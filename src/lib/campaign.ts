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
import { TemplateLang, fillTemplate, lineTemplateKey, renderTemplate } from "./waTemplates";
import { categoryOfLine } from "./catalog";

export type RecipientStatus = "queued" | "sending" | "sent" | "delivered" | "replied" | "failed" | "skipped";

/**
 * A picture / video / document sent with the message. The file itself stays
 * in this browser (IndexedDB, see campaignMedia.ts); only this description is
 * saved with the campaign.
 */
export interface MediaRef {
  key: string;
  name: string;
  type: string; // MIME
  size: number;
  kind: "image" | "video" | "file";
}

/** What one service category receives. Empty fields fall back to the "*" (all categories) entry. */
export interface CategoryContent {
  /** Custom message with {name} {service} {company}; empty = the automatic template for the lead's service. */
  text?: string;
  link?: string;
  media?: MediaRef;
}
export const ALL_CATEGORIES = "*";

export interface Recipient {
  leadId: string;
  name: string;
  phone: string; // international digits
  line: string;
  category?: string;
  media?: MediaRef;
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
  /** Per-category message / link / media; "*" applies to every category. */
  content?: Record<string, CategoryContent>;
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

const TITLES = /^(dr|dr\.|doctor|mr|mr\.|mrs|mrs\.|ms|ms\.|miss|engr|engr\.|eng|prof|prof\.|haji|hajji|sir|madam|ch|ch\.|malik|sheikh)$/i;
const firstName = (n?: string) => {
  const s = String(n || "").trim();
  if (/^\+?[\d\s()-]{7,}$/.test(s)) return "";
  const parts = s.split(/\s+/).filter(Boolean);
  // "Dr. Sana Clinic" → "Sana", not "Dr."
  const first = parts.find((p) => !TITLES.test(p)) || parts[0] || "";
  return first;
};

/** The service category of a lead ("Software Development", "Digital Marketing", …), "Other" when unknown. */
export function categoryOfLead(l: any): string {
  const line = l.serviceType || l.ai?.line || "";
  const fromLine = line ? categoryOfLine(line) : "";
  if (fromLine && fromLine !== "Other") return fromLine;
  const c = l.ai?.category || l.category || "";
  return c && c !== "Other" ? c : "Other";
}

/** Message, link and media for one category (category first, then the "all" entry). */
export function contentFor(content: Record<string, CategoryContent> | undefined, category: string): CategoryContent {
  const all = content?.[ALL_CATEGORIES] || {};
  const own = content?.[category] || {};
  return {
    text: own.text?.trim() ? own.text : all.text,
    link: own.link?.trim() ? own.link : all.link,
    media: own.media || all.media,
  };
}

/**
 * Recipients for the chosen leads. Opted-out, invalid and duplicate numbers
 * are kept in the list as "skipped" so the user sees why.
 */
export function buildRecipients(
  leads: any[],
  optOuts: Set<string>,
  settings: unknown,
  opts: { lang: TemplateLang; templateMode: "auto" | "fixed"; templateKey: string; content?: Record<string, CategoryContent> }
): Recipient[] {
  const seen = new Set<string>();
  return leads.map((l) => {
    const phone = normalizePhone(l.whatsapp || l.phone || l.phoneE164);
    const line = l.serviceType || l.ai?.line || "";
    const templateKey = opts.templateMode === "auto" ? lineTemplateKey(line) : opts.templateKey;
    const category = categoryOfLead(l);
    const c = contentFor(opts.content, category);
    // No known service: "our services" reads better than an empty gap ("following up about .").
    const vars = { name: firstName(l.name), service: line || (opts.lang === "ur" ? "ہماری سروسز" : "our services"), company: (settings as any)?.companyName || "Digital Target" };
    // Each lead gets the message of its own category: custom text if the owner wrote one, else the automatic template of its service.
    let text = c.text?.trim() ? fillTemplate(c.text, vars, opts.lang) : renderTemplate(settings as never, templateKey, opts.lang, vars);
    const link = (c.link || "").trim();
    if (link && !text.includes(link)) text = `${text}\n\n${link}`;
    const base = { leadId: l.id, name: l.name || phone, phone, line, category, templateKey, text, ...(c.media ? { media: c.media } : {}) };
    let reason = "";
    if (!phone) reason = "Number sahi nahi";
    else if (l.optOut || optOuts.has(phone)) reason = "Opt-out — message band karne ko kaha tha";
    else if (seen.has(phone)) reason = "Duplicate number";
    else if (["Lost", "Invalid"].includes(l.status)) reason = `Status ${l.status}`;
    else if (l.aiHandoff && l.assignedTo) reason = `Assistant (${l.takenByName || l.assignedToName || "team"}) handle kar raha hai — automation band`;
    if (phone) seen.add(phone);
    return reason ? { ...base, status: "skipped" as const, reason } : { ...base, status: "queued" as const };
  });
}

const dayOf = (iso?: string) => String(iso || "").slice(0, 10);

/**
 * Messages sent today. The daily cap is shared by all campaigns and is kept in
 * its own counter (`waDailyCounts/{date}`), so deleting a campaign never resets
 * it; the campaigns' own send times are counted too, and the larger figure wins.
 */
export function sentToday(campaigns: Campaign[], today = new Date().toISOString().slice(0, 10), counted = 0): number {
  let n = 0;
  for (const c of campaigns) for (const r of c.recipients || []) if (r.sentAt && dayOf(r.sentAt) === today) n++;
  return Math.max(n, Number(counted) || 0);
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

/** Recipients grouped by category, for the preview. */
export function groupByCategory(recipients: Recipient[]) {
  const m = new Map<string, { category: string; total: number; queued: number }>();
  for (const r of recipients) {
    const k = r.category || "Other";
    const e = m.get(k) || { category: k, total: 0, queued: 0 };
    e.total++; if (r.status === "queued") e.queued++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

const today_ = () => new Date().toISOString().slice(0, 10);

/** Why a campaign cannot be deleted right now, or "" when it can. */
export function deleteBlocker(c: Campaign): string {
  if (c.status === "running") return "Chal rahi campaign delete nahi hoti — pehle Pause / Stop karein.";
  return "";
}

/** Finished campaigns that can be cleared in one go. */
export const clearable = (list: Campaign[]) => list.filter((c) => ["completed", "stopped"].includes(c.status) && !deleteBlocker(c));
