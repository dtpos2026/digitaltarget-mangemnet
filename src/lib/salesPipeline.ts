// Sales pipeline for WhatsApp leads: statuses, temperature (HOT / WARM /
// COLD), sources, assignment, TAKE LEAD, follow-ups and the daily numbers.
//
// Storage stays backward compatible: statuses that already existed keep their
// stored value and only get a new label (Converted = WON, Proposal =
// QUOTATION, Demo Given = DEMO COMPLETED, Contacted = CONTACTING), so every
// report, closing and campaign rule that reads `status` keeps working.
import { withHistory } from "./leadHistory";
import type { LeadEvent } from "./leadHistory";

// ------------------------------------------------------------------ statuses
export const SALES_STATUSES: { key: string; label: string }[] = [
  { key: "New", label: "NEW" },
  { key: "Assigned", label: "ASSIGNED" },
  { key: "Contacted", label: "CONTACTING" },
  { key: "AI Handling", label: "AI HANDLING" },
  { key: "Assistant Handling", label: "ASSISTANT HANDLING" },
  { key: "Hot", label: "HOT" },
  { key: "Warm", label: "WARM" },
  { key: "Cold", label: "COLD" },
  { key: "Demo Scheduled", label: "DEMO SCHEDULED" },
  { key: "Demo Given", label: "DEMO COMPLETED" },
  { key: "Proposal", label: "QUOTATION" },
  { key: "Negotiation", label: "NEGOTIATION" },
  { key: "Converted", label: "WON" },
  { key: "Lost", label: "LOST" },
  { key: "Follow-up", label: "FOLLOW-UP" },
];
/** Older statuses still on existing leads; shown and kept, not offered first. */
export const LEGACY_STATUSES = ["Interested", "Qualified", "Meeting Scheduled", "Invalid"];
const LABEL = new Map(SALES_STATUSES.map((s) => [s.key, s.label]));
export const statusLabel = (key?: string) => LABEL.get(String(key || "New")) || String(key || "New");

/** Statuses a person sets in the sales flow; captures / AI never move a lead out of these. */
export const HUMAN_STATUSES = new Set([
  "Assigned", "Assistant Handling", "Hot", "Warm", "Cold", "Demo Scheduled", "Demo Given", "Meeting Scheduled",
  "Proposal", "Negotiation", "Follow-up",
]);
export const CLOSED_STATUSES = new Set(["Converted", "Lost", "Invalid"]);
export const isClosed = (l: { status?: string }) => CLOSED_STATUSES.has(String(l.status || ""));

// ---------------------------------------------------------------- temperature
export type Temperature = "HOT" | "WARM" | "COLD";
export const TEMPERATURES: Temperature[] = ["HOT", "WARM", "COLD"];
const FROM_LEVEL: Record<string, Temperature> = { Hot: "HOT", Warm: "WARM", Cold: "COLD" };

/** Manual classification wins; otherwise the AI's level. */
export function temperatureOf(l: any): Temperature {
  const t = String(l?.temperature || "").toUpperCase();
  if (l?.temperatureManual && TEMPERATURES.includes(t as Temperature)) return t as Temperature;
  return FROM_LEVEL[l?.ai?.level] || (TEMPERATURES.includes(t as Temperature) ? (t as Temperature) : "COLD");
}
export const temperatureClass = (t: Temperature) => (t === "HOT" ? "bad" : t === "WARM" ? "warn" : "");

// -------------------------------------------------------------------- sources
/** Lead that came in over WhatsApp (old "WhatsApp" source, WhatsApp Direct, Meta ad chats, auto-captured). */
export const isWhatsAppLead = (l: any) => /whatsapp/i.test(String(l?.source || "")) || !!l?.channel || !!l?.waJid;

export const LEAD_SOURCES = ["Meta Ads", "Facebook", "Instagram", "WhatsApp Direct", "Website", "Referral", "Manual"];
/** Older source values map onto the list above for reports; the stored value is kept. */
export function sourceOf(l: any): string {
  const s = String(l?.source || "").trim();
  if (!s) return "Manual";
  if (LEAD_SOURCES.includes(s)) return s;
  if (/ads?/i.test(s) && /(facebook|fb|meta|instagram|insta)/i.test(s)) return "Meta Ads";
  if (/^whatsapp$/i.test(s)) return "WhatsApp Direct";
  if (/facebook|fb/i.test(s)) return "Facebook";
  if (/insta/i.test(s)) return "Instagram";
  if (/web/i.test(s)) return "Website";
  if (/referr/i.test(s)) return "Referral";
  return s;
}

