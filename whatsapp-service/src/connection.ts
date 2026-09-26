import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type ConnectionState,
  type WAMessage,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import type { Boom } from "@hapi/boom";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import type { Logger } from "pino";
import { useFirestoreAuthState } from "./auth-state.js";
import type { Config } from "./config.js";
import { SessionCipher } from "./crypto.js";
import { Lease } from "./lease.js";
import { makeMediaStorer } from "./media.js";
import { jidUser, normalizePhone } from "./phone.js";
import { CapturePipeline } from "./pipeline.js";
import type { FirestoreStore } from "./store.js";
import { mergeSettings, type AccountSettings, type MessageRecord } from "./types.js";

export type AccountStatus = "disconnected" | "connecting" | "qr" | "pairing" | "connected" | "logged_out" | "error";

export interface AccountCommand {
  id: string;
  action: "connect" | "disconnect" | "logout" | "reconnect" | "pair_code";
  phone?: string;
  requestedBy?: string;
  requestedAt?: string;
}

type Bucket = Parameters<typeof makeMediaStorer>[0]["bucket"];

const QR_TTL_MS = 60_000;

/**
 * One linked WhatsApp device (users/{ws}/waAccounts/{accountId}).
 * Status, QR / pairing code and history progress are published on the
 * account document so the portal can show them live.
 */
export class AccountConnection {
  readonly sessionId: string;
  readonly ref: DocumentReference;
  status: AccountStatus = "disconnected";
  private sock: WASocket | null = null;
  private auth: Awaited<ReturnType<typeof useFirestoreAuthState>> | null = null;
  private readonly lease: Lease;
  private settings: AccountSettings = mergeSettings({});
  private expectedPhone = "";
  private stopping = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private attempts = 0;
  private qrCount = 0;
  private pairingPhone: string | null = null;
  private pairingRequested = false;
  private lastCommandId: string | null = null;
  private seenFirstDoc = false;
  private queue: Promise<unknown> = Promise.resolve();
  private lastSendAt = 0;
  private readonly sent = new Map<string, { message?: proto.IMessage | null; uid: string; email?: string }>();
  private readonly pipeline: CapturePipeline;
  private history = { chats: 0, messages: 0, status: "idle" as string };

  constructor(
    private readonly deps: {
      db: Firestore;
      bucket: Bucket | null;
      cfg: Config;
      log: Logger;
      store: FirestoreStore;
      ws: string;
      accountId: string;
    }
  ) {
    const { db, ws, accountId, cfg } = deps;
    this.sessionId = `${ws}__${accountId}`;
    this.ref = db.collection("users").doc(ws).collection("waAccounts").doc(accountId);
    this.lease = new Lease(db, this.sessionId, cfg.instanceId);
    const storeMedia = deps.bucket
      ? makeMediaStorer({ bucket: deps.bucket, ws, maxBytes: cfg.mediaMaxBytes, getSocket: () => this.sock })
      : undefined;
    this.pipeline = new CapturePipeline(deps.store, {
      ws,
      accountId,
      settings: () => this.settings,
      timezone: cfg.timezone,
      log: deps.log,
      storeMedia,
      resolvePnForLid: async (lid) => {
        const pn = await this.sock?.signalRepository.lidMapping.getPNForLID(lid);
        return pn ? `${jidUser(pn)}@s.whatsapp.net` : null;
      },
      portalSender: (id) => this.sent.get(id),
    });
  }

  private get log() {
    return this.deps.log;
  }

  /** Serialises all event handling for this account. */
  private enqueue(fn: () => Promise<unknown>) {
    this.queue = this.queue.then(fn).catch((e) => this.log.error({ err: e }, "event handling failed"));
    return this.queue;
  }

  private async publish(patch: Record<string, unknown>) {
    if (typeof patch.status === "string") this.status = patch.status as AccountStatus;
    const now = new Date().toISOString();
    // Every publish doubles as a heartbeat so the portal never shows "service offline" mid-connect.
    await this.ref.set({ ...patch, updatedAt: now, heartbeatAt: now, serviceInstance: this.deps.cfg.instanceId }, { merge: true });
  }

  /** Called for every snapshot of the account document. */
  async onAccountDoc(data: Record<string, unknown>) {
    this.settings = mergeSettings(data.settings);
    this.expectedPhone = normalizePhone(data.expectedPhone);
    const firstDoc = !this.seenFirstDoc;
    this.seenFirstDoc = true;

    const cmd = data.command as AccountCommand | null | undefined;
    if (cmd?.id && cmd.id !== data.commandAck && cmd.id !== this.lastCommandId) {
      this.lastCommandId = cmd.id;
      await this.ref.set({ commandAck: cmd.id }, { merge: true });
      this.log.info({ action: cmd.action, by: cmd.requestedBy }, "account command");
      await this.runCommand(cmd);
      return;
    }
    // Resume linked sessions after a restart / redeploy.
    if (firstDoc && data.active === true && !this.sock) await this.start();
  }

