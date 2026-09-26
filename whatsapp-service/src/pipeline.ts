import { randomBytes } from "node:crypto";
import type { Chat, Contact, WACallEvent, WAMessage } from "@whiskeysockets/baileys";
import { chatTypeOf, parseMessage, statusLabel, type ParsedMessage } from "./parser.js";
import { isLidUser, isPnUser, jidNormalizedUser } from "@whiskeysockets/baileys";
import { formatLocalPhone, jidUser, normalizePhone } from "./phone.js";
import { detectServiceLine } from "./classify.js";
import type {
  AccountSettings,
  CaptureStore,
  ConversationRecord,
  LeadRecord,
  MessageRecord,
  StoredMedia,
} from "./types.js";

export interface Log {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface PipelineOptions {
  ws: string;
  accountId: string;
  settings: () => AccountSettings;
  timezone: string;
  log: Log;
  /** Looks up the phone-number jid for a privacy id (…@lid) chat. */
  resolvePnForLid?: (lidJid: string) => Promise<string | null>;
  /** Downloads media of a new message to Storage. */
  storeMedia?: (msg: WAMessage, parsed: ParsedMessage, conversationId: string) => Promise<StoredMedia | null>;
  /** Who sent a message from the portal inbox (outbox), by WhatsApp message id. */
  portalSender?: (messageId: string) => { uid: string; email?: string } | undefined;
  now?: () => number;
}

/** Same shape as the portal's uid("LD"): LD-<time36>-<rand>. */
export function newLeadId(now = Date.now()): string {
  return `LD-${now.toString(36).toUpperCase()}-${randomBytes(4).toString("hex").slice(0, 5).toUpperCase()}`;
}

export function localDate(ts: number, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, matching the portal's todayISO().
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}

/** Readable, stable conversation ids: phone digits, lid_<id> or g_<id>. */
export function conversationIdFor(p: Pick<ParsedMessage, "chatType" | "chatJid" | "pnJid" | "lidJid">): string {
  if (p.chatType === "group") return "g_" + jidUser(p.chatJid);
  if (p.pnJid) return jidUser(p.pnJid);
  if (p.lidJid) return "lid_" + jidUser(p.lidJid);
  return "x_" + jidUser(p.chatJid).replace(/[^\w-]/g, "_");
}

function displayName(conv: Partial<ConversationRecord>): string {
  return conv.contactName || conv.pushName || formatLocalPhone(conv.phone || "") || "WhatsApp contact";
}

/**
 * WhatsApp → Firestore capture:
 * message → conversation (+stats) → message doc → lead (deduplicated by phone) → notifications.
 */
export class CapturePipeline {
  private readonly contactNames = new Map<string, string>();
  private readonly lidToConversation = new Map<string, string>();
  private readonly now: () => number;

  constructor(private readonly store: CaptureStore, private readonly o: PipelineOptions) {
    this.now = o.now || Date.now;
  }

  /** Saved contact names from history sync / contact updates. */
  async handleContacts(contacts: Partial<Contact>[]) {
    for (const c of contacts) {
      const name = c.name || c.verifiedName || undefined;
      if (!name) continue;
      for (const jid of [c.id, c.phoneNumber, c.lid]) {
        if (!jid) continue;
        const user = jidUser(jid);
        if (this.contactNames.get(user) === name) continue;
        this.contactNames.set(user, name);
        const id = jid.endsWith("@lid") ? "lid_" + user : user;
        await this.store.updateConversationIfExists(this.o.ws, id, { contactName: name }).catch(() => undefined);
      }
    }
  }