// ----------------------------------------------------------------- the team
export interface SalesAssistant { teamId: string; name: string; uid?: string; active: boolean }
export interface SalesSettings {
  /** pool: everyone is notified, first to TAKE gets it • roundrobin: auto-assign in turn • manual: CEO assigns. */
  mode: "pool" | "roundrobin" | "manual";
  /** Create / update leads automatically from new WhatsApp messages (extension). */
  autoCapture: boolean;
  assistants: SalesAssistant[];
  /** CEO / admins notified about every new lead. */
  notifyUids: string[];
}
export const DEFAULT_SALES: SalesSettings = { mode: "pool", autoCapture: true, assistants: [], notifyUids: [] };
export const salesSettingsOf = (settings: any): SalesSettings => ({ ...DEFAULT_SALES, ...(settings?.sales || {}) });
export const activeAssistants = (s: SalesSettings) => (s.assistants || []).filter((a) => a.active !== false && a.teamId);

/** Next assistant after `lastTeamId` (round-robin), or null if there is none. */
export function nextRoundRobin(list: SalesAssistant[], lastTeamId?: string | null): SalesAssistant | null {
  if (!list.length) return null;
  const i = list.findIndex((a) => a.teamId === lastTeamId);
  return list[(i + 1) % list.length];
}

// ------------------------------------------------------------- take / assign
/** May this assistant take the lead now? Returns the reason when not. */
export function takeBlocker(l: any, myTeamId?: string | null): string {
  if (!myTeamId) return "Aap ka account kisi team member se link nahi — admin se link karwayein.";
  if (isClosed(l)) return "Lead band ho chuki hai.";
  if (l.assignedTo && l.assignedTo !== myTeamId) return `${l.assignedToName || "Doosra assistant"} ye lead le chuka hai.`;
  if (l.assignedTo === myTeamId && l.takenAt) return "Ye lead pehle se aap ke paas hai.";
  return "";
}

const nowIso = () => new Date().toISOString();

/** Lead after TAKE LEAD: assigned to me, human handling, AI handed off. */
export function takenLead(l: any, me: { teamId: string; name: string; by: string }, at = nowIso()) {
  const next = {
    ...l,
    assignedTo: me.teamId, assignedToName: me.name, assignedAt: l.assignedTo === me.teamId && l.assignedAt ? l.assignedAt : at,
    takenBy: me.teamId, takenByName: me.name, takenAt: at,
    status: "Assistant Handling", handler: "assistant", aiHandoff: true, aiHandoffAt: at,
    updatedAt: at,
  };
  return withHistory(next, { type: "taken", text: `${me.name} ne lead li (TAKE LEAD) — AI handoff, ab assistant handle kar raha hai`, by: me.by, at, to: "Assistant Handling" });
}

/** Lead after the CEO / round-robin assigns it (the assistant still presses TAKE LEAD). */
export function assignedLead(l: any, to: { teamId: string; name: string } | null, by: string, how: "manual" | "roundrobin" = "manual", at = nowIso()) {
  if (!to) {
    const next = { ...l, assignedTo: "", assignedToName: "", assignedAt: "", takenBy: "", takenByName: "", takenAt: "", status: l.status === "Assigned" ? "New" : l.status, updatedAt: at };
    return withHistory(next, { type: "assigned", text: "Assignment hata di — lead pool mein wapas", by, at });
  }
  const reassigned = !!l.assignedTo && l.assignedTo !== to.teamId;
  const next = {
    ...l, assignedTo: to.teamId, assignedToName: to.name, assignedAt: at, assignedBy: by,
    takenBy: "", takenByName: "", takenAt: "",
    status: !l.status || ["New", "AI Handling", "Assigned", "Assistant Handling"].includes(l.status) ? "Assigned" : l.status,
    updatedAt: at,
  };
  return withHistory(next, { type: "assigned", text: `${reassigned ? "Reassign" : "Assign"}: ${to.name}${how === "roundrobin" ? " (round-robin)" : ""}`, by, at });
}

/** Status change with the side effects the sales flow expects. */
export function withStatus(l: any, status: string, by: string, at = nowIso()) {
  const next: any = { ...l, status, updatedAt: at };
  if (status === "Hot" || status === "Warm" || status === "Cold") { next.temperature = status.toUpperCase(); next.temperatureManual = true; }
  if (status === "Contacted" && !l.firstContactAt) next.firstContactAt = at;
  if (status === "Demo Given" && !l.demoDoneAt) next.demoDoneAt = at;
  if (status === "Converted") next.wonAt = at;
  if (status === "Lost") next.lostAt = at;
  if (status === "Assistant Handling") { next.aiHandoff = true; next.handler = "assistant"; }
  if (status === "AI Handling") { next.handler = "ai"; }
  const type: LeadEvent["type"] = status === "Converted" ? "converted" : "status";
  return withHistory(next, { type, text: `${statusLabel(l.status)} → ${statusLabel(status)}`, by, at, to: status });
}

