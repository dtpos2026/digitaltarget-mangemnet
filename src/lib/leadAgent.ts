// Lead agent: reads a WhatsApp conversation the way a sales person would —
// Urdu script, Roman Urdu and English — and writes a short brief:
// who the customer is, what they want, how ready they are, what is holding
// them back, whether they are a VIP, and exactly what to do next.
//
// Rule-based and offline (runs in the browser). It only states what the
// chat actually says; every point carries the words it came from.
import type { ChatLine } from "./chatClassifier";

// ------------------------------------------------------------- normalising
// Common Urdu-script words → Roman Urdu / English, so one set of rules
// understands all three. Longer phrases first.
const URDU_MAP: [RegExp, string][] = [
  [/نہیں چاہیے|نہیں چاہئے|ضرورت نہیں/g, " nahi chahiye "],
  [/دلچسپی نہیں/g, " not interested "],
  [/بعد میں|سوچ کر|سوچتا|سوچتی/g, " baad mein "],
  [/بھیج دی|بھیج دیا|کر دی|کر دیا/g, " kar di "],
  [/سافٹ ?ویئر|سافٹ ?ویر/g, " software "],
  [/ویب ?سائٹ/g, " website "],
  [/موبائل ایپ|ایپلیکیشن|ایپ/g, " mobile app "],
  [/فیس ?بک/g, " facebook "],
  [/انسٹا ?گرام/g, " instagram "],
  [/اشتہار|ایڈز|ایڈ/g, " ads "],
  [/سوشل میڈیا/g, " social media "],
  [/لوگو/g, " logo "],
  [/ڈیزائن/g, " design "],
  [/ویڈیو|ریلز|ریل/g, " video reels "],
  [/قیمت|ریٹ|کتنے|کتنا|چارجز|خرچہ/g, " price "],
  [/پیکج/g, " package "],
  [/ڈیمو/g, " demo "],
  [/ملاقات|میٹنگ/g, " meeting "],
  [/ادائیگی|پیمنٹ|پے منٹ/g, " payment "],
  [/ایڈوانس/g, " advance "],
  [/بجٹ/g, " budget "],
  [/ہزار/g, " hazar "],
  [/لاکھ/g, " lakh "],
  [/ریسٹورنٹ|ہوٹل/g, " restaurant "],
  [/دکان|دوکان|اسٹور|سٹور/g, " dukan "],
  [/کلینک|ہسپتال|اسپتال/g, " clinic "],
  [/اسکول|سکول|اکیڈمی/g, " school "],
  [/کمپنی|برانچ|برانچز/g, " company branches "],
  [/جلدی|فوری|ابھی|آج ہی/g, " urgent "],
  [/مہنگا|زیادہ ہے/g, " mehnga "],
  [/شکریہ/g, " thanks "],
  [/السلام علیکم|سلام/g, " salam "],
  [/چاہیے|چاہئے/g, " chahiye "],
];

/** Urdu script → Roman words the rules understand. Latin text is unchanged. */
export function normalizeText(t: string): string {
  let s = String(t || "");
  if (!/[\u0600-\u06ff]/.test(s)) return s;
  // Urdu / Arabic digits → 0-9
  s = s.replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  for (const [re, to] of URDU_MAP) s = s.replace(re, to);
  return s.replace(/\s{2,}/g, " ").trim();
}
export const normalizeLines = (lines: ChatLine[]) => lines.map((l) => ({ ...l, text: normalizeText(l.text) }));

export type ChatLanguage = "urdu" | "roman" | "english" | "mixed";
const ROMAN = /\b(hai|hain|kya|kitna|kitne|chahiye|karna|karein|krna|mujhe|apka|aap|bhai|ji|nahi|mera|hum|kab|kahan|kaise|acha|theek)\b/i;
const ENGLISH = /\b(the|is|are|you|your|can|could|please|need|want|how|much|what|price|interested|would|like|about)\b/i;

