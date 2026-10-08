// Channel-agnostic lead ingestion.
//
// One inbound WhatsApp conversation in → one lead change out. Today the
// WhatsApp Web extension feeds it (AutoCapture in the portal); later a
// WhatsApp Business API webhook can call the same function on a server and
// the CRM does not change:
//
//   WhatsApp Web → Extension ─┐
//                             ├─▶ planIngest() → lead (+ leadPhoneIndex) → portal / assistant / CEO
//   WhatsApp Cloud API → Webhook ─┘
//
// Pure: no network, no Firestore. The caller writes the result.
import type { ChatLine } from "./chatClassifier";
import { analyzeLead, applyAnalysis } from "./leadAnalysis";
import { planCapture } from "./leadCapture";
import { assessChat, BlockEntry, DEFAULT_FILTER } from "./captureFilter";
import { withHistory } from "./leadHistory";
import { formatLocalPhone, normalizePhone } from "./phone";
import { temperatureOf } from "./salesPipeline";

export type Channel = "wa-web-extension" | "wa-cloud-api" | "wa-server" | "manual";

export interface InboundMsg { id?: string; text: string; fromMe: boolean; at: number }
export interface AdInfo { title?: string; body?: string; sourceUrl?: string; sourceId?: string; sourceType?: string; ctwaClid?: string }

export interface InboundConversation {
  channel: Channel;
  phone: string; // international digits (normalised by the caller or here)
  name: string;
  jid?: string;
  /** Recent messages, oldest → newest. */
  messages: InboundMsg[];
  ad?: AdInfo | null;
  labels?: string[];
  saved?: boolean;
  isBusiness?: boolean;
  archived?: boolean;
}

export interface ChatEntry extends ChatLine { id?: string; at?: number }

export const MAX_CHAT = 150;
const key = (m: ChatEntry) => m.id || `${m.fromMe ? 1 : 0}|${Math.floor((m.at || 0) / 1000)}|${m.text.slice(0, 80)}`;

/** Stored conversation + new messages, without duplicates, oldest → newest, capped. */
export function mergeChat(existing: ChatEntry[] = [], incoming: InboundMsg[] = [], cap = MAX_CHAT): ChatEntry[] {
  const seen = new Set(existing.map(key));
  const add: ChatEntry[] = [];
  for (const m of incoming) {
    if (!m.text) continue;
    const e: ChatEntry = { text: String(m.text).slice(0, 1000), fromMe: !!m.fromMe, ...(m.at ? { at: m.at } : {}), ...(m.id ? { id: m.id } : {}) };
    // old entries (before ids were stored) match on text + direction
    const legacy = existing.some((x) => !x.id && !x.at && x.text === e.text && x.fromMe === e.fromMe);
    if (seen.has(key(e)) || legacy) continue;
    seen.add(key(e));
    add.push(e);
  }
  return [...existing, ...add].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-cap);
}