  /** Chat list from the initial history sync (creates conversations even without messages). */
  async handleChats(chats: Chat[]) {
    const settings = this.o.settings();
    for (const chat of chats) {
      if (!chat.id) continue;
      const chatType = chatTypeOf(chat.id);
      if (chatType === "status" || chatType === "newsletter" || chatType === "broadcast") continue;
      if (chatType === "group" && settings.ignoreGroups) continue;
      const pnJid = chat.id.endsWith("@s.whatsapp.net") ? chat.id : chat.pnJid || undefined;
      const lidJid = chat.id.endsWith("@lid") ? chat.id : chat.lidJid || undefined;
      const id = await this.resolveConversationId({ chatType, chatJid: chat.id, pnJid, lidJid });
      const existing = await this.store.getConversation(this.o.ws, id);
      const ts = chat.conversationTimestamp ? Number(chat.conversationTimestamp) * 1000 : undefined;
      const patch: Partial<ConversationRecord> = {
        id,
        accountId: this.o.accountId,
        jid: chat.id,
        chatType,
        updatedAt: this.now(),
        ...(pnJid ? { pnJid, phone: jidUser(pnJid) } : {}),
        ...(lidJid ? { lidJid } : {}),
      };
      const saved = this.contactNames.get(jidUser(pnJid || chat.id));
      if (saved) patch.contactName = saved;
      else if (chat.name && !existing?.contactName) patch.contactName = chat.name;
      if (!existing) {
        patch.createdAt = ts || this.now();
        patch.unreadCount = chat.unreadCount || 0;
        if (ts) patch.lastMessageAt = ts;
      }
      await this.store.upsertConversation(this.o.ws, id, patch);
    }
  }

  /** New / appended messages (messages.upsert) and history batches. */
  async handleMessages(messages: WAMessage[], source: "realtime" | "history") {
    for (const msg of messages) {
      let parsed: ParsedMessage | null = null;
      try {
        parsed = parseMessage(msg);
        if (!parsed) continue;
        await this.handleOne(msg, parsed, source);
      } catch (e) {
        this.o.log.error({ err: e, id: msg.key?.id, chat: msg.key?.remoteJid }, "message capture failed");
      }
    }
  }

  /**
   * Calls ring on the phone (a linked device cannot take them); we log them in
   * the chat so the inbox and performance numbers include them. A call from a
   * new number creates a lead like a message does.
   */
  async handleCalls(calls: WACallEvent[]) {
    for (const c of calls) {
      try {
        if (c.isGroup) continue;
        const chatJid = c.chatId || c.from;
        const alt = c.callerPn;
        const kindLabel = c.isVideo ? "video call" : "voice call";
        const p: ParsedMessage = {
          id: `call_${c.id}`,
          chatJid,
          chatType: "user",
          fromMe: false,
          senderJid: c.from,
          timestamp: c.date ? new Date(c.date).getTime() : this.now(),
          kind: "call",
          text: `📞 Incoming ${kindLabel}`,
        };
        if (isPnUser(chatJid)) p.pnJid = jidNormalizedUser(chatJid);
        else if (alt) p.pnJid = jidNormalizedUser(alt.includes("@") ? alt : `${alt}@s.whatsapp.net`);
        if (isLidUser(chatJid)) p.lidJid = jidNormalizedUser(chatJid);
        if (c.status === "offer") {
          await this.handleOne(null, p, "realtime");
          continue;
        }
        const ended: Record<string, string> = {
          timeout: `📵 Missed ${kindLabel}`,
          reject: `📵 Declined ${kindLabel}`,
          accept: `📞 Answered ${kindLabel}`,
        };
        if (!ended[c.status]) continue;
        if (!p.pnJid && p.lidJid && this.o.resolvePnForLid) p.pnJid = (await this.o.resolvePnForLid(p.lidJid).catch(() => null)) || undefined;
        const convId = await this.resolveConversationId(p);
        await this.store.patchMessage(this.o.ws, convId, p.id, { text: ended[c.status], callStatus: c.status }).catch(() => undefined);
        await this.store.updateConversationIfExists(this.o.ws, convId, { lastMessageText: ended[c.status] }).catch(() => undefined);
        if (c.status === "timeout") {
          await this.store.bumpStats(this.o.ws, localDate(p.timestamp, this.o.timezone), { missedCalls: 1 }).catch(() => undefined);
        }
      } catch (e) {
        this.o.log.error({ err: e, call: c.id }, "call capture failed");
      }
    }
  }

