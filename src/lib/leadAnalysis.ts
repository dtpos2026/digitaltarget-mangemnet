// AI lead analysis (rule-based, runs in the browser).
//
// Builds on chatClassifier (service line + status) and adds: lead type
// (ads / unsaved number / saved contact), an interest *estimate*, potential
// value, follow-up need and a suggested next action. The service line is
// always one that exists in the catalog — nothing new is invented.
//
// The interest % is an estimate from the conversation, not a promise of
// conversion; the UI labels it that way.
import { ChatLine, classifyChat, linesMentioned } from "./chatClassifier";
import { LeadBrief, buildBrief, normalizeLines } from "./leadAgent";
export type { LeadBrief } from "./leadAgent";
import { activeServicesOf, categoryOfLine, linesOf, typicalSaleValue } from "./catalog";
import { shouldMoveStatus } from "./leadCapture";
import { OPT_OUT_RE } from "./waTemplates";
import { withHistory } from "./leadHistory";
export { withHistory } from "./leadHistory";
export type { LeadEvent } from "./leadHistory";

export type LeadType = "ads" | "unsaved" | "saved" | "other";
export type InterestLevel = "Hot" | "Warm" | "Cold";

/** Badge colour for an interest level. */
export const levelClass = (lvl?: string) => (lvl === "Hot" ? "bad" : lvl === "Warm" ? "warn" : "");

export const LEAD_TYPE_LABEL: Record<LeadType, string> = {
  ads: "Ads lead", unsaved: "Unsaved number", saved: "Saved contact", other: "Other source",
};

export interface LeadAI {
  version: 1;
  analyzedAt: string;
  line: string | null;
  category: string | null;
  leadType: LeadType;
  /** 0–100, an estimate from the chat. */
  interest: number;
  level: InterestLevel;
  suggestedStatus: string;
  statusReason: string;
  /** Starting catalog price of the detected service line — never the customer's budget. */
  potentialValue: number;
  valueBasis: "chat budget" | "catalog price" | "none";
  /** Budget the customer mentioned (information only). */
  budget?: number;
  followUp: { required: boolean; date: string; reason: string };
  nextAction: string;
  lastMessage: string;
  lastFromMe: boolean;
  customerMessages: number;
  optOut: boolean;
  /** Agent brief: summary, stage, VIP, objections, next steps (newer analyses only). */
  brief?: LeadBrief;
}

/**
 * Conversation lines of a lead: a stored chat if there is one, otherwise the
 * transcript that capture wrote into notes ("Name: text" / "Hum: text").
 */
export function conversationOf(lead: { chat?: ChatLine[]; notes?: string; name?: string }): ChatLine[] {
  if (Array.isArray(lead.chat) && lead.chat.length) return lead.chat;
  const notes = String(lead.notes || "");
  if (!notes.trim()) return [];
  return notes
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^whatsapp chat:?$/i.test(l))
    .map((l) => {
      const m = l.match(/^([^:]{1,40}):\s*(.*)$/);
      if (!m) return { text: l, fromMe: false };
      const who = m[1].trim().toLowerCase();
      return { text: m[2], fromMe: who === "hum" || who === "me" || who === "we" };
    });
}

const LEVEL_RANK: Record<InterestLevel, number> = { Hot: 3, Warm: 2, Cold: 1 };

/** WhatsApp Business label names → an interest level the owner set by hand. */
export function labelLevel(labels: string[] = []): InterestLevel | null {
  let best: InterestLevel | null = null;
  for (const raw of labels) {
    const l = raw.toLowerCase();
    let lv: InterestLevel | null = null;
    if (/\b(hot|high|urgent|serious|ready|confirmed?|interested|new order)\b/.test(l)) lv = "Hot";
    else if (/\b(warm|medium|mid|follow|pending|quote|proposal)\b/.test(l)) lv = "Warm";
    else if (/\b(cold|low|not interested|later|no reply)\b/.test(l)) lv = "Cold";
    if (lv && (!best || LEVEL_RANK[lv] > LEVEL_RANK[best])) best = lv;
  }
  return best;
}