const CITY = /\b(karachi|lahore|islamabad|rawalpindi|faisalabad|multan|peshawar|quetta|sialkot|gujranwala|hyderabad|bahawalpur|sargodha|sahiwal|burewala|vehari|okara|sheikhupura|rahim yar khan|gujrat|jhelum|abbottabad|mardan|sukkur|larkana|dera ghazi khan|mirpur|muzaffarabad|kasur|chiniot|jhang|dubai|sharjah|riyadh|jeddah|london)\b/i;
const BIZ_NAME = /\b(?:my|our|mera|meri|hamara|hamari)\s+(?:restaurant|resturant|cafe|shop|store|clinic|hotel|business|company|brand|dukan)\s+(?:ka\s+naam\s+|is\s+|name\s+is\s+|hai\s+)?["']?([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,3})/;
// "Faisal Foods naam hai" / "naam Faisal Foods hai" / "name is Faisal Foods"
const NAAM = /\b([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,3})\s+(?:naam|name)\s+(?:hai|he|h)\b/;
const NAAM2 = /\b(?:naam|name(?:\s+is)?)\s*[:-]?\s*["']?([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,3})/;
const PRONOUN = /^(hamara|hamari|mera|meri|my|our|apna|apni|is|ye|yeh|the|a|an|salam|assalam|hello|hi)$/i;
const NAMED = /\b([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,3})\s+(?:restaurant|resturant|cafe|foods?|kitchen|bakery|clinic|hospital|store|mart|traders|boutique)\b/;

/** City / business name when the customer writes them. */
export function extractDetails(msgs: InboundMsg[]): { city: string; businessName: string } {
  const theirs = msgs.filter((m) => !m.fromMe).map((m) => m.text || "").join(" \n ");
  const c = theirs.match(CITY);
  const named = [...theirs.matchAll(new RegExp(NAMED.source, "g"))].map((m) => m[1]).find((n) => !PRONOUN.test(n.split(/\s+/)[0]));
  const b = theirs.match(NAAM)?.[1] || theirs.match(NAAM2)?.[1] || theirs.match(BIZ_NAME)?.[1] || named || "";
  const city = c ? c[1].replace(/\b\w/g, (x) => x.toUpperCase()) : "";
  return { city, businessName: PRONOUN.test(b.split(/\s+/)[0] || "") ? "" : b.trim() };
}

export type IngestPlan =
  | { kind: "skip"; reason: string }
  | { kind: "create"; lead: any; isAds: boolean }
  | { kind: "update"; lead: any; inbound: number; outbound: number };

export interface IngestContext {
  settings: unknown;
  by: string; // who captured (email / "whatsapp-service")
  today: string;
  newId: () => string;
  blocklist?: BlockEntry[];
  now?: Date;
}

/**
 * Decide what one conversation does to the CRM.
 *  - existing lead (by phone / jid): merge messages, re-analyse, keep status unless the rules allow a move;
 *  - new number: only real leads become leads (personal, courier / OTP / bank, blocked numbers are skipped);
 *  - our own outgoing messages never create a lead.
 */
export function planIngest(c: InboundConversation, existing: any | null, ctx: IngestContext): IngestPlan {
  const phone = normalizePhone(c.phone) || "";
  const msgs = [...(c.messages || [])].filter((m) => m && m.text).sort((a, b) => (a.at || 0) - (b.at || 0));
  const lines: ChatLine[] = msgs.map((m) => ({ text: m.text, fromMe: m.fromMe }));
  const inbound = msgs.filter((m) => !m.fromMe);
  const lastIn = inbound[inbound.length - 1];
  const now = (ctx.now || new Date()).toISOString();

  if (existing) {
    const chat = mergeChat(Array.isArray(existing.chat) ? existing.chat : [], msgs);
    const newIn = chat.length - (existing.chat?.length || 0);
    if (newIn <= 0 && existing.lastMessageText === (lastIn?.text || existing.lastMessageText)) return { kind: "skip", reason: "Koi naya message nahi" };
    let next: any = {
      ...existing, chat,
      ...(lastIn ? { lastMessageAt: new Date(lastIn.at || Date.now()).toISOString(), lastMessageText: lastIn.text.slice(0, 300), lastInboundAt: new Date(lastIn.at || Date.now()).toISOString() } : {}),
      ...(c.jid && !existing.waJid ? { waJid: c.jid } : {}),
      ...(phone && !existing.phoneE164 ? { phoneE164: phone } : {}),
      ...(c.ad && !existing.adInfo ? { adInfo: c.ad } : {}),
      ...(c.labels?.length ? { waLabels: c.labels } : {}),
      updatedAt: now,
    };
    const added = mergeChat([], msgs).filter((m) => !(existing.chat || []).some((x: ChatEntry) => key(x) === key(m)));
    const ins = added.filter((m) => !m.fromMe).length, outs = added.length - ins;
    if (ins) next = withHistory(next, { type: "captured", text: `Naya message: ${added.filter((m) => !m.fromMe).slice(-1)[0].text.slice(0, 140)}`, by: ctx.by, at: now });
    next = applyAnalysis(next, analyzeLead(next, ctx.settings, ctx.now), { moveStatus: true, by: "ai" });
    if (!next.temperatureManual) next.temperature = temperatureOf({ ...next, temperatureManual: false });
    return { kind: "update", lead: next, inbound: ins, outbound: outs };
  }

  if (!inbound.length) return { kind: "skip", reason: "Sirf hamare messages — lead nahi banti" };
  const assess = assessChat(
    { name: c.name, phone, saved: c.saved, archived: c.archived, isBusiness: c.isBusiness, labels: c.labels || [], ad: !!c.ad },
    lines, ctx.settings, { ...DEFAULT_FILTER, levels: { Hot: true, Warm: true, Cold: true } }, ctx.blocklist || []
  );
  if (assess.excluded) return { kind: "skip", reason: assess.excluded };

  const plan = planCapture({ key: c.jid || phone, jid: c.jid, phone, name: c.name || formatLocalPhone(phone) }, lines, [], {
    updateExisting: false, newId: ctx.newId, today: ctx.today, createdBy: ctx.by,
  });
  if (plan.kind !== "create") return { kind: "skip", reason: "Lead nahi ban saki" };
  const isAds = assess.kind === "ads" || !!c.ad;
  const det = extractDetails(msgs);
  let lead: any = {
    ...plan.lead,
    status: "New",
    source: isAds ? "Meta Ads" : "WhatsApp Direct",
    channel: c.channel,
    ...(c.ad ? { adInfo: c.ad } : {}),
    city: det.city, businessName: det.businessName,
    chat: mergeChat([], msgs),
    lastMessageAt: lastIn ? new Date(lastIn.at || Date.now()).toISOString() : now,
    lastMessageText: lastIn ? lastIn.text.slice(0, 300) : "",
    lastInboundAt: lastIn ? new Date(lastIn.at || Date.now()).toISOString() : now,
    waLabels: c.labels || [],
    ...(c.saved !== undefined ? { waSaved: !!c.saved } : {}),
    assignedTo: "", assignedToName: "",
    createdAt: now,
  };
  lead = applyAnalysis(lead, analyzeLead(lead, ctx.settings, ctx.now), { moveStatus: false, by: "ai" });
  lead.temperature = temperatureOf(lead);
  lead.requirement = lead.ai?.brief?.summary || lead.serviceType || "";
  if (!lead.business && lead.ai?.brief?.business) lead.business = lead.ai.brief.business;
  return { kind: "create", lead, isAds };
}

/** Only the fields a sales assistant may write on a lead that is not theirs (see firestore.rules). */
export const CAPTURE_FIELDS = ["chat", "lastMessageAt", "lastMessageText", "lastInboundAt", "unreadCount", "history", "ai", "interest", "leadType",
  "adInfo", "waJid", "phoneE164", "waLabels", "vip", "priority", "business", "updatedAt"] as const;
export const pickCaptureFields = (l: any) => Object.fromEntries(CAPTURE_FIELDS.filter((k) => l[k] !== undefined).map((k) => [k, l[k]]));
