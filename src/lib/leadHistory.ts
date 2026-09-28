// Per-lead timeline: capture, status changes, AI analysis, messages, replies.

export interface LeadEvent {
  at: string;
  type: "created" | "captured" | "status" | "ai" | "message" | "reply" | "assigned" | "followup" | "note" | "converted" | "optout";
  text: string;
  by?: string;
}

/** Appends to the lead's history (kept to the last 80 events). */
export function withHistory<T extends object>(lead: T, ev: Omit<LeadEvent, "at"> & { at?: string }): T & { history: LeadEvent[] } {
  const entry: LeadEvent = { at: ev.at || new Date().toISOString(), type: ev.type, text: ev.text.slice(0, 400), ...(ev.by ? { by: ev.by } : {}) };
  const prev = (lead as { history?: unknown }).history;
  return { ...lead, history: [...(Array.isArray(prev) ? (prev as LeadEvent[]) : []), entry].slice(-80) };
}
