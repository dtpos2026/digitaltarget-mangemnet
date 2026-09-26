// Reads a WhatsApp chat and suggests the lead's service line and status.
// Keyword rules in English + Roman Urdu; whatsapp-service/src/classify.ts
// uses the same tables for leads it creates automatically.

export interface ChatLine { text: string; fromMe: boolean }
export interface ChatSuggestion { line: string | null; status: string; reason: string }

export const LINE_KEYWORDS: [string, RegExp][] = [
  ["AI Software Development", /\b(software|apps?|application|pos|crm|erp|system|automation|automate|chat ?bot|bot|ai|artificial intelligence|billing|inventory)\b/gi],
  ["Web Development", /\b(website|web ?site|wordpress|shopify|landing page|domain|hosting|e-?commerce|online store)\b/gi],
  ["Digital Marketing", /\b(ads?|advertis\w*|boost|campaigns?|marketing|google ads|facebook ads|meta ads|seo|leads chahiye|sales)\b/gi],
  ["Social Media Management", /\b(social media|page manage|manage (my|hamara|mera) page|instagram|tiktok|followers|posting|content|smm)\b/gi],
  ["Graphic Design", /\b(logo|designs?|poster|flyer|banner|menu card|visiting card|brochure|thumbnail)\b/gi],
  ["Video Production", /\b(videos?|reels?|editing|shoot|youtube|animation|promo)\b/gi],
  ["Branding", /\b(branding|brand identity|brand guide)\b/gi],
];

const CONVERTED = /\b(payment (kar|kr) (di|dee|diya|dia)|payment done|paid|advance (bhej|send|transfer)|transfer (kar|kr) (di|diya)|deal (done|final)|confirm(ed)?|order (confirm|place)|start (kar|kr)(ein|en|o|do))/i;
const LOST = /\b(not interested|interest nahi|nahi chahiye|nai chahiye|zarurat nahi|zaroorat nahi|cancel|budget nahi|no thanks|mat (bhej|kar))/i;
const FOLLOW = /\b(baad mein|bad me|baad me|kal (bat|baat|call)|sochta|soch k|soch ke|later|next week|agle hafte|call (karna|kr|kar)|remind)/i;
const INTEREST = /\b(price|rate|rates|kitne|kitna|charges|cost|package|packages|details|quotation|quote|demo|interested|kya (hai|ha) (price|rate)|fee)\b/i;

const RANK: Record<string, number> = { New: 0, Contacted: 1, Interested: 2, "Follow-up": 2, Lost: 3, Converted: 4 };

/** Messages oldest → newest. */
export function classifyChat(lines: ChatLine[]): ChatSuggestion {
  const theirs = lines.filter((l) => !l.fromMe && l.text).map((l) => l.text);
  const all = lines.map((l) => l.text || "").join(" \n ");

  // Service line: most keyword hits across the whole chat.
  let line: string | null = null;
  let best = 0;
  for (const [name, re] of LINE_KEYWORDS) {
    const hits = (all.match(re) || []).length;
    if (hits > best) { best = hits; line = name; }
  }

  // Status: strongest signal wins; lost/follow-up only count from the customer.
  let status = lines.some((l) => l.fromMe) ? "Contacted" : "New";
  let reason = status === "Contacted" ? "Hum ne reply kiya hai" : "Sirf customer ke messages";
  const bump = (s: string, why: string) => { if (RANK[s] >= RANK[status]) { status = s; reason = why; } };
  for (const l of lines) {
    const t = l.text || "";
    if (!t) continue;
    if (CONVERTED.test(t)) bump("Converted", `"${t.slice(0, 60)}"`);
    else if (!l.fromMe && LOST.test(t)) bump("Lost", `"${t.slice(0, 60)}"`);
    else if (!l.fromMe && FOLLOW.test(t)) bump("Follow-up", `"${t.slice(0, 60)}"`);
    else if (!l.fromMe && INTEREST.test(t)) bump("Interested", `"${t.slice(0, 60)}"`);
  }
  // A later "not interested" after interest still means lost; a later payment beats everything.
  const lastTheirs = theirs[theirs.length - 1] || "";
  if (status !== "Converted" && LOST.test(lastTheirs)) { status = "Lost"; reason = `"${lastTheirs.slice(0, 60)}"`; }
  return { line, status, reason };
}