// ------------------------------------------------------------------ follow-up
export interface FollowUp { date: string; time?: string; note?: string }
export const followUpDueAt = (l: any): string => (l?.followUpDate ? `${l.followUpDate}T${l.followUpTime || "10:00"}` : "");
/** Pending follow-up a person set (not done, lead still open). AI-suggested dates (followUpAuto) are hints only. */
export const hasPendingFollowUp = (l: any) => !!l?.followUpDate && !l.followUpDone && !l.followUpAuto && !isClosed(l);
export const followUpIsDue = (l: any, now = new Date()) => hasPendingFollowUp(l) && new Date(followUpDueAt(l)).getTime() <= now.getTime();

export function withFollowUp(l: any, f: FollowUp, by: string, at = nowIso()) {
  const next = { ...l, followUpDate: f.date, followUpTime: f.time || "", followUpNote: f.note || "", followUpDone: false, followUpDoneAt: "", followUpAuto: false, updatedAt: at };
  return withHistory(next, { type: "followup", text: `Follow-up: ${f.date}${f.time ? ` ${f.time}` : ""}${f.note ? ` — ${f.note}` : ""}`, by, at });
}
export function followUpDone(l: any, by: string, at = nowIso()) {
  const next = { ...l, followUpDone: true, followUpDoneAt: at, updatedAt: at };
  return withHistory(next, { type: "followup_done", text: `Follow-up mukammal (${l.followUpDate}${l.followUpTime ? ` ${l.followUpTime}` : ""})`, by, at });
}
export function withDemo(l: any, when: string, by: string, at = nowIso()) {
  const next = withStatus({ ...l, demoAt: when }, "Demo Scheduled", by, at);
  return withHistory(next, { type: "demo", text: `Demo: ${when.replace("T", " ")}`, by, at });
}

// -------------------------------------------------------------- visibility
/** What an assistant may see: their own leads and the open pool (unassigned). */
export const visibleToAssistant = (l: any, myTeamId?: string | null) =>
  !!myTeamId && (l.assignedTo === myTeamId || (!l.assignedTo && !isClosed(l)));

// ---------------------------------------------------------- daily numbers
const day = (v: unknown) => String(v || "").slice(0, 10);
const eventsOn = (l: any, d: string) => (Array.isArray(l.history) ? l.history : []).filter((h: any) => day(h.at) === d);
const reached = (l: any, d: string, statuses: string[]) => eventsOn(l, d).some((h: any) => h.to && statuses.includes(h.to));

export interface DailySales {
  newLeads: number; contacted: number; hot: number; warm: number; cold: number;
  demosScheduled: number; demosCompleted: number; quotations: number; won: number; lost: number; followUpsPending: number;
}

/** Today's (or any day's) sales numbers from the leads' own timelines. */
export function dailySales(leads: any[], d: string, now = new Date()): DailySales {
  const touched = leads.filter((l) => day(l.createdAt || l.date) === d || eventsOn(l, d).length > 0 || day(l.lastMessageAt) === d);
  const temp = (t: Temperature) => touched.filter((l) => !isClosed(l) && temperatureOf(l) === t).length;
  return {
    newLeads: leads.filter((l) => day(l.createdAt || l.date) === d).length,
    contacted: leads.filter((l) => day(l.firstContactAt) === d || reached(l, d, ["Contacted", "Assistant Handling"])).length,
    hot: temp("HOT"), warm: temp("WARM"), cold: temp("COLD"),
    demosScheduled: leads.filter((l) => reached(l, d, ["Demo Scheduled", "Meeting Scheduled"])).length,
    demosCompleted: leads.filter((l) => reached(l, d, ["Demo Given"])).length,
    quotations: leads.filter((l) => reached(l, d, ["Proposal"])).length,
    won: leads.filter((l) => reached(l, d, ["Converted"]) || day(l.wonAt) === d).length,
    lost: leads.filter((l) => reached(l, d, ["Lost"]) || day(l.lostAt) === d).length,
    followUpsPending: leads.filter((l) => hasPendingFollowUp(l) && (l.followUpDate <= d || followUpIsDue(l, now))).length,
  };
}

export interface AssistantStats { teamId: string; name: string; assigned: number; contacted: number; demos: number; sales: number; conversion: number; open: number }

/** Per-assistant performance over leads (all time of the given list). */
export function assistantStats(leads: any[], assistants: SalesAssistant[]): AssistantStats[] {
  return assistants.map((a) => {
    const mine = leads.filter((l) => l.assignedTo === a.teamId);
    const contacted = mine.filter((l) => l.firstContactAt || l.takenAt || !["New", "Assigned"].includes(l.status)).length;
    const demos = mine.filter((l) => l.demoAt || ["Demo Scheduled", "Demo Given", "Meeting Scheduled"].includes(l.status) || l.demoDoneAt).length;
    const sales = mine.filter((l) => l.status === "Converted").length;
    return {
      teamId: a.teamId, name: a.name, assigned: mine.length, contacted, demos, sales,
      conversion: mine.length ? Math.round((sales / mine.length) * 100) : 0,
      open: mine.filter((l) => !isClosed(l)).length,
    };
  });
}