const ADS_SOURCE = /\b(ads?|facebook|fb|instagram|insta|meta|tiktok|google|campaign|sponsored|boost)\b/i;
// What a customer typically writes after tapping a Facebook / Instagram
// "Click to WhatsApp" ad (English + Roman Urdu), including the prefilled
// messages Meta suggests.
const ADS_CHAT = /\b(ad dekha|ad dekhi|add dekha|aap ka ad|apka ad|your ad|saw (your|the|an?) ad|ad se|ads? par|sponsored|click to whatsapp|(facebook|fb|instagram|insta) (par|pe|per|se|pr|ad|page) (dekha|dekhi|mila|aya|aaya)|(dekha|dekhi) (tha |thi )?(facebook|fb|instagram|insta)|(can|could) i get more info(rmation)? (on|about) this|(i'?m|i am) interested in this|(hi|hello),? ?(i'?d like|i would like|i want) (to know|more)|is (ke|k) (baare|bare) mein (maloomat|info|details)|more information about this)\b/i;

/** True when the chat looks like it came from a Facebook / Instagram ad. */
export function adsSignal(lines: ChatLine[], meta?: { ad?: boolean }): boolean {
  if (meta?.ad) return true;
  return ADS_CHAT.test(lines.filter((l) => !l.fromMe).map((l) => l.text).join(" \n "));
}
const looksLikeNumber = (s?: string) => !s || /^\+?[\d\s()-]{7,}$/.test(s.trim());

export function leadTypeOf(lead: { source?: string; name?: string; waSaved?: boolean }, lines: ChatLine[]): LeadType {
  if (ADS_SOURCE.test(String(lead.source || "")) || adsSignal(lines)) return "ads";
  // waSaved = what WhatsApp said at capture (a WhatsApp profile name alone does not mean a saved contact)
  if (lead.waSaved === false || looksLikeNumber(lead.name)) return "unsaved";
  if (lead.waSaved || /whatsapp/i.test(String(lead.source || ""))) return "saved";
  return "other";
}

/** "budget 20k", "Rs 15,000", "50 hazar", "1.5 lakh" → rupees. */
export function budgetFromChat(lines: ChatLine[]): number {
  const text = lines.filter((l) => !l.fromMe).map((l) => l.text).join(" ");
  const m = text.match(/(?:budget|rs\.?|pkr|rupees?)\s*[:-]?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|hazar|hazaar|thousand|lakh|lac)?/i)
    || text.match(/(\d[\d,]*(?:\.\d+)?)\s*(k|hazar|hazaar|thousand|lakh|lac)\b/i);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/,/g, ""));
  const unit = (m[2] || "").toLowerCase();
  if (unit === "k" || unit.startsWith("hazar") || unit === "thousand") n *= 1000;
  if (unit === "lakh" || unit === "lac") n *= 100000;
  return n >= 500 && n <= 50_000_000 ? Math.round(n) : 0;
}

const BASE: Record<string, number> = {
  New: 30, Contacted: 35, Interested: 60, "Follow-up": 50, Qualified: 65, Proposal: 70, "Meeting Scheduled": 70,
  "Demo Given": 70, Negotiation: 75, Converted: 100, Lost: 5, Invalid: 0,
  "Demo Scheduled": 75, Hot: 75, Warm: 50, Cold: 20,
};
// Who-is-handling-it statuses say nothing about interest: the chat itself decides.
const HANDLING = new Set(["Assigned", "AI Handling", "Assistant Handling"]);
const PRICE_ASK = /\b(price|rate|rates|kitne|kitna|charges|cost|package|fee|quotation|quote)\b/i;
const DEMO_ASK = /\b(demo|meeting|milna|visit|call (karein|kr|karo)|sample|portfolio)\b/i;
const LATER = /\b(baad mein|bad me|baad me|sochta|soch k|later|next week|agle hafte)\b/i;
const SOFTWARE_CATS = ["Software Development", "Development"];

const addDays = (from: Date, n: number) => new Date(from.getTime() + n * 864e5).toISOString().slice(0, 10);