export function detectLanguage(lines: ChatLine[]): ChatLanguage {
  const theirs = lines.filter((l) => !l.fromMe).map((l) => l.text || "");
  let u = 0, r = 0, e = 0;
  for (const t of theirs) {
    if (/[؀-ۿ]/.test(t)) u++;
    else if (ROMAN.test(t)) r++;
    else if (ENGLISH.test(t)) e++;
  }
  const kinds = [u, r, e].filter(Boolean).length;
  if (kinds > 1) return "mixed";
  return u ? "urdu" : r ? "roman" : e ? "english" : "roman";
}

// ------------------------------------------------------------- brief
export type Stage = "New inquiry" | "Exploring" | "Comparing price" | "Ready to buy" | "Customer" | "Not interested";
export type Priority = "P1" | "P2" | "P3";

export interface LeadBrief {
  version: 1;
  language: ChatLanguage;
  business: string; // "Restaurant", "Clinic", … or ""
  needs: string[]; // service lines the chat mentions (catalog lines)
  budget: number;
  urgency: "urgent" | "normal" | "later";
  stage: Stage;
  objections: string[];
  sentiment: "positive" | "neutral" | "negative";
  vip: boolean;
  vipScore: number; // 0–100
  vipReasons: string[];
  priority: Priority;
  summary: string; // one line, Roman Urdu
  actions: string[]; // 1–3 concrete next steps
  evidence: string[]; // customer phrases the brief is based on
}

const BUSINESS: [string, RegExp][] = [
  ["Restaurant / Cafe", /\b(restaurant|resturant|hotel|cafe|dhaba|food|biryani|pizza|bakery|kitchen|takeaway|fast ?food)\b/i],
  ["Clinic / Hospital", /\b(clinic|hospital|doctor|dr\.?|medical|pharmacy|dental|lab)\b/i],
  ["Shop / Retail", /\b(shop|dukan|dukaan|store|mart|boutique|garments|mobile shop|super ?store)\b/i],
  ["School / Academy", /\b(school|academy|college|institute|tuition|coaching)\b/i],
  ["Travel agency", /\b(travel|tours?|umrah|hajj|visa|ticketing)\b/i],
  ["Real estate", /\b(real estate|property|plots?|builders?|construction|housing)\b/i],
  ["Salon / Beauty", /\b(salon|parlou?r|beauty|spa|makeup)\b/i],
  ["Gym / Fitness", /\b(gym|fitness)\b/i],
  ["Company / Brand", /\b(company|pvt|ltd|brand|factory|industr\w*|distribut\w*|branches)\b/i],
];
const URGENT = /\b(urgent|asap|jaldi|foran|fori|abhi|aaj hi|today|kal tak|is hafte|this week|immediately)\b/i;
const LATER = /\b(baad mein|bad me|baad me|sochta|soch k|soch ke|later|next month|agle mahine|next week|agle hafte|abhi nahi)\b/i;
const READY = /\b(start (kar|kr)(ein|en|o|do)?|kab start|confirm|final|deal|advance (kitna|bhej|send)|account (number|details)|payment (kaise|kahan|kar|kr)|order (kar|place|confirm)|chalate hain|karwana hai|banwana hai|lena hai|ok (done|final))\b/i;
const PRICE = /\b(price|rate|rates|kitne|kitna|charges|cost|package|fee|quotation|quote)\b/i;
const OBJ: [string, RegExp][] = [
  ["Qeemat zyada lag rahi hai", /\b(mehnga|mehenga|expensive|zyada (hai|hain|price)|too much|costly|kam (karein|kar do|kro)|discount)\b/i],
  ["Budget kam hai", /\b(budget (kam|nahi|low)|paise nahi|afford)\b/i],
  ["Abhi soch raha hai", LATER],
  ["Pehle kaam / sample dekhna chahta hai", /\b(sample|portfolio|pehle (dikhao|dikhayein)|previous work|kaam dikhao|reviews?)\b/i],
  ["Kisi aur se bhi baat kar raha hai", /\b(aur (log|company)|doosr[ie]|other (company|agency)|compare|already (have|hai))\b/i],
  ["Bharosa / trust ka sawal", /\b(trust|bharosa|fraud|guarantee|refund)\b/i],
];
const POSITIVE = /\b(thanks|shukriya|great|good|acha|achha|perfect|nice|zabardast|theek hai|ok)\b/i;
const NEGATIVE = /\b(bekar|bakwas|not good|kharab|problem|complain|naraz|ghussa|late kyun|worst)\b/i;
const BIG = /\b(branches|chain|franchise|multiple (shops|outlets)|company|pvt|ltd|hospital|factory|distribut\w*|monthly (package|retainer)|long term|saal bhar|yearly)\b/i;

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-PK")}`;
const quote = (t: string) => `"${t.replace(/\s+/g, " ").trim().slice(0, 70)}"`;

