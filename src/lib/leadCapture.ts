// Turns one WhatsApp chat into a lead change: link / update an existing lead
// or create a new one, with service category and status read from the chat.
// Used by "Capture Leads" (all chats) and "Save this chat as lead".
import { classifyChat, ChatLine, ChatSuggestion } from "./chatClassifier";
import { formatLocalPhone, leadPhones } from "./phone";
import { withHistory } from "./leadHistory";

// Pipeline order; a capture only moves a lead forward (or to Lost / Converted).
const ORDER = ["New", "Contacted", "Interested", "Follow-up", "Qualified", "Proposal", "Negotiation", "Converted"];
export const shouldMoveStatus = (from: string, to: string) =>
  from !== to && !["Converted", "Lost", "Invalid"].includes(from) &&
  (to === "Lost" || to === "Converted" || ORDER.indexOf(to) > ORDER.indexOf(from));

export interface CaptureChat {
  key: string; // conversation id (service) or WhatsApp chat id (extension)
  jid?: string;
  phone?: string; // international digits
  name: string;
  firstAt?: number; // ms
  conversationId?: string; // only for chats stored by whatsapp-service
  assignedTo?: string;
  leadId?: string;
}

export interface LeadLike {
  id: string;
  name?: string;
  status?: string;
  serviceType?: string;
  conversationId?: string;
  waJid?: string;
  phone?: string;
  whatsapp?: string;
  phoneE164?: string;
  [k: string]: unknown;
}

export type CapturePlan =
  | { kind: "create"; lead: LeadLike; s: ChatSuggestion }
  | { kind: "update"; lead: LeadLike; patch: Record<string, unknown>; s: ChatSuggestion }
  | { kind: "same"; lead: LeadLike; s: ChatSuggestion };

export function findLeadForChat<L extends LeadLike>(chat: CaptureChat, leads: L[]): L | undefined {
  if (chat.leadId) {
    const byId = leads.find((l) => l.id === chat.leadId);
    if (byId) return byId;
  }
  if (chat.phone) {
    const byPhone = leads.find((l) => leadPhones(l).includes(chat.phone!));
    if (byPhone) return byPhone;
  }
  if (chat.jid) return leads.find((l) => l.waJid && l.waJid === chat.jid);
  return undefined;
}

const transcript = (lines: ChatLine[], name: string) =>
  lines.slice(-6).map((l) => `${l.fromMe ? "Hum" : name || "Client"}: ${l.text.replace(/\s+/g, " ").slice(0, 160)}`).join("\n");

export function planCapture(
  chat: CaptureChat,
  lines: ChatLine[],
  leads: LeadLike[],
  opts: { updateExisting: boolean; newId: () => string; today: string; createdBy: string }
): CapturePlan {
  const s = classifyChat(lines);
  const existing = findLeadForChat(chat, leads);
  if (existing) {
    const patch: Record<string, unknown> = {};
    if (opts.updateExisting && shouldMoveStatus(existing.status || "New", s.status)) patch.status = s.status;
    if (!existing.serviceType && s.line) patch.serviceType = s.line;
    if (chat.conversationId && !existing.conversationId) patch.conversationId = chat.conversationId;
    if (chat.jid && !existing.waJid) patch.waJid = chat.jid;
    if (chat.phone && !existing.phone) { patch.phone = formatLocalPhone(chat.phone); patch.phoneE164 = chat.phone; }
    if (Object.keys(patch).length) {
      const what = [patch.status ? `status → ${patch.status}` : "", patch.serviceType ? `service: ${patch.serviceType}` : ""].filter(Boolean).join(", ");
      patch.history = withHistory(existing, { type: "captured", text: `WhatsApp chat se update${what ? ` (${what})` : ""}`, by: opts.createdBy }).history;
      return { kind: "update", lead: existing, patch, s };
    }
    return { kind: "same", lead: existing, s };
  }
  const phone = chat.phone ? formatLocalPhone(chat.phone) : "";
  const chatText = lines.length ? transcript(lines, chat.name) : "";
  const lead: LeadLike = {
    id: opts.newId(), name: chat.name || phone || "WhatsApp contact", phone, whatsapp: phone, phoneE164: chat.phone || "",
    category: "Other", serviceType: s.line || "Other", software: "", plan: "Undecided", status: s.status, source: "WhatsApp",
    referralBy: "", meetingDate: "", followUpDate: "", notes: chatText ? `WhatsApp chat:\n${chatText}` : "",
    date: chat.firstAt ? new Date(chat.firstAt).toISOString().slice(0, 10) : opts.today,
    createdAt: new Date().toISOString(), createdBy: opts.createdBy,
    conversationId: chat.conversationId || "", waJid: chat.jid || "", assignedTo: chat.assignedTo || "",
    chat: lines.slice(-20).map((l) => ({ text: l.text.slice(0, 500), fromMe: l.fromMe })),
  };
  return { kind: "create", lead: withHistory(lead, { type: "captured", text: `WhatsApp chat se lead bani • ${lead.serviceType} • ${lead.status}`, by: opts.createdBy }), s };
}