  /** Delivery / read receipts and edits for existing messages. */
  async handleUpdates(updates: { key: WAMessage["key"]; update: Partial<WAMessage> }[]) {
    for (const { key, update } of updates) {
      if (!key?.id || !key.remoteJid || update.status == null) continue;
      const chatType = chatTypeOf(key.remoteJid);
      if (chatType !== "user" && chatType !== "group") continue;
      const id = await this.resolveConversationId({
        chatType,
        chatJid: key.remoteJid,
        pnJid: key.remoteJid.endsWith("@s.whatsapp.net") ? key.remoteJid : key.remoteJidAlt,
        lidJid: key.remoteJid.endsWith("@lid") ? key.remoteJid : undefined,
      });
      await this.store
        .patchMessage(this.o.ws, id, key.id, { status: statusLabel(update.status, !!key.fromMe) })
        .catch(() => undefined); // receipt for a message we never stored
    }
  }

  private skip(p: ParsedMessage): boolean {
    if (p.chatType === "status" || p.chatType === "newsletter" || p.chatType === "broadcast") return true;
    return p.chatType === "group" && this.o.settings().ignoreGroups;
  }

  /** Keeps one conversation per person even when WhatsApp switches between phone and privacy ids. */
  private async resolveConversationId(p: Pick<ParsedMessage, "chatType" | "chatJid" | "pnJid" | "lidJid">): Promise<string> {
    if (p.chatType !== "user") return conversationIdFor(p);
    if (p.lidJid) {
      const known = this.lidToConversation.get(p.lidJid) ?? (await this.store.findConversationIdByLid(this.o.ws, p.lidJid));
      if (known) {
        this.lidToConversation.set(p.lidJid, known);
        return known;
      }
    }
    const id = conversationIdFor(p);
    if (p.lidJid) this.lidToConversation.set(p.lidJid, id);
    return id;
  }

