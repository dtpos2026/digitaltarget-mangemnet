import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { FieldValue, type BulkWriter, type Firestore } from "firebase-admin/firestore";
import { normalizePhone } from "./phone.js";
import type {
  CaptureStore,
  ConversationRecord,
  LeadRecord,
  MessageRecord,
  NotificationInput,
} from "./types.js";

interface Presets {
  superRoles: string[];
  permissions: { key: string }[];
  presets: Record<string, string[]>;
}

/** Same rule as the portal's effectivePermissions(). */
export function effectivePermissions(presets: Presets, r: { role?: string; permissions?: unknown; disabled?: boolean }): Set<string> {
  if (!r || r.disabled || !r.role) return new Set();
  if (presets.superRoles.includes(r.role)) return new Set(presets.permissions.map((p) => p.key));
  const list = Array.isArray(r.permissions) ? (r.permissions as string[]) : presets.presets[r.role] || [];
  return new Set(list);
}

/** Dotted counter keys → nested object of FieldValue.increment (set+merge friendly). */
export function statsDoc(day: string, inc: Record<string, number>, set: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = { day, updatedAt: new Date().toISOString() };
  const put = (path: string, value: unknown) => {
    const parts = path.split(".");
    let node = out;
    for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Record<string, unknown>;
    node[parts[parts.length - 1]] = value;
  };
  for (const [k, v] of Object.entries(inc)) put(k, FieldValue.increment(v));
  for (const [k, v] of Object.entries(set)) put(k, v);
  return out;
}

const CONV_CACHE_MS = 30_000;
const ROLES_CACHE_MS = 60_000;
const LEADS_CACHE_MS = 5 * 60_000;

/**
 * Firestore implementation of the capture store (Admin SDK — bypasses rules,
 * so every path here is deliberately scoped to users/{ws}/…).
 *
 * History syncs can deliver tens of thousands of messages: inside
 * runBatch() message writes go through a BulkWriter and conversation
 * updates are merged in memory and written once per conversation.
 */
export class FirestoreStore implements CaptureStore {
  private readonly presets: Presets;
  private convCache = new Map<string, { rec: ConversationRecord; at: number }>();
  private rolesCache = new Map<string, { at: number; rows: { uid: string; perms: Set<string>; teamId?: string }[] }>();
  private legacyLeads = new Map<string, { at: number; byPhone: Map<string, string> }>();
  private writer: BulkWriter | null = null;
  private pendingConv = new Map<string, { ws: string; id: string; patch: Partial<ConversationRecord>; unread: number }>();
  private pendingStats = new Map<string, { ws: string; day: string; inc: Record<string, number>; set: Record<string, unknown> }>();

  constructor(private readonly db: Firestore, presetsPath: string) {
    this.presets = JSON.parse(readFileSync(presetsPath, "utf8"));
  }

  private ws(ws: string) {
    return this.db.collection("users").doc(ws);
  }

  private convKey(ws: string, id: string) {
    return `${ws}/${id}`;
  }

  /** Runs fn with batched writes (used for history sync). */
  async runBatch<T>(fn: () => Promise<T>): Promise<T> {
    if (this.writer) return fn(); // already batching
    this.writer = this.db.bulkWriter();
    this.writer.onWriteError((err) => err.failedAttempts < 5);
    try {
      return await fn();
    } finally {
      const writer = this.writer;
      this.writer = null;
      for (const p of this.pendingConv.values()) {
        writer.set(this.ws(p.ws).collection("waConversations").doc(p.id), this.convData(p.patch, p.unread), { merge: true });
      }
      this.pendingConv.clear();
      for (const p of this.pendingStats.values()) {
        writer.set(this.ws(p.ws).collection("waStats").doc(p.day), statsDoc(p.day, p.inc, p.set), { merge: true });
      }
      this.pendingStats.clear();
      await writer.close();
    }
  }

