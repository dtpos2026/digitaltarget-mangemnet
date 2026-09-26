import type { ChatType, MediaInfo } from "./parser.js";

/** Per-account options, editable from the portal (waAccounts/{id}.settings). */
export interface AccountSettings {
  /** Create a lead for every new 1:1 number that messages us. */
  autoCreateLeads: boolean;
  /** Also create leads for chats imported by the initial history sync. */
  leadsFromHistory: boolean;
  /** Do not store group chats at all. */
  ignoreGroups: boolean;
  /** Download images / documents / voice notes of new messages to Storage. */
  downloadMedia: boolean;
  /** Ask the phone for full history (not just recent chats) when linking. */
  syncFullHistory: boolean;
  /** Team record id new WhatsApp leads are assigned to ("" = unassigned). */
  defaultAssignee: string;
  notifyOnNewLead: boolean;
}

export const DEFAULT_SETTINGS: AccountSettings = {
  autoCreateLeads: true,
  leadsFromHistory: false,
  ignoreGroups: true,
  downloadMedia: true,
  syncFullHistory: true,
  defaultAssignee: "",
  notifyOnNewLead: true,
};

export function mergeSettings(raw: unknown): AccountSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<AccountSettings>;
  return {
    autoCreateLeads: s.autoCreateLeads ?? DEFAULT_SETTINGS.autoCreateLeads,
    leadsFromHistory: s.leadsFromHistory ?? DEFAULT_SETTINGS.leadsFromHistory,
    ignoreGroups: s.ignoreGroups ?? DEFAULT_SETTINGS.ignoreGroups,
    downloadMedia: s.downloadMedia ?? DEFAULT_SETTINGS.downloadMedia,
    syncFullHistory: s.syncFullHistory ?? DEFAULT_SETTINGS.syncFullHistory,
    defaultAssignee: typeof s.defaultAssignee === "string" ? s.defaultAssignee : "",
    notifyOnNewLead: s.notifyOnNewLead ?? DEFAULT_SETTINGS.notifyOnNewLead,
  };
}

export interface StoredMedia extends MediaInfo {
  /** Cloud Storage object path (workspaces/{ws}/whatsapp/{conv}/{file}). */
  path?: string;
  /** Why the file was not stored (too large, expired…). */
  skipped?: string;
}

/** users/{ws}/waConversations/{id} */
export interface ConversationRecord {
  id: string;
  accountId: string;
  /** Jid used to reply (as WhatsApp addressed the chat). */
  jid: string;
  chatType: ChatType;
  pnJid?: string;
  lidJid?: string;
  /** International digits, e.g. 923451873354 (unknown for some privacy-id chats). */
  phone?: string;
  /** Name saved in the phone's contacts. */
  contactName?: string;
  /** Name the customer set on WhatsApp. */
  pushName?: string;
  leadId?: string;
  lastMessageAt?: number;
  lastMessageText?: string;
  lastMessageFromMe?: boolean;
  lastMessageKind?: string;
  unreadCount?: number;
  firstInboundAt?: number;
  firstResponseAt?: number;
  /** firstResponseAt - firstInboundAt, for response-time analytics. */
  firstResponseMs?: number;
  lastInboundAt?: number;
  lastOutboundAt?: number;
  inboundCount?: number;
  outboundCount?: number;
  assignedTo?: string;
  createdAt?: number;
  updatedAt?: number;
}

/** users/{ws}/waConversations/{conv}/messages/{id} */
export interface MessageRecord {
  id: string;
  conversationId: string;
  accountId: string;
  fromMe: boolean;
  sender: string;
  senderName?: string;
  kind: string;
  text: string;
  media?: StoredMedia;
  quotedId?: string;
  timestamp: number;
  at: string;
  status: string;
  source: "realtime" | "history" | "portal";
  createdBy?: string;
}

/** Lead document, compatible with the existing Leads tab. */
export interface LeadRecord {
  id: string;
  name: string;
  phone: string;
  whatsapp: string;
  phoneE164: string;
  category: string;
  serviceType: string;
  software: string;
  plan: string;
  status: string;
  source: string;
  referralBy: string;
  meetingDate: string;
  followUpDate: string;
  notes: string;
  date: string;
  createdAt: string;
  createdBy: string;
  conversationId: string;
  waJid: string;
  waAccountId: string;
  assignedTo: string;
}

export interface NotificationInput {
  type: string;
  title: string;
  body: string;
  link?: { tab: string; conversationId?: string; leadId?: string };
}

/** Everything the capture pipeline needs from the database. */
export interface CaptureStore {
  getConversation(ws: string, id: string): Promise<ConversationRecord | null>;
  findConversationIdByLid(ws: string, lidJid: string): Promise<string | null>;
  upsertConversation(ws: string, id: string, patch: Partial<ConversationRecord>, incrementUnread?: number): Promise<void>;
  updateConversationIfExists(ws: string, id: string, patch: Partial<ConversationRecord>): Promise<void>;
  saveMessages(ws: string, conversationId: string, messages: MessageRecord[]): Promise<void>;
  patchMessage(ws: string, conversationId: string, messageId: string, patch: Record<string, unknown>): Promise<void>;
  /** Lead id reachable on this normalised phone, if any. */
  findLeadIdByPhone(ws: string, phone: string): Promise<string | null>;
  /**
   * Creates the lead unless another one already owns `dedupKey`
   * (atomic, so two messages arriving together cannot create two leads).
   */
  createLeadIfAbsent(ws: string, dedupKey: string, lead: LeadRecord): Promise<{ leadId: string; created: boolean }>;
  touchLead(ws: string, leadId: string, patch: Record<string, unknown>): Promise<void>;
  /** Login uids in the workspace holding any of the permissions (optionally linked to a team record). */
  listRecipients(ws: string, anyOf: string[], teamId?: string): Promise<string[]>;
  notify(ws: string, userUids: string[], n: NotificationInput): Promise<void>;
}