  private async handleOne(msg: WAMessage | null, p: ParsedMessage, source: "realtime" | "history") {
    if (this.skip(p)) return;
    const { ws } = this.o;

    if (p.chatType === "user" && !p.pnJid && p.lidJid && this.o.resolvePnForLid) {
      const pn = await this.o.resolvePnForLid(p.lidJid).catch(() => null);
      if (pn) p.pnJid = pn;
    }
    const convId = await this.resolveConversationId(p);

    if (p.kind === "reaction" || p.kind === "revoke" || p.kind === "edit") {
      if (!p.targetId) return;
      const patch: Record<string, unknown> =
        p.kind === "reaction"
          ? { [`reactions.${jidUser(p.fromMe ? "me" : p.senderJid) || "me"}`]: p.text || null }
          : p.kind === "revoke"
            ? { deleted: true, deletedAt: p.timestamp }
            : { text: p.text, edited: true, editedAt: p.timestamp };
      await this.store.patchMessage(ws, convId, p.targetId, patch).catch(() => undefined);
      return;
    }

    const conv = await this.store.getConversation(ws, convId);
    const phone = p.pnJid ? normalizePhone(jidUser(p.pnJid)) : "";
    const patch: Partial<ConversationRecord> = {
      id: convId,
      accountId: this.o.accountId,
      jid: p.chatJid,
      chatType: p.chatType,
      updatedAt: this.now(),
    };
    if (p.pnJid) patch.pnJid = p.pnJid;
    if (phone) patch.phone = phone;
    if (p.lidJid) patch.lidJid = p.lidJid;
    const saved = this.contactNames.get(phone) || (p.lidJid ? this.contactNames.get(jidUser(p.lidJid)) : undefined);
    if (saved && saved !== conv?.contactName) patch.contactName = saved;
    if (!p.fromMe && p.pushName && p.chatType === "user" && p.pushName !== conv?.pushName) patch.pushName = p.pushName;
    if (!conv) patch.createdAt = p.timestamp;

    if (!conv?.lastMessageAt || p.timestamp >= conv.lastMessageAt) {
      patch.lastMessageAt = p.timestamp;
      patch.lastMessageText = (p.text || `[${p.kind}]`).slice(0, 200);
      patch.lastMessageFromMe = p.fromMe;
      patch.lastMessageKind = p.kind;
    }
    if (p.fromMe) {
      patch.outboundCount = (conv?.outboundCount || 0) + 1;
      if (!conv?.lastOutboundAt || p.timestamp > conv.lastOutboundAt) patch.lastOutboundAt = p.timestamp;
      if (conv?.firstInboundAt && !conv.firstResponseAt && p.timestamp >= conv.firstInboundAt) {
        patch.firstResponseAt = p.timestamp;
        patch.firstResponseMs = p.timestamp - conv.firstInboundAt;
      }
    } else {
      patch.inboundCount = (conv?.inboundCount || 0) + 1;
      if (!conv?.lastInboundAt || p.timestamp > conv.lastInboundAt) patch.lastInboundAt = p.timestamp;
      if (!conv?.firstInboundAt || p.timestamp < conv.firstInboundAt) patch.firstInboundAt = p.timestamp;
    }
    const unread = !p.fromMe && source === "realtime" ? 1 : 0;
    await this.store.upsertConversation(ws, convId, patch, unread);

    let media: StoredMedia | undefined = p.media;
    if (msg && p.media && source === "realtime" && this.o.settings().downloadMedia && this.o.storeMedia) {
      media = (await this.o.storeMedia(msg, p, convId).catch((e) => {
        this.o.log.warn({ err: e, id: p.id }, "media download failed");
        return { ...p.media!, skipped: "download failed" };
      })) || p.media;
    }

    const record: MessageRecord = {
      id: p.id,
      conversationId: convId,
      accountId: this.o.accountId,
      fromMe: p.fromMe,
      sender: p.senderJid,
      kind: p.kind,
      text: p.text,
      timestamp: p.timestamp,
      at: new Date(p.timestamp).toISOString(),
      status: statusLabel(p.status, p.fromMe),
      source,
      ...(p.pushName && !p.fromMe ? { senderName: p.pushName } : {}),
      ...(media ? { media } : {}),
      ...(p.quotedId ? { quotedId: p.quotedId } : {}),
    };
    const sender = p.fromMe ? this.o.portalSender?.(p.id) : undefined;
    if (sender) {
      record.source = "portal";
      record.createdBy = sender.uid;
      if (sender.email) record.senderName = sender.email;
    }
    if (p.kind === "call") record.callStatus = "offer";
    await this.store.saveMessages(ws, convId, [record]);

    // Daily counters for the Performance page.
    const inc: Record<string, number> = {};
    if (p.kind === "call") inc.calls = 1;
    else if (p.fromMe) {
      inc.outbound = 1;
      if (sender) { inc.portalSent = 1; inc[`byUser.${sender.uid}.sent`] = 1; }
    } else inc.inbound = 1;
    if (!conv) inc.newConversations = 1;
    if (patch.firstResponseMs != null) {
      inc.responses = 1;
      inc.responseMsTotal = patch.firstResponseMs;
      if (sender) { inc[`byUser.${sender.uid}.responses`] = 1; inc[`byUser.${sender.uid}.responseMsTotal`] = patch.firstResponseMs; }
    }
    await this.store
      .bumpStats(ws, localDate(p.timestamp, this.o.timezone), inc, sender?.email ? { [`byUser.${sender.uid}.email`]: sender.email } : undefined)
      .catch((e) => this.o.log.warn({ err: e }, "stats update failed"));

    if (p.fromMe || p.chatType !== "user") return;
    const merged: ConversationRecord = { ...(conv || ({} as ConversationRecord)), ...patch } as ConversationRecord;
    if (conv?.leadId) {
      if (source === "realtime") {
        await this.store.touchLead(ws, conv.leadId, { lastContactAt: record.at, lastWhatsAppAt: record.at }).catch(() => undefined);
        await this.notifyAssignee(merged, p);
      }
      return;
    }
    const settings = this.o.settings();
    const wantLead = settings.autoCreateLeads && (source === "realtime" || settings.leadsFromHistory);
    if (wantLead) await this.ensureLead(merged, p, source);
  }

