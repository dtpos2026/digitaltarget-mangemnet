// Decides which WhatsApp chats become leads.
//
// Capture never touches personal chats: it skips groups (always), saved
// contacts (optional), couriers / OTP / bank / delivery messages, chats with
// no business signal at all, labels you exclude and a personal "never
// capture" list. Everything that is kept is analysed (service, interest,
// Ads vs organic) so the owner can review before anything is saved.
import { ChatLine } from "./chatClassifier";
import { adsSignal, analyzeLead, labelLevel, LeadAI } from "./leadAnalysis";
export { labelLevel } from "./leadAnalysis";
import { categoryOfLine } from "./catalog";
import { normalizePhone } from "./phone";

export type Level = "Hot" | "Warm" | "Cold";

export interface CaptureFilter {
  sinceDays: number;
  /** Catalog category ("Software Development", …) or "" for all. */
  group: string;
  source: "all" | "ads" | "organic";
  levels: Record<Level, boolean>;
  excludeSaved: boolean;
  excludeNoBusiness: boolean;
  excludeServiceWords: boolean;
  excludeBusinessAccounts: boolean;
  excludeArchived: boolean;
  excludeLabels: string[];
  onlyLabels: string[];
  updateExisting: boolean;
}

export const DEFAULT_FILTER: CaptureFilter = {
  sinceDays: 90, group: "", source: "all",
  levels: { Hot: true, Warm: true, Cold: true },
  excludeSaved: false, excludeNoBusiness: true, excludeServiceWords: true, excludeBusinessAccounts: false,
  excludeArchived: false, excludeLabels: [], onlyLabels: [], updateExisting: true,
};

export interface BlockEntry { key: string; name: string; phone?: string; at: string }

/** Messages that are clearly not sales conversations: courier, OTP, bank, bills, delivery apps. */
const NOISE = /\b(courier|tcs|leopards?|m ?& ?p|trax|call ?courier|postex|bykea|parcel|consignment|cn ?(no|number|#)|tracking (id|number|no)|delivery (boy|rider|attempt)|rider|out for delivery|otp|one[- ]time (password|code)|verification code|your code is|do not share (this )?(code|otp)|jazz ?cash|easy ?paisa|sadapay|nayapay|raast|debited|credited|account balance|a\/c|iban|transaction (id|successful)|bank alfalah|hbl|ubl|meezan|mcb|allied bank|k-?electric|lesco|sngpl|ssgc|ptcl|nadra|challan|e-?challan|utility bill|bill (due|amount)|foodpanda|daraz|careem|uber|indrive)\b/i;
/** Anything that hints at a sale: service words, prices, interest words. */
const BUSINESS = /\b(software|pos|website|web ?site|app|ads?|advert\w*|marketing|seo|design|logo|video|reels?|social media|branding|price|rate|kitne|kitna|charges|package|quotation|quote|demo|invoice|payment|project|business|restaurant|shop|clinic|store|dukan|order|service|ai|bot|automation|leads?)\b/i;

export interface ChatMeta {
  name: string;
  phone?: string;
  saved?: boolean;
  archived?: boolean;
  isBusiness?: boolean;
  labels?: string[];
  /** Set by the extension when the message carries Meta ad metadata. */
  ad?: boolean;
}

export interface Assessment {
  /** Why the chat is excluded, or null when it is a candidate. */
  excluded: string | null;
  kind: "ads" | "organic";
  line: string | null;
  group: string;
  level: Level;
  levelBy: "chat" | "label";
  interest: number;
  status: string;
  ai: LeadAI | null;
}

export const isBlocked = (meta: { name?: string; phone?: string }, list: BlockEntry[] = []) => {
  const n = normalizePhone(meta.phone);
  const name = String(meta.name || "").trim().toLowerCase();
  return list.some((b) => (n && b.phone && normalizePhone(b.phone) === n) || (!b.phone && name && b.key === name));
};

export function blockEntry(meta: { name?: string; phone?: string }): BlockEntry {
  const phone = normalizePhone(meta.phone) || undefined;
  const name = String(meta.name || "").trim();
  return { key: phone || name.toLowerCase(), name, phone, at: new Date().toISOString() };
}

/**
 * Analyse one chat against the filter. Pure: no network, no writes.
 * `lines` are oldest → newest.
 */
export function assessChat(meta: ChatMeta, lines: ChatLine[], settings: unknown, f: CaptureFilter, blocklist: BlockEntry[] = []): Assessment {
  const text = lines.map((l) => l.text || "").join(" \n ");
  const theirs = lines.filter((l) => !l.fromMe).map((l) => l.text || "").join(" \n ");
  const ads = adsSignal(lines, meta);
  const probe = { name: meta.name, phone: meta.phone, source: ads ? "Facebook Ads" : "WhatsApp", chat: lines };
  const ai = lines.length ? analyzeLead(probe, settings) : null;
  const lbl = labelLevel(meta.labels);
  const level: Level = lbl || ai?.level || "Cold";
  const base: Assessment = {
    excluded: null, kind: ads ? "ads" : "organic", line: ai?.line || null,
    group: ai?.line ? categoryOfLine(ai.line) : "", level, levelBy: lbl ? "label" : "chat",
    interest: ai?.interest ?? 0, status: ai?.suggestedStatus || "New", ai,
  };
  const out = (excluded: string): Assessment => ({ ...base, excluded });

  if (isBlocked(meta, blocklist)) return out("Aap ki 'kabhi capture na karein' list mein hai");
  if (f.excludeArchived && meta.archived) return out("Archived chat");
  if (f.excludeSaved && meta.saved && !ads) return out("Phone mein saved contact (personal ho sakta hai)");
  if (f.excludeBusinessAccounts && meta.isBusiness && !ads) return out("WhatsApp Business account (courier / company ho sakti hai)");
  if (f.excludeServiceWords && NOISE.test(theirs) && !BUSINESS.test(theirs)) return out("Courier / OTP / bank / bill wala message");
  const labels = (meta.labels || []).map((l) => l.toLowerCase());
  const bad = f.excludeLabels.map((l) => l.toLowerCase()).find((l) => labels.includes(l));
  if (bad) return out(`Label "${bad}" exclude hai`);
  if (f.onlyLabels.length && !f.onlyLabels.some((l) => labels.includes(l.toLowerCase()))) return out("Chune hue labels mein nahi");
  if (f.excludeNoBusiness && !ads && !base.line && !BUSINESS.test(text)) return out("Koi business / service baat nahi (personal chat lagti hai)");
  if (f.source === "ads" && !ads) return out("Ads lead nahi hai");
  if (f.source === "organic" && ads) return out("Ads lead hai (aap ne sirf organic chuna)");
  if (f.group && base.group !== f.group) return out(base.group ? `Category ${base.group} hai` : "Service samajh nahi aayi");
  if (!f.levels[level]) return out(`Interest ${level} hai (filter mein nahi)`);
  return base;
}

/** Sorted, de-duplicated label names used by the chats. */
export const labelNames = (chats: { labels?: string[] }[]) =>
  Array.from(new Set(chats.flatMap((c) => c.labels || []))).sort((a, b) => a.localeCompare(b));