  private convData(patch: Partial<ConversationRecord>, unread: number) {
    return unread ? { ...patch, unreadCount: FieldValue.increment(unread) } : { ...patch };
  }

  async getConversation(ws: string, id: string): Promise<ConversationRecord | null> {
    const key = this.convKey(ws, id);
    const pending = this.pendingConv.get(key);
    const cached = this.convCache.get(key);
    let base: ConversationRecord | null = null;
    if (cached && (Date.now() - cached.at < CONV_CACHE_MS || this.writer)) {
      base = cached.rec;
    } else {
      const snap = await this.ws(ws).collection("waConversations").doc(id).get();
      base = snap.exists ? (snap.data() as ConversationRecord) : null;
      if (base) this.convCache.set(key, { rec: base, at: Date.now() });
      else this.convCache.delete(key);
    }
    if (pending) return { ...(base || ({} as ConversationRecord)), ...pending.patch } as ConversationRecord;
    return base;
  }

  async findConversationIdByLid(ws: string, lidJid: string): Promise<string | null> {
    const snap = await this.ws(ws).collection("waConversations").where("lidJid", "==", lidJid).limit(1).get();
    return snap.empty ? null : snap.docs[0].id;
  }

  async upsertConversation(ws: string, id: string, patch: Partial<ConversationRecord>, incrementUnread = 0) {
    const key = this.convKey(ws, id);
    const cached = this.convCache.get(key);
    const unreadBase = cached?.rec.unreadCount || 0;
    this.convCache.set(key, {
      rec: { ...(cached?.rec || ({} as ConversationRecord)), ...patch, unreadCount: patch.unreadCount ?? unreadBase + incrementUnread } as ConversationRecord,
      at: cached?.at || Date.now(),
    });
    if (this.writer) {
      const prev = this.pendingConv.get(key);
      this.pendingConv.set(key, { ws, id, patch: { ...(prev?.patch || {}), ...patch }, unread: (prev?.unread || 0) + incrementUnread });
      return;
    }
    await this.ws(ws).collection("waConversations").doc(id).set(this.convData(patch, incrementUnread), { merge: true });
  }

  async updateConversationIfExists(ws: string, id: string, patch: Partial<ConversationRecord>) {
    const key = this.convKey(ws, id);
    if (this.pendingConv.has(key)) return this.upsertConversation(ws, id, patch);
    await this.ws(ws).collection("waConversations").doc(id).update(patch);
    const cached = this.convCache.get(key);
    if (cached) cached.rec = { ...cached.rec, ...patch };
  }

  async saveMessages(ws: string, conversationId: string, messages: MessageRecord[]) {
    const col = this.ws(ws).collection("waConversations").doc(conversationId).collection("messages");
    if (this.writer) {
      for (const m of messages) this.writer.set(col.doc(m.id), m, { merge: true });
      return;
    }
    const batch = this.db.batch();
    for (const m of messages) batch.set(col.doc(m.id), m, { merge: true });
    await batch.commit();
  }

  async patchMessage(ws: string, conversationId: string, messageId: string, patch: Record<string, unknown>) {
    await this.ws(ws).collection("waConversations").doc(conversationId).collection("messages").doc(messageId).update(patch);
  }