export interface BriefInput {
  name?: string;
  status: string;
  line: string | null;
  needs: string[];
  budget: number;
  potentialValue: number;
  interest: number;
  optOut: boolean;
  unanswered: boolean;
  isAds: boolean;
  daysSinceLast: number | null;
}

/** Writes the brief. `lines` must already be normalised (normalizeLines). */
const TITLES = /^(dr\.?|doctor|mr\.?|mrs\.?|ms\.?|miss|engr\.?|prof\.?|haji|sir|madam|ch\.?|malik|sheikh|rana|mian)$/i;
const firstName = (n?: string) => {
  const parts = String(n || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length || /^\+?[\d\s()-]{7,}$/.test(String(n))) return "";
  return parts.find((p) => !TITLES.test(p)) || parts[0];
};

export function buildBrief(rawLines: ChatLine[], lines: ChatLine[], x: BriefInput): LeadBrief {
  // Normalised and original lines line up 1:1; evidence quotes the original words.
  const pairs = lines.map((l, i) => ({ l, raw: rawLines[i] || l })).filter((p) => !p.l.fromMe && p.l.text);
  const theirs = pairs.map((p) => p.l);
  const all = theirs.map((l) => l.text).join(" \n ");
  const lastTheirs = theirs[theirs.length - 1]?.text || "";
  const evidence: string[] = [];
  const hit = (re: RegExp) => {
    const p = pairs.find((t) => re.test(t.l.text));
    if (p && evidence.length < 4 && !evidence.includes(quote(p.raw.text))) evidence.push(quote(p.raw.text));
    return !!p;
  };

  const business = BUSINESS.find(([, re]) => re.test(all))?.[0] || "";
  if (business) hit(BUSINESS.find(([b]) => b === business)![1]);
  const urgency: LeadBrief["urgency"] = URGENT.test(all) ? "urgent" : LATER.test(lastTheirs) ? "later" : "normal";
  const objections = OBJ.filter(([, re]) => re.test(all)).map(([t]) => t);
  const ready = READY.test(all);
  const asked = PRICE.test(all);

  let stage: Stage;
  if (x.status === "Converted") stage = "Customer";
  else if (x.optOut || x.status === "Lost" || /\b(not interested|nahi chahiye|zarurat nahi|zaroorat nahi)\b/i.test(lastTheirs)) stage = "Not interested";
  else if (ready) { stage = "Ready to buy"; hit(READY); }
  else if (asked) { stage = "Comparing price"; hit(PRICE); }
  else if (theirs.length >= 2 || x.line) stage = "Exploring";
  else stage = "New inquiry";

  const sentiment: LeadBrief["sentiment"] = NEGATIVE.test(all) ? "negative" : POSITIVE.test(all) ? "positive" : "neutral";

  // VIP: big money, a serious business, several services, ready / urgent.
  const value = Math.max(x.budget, x.potentialValue);
  const reasons: string[] = [];
  let score = 0;
  if (value >= 100000) { score += 35; reasons.push(`bara kaam (${rs(value)})`); }
  else if (value >= 40000) { score += 20; reasons.push(`achi value (${rs(value)})`); }
  if (BIG.test(all)) { score += 25; reasons.push("bara business / lamba kaam"); hit(BIG); }
  if (x.needs.length >= 2) { score += 15; reasons.push(`${x.needs.length} services chahiye`); }
  if (stage === "Ready to buy") { score += 20; reasons.push("khareedne ko tayyar"); }
  if (urgency === "urgent") { score += 10; reasons.push("jaldi chahiye"); hit(URGENT); }
  if (x.interest >= 70) { score += 10; reasons.push(`interest ${x.interest}%`); }
  if (x.status === "Converted") { score += 10; reasons.push("pehle se customer"); }
  if (stage === "Not interested") score = 0;
  score = Math.min(100, score);
  const vip = score >= 55;

  // P1 = today, money is waiting; P2 = this week; P3 = no rush.
  const priority: Priority = stage === "Not interested" ? "P3"
    : stage === "Customer" ? (x.unanswered ? "P2" : "P3")
    : vip || stage === "Ready to buy" || urgency === "urgent" || (stage === "Comparing price" && x.budget > 0 && x.unanswered) ? "P1"
    : stage === "Comparing price" || x.unanswered || x.interest >= 50 ? "P2" : "P3";

  // Next steps — concrete, in the order to do them.
  const actions: string[] = [];
  const need = x.needs[0] || x.line || "";
  if (x.optOut) actions.push("Message band karne ko kaha hai — dobara message na karein");
  else if (stage === "Customer") actions.push("Client profile / invoice update karein, aur kaam ka next step confirm karein");
  else if (stage === "Not interested") actions.push("Abhi chhor dein — 2-3 mahine baad naya offer");
  else {
    if (x.unanswered) actions.push(`Pehle jawab dein${x.daysSinceLast !== null && x.daysSinceLast >= 1 ? ` (${x.daysSinceLast} din se intezar)` : " — customer intezar kar raha hai"}`);
    if (stage === "Ready to buy") actions.push("Advance / payment details bhejein aur start date fix karein");
    if (stage === "Comparing price") actions.push(need ? `${need} ka package aur price bhejein${x.budget ? ` (budget ${rs(x.budget)} ke mutabiq)` : ""}` : "Price list bhejein aur zarurat poochhein");
    if (objections.includes("Qeemat zyada lag rahi hai")) actions.push("Chhota / starter package offer karein ya value samjhayein (results, support)");
    if (objections.includes("Pehle kaam / sample dekhna chahta hai")) actions.push("Portfolio / pichle kaam ke samples bhejein");
    if (objections.includes("Bharosa / trust ka sawal")) actions.push("Reviews, client references aur office location share karein");
    if (stage === "Exploring" && !actions.length) actions.push(need ? `${need} ke baare mein 2-3 sawal poochhein (business, city, budget) aur demo offer karein` : "Zarurat poochhein — kaun si service chahiye");
    if (stage === "New inquiry" && !actions.length) actions.push("Salam ke saath services ka short intro bhejein aur zarurat poochhein");
    if (urgency === "later" && !actions.some((a) => /follow/i.test(a))) actions.push("Unki batayi tareekh par follow-up reminder lagayein");
    if (vip) actions.push("VIP — aap khud call karein, sirf message par na chhorein");
  }

  const langLabel = { urdu: "Urdu", roman: "Roman Urdu", english: "English", mixed: "Urdu + English" }[detectLanguage(rawLines)];
  const who = [firstName(x.name), business && `(${business})`].filter(Boolean).join(" ");
  const want = x.needs.length ? x.needs.slice(0, 2).join(" + ") : "service abhi saaf nahi";
  const bits = [
    `${who || "Customer"} — ${want}`,
    x.budget ? `budget ${rs(x.budget)}` : "",
    { "New inquiry": "pehla rabta", Exploring: "maloomat le raha hai", "Comparing price": "price pooch raha hai", "Ready to buy": "khareedne ko tayyar", Customer: "customer ban chuka", "Not interested": "interest nahi" }[stage],
    urgency === "urgent" ? "jaldi chahiye" : urgency === "later" ? "baad mein bolega" : "",
    x.isAds ? "Ads se aaya" : "",
  ].filter(Boolean);

  return {
    version: 1, language: detectLanguage(rawLines), business, needs: x.needs, budget: x.budget, urgency, stage, objections, sentiment,
    vip, vipScore: score, vipReasons: reasons, priority,
    summary: `${bits.join(" • ")}. (${langLabel})`,
    actions: actions.slice(0, 3), evidence,
  };
}
