// WhatsApp Message Center: follow-up campaigns to the business's own leads.
//
// Designed to stay inside WhatsApp's rules, not to get around them:
//  - only leads who contacted the business (the user confirms consent);
//  - anyone who asked to stop (opt-out) is skipped for good;
//  - human-paced: a fixed minimum delay between messages and a daily cap;
//  - the campaign pauses itself on repeated failures, a high failure rate,
//    the daily cap, a disconnected WhatsApp, or an opt-out reply;
//  - every message is shown to the user and approved before sending.
// There is no randomisation, rotation or anything meant to avoid detection.
import { normalizePhone } from "./phone";
import { TemplateLang, lineTemplateKey, renderTemplate } from "./waTemplates";

export type RecipientStatus = "queued" | "sending" | "sent" | "delivered" | "replied" | "failed" | "skipped";

export interface Recipient {
  leadId: string;
  name: string;
  phone: string; // international digits
  line: string;
  templateKey: string;
  text: string;
  status: RecipientStatus;
  reason?: string; // why skipped / failed
  sentAt?: string;
  deliveredAt?: string;
  repliedAt?: string;
  replyText?: string;
  optOut?: boolean;
}

export type CampaignStatus = "draft" | "running" | "paused" | "stopped" | "completed";

export interface CampaignAlert {
  at: string;
  type: "daily_limit" | "failure_rate" | "consecutive_failures" | "provider" | "invalid_numbers" | "opt_out" | "unusual";
  text: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  lang: TemplateLang;
  templateMode: "auto" | "fixed";
  templateKey: string;
  delaySec: number;
  dailyLimit: number;
  startAt?: string; // ISO; sending waits until then
  consent: boolean;
  recipients: Recipient[];
  alerts: CampaignAlert[];
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  pausedReason?: string;
  heartbeatAt?: string;
}

/** Floors that cannot be lowered from the UI. */
export const MIN_DELAY_SEC = 30;
export const MAX_DAILY_LIMIT = 200;
export const DEFAULTS = { delaySec: 60, dailyLimit: 50 };

export const clampDelay = (n: number) => Math.max(MIN_DELAY_SEC, Math.round(Number(n) || DEFAULTS.delaySec));
export const clampDaily = (n: number) => Math.min(MAX_DAILY_LIMIT, Math.max(1, Math.round(Number(n) || DEFAULTS.dailyLimit)));

const firstName = (n?: string) => {
  const s = String(n || "").trim();
  return /^\+?[\d\s()-]{7,}$/.test(s) ? "" : s.split(/\s+/)[0];
};

/**
 * Recipients for the chosen leads. Opted-out, invalid and duplicate numbers
 * are kept in the list as "skipped" so the user sees why.
 */
export function buildRecipients(
  leads: any[],
  optOuts: Set<string>,
  settings: unknown,
  opts: { lang: TemplateLang; templateMode: "auto" | "fixed"; templateKey: string }
): Recipient[] {
  const seen = new Set<string>();
  return leads.map((l) => {
    const phone = normalizePhone(l.whatsapp || l.phone || l.phoneE164);
    const line = l.serviceType || l.ai?.line || "";
    const templateKey = opts.templateMode === "auto" ? lineTemplateKey(line) : opts.templateKey;
    const text = renderTemplate(settings as never, templateKey, opts.lang, { name: firstName(l.name), service: line });
    const base = { leadId: l.id, name: l.name || phone, phone, line, templateKey, text };
    let reason = "";
    if (!phone) reason = "Number sahi nahi";
    else if (l.optOut || optOuts.has(phone)) reason = "Opt-out — message band karne ko kaha tha";
    else if (seen.has(phone)) reason = "Duplicate number";
    else if (["Lost", "Invalid"].includes(l.status)) reason = `Status ${l.status}`;
    if (phone) seen.add(phone);
    return reason ? { ...base, status: "skipped" as const, reason } : { ...base, status: "queued" as const };
  });
}

const dayOf = (iso?: string) => String(iso || "").slice(0, 10);

/** Messages already sent today across all campaigns (the daily cap is shared). */
export function sentToday(campaigns: Campaign[], today = new Date().toISOString().slice(0, 10)): number {
  let n = 0;
  for (const c of campaigns) for (const r of c.recipients || []) if (r.sentAt && dayOf(r.sentAt) === today) n++;
  return n;
}

/**
 * Safety check before each send and after each result. Returns the alert to
 * raise and whether the campaign must pause.
 */
export function safetyCheck(c: Campaign, usedToday: number): { pause: boolean; alert?: CampaignAlert } {
  const now = new Date().toISOString();
  if (usedToday >= clampDaily(c.dailyLimit)) {
    return { pause: true, alert: { at: now, type: "daily_limit", text: `Aaj ki limit (${clampDaily(c.dailyLimit)} messages) poori — kal dobara resume karein.` } };
  }
  const tried = (c.recipients || []).filter((r) => ["sent", "delivered", "replied", "failed"].includes(r.status));
  const failed = tried.filter((r) => r.status === "failed");
  const lastThree = tried.slice(-3);
  if (lastThree.length === 3 && lastThree.every((r) => r.status === "failed")) {
    return { pause: true, alert: { at: now, type: "consecutive_failures", text: "Lagatar 3 messages fail hue — WhatsApp connection check karein." } };
  }
  if (tried.length >= 5 && failed.length / tried.length > 0.3) {
    return { pause: true, alert: { at: now, type: "failure_rate", text: `Failure rate ${Math.round((failed.length / tried.length) * 100)}% — campaign ruk gayi.` } };
  }
  const optedOut = (c.recipients || []).filter((r) => r.optOut).length;
  if (optedOut >= 2 && optedOut / Math.max(1, tried.length) > 0.1) {
    return { pause: true, alert: { at: now, type: "opt_out", text: `${optedOut} logon ne message band karne ko kaha — message / audience check karein.` } };
  }
  return { pause: false };
}

export interface CampaignStats {
  selected: number; queued: number; sent: number; delivered: number; failed: number; skipped: number;
  replies: number; conversations: number; interested: number; converted: number; optOuts: number;
  responseRatio: number; // replies / sent, %
}

const INTERESTED = ["Interested", "Qualified", "Proposal", "Meeting Scheduled", "Demo Given", "Negotiation", "Follow-up"];

export function campaignStats(c: Campaign, leads: any[] = []): CampaignStats {
  const r = c.recipients || [];
  const count = (...s: RecipientStatus[]) => r.filter((x) => s.includes(x.status)).length;
  const sent = count("sent", "delivered", "replied");
  const replies = count("replied");
  const byId = new Map(leads.map((l) => [l.id, l]));
  const reached = r.filter((x) => ["sent", "delivered", "replied"].includes(x.status)).map((x) => byId.get(x.leadId)).filter(Boolean);
  return {
    selected: r.length, queued: count("queued", "sending"), sent, delivered: count("delivered", "replied"), failed: count("failed"),
    skipped: count("skipped"), replies, conversations: replies,
    interested: reached.filter((l: any) => INTERESTED.includes(l.status)).length,
    converted: reached.filter((l: any) => l.status === "Converted").length,
    optOuts: r.filter((x) => x.optOut).length,
    responseRatio: sent ? Math.round((replies / sent) * 100) : 0,
  };
}

/** Next recipient to send, or null when nothing is left. */
export const nextQueued = (c: Campaign) => (c.recipients || []).findIndex((r) => r.status === "queued");

/** Paused by a safety rule (not by the user): shown as a dashboard alert. */
export const needsAttention = (c: Campaign) => c.status === "paused" && !!c.pausedReason && c.pausedReason !== "User ne pause kiya";
