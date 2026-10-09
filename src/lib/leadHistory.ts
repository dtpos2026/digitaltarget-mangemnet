// Per-lead timeline: everything that happened with a lead — capture, calls,
// WhatsApp, meetings, follow-ups, demo, quotations, status changes, notes and
// activities an administrator logs — with who, when, and the outcome.

export type LeadEventType =
  | "created" | "captured" | "status" | "ai" | "message" | "reply" | "assigned" | "followup" | "note" | "converted" | "optout"
  | "taken" | "followup_done" | "demo" | "quotation" | "lost" | "handoff"
  | "call" | "whatsapp" | "meeting" | "visit" | "email";

export interface LeadEvent {
  at: string;
  type: LeadEventType;
  text: string;
  by?: string;
  /** For status changes: the new status (daily numbers read this). */
  to?: string;
  /** Logged activities: result of the call / meeting. */
  outcome?: string;
  /** Minutes (calls, meetings). */
  duration?: number;
  /** Who did it: an administrator, the assistant, or the system / AI. */
  role?: "admin" | "assistant" | "system";
  /** Display name of the person (email stays in `by`). */
  who?: string;
}

/** Activities a person logs by hand. */
export const ACTIVITY_TYPES: { type: LeadEventType; label: string; icon: string }[] = [
  { type: "call", label: "Call", icon: "📞" },
  { type: "whatsapp", label: "WhatsApp", icon: "💬" },
  { type: "meeting", label: "Meeting", icon: "🤝" },
  { type: "visit", label: "Visit", icon: "🚗" },
  { type: "email", label: "Email", icon: "📧" },
  { type: "note", label: "Note", icon: "📝" },
];

export const OUTCOMES = [
  "Baat hui (connected)", "Jawab nahi diya", "Busy / baad mein", "Interested", "Not interested",
  "Demo book hua", "Quotation maangi", "Payment ki baat", "Number band / ghalat",
];

/** Timeline filters: which event types each one shows. */
export const HISTORY_FILTERS: { id: string; label: string; types?: LeadEventType[]; admin?: boolean }[] = [
  { id: "all", label: "Sab" },
  { id: "calls", label: "📞 Calls", types: ["call"] },
  { id: "whatsapp", label: "💬 WhatsApp", types: ["whatsapp", "message", "reply", "captured"] },
  { id: "followups", label: "⏰ Follow-ups", types: ["followup", "followup_done"] },
  { id: "demo", label: "📅 Demo / meetings", types: ["demo", "meeting", "visit"] },
  { id: "quotation", label: "🧾 Quotations", types: ["quotation"] },
  { id: "status", label: "↔ Status", types: ["status", "converted", "lost", "taken", "assigned", "handoff", "optout", "created"] },
  { id: "notes", label: "📝 Notes", types: ["note", "email"] },
  { id: "admin", label: "🛡 Admin", admin: true },
  { id: "ai", label: "✨ AI", types: ["ai"] },
];

export const filterHistory = (events: LeadEvent[], filterId: string) => {
  const f = HISTORY_FILTERS.find((x) => x.id === filterId);
  if (!f || f.id === "all") return events;
  if (f.admin) return events.filter((e) => e.role === "admin");
  return events.filter((e) => f.types!.includes(e.type));
};

const MAX_EVENTS = 500;
const MAX_AI = 30;

/**
 * Appends to the lead's history. Every human / customer event is kept (up to
 * 500); automatic AI re-analysis notes are trimmed to the latest 30 so they
 * never push real activity out.
 */
export function withHistory<T extends object>(lead: T, ev: Omit<LeadEvent, "at"> & { at?: string }): T & { history: LeadEvent[] } {
  const entry: LeadEvent = {
    at: ev.at || new Date().toISOString(), type: ev.type, text: ev.text.slice(0, 600),
    ...(ev.by ? { by: ev.by } : {}), ...(ev.to ? { to: ev.to } : {}), ...(ev.outcome ? { outcome: ev.outcome } : {}),
    ...(ev.duration ? { duration: ev.duration } : {}), ...(ev.role ? { role: ev.role } : {}), ...(ev.who ? { who: ev.who } : {}),
  };
  const prev = (lead as { history?: unknown }).history;
  let list = [...(Array.isArray(prev) ? (prev as LeadEvent[]) : []), entry];
  const ai = list.filter((e) => e.type === "ai").length;
  if (ai > MAX_AI) {
    let drop = ai - MAX_AI;
    list = list.filter((e) => !(e.type === "ai" && drop-- > 0));
  }
  return { ...lead, history: list.slice(-MAX_EVENTS) };
}