export function analyzeLead(lead: any, settings: unknown, today = new Date()): LeadAI {
  const rawLines = conversationOf(lead);
  // Urdu script → the same words as Roman Urdu / English for every rule below.
  const lines = normalizeLines(rawLines);
  const cls = classifyChat(lines);
  const known = linesOf(settings);
  // Only lines that exist in the catalog; otherwise keep the lead's own.
  const line = cls.line && known.includes(cls.line) ? cls.line : lead.serviceType && known.includes(lead.serviceType) ? lead.serviceType : null;
  const category = line ? categoryOfLine(line) : null;
  const theirs = lines.filter((l) => !l.fromMe);
  const theirText = theirs.map((l) => l.text).join(" ");
  const last = lines[lines.length - 1];
  const optOut = !!lead.optOut || theirs.some((l) => OPT_OUT_RE.test(l.text));

  // Current status: the lead's own, moved forward by the chat when it says more.
  const current = lead.status || "New";
  const suggestedStatus = optOut ? "Lost" : shouldMoveStatus(current, cls.status) ? cls.status : current;

  const basis = HANDLING.has(suggestedStatus) ? (BASE[cls.status] !== undefined ? cls.status : "New") : suggestedStatus;
  let interest = BASE[basis] ?? 30;
  if (PRICE_ASK.test(theirText)) interest += 10;
  if (budgetFromChat(lines) > 0) interest += 10;
  if (DEMO_ASK.test(theirText)) interest += 10;
  interest += Math.min(10, Math.max(0, theirs.length - 1) * 5);
  if (LATER.test(theirs[theirs.length - 1]?.text || "")) interest -= 10;
  const lastDate = String(lead.lastMessageAt || lead.updatedAt || lead.date || lead.createdAt || "").slice(0, 10);
  if (lastDate && (today.getTime() - new Date(`${lastDate}T12:00:00`).getTime()) / 864e5 > 14) interest -= 15;
  if (suggestedStatus === "Converted") interest = 100;
  if (optOut || suggestedStatus === "Lost" || suggestedStatus === "Invalid") interest = Math.min(interest, 5);
  interest = Math.max(0, Math.min(100, Math.round(interest)));
  // A WhatsApp label the owner put on the chat ("Hot lead") wins over the estimate.
  const level: InterestLevel = labelLevel(lead.waLabels) || (interest >= 70 ? "Hot" : interest >= 40 ? "Warm" : "Cold");

  // Potential value: the starting price of the detected line in the catalog (what a sale
  // realistically starts at). The customer's budget is kept apart — it is not a price.
  const budget = budgetFromChat(lines);
  let potentialValue = 0;
  let valueBasis: LeadAI["valueBasis"] = "none";
  if (line) {
    const prices = activeServicesOf(settings).filter((s) => s.line === line).map(typicalSaleValue).filter((n) => n > 0);
    if (prices.length) { potentialValue = Math.min(...prices); valueBasis = "catalog price"; }
  }

  // Follow-up.
  const closed = ["Converted", "Lost", "Invalid"].includes(suggestedStatus) || optOut;
  const unanswered = !!last && !last.fromMe;
  const overdue = lead.followUpDate && lead.followUpDate < today.toISOString().slice(0, 10);
  const stale = lastDate && (today.getTime() - new Date(`${lastDate}T12:00:00`).getTime()) / 864e5 >= 2;
  const required = !closed && (unanswered || !!overdue || !!stale || !lead.followUpDate);
  const date = lead.followUpDate && !overdue ? lead.followUpDate : addDays(today, level === "Hot" || unanswered ? 0 : level === "Warm" ? 1 : 3);
  const reason = closed ? "Lead band hai" : unanswered ? "Customer ka aakhri message jawab ka intezar kar raha hai"
    : overdue ? `Follow-up ki tareekh (${lead.followUpDate}) guzar gayi` : stale ? "2+ din se koi baat nahi hui" : "Follow-up date set nahi";

  // Next action.
  const cat = category || "";
  let nextAction: string;
  if (optOut) nextAction = "Customer ne message band karne ko kaha — dobara message na karein";
  else if (suggestedStatus === "Converted") nextAction = "Client banayein aur invoice / advance ka record karein";
  else if (suggestedStatus === "Lost") nextAction = "Abhi koi action nahi — 2-3 mahine baad naya offer bhej sakte hain";
  else if (unanswered) nextAction = `Customer ka jawab dein${PRICE_ASK.test(last?.text || "") ? " — price / package bhejein" : ""}`;
  else if (["Proposal", "Negotiation"].includes(suggestedStatus)) nextAction = "Proposal par follow-up karein aur advance payment ki baat karein";
  else if (suggestedStatus === "Interested" || level === "Hot") {
    nextAction = SOFTWARE_CATS.includes(cat) ? "Demo schedule karein (call / visit)"
      : cat === "Digital Marketing" ? "Ads package aur budget plan bhejein, business / city poochhein"
      : cat === "Creative Services" ? "Portfolio / samples bhejein aur quantity poochhein"
      : "Details aur price bhej kar meeting rakhein";
  } else if (suggestedStatus === "Follow-up") nextAction = "Follow-up call / message karein";
  else nextAction = line ? `${line} ki details / price list bhejein aur zarurat poochhein` : "Zarurat poochhein (kaun si service chahiye)";

  const leadType = leadTypeOf(lead, lines);
  let needs = linesMentioned(lines).filter((l) => known.includes(l));
  if (line && !needs.includes(line)) needs.unshift(line);
  // A restaurant asking for "POS software" wants DTPOS; a specific software line makes "Custom Software" redundant.
  const isRestaurant = /\b(restaurant|resturant|cafe|hotel|dhaba|food|biryani|pizza|bakery|kitchen)\b/i.test(theirText);
  if (isRestaurant && needs.includes("Retail POS") && known.includes("Restaurant Software / DTPOS")) needs = needs.map((n) => (n === "Retail POS" ? "Restaurant Software / DTPOS" : n));
  if (needs.includes("Custom Software") && needs.some((n) => ["Restaurant Software / DTPOS", "Retail POS", "Travel Agency Software", "AI Software Development"].includes(n))) needs = needs.filter((n) => n !== "Custom Software");
  needs = Array.from(new Set(needs));
  const brief = buildBrief(rawLines, lines, {
    name: lead.name, status: suggestedStatus, line, needs, budget: budgetFromChat(lines), potentialValue, interest, optOut,
    unanswered, isAds: leadType === "ads",
    daysSinceLast: lastDate ? Math.max(0, Math.floor((today.getTime() - new Date(`${lastDate}T12:00:00`).getTime()) / 864e5)) : null,
  });
  // The agent's first step is more specific than the generic one when the chat says more.
  if (!optOut && brief.actions[0] && (brief.stage === "Ready to buy" || brief.objections.length || brief.vip)) nextAction = brief.actions[0];

  return {
    version: 1, analyzedAt: new Date().toISOString(), line, category, leadType,
    interest, level, suggestedStatus, statusReason: cls.reason, potentialValue, valueBasis, budget,
    followUp: { required, date, reason }, nextAction,
    lastMessage: (rawLines[rawLines.length - 1]?.text || "").slice(0, 200), lastFromMe: !!last?.fromMe, customerMessages: theirs.length, optOut, brief,
  };
}