  /**
   * Index doc (leadPhoneIndex/{phone}) first, then leads.phoneE164, then a
   * cached scan of older leads that only have local-format phone fields.
   */
  async findLeadIdByPhone(ws: string, phone: string): Promise<string | null> {
    const n = normalizePhone(phone);
    if (!n) return null;
    const idx = await this.ws(ws).collection("leadPhoneIndex").doc(n).get();
    if (idx.exists) {
      const leadId = idx.get("leadId") as string;
      const lead = await this.ws(ws).collection("leads").doc(leadId).get();
      if (lead.exists) return leadId;
    }
    const q = await this.ws(ws).collection("leads").where("phoneE164", "==", n).limit(1).get();
    if (!q.empty) return q.docs[0].id;
    let legacy = this.legacyLeads.get(ws);
    if (!legacy || Date.now() - legacy.at > LEADS_CACHE_MS) {
      const all = await this.ws(ws).collection("leads").select("phone", "whatsapp").get();
      const byPhone = new Map<string, string>();
      for (const d of all.docs) {
        for (const f of ["whatsapp", "phone"]) {
          const p = normalizePhone(d.get(f));
          if (p && !byPhone.has(p)) byPhone.set(p, d.id);
        }
      }
      legacy = { at: Date.now(), byPhone };
      this.legacyLeads.set(ws, legacy);
    }
    const found = legacy.byPhone.get(n) || null;
    if (found) await this.ws(ws).collection("leadPhoneIndex").doc(n).set({ leadId: found, phone: n }).catch(() => undefined);
    return found;
  }

  async createLeadIfAbsent(ws: string, dedupKey: string, lead: LeadRecord) {
    const idxRef = this.ws(ws).collection("leadPhoneIndex").doc(dedupKey);
    const leadRef = this.ws(ws).collection("leads").doc(lead.id);
    return this.db.runTransaction(async (tx) => {
      const idx = await tx.get(idxRef);
      if (idx.exists) {
        const existing = idx.get("leadId") as string;
        const ex = await tx.get(this.ws(ws).collection("leads").doc(existing));
        if (ex.exists) return { leadId: existing, created: false };
      }
      tx.set(leadRef, lead);
      tx.set(idxRef, { leadId: lead.id, phone: lead.phoneE164 || null, createdAt: lead.createdAt });
      return { leadId: lead.id, created: true };
    }).then((res) => {
      if (res.created) this.legacyLeads.get(ws)?.byPhone.set(lead.phoneE164, lead.id);
      return res;
    });
  }

  async touchLead(ws: string, leadId: string, patch: Record<string, unknown>) {
    await this.ws(ws).collection("leads").doc(leadId).update(patch);
  }

  async listRecipients(ws: string, anyOf: string[], teamId?: string): Promise<string[]> {
    let cached = this.rolesCache.get(ws);
    if (!cached || Date.now() - cached.at > ROLES_CACHE_MS) {
      const snap = await this.db.collection("roles").where("workspaceUid", "==", ws).get();
      cached = {
        at: Date.now(),
        rows: snap.docs.map((d) => ({ uid: d.id, perms: effectivePermissions(this.presets, d.data()), teamId: d.get("teamId") })),
      };
      this.rolesCache.set(ws, cached);
    }
    return cached.rows
      .filter((r) => anyOf.some((p) => r.perms.has(p)) && (!teamId || r.teamId === teamId))
      .map((r) => r.uid);
  }

  async bumpStats(ws: string, day: string, inc: Record<string, number>, set: Record<string, unknown> = {}) {
    if (!Object.keys(inc).length && !Object.keys(set).length) return;
    if (this.writer) {
      const key = `${ws}/${day}`;
      const cur = this.pendingStats.get(key) || { ws, day, inc: {}, set: {} };
      for (const [k, v] of Object.entries(inc)) cur.inc[k] = (cur.inc[k] || 0) + v;
      Object.assign(cur.set, set);
      this.pendingStats.set(key, cur);
      return;
    }
    await this.ws(ws).collection("waStats").doc(day).set(statsDoc(day, inc, set), { merge: true });
  }

  async notify(ws: string, userUids: string[], n: NotificationInput) {
    if (!userUids.length) return;
    const col = this.ws(ws).collection("notifications");
    const batch = this.db.batch();
    const createdAt = new Date().toISOString();
    for (const userUid of userUids) {
      const id = `N-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
      batch.set(col.doc(id), { id, userUid, ...n, read: false, createdAt, createdBy: "whatsapp-service" });
    }
    await batch.commit();
  }
}
