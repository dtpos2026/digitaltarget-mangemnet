import type { Firestore, Query } from "firebase-admin/firestore";
import type { Logger } from "pino";
import type { Config } from "./config.js";
import { AccountConnection } from "./connection.js";
import type { FirestoreStore } from "./store.js";

type Bucket = ConstructorParameters<typeof AccountConnection>[0]["bucket"];

interface OutboxDoc {
  id: string;
  accountId: string;
  conversationId: string;
  text: string;
  status: string;
  createdBy: string;
  createdByEmail?: string;
}

/**
 * Watches every users/{ws}/waAccounts document (or one workspace when
 * WORKSPACE_UID is set), keeps one AccountConnection per account, and sends
 * replies queued by the portal in users/{ws}/waOutbox.
 */
export class Manager {
  private readonly connections = new Map<string, AccountConnection>();
  private readonly outboxWatchers = new Map<string, () => void>();
  private unsubAccounts: (() => void) | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(private readonly deps: { db: Firestore; bucket: Bucket; cfg: Config; log: Logger; store: FirestoreStore }) {}

  start() {
    const { db, cfg, log } = this.deps;
    const q: Query = cfg.workspaceUid
      ? db.collection("users").doc(cfg.workspaceUid).collection("waAccounts")
      : db.collectionGroup("waAccounts");
    this.unsubAccounts = q.onSnapshot(
      (snap) => {
        for (const change of snap.docChanges()) {
          const ws = change.doc.ref.parent.parent?.id;
          if (!ws) continue;
          const key = `${ws}/${change.doc.id}`;
          if (change.type === "removed") {
            void this.connections.get(key)?.stop(true);
            this.connections.delete(key);
            continue;
          }
          let conn = this.connections.get(key);
          if (!conn) {
            conn = new AccountConnection({ ...this.deps, ws, accountId: change.doc.id, log: log.child({ ws, account: change.doc.id }) });
            this.connections.set(key, conn);
          }
          this.watchOutbox(ws);
          conn.onAccountDoc(change.doc.data()).catch((e) => log.error({ err: e, key }, "account update failed"));
        }
      },
      (err) => log.error({ err }, "waAccounts listener failed")
    );
    // Lets the portal tell "service offline" apart from "phone offline".
    this.heartbeat = setInterval(() => {
      for (const c of this.connections.values()) {
        c.ref.set({ heartbeatAt: new Date().toISOString(), serviceInstance: cfg.instanceId }, { merge: true }).catch(() => undefined);
      }
    }, 30_000);
    this.heartbeat.unref();
  }

  private watchOutbox(ws: string) {
    if (this.outboxWatchers.has(ws)) return;
    const { db, log } = this.deps;
    const col = db.collection("users").doc(ws).collection("waOutbox");
    const unsub = col.where("status", "==", "queued").onSnapshot(
      (snap) => {
        for (const change of snap.docChanges()) {
          if (change.type === "added") void this.sendQueued(ws, change.doc.ref.id);
        }
      },
      (err) => log.error({ err, ws }, "outbox listener failed")
    );
    this.outboxWatchers.set(ws, unsub);
  }

  private async sendQueued(ws: string, id: string) {
    const { db, log, cfg } = this.deps;
    const ref = db.collection("users").doc(ws).collection("waOutbox").doc(id);
    // Claim it so a second instance / duplicate snapshot cannot send twice.
    const item = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.get("status") !== "queued") return null;
      tx.update(ref, { status: "sending", claimedBy: cfg.instanceId, claimedAt: new Date().toISOString() });
      return snap.data() as OutboxDoc;
    });
    if (!item) return;
    const conn = this.connections.get(`${ws}/${item.accountId}`);
    try {
      if (!conn) throw new Error("WhatsApp account nahi mila");
      const text = String(item.text || "").trim();
      if (!text) throw new Error("Khali message");
      const rec = await conn.sendText(item.conversationId, text, { uid: item.createdBy, email: item.createdByEmail });
      await ref.update({ status: "sent", waMessageId: rec.id, sentAt: rec.at });
      await db.collection("users").doc(ws).collection("auditLogs").doc(`AU-WA-${rec.id}`).set({
        id: `AU-WA-${rec.id}`,
        at: rec.at,
        actorUid: item.createdBy,
        actorEmail: item.createdByEmail || "",
        action: "whatsapp.send",
        collection: "waConversations",
        entityId: item.conversationId,
        entityLabel: item.conversationId,
        details: text.slice(0, 200),
      });
    } catch (e) {
      log.warn({ err: e, ws, id }, "outbox send failed");
      await ref.update({ status: "failed", error: (e as Error).message, failedAt: new Date().toISOString() }).catch(() => undefined);
    }
  }

  summary() {
    return [...this.connections.values()].map((c) => c.summary());
  }

  /** SIGTERM: close sockets but keep sessions linked, release leases. */
  async shutdown() {
    this.unsubAccounts?.();
    for (const u of this.outboxWatchers.values()) u();
    if (this.heartbeat) clearInterval(this.heartbeat);
    await Promise.all([...this.connections.values()].map((c) => c.stop(true)));
  }
}