/**
 * Lead with the analysis applied: fills service and type, moves the status
 * forward only, sets a follow-up date if none, records history.
 */
export function applyAnalysis(lead: any, ai: LeadAI, opts: { moveStatus?: boolean; by?: string } = {}) {
  let next = { ...lead, ai, leadType: ai.leadType, interest: ai.interest, updatedAt: new Date().toISOString() };
  const changes: string[] = [];
  if (!lead.serviceType && ai.line) { next.serviceType = ai.line; changes.push(`service: ${ai.line}`); }
  if (opts.moveStatus !== false && ai.suggestedStatus !== (lead.status || "New") && shouldMoveStatus(lead.status || "New", ai.suggestedStatus)) {
    next.status = ai.suggestedStatus; changes.push(`status: ${lead.status || "New"} → ${ai.suggestedStatus}`);
  }
  if (ai.optOut && !lead.optOut) { next.optOut = true; changes.push("opt-out"); }
  if (ai.brief) {
    // VIP is a flag on the lead (filters, sorting); once set by hand it stays.
    if (ai.brief.vip && !lead.vip) { next.vip = true; changes.push("VIP"); }
    next.priority = ai.brief.priority;
    if (ai.brief.business && !lead.business) next.business = ai.brief.business;
  }
  // An AI-suggested date is only a hint (followUpAuto): reminders are for follow-ups a person sets.
  if (!lead.followUpDate && ai.followUp.required) { next.followUpDate = ai.followUp.date; next.followUpAuto = true; changes.push(`follow-up ${ai.followUp.date}`); }
  next = withHistory(next, { type: "ai", text: `AI: ${ai.level} (${ai.interest}%)${ai.line ? ` • ${ai.line}` : ""}${changes.length ? ` • ${changes.join(", ")}` : ""}`, by: opts.by });
  return next;
}