  private async runCommand(cmd: AccountCommand) {
    switch (cmd.action) {
      case "connect":
        await this.publish({ active: true, lastError: null });
        return this.start();
      case "pair_code": {
        const phone = normalizePhone(cmd.phone);
        if (!phone) return this.publish({ status: "error", lastError: "Pairing ke liye sahi phone number dein" });
        await this.stop(false);
        this.pairingPhone = phone;
        await this.publish({ active: true, lastError: null });
        return this.start();
      }
      case "reconnect":
        await this.stop(false);
        await this.publish({ active: true, lastError: null });
        return this.start();
      case "disconnect":
        await this.stop(true);
        return this.publish({ status: "disconnected", active: false, qr: null, pairingCode: null });
      case "logout":
        return this.logout();
    }
  }

  async start() {
    if (this.sock) return;
    if (!(await this.lease.acquire())) {
      await this.publish({ status: "error", lastError: "Yeh WhatsApp session kisi aur service instance par chal raha hai." });
      return;
    }
    this.lease.keepAlive(() => {
      this.log.warn("lease lost; another instance took over");
      void this.stop(false);
      void this.publish({ status: "error", lastError: "Session doosre service instance ne le liya." });
    });
    this.stopping = false;
    this.qrCount = 0;
    this.pairingRequested = false;
    this.auth = await useFirestoreAuthState(this.deps.db, this.sessionId, new SessionCipher(this.deps.cfg.sessionKey));
    const { version } = await fetchLatestBaileysVersion({ signal: AbortSignal.timeout(5000) }).catch(() => ({ version: undefined }));
    const baileysLog = this.log.child({ module: "baileys" }, { level: process.env.BAILEYS_LOG_LEVEL || "warn" });

    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: {
        creds: this.auth.state.creds,
        keys: makeCacheableSignalKeyStore(this.auth.state.keys, baileysLog),
      },
      logger: baileysLog,
      // A desktop identity lets the phone share full chat history on link.
      browser: Browsers.macOS("Desktop"),
      syncFullHistory: this.settings.syncFullHistory,
      // Stay "offline" so the phone keeps getting notifications.
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => (key.id ? this.sent.get(key.id)?.message || undefined : undefined),
    });
    this.sock = sock;
    await this.publish({ status: "connecting", qr: null, pairingCode: null });

    sock.ev.on("creds.update", () => void this.auth?.saveCreds().catch((e) => this.log.error({ err: e }, "saveCreds failed")));
    sock.ev.on("connection.update", (u) => void this.enqueue(() => this.onConnectionUpdate(sock, u)));
    sock.ev.on("messaging-history.set", (h) =>
      void this.enqueue(async () => {
        this.history.status = "running";
        await this.deps.store.runBatch(async () => {
          await this.pipeline.handleContacts(h.contacts || []);
          await this.pipeline.handleChats(h.chats || []);
          await this.pipeline.handleMessages(h.messages || [], "history");
        });
        this.history.chats += h.chats?.length || 0;
        this.history.messages += h.messages?.length || 0;
        await this.publish({
          history: { ...this.history, progress: h.progress ?? null, lastBatchAt: new Date().toISOString() },
        });
      })
    );
    sock.ev.on("messaging-history.status", (s) =>
      void this.enqueue(async () => {
        if (s.status !== "complete") return;
        this.history.status = "complete";
        await this.publish({ history: { ...this.history, completedAt: new Date().toISOString() } });
      })
    );
    sock.ev.on("messages.upsert", ({ messages }) => void this.enqueue(() => this.pipeline.handleMessages(messages, "realtime")));
    sock.ev.on("messages.update", (updates) => void this.enqueue(() => this.pipeline.handleUpdates(updates)));
    sock.ev.on("contacts.upsert", (c) => void this.enqueue(() => this.pipeline.handleContacts(c)));
    sock.ev.on("contacts.update", (c) => void this.enqueue(() => this.pipeline.handleContacts(c)));
  }

  private async onConnectionUpdate(sock: WASocket, u: Partial<ConnectionState>) {
    if (sock !== this.sock) return; // stale socket
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      this.qrCount++;
      if (this.pairingPhone && !this.pairingRequested) {
        this.pairingRequested = true;
        try {
          const code = await sock.requestPairingCode(this.pairingPhone);
          await this.publish({ status: "pairing", pairingCode: code, pairingPhone: this.pairingPhone, qr: null });
        } catch (e) {
          await this.publish({ status: "error", lastError: `Pairing code nahi mila: ${(e as Error).message}` });
        }
      } else if (!this.pairingPhone) {
        await this.publish({ status: "qr", qr, qrAt: Date.now(), qrExpiresAt: Date.now() + QR_TTL_MS, qrCount: this.qrCount });
      }
    }

    if (connection === "open") {
      this.attempts = 0;
      this.pairingPhone = null;
      const me = sock.user;
      const phone = normalizePhone(jidUser(me?.id));
      const mismatch = !!this.expectedPhone && !!phone && phone !== this.expectedPhone;
      await this.publish({
        status: "connected",
        active: true,
        qr: null,
        pairingCode: null,
        me: { id: me?.id || "", phone, name: me?.name || me?.notify || "" },
        connectedAt: new Date().toISOString(),
        numberMismatch: mismatch,
        lastError: mismatch ? `Connected number ${phone} expected ${this.expectedPhone} se mukhtalif hai` : null,
      });
      this.log.info({ phone }, "WhatsApp connected");
    }

    if (connection === "close") {
      this.sock = null;
      const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || "closed";
      this.log.warn({ code, reason }, "WhatsApp connection closed");
      if (this.stopping) return;

      if (code === DisconnectReason.loggedOut) {
        await this.auth?.clear();
        await this.lease.release();
        await this.publish({ status: "logged_out", active: false, qr: null, pairingCode: null, me: null,
          lastError: "Phone par Linked Devices se logout kar diya gaya. Dobara connect karne ke liye QR scan karein." });
        return;
      }
      if (code === DisconnectReason.connectionReplaced || code === DisconnectReason.forbidden) {
        await this.lease.release();
        await this.publish({ status: "error", active: false, qr: null,
          lastError: code === DisconnectReason.forbidden
            ? "WhatsApp ne is session ko block kar diya (403). Phone check karein."
            : "Yeh session kisi aur jagah khul gaya (connection replaced)." });
        return;
      }
      const registered = !!this.auth?.state.creds.registered;
      if (!registered && (this.qrCount > 0 || this.pairingRequested) && code !== DisconnectReason.restartRequired) {
        await this.lease.release();
        await this.publish({ status: "disconnected", active: false, qr: null, pairingCode: null,
          lastError: "QR / pairing code ka waqt khatam ho gaya. Dobara 'Connect' dabayein." });
        return;
      }
      // restartRequired (normal right after scanning) → immediately; otherwise back off.
      const delay = code === DisconnectReason.restartRequired ? 0 : Math.min(60_000, 2 ** this.attempts * 1000);
      this.attempts++;
      await this.publish({ status: "connecting", lastError: code === DisconnectReason.restartRequired ? null : `Reconnecting (${reason})` });
      this.reconnectTimer = setTimeout(() => void this.start().catch((e) => this.log.error({ err: e }, "reconnect failed")), delay);
    }
  }

  /** Close the socket but keep the linked session (can resume without QR). */
  async stop(releaseLease: boolean) {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const sock = this.sock;
    this.sock = null;
    if (sock) await sock.end(undefined).catch(() => undefined);
    if (releaseLease) await this.lease.release();
    else this.lease.stop();
  }

  /** Unlink the device from the phone and delete the stored session. */
  async logout() {
    this.stopping = true;
    const sock = this.sock;
    this.sock = null;
    if (sock) await sock.logout("Disconnected from Digital Target portal").catch(() => undefined);
    if (!this.auth) this.auth = await useFirestoreAuthState(this.deps.db, this.sessionId, new SessionCipher(this.deps.cfg.sessionKey));
    await this.auth.clear();
    await this.lease.release();
    await this.publish({ status: "logged_out", active: false, qr: null, pairingCode: null, me: null, lastError: null,
      history: { chats: 0, messages: 0, status: "idle" } });
  }

  /** Sends a text from the portal inbox; returns the stored message record. */
  async sendText(conversationId: string, text: string, by: { uid: string; email?: string }): Promise<MessageRecord> {
    const sock = this.sock;
    if (!sock || this.status !== "connected") throw new Error("WhatsApp connected nahi hai");
    const conv = await this.deps.store.getConversation(this.deps.ws, conversationId);
    if (!conv || conv.accountId !== this.deps.accountId) throw new Error("Conversation nahi mili");
    const wait = this.lastSendAt + this.deps.cfg.sendIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastSendAt = Date.now();
    const res = await sock.sendMessage(conv.jid, { text });
    if (!res?.key.id) throw new Error("Message send nahi hua");
    this.sent.set(res.key.id, { message: res.message, ...by });
    if (this.sent.size > 500) this.sent.delete(this.sent.keys().next().value as string);
    const now = Date.now();
    const record: MessageRecord = {
      id: res.key.id,
      conversationId,
      accountId: this.deps.accountId,
      fromMe: true,
      sender: sock.user?.id || "me",
      senderName: by.email,
      kind: "text",
      text,
      timestamp: now,
      at: new Date(now).toISOString(),
      status: "sent",
      source: "portal",
      createdBy: by.uid,
    };
    await this.deps.store.saveMessages(this.deps.ws, conversationId, [record]);
    return record;
  }

  /** Test hook: feed raw messages through the capture pipeline. */
  ingest(messages: WAMessage[], source: "realtime" | "history") {
    return this.enqueue(() => this.pipeline.handleMessages(messages, source));
  }

  summary() {
    return { ws: this.deps.ws, accountId: this.deps.accountId, status: this.status };
  }
}