  /** Finds or creates the lead for a conversation and links them. */
  private async ensureLead(conv: ConversationRecord, p: ParsedMessage, source: "realtime" | "history") {
    const { ws } = this.o;
    const settings = this.o.settings();
    const phone = conv.phone || "";
    let leadId = phone ? await this.store.findLeadIdByPhone(ws, phone) : null;
    let created = false;

    if (!leadId) {
      const at = new Date(p.timestamp).toISOString();
      const local = formatLocalPhone(phone);
      const lead: LeadRecord = {
        id: newLeadId(this.now()),
        name: displayName(conv),
        phone: local,
        whatsapp: local,
        phoneE164: phone,
        category: "Other",
        serviceType: detectServiceLine(p.text || ""),
        software: "",
        plan: "Undecided",
        status: "New",
        source: "WhatsApp",
        referralBy: "",
        meetingDate: "",
        followUpDate: "",
        notes: p.text ? `WhatsApp: ${p.text.slice(0, 300)}` : "WhatsApp inquiry",
        date: localDate(p.timestamp, this.o.timezone),
        createdAt: at,
        createdBy: "whatsapp-service",
        conversationId: conv.id,
        waJid: conv.jid,
        waAccountId: this.o.accountId,
        assignedTo: settings.defaultAssignee || "",
      };
      const dedupKey = phone || conv.id;
      const res = await this.store.createLeadIfAbsent(ws, dedupKey, lead);
      leadId = res.leadId;
      created = res.created;
    }

    await this.store.upsertConversation(ws, conv.id, {
      leadId,
      ...(created && settings.defaultAssignee && !conv.assignedTo ? { assignedTo: settings.defaultAssignee } : {}),
    });
    if (!created) {
      // Existing lead (added manually or from another source): link it to this chat.
      await this.store
        .touchLead(ws, leadId, { lastContactAt: new Date(p.timestamp).toISOString(), conversationId: conv.id, waJid: conv.jid })
        .catch(() => undefined);
      return;
    }
    this.o.log.info({ leadId, conversation: conv.id }, "new WhatsApp lead");
    await this.store.bumpStats(ws, localDate(p.timestamp, this.o.timezone), { newLeads: 1 }).catch(() => undefined);
    if (source !== "realtime" || !settings.notifyOnNewLead) return;
    const uids = await this.store.listRecipients(ws, ["leads.view", "whatsapp.view"]);
    await this.store.notify(ws, uids, {
      type: "lead.new",
      title: "New WhatsApp lead",
      body: `${displayName(conv)}${phone ? ` (${formatLocalPhone(phone)})` : ""}: ${(p.text || `[${p.kind}]`).slice(0, 140)}`,
      link: { tab: "whatsapp", conversationId: conv.id, leadId },
    });
  }

  private async notifyAssignee(conv: ConversationRecord, p: ParsedMessage) {
    if (!conv.assignedTo) return;
    const uids = await this.store.listRecipients(this.o.ws, ["whatsapp.view"], conv.assignedTo);
    if (!uids.length) return;
    await this.store.notify(this.o.ws, uids, {
      type: "whatsapp.message",
      title: `WhatsApp: ${displayName(conv)}`,
      body: (p.text || `[${p.kind}]`).slice(0, 140),
      link: { tab: "whatsapp", conversationId: conv.id, leadId: conv.leadId },
    });
  }
}
