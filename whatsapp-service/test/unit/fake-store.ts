import { normalizePhone } from "../../src/phone.js";
import type { CaptureStore, ConversationRecord, LeadRecord, MessageRecord, NotificationInput } from "../../src/types.js";

/** In-memory CaptureStore for pipeline tests. */
export class FakeStore implements CaptureStore {
  conversations = new Map<string, ConversationRecord>();
  messages = new Map<string, Map<string, MessageRecord & Record<string, unknown>>>();
  leads = new Map<string, LeadRecord & Record<string, unknown>>();
  index = new Map<string, string>();
  notifications: { uid: string; n: NotificationInput }[] = [];
  recipients: { uid: string; perms: string[]; teamId?: string }[] = [];

  async getConversation(_ws: string, id: string) {
    const c = this.conversations.get(id);
    return c ? { ...c } : null;
  }
  async findConversationIdByLid(_ws: string, lid: string) {
    return [...this.conversations.values()].find((c) => c.lidJid === lid)?.id || null;
  }
  async upsertConversation(_ws: string, id: string, patch: Partial<ConversationRecord>, inc = 0) {
    const cur = this.conversations.get(id) || ({} as ConversationRecord);
    this.conversations.set(id, { ...cur, ...patch, unreadCount: (patch.unreadCount ?? cur.unreadCount ?? 0) + inc } as ConversationRecord);
  }
  async updateConversationIfExists(ws: string, id: string, patch: Partial<ConversationRecord>) {
    if (!this.conversations.has(id)) throw new Error("not found");
    await this.upsertConversation(ws, id, patch);
  }
  async saveMessages(_ws: string, conv: string, msgs: MessageRecord[]) {
    const m = this.messages.get(conv) || new Map();
    for (const r of msgs) m.set(r.id, { ...(m.get(r.id) || {}), ...r });
    this.messages.set(conv, m);
  }
  async patchMessage(_ws: string, conv: string, id: string, patch: Record<string, unknown>) {
    const m = this.messages.get(conv)?.get(id);
    if (!m) throw new Error("not found");
    Object.assign(m, patch);
  }
  async findLeadIdByPhone(_ws: string, phone: string) {
    const n = normalizePhone(phone);
    if (this.index.has(n)) return this.index.get(n)!;
    for (const l of this.leads.values()) {
      if ([l.phoneE164, l.phone, l.whatsapp].some((p) => normalizePhone(p) === n)) return l.id;
    }
    return null;
  }
  async createLeadIfAbsent(_ws: string, key: string, lead: LeadRecord) {
    await Promise.resolve(); // yield, like a real transaction
    const existing = this.index.get(key);
    if (existing) return { leadId: existing, created: false };
    this.index.set(key, lead.id);
    this.leads.set(lead.id, { ...lead });
    return { leadId: lead.id, created: true };
  }
  async touchLead(_ws: string, id: string, patch: Record<string, unknown>) {
    const l = this.leads.get(id);
    if (!l) throw new Error("not found");
    Object.assign(l, patch);
  }
  async listRecipients(_ws: string, anyOf: string[], teamId?: string) {
    return this.recipients.filter((r) => r.perms.some((p) => anyOf.includes(p)) && (!teamId || r.teamId === teamId)).map((r) => r.uid);
  }
  async notify(_ws: string, uids: string[], n: NotificationInput) {
    for (const uid of uids) this.notifications.push({ uid, n });
  }
}
