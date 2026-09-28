// AI reply assistant (rule-based, runs in the browser).
//
// It only writes a DRAFT reply for the open chat. A person reads it and
// presses Send — nothing is ever sent automatically (sending unattended
// replies from a personal WhatsApp is against WhatsApp's rules and gets
// numbers banned).
//
// Answers come from, in this order:
//  1. answers the owner trained (settings.aiKnowledge: keywords → answer),
//  2. the service catalog (real prices from Settings),
//  3. short default replies for greeting / demo / location / thanks …
// Prices are never invented: no catalog match → it asks what the customer needs.
import { ChatLine, classifyChat } from "./chatClassifier";
import { activeServicesOf, CatalogService } from "./catalog";
import { OPT_OUT_RE } from "./waTemplates";

export interface KnowledgeItem { id: string; keywords: string; answer: string; uses?: number; createdAt: string }
export type Intent = "optout" | "price" | "demo" | "location" | "timing" | "thanks" | "later" | "interested" | "greeting" | "other";
export interface Draft { text: string; intent: Intent; source: "trained" | "catalog" | "default" | "none"; matchedId?: string; reason: string }

const RX: [Intent, RegExp][] = [
  ["price", /\b(price|prices|rate|rates|kitne|kitna|kya rate|charges?|cost|package|packages|fee|quotation|quote|budget|paisay|paise)\b/i],
  ["demo", /\b(demo|meeting|milna|milte|visit|call (karein|kr|karo|kren)|sample|portfolio|dikhao|dikhayein|show me)\b/i],
  ["location", /\b(kahan|kahaan|address|location|office|city|where are you)\b/i],
  ["timing", /\b(kitna time|kab tak|kitne din|how long|delivery time|duration|time lagega)\b/i],
  ["later", /\b(baad mein|bad me|baad me|sochta|soch k|soch ke|later|next week|agle hafte)\b/i],
  ["thanks", /\b(shukriya|shukria|thanks|thank you|jazak|meherbani)\b/i],
  ["interested", /\b(interested|chahiye|chahiyeh|banwana|banwani|karwana|karwani|lena hai|start karna)\b/i],
  ["greeting", /^(assalam|salam|aoa|hello|hi|hey|slam|good (morning|evening))\b/i],
];

const STOP = new Set("the and for you your are was this that with have has will can not but from what how when who why aap apka apki apke hai hain hoga hogi kya kyun kaise kab kahan kar karo karna karein kr krna mein mai main ko ka ki ke se par pe per bhi tha thi the ho hum mujhe mera meri mere yeh ye woh wo aur ya ek koi".split(" "));

const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9؀-ۿ\s]/g, " ").split(/\s+/).filter(Boolean);
const isEnglish = (t: string) => {
  const w = words(t);
  if (!w.length) return false;
  const en = w.filter((x) => /^(the|is|are|you|your|can|could|please|need|want|how|much|what|do|does|price|interested|info|information|about|this|hello|hi|thanks|thank)$/.test(x)).length;
  const ur = w.filter((x) => /^(aap|ap|hai|hain|kya|kitna|kitne|mujhe|chahiye|karna|karein|krna|bhai|ji|nahi|hum|mera|apka|apki|batayein|bataen)$/.test(x)).length;
  return en > ur;
};
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-PK")}`;
const first = (name?: string) => String(name || "").trim().split(/\s+/)[0] || "";

export function intentOf(text: string): Intent {
  if (OPT_OUT_RE.test(text)) return "optout";
  for (const [intent, re] of RX) if (re.test(text.trim())) return intent;
  return "other";
}

function priceLines(svcs: CatalogService[]) {
  return svcs.slice(0, 4).map((s) => {
    const unit = s.unit && s.unit !== "project" && s.unit !== "license" ? `/${s.unit}` : s.unit === "license" ? " (per license)" : "";
    const setup = s.pricing === "setup_plus_monthly" && s.setupFee ? ` + ${rs(s.setupFee)} setup` : "";
    return `• ${s.name}: ${rs(s.rate)}${unit}${setup}`;
  }).join("\n");
}

/** The customer's recent messages (after our last reply, or the last 3). */
export function recentCustomerText(lines: ChatLine[]): string {
  const out: string[] = [];
  const spoken = lines.filter((l) => l.text);
  // If we spoke last there is nothing new to answer.
  if (!spoken.length || spoken[spoken.length - 1].fromMe) return "";
  for (let i = spoken.length - 1; i >= 0 && out.length < 3; i--) {
    if (spoken[i].fromMe) break;
    out.unshift(spoken[i].text);
  }
  return out.join(" \n ");
}

export function draftReply(
  lines: ChatLine[],
  opts: { settings: unknown; name?: string; kb?: KnowledgeItem[]; company?: string }
): Draft {
  const recent = recentCustomerText(lines);
  if (!recent) return { text: "", intent: "other", source: "none", reason: "Customer ka koi naya message nahi — pehle unka message aane dein" };
  const intent = intentOf(recent);
  const who = first(opts.name);
  const hi = who ? `${who}, ` : "";
  const en = isEnglish(recent);
  const company = opts.company || "Digital Target";

  if (intent === "optout") return { text: "", intent, source: "none", reason: "Customer ne message band karne ko kaha — reply na karein" };

  // 1. Trained answers.
  const low = recent.toLowerCase();
  let best: { item: KnowledgeItem; score: number } | null = null;
  for (const item of opts.kb || []) {
    const kws = item.keywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
    const score = kws.reduce((s, k) => s + (low.includes(k) ? (k.includes(" ") ? 2 : 1) : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { item, score };
  }
  if (best) return { text: best.item.answer.replace(/\{name\}/g, who).replace(/\s+([!,?.])/g, "$1"), intent, source: "trained", matchedId: best.item.id, reason: `Aap ke sikhaye hue jawab se (keywords: ${best.item.keywords})` };

  // 2. Catalog prices.
  const cls = classifyChat(lines);
  if (intent === "price" || intent === "interested") {
    const svcs = activeServicesOf(opts.settings).filter((s) => cls.line && s.line === cls.line);
    if (svcs.length) {
      const list = priceLines(svcs);
      const text = en
        ? `Hi ${who || "there"}! Here are our ${cls.line} options:\n${list}\nFinal price depends on your requirements. Could you tell me a little about your business so I can suggest the best package?`
        : `Assalam o Alaikum ${who}!\n${cls.line} ke rates:\n${list}\nFinal qeemat aap ki requirement par depend karti hai. Apne business ke baare mein thora bata dein taake main sahi package suggest kar sakoon?`;
      return { text: text.replace(/Alaikum \n/, "Alaikum!\n"), intent, source: "catalog", reason: `Settings ke catalog se ${cls.line} ki qeematein` };
    }
    return {
      text: en ? `Hi ${who || "there"}! Happy to help. Which service do you need (software, ads, social media, design or video) and what is your business?`
        : `${hi}zaroor! Aap ko kaun si service chahiye — software, ads, social media, design ya video? Aur aap ka business kya hai? Phir main sahi price bata dunga.`,
      intent, source: "default", reason: "Service samajh nahi aayi, is liye qeemat nahi likhi — pehle zarurat poochh li",
    };
  }

  // 3. Short defaults.
  const D: Record<Intent, [string, string]> = {
    demo: [`${hi}zaroor, hum demo / meeting rakh sakte hain. Aap ko aaj ya kal mein se kaun sa time munasib hai?`, `Sure ${who}! We can arrange a demo or call. Which time works for you today or tomorrow?`],
    location: [`${hi}hum ${company} hain — online kaam karte hain aur zarurat par meeting bhi rakh sakte hain. Aap kis shehar se hain?`, `We work online and can meet if needed. Which city are you in?`],
    timing: [`${hi}kaam ka time project par depend karta hai. Requirement bata dein to main exact timeline bata dunga.`, `Timeline depends on the project. Share your requirement and I'll confirm exact timing.`],
    thanks: [`${hi}aap ka bhi shukriya! Koi sawal ho to bejhijhak poochhein.`, `Thank you ${who}! Let me know if you have any questions.`],
    later: [`${hi}koi baat nahi, jab munasib ho bata dein. Main kuch din baad follow-up kar loonga.`, `No problem ${who}, take your time. I'll follow up in a few days.`],
    greeting: [`Assalam o Alaikum ${who}! ${company} mein khush aamdeed. Aap ko kis service mein madad chahiye?`, `Hello ${who}! Welcome to ${company}. How can I help you?`],
    other: [`${hi}shukriya. Aap thora detail mein bata dein ke aap ko kya chahiye taake main behtar madad kar sakoon.`, `Thanks ${who}! Could you share a few more details about what you need?`],
    price: ["", ""], interested: ["", ""], optout: ["", ""],
  };
  const [ur, eng] = D[intent];
  return { text: (en ? eng : ur).replace(/\s+([!,?.])/g, "$1").replace(/  +/g, " ").trim(), intent, source: "default", reason: `Aam jawab (${intent})` };
}

/** Customer message → our reply pairs from the chat, newest last. */
export function qaPairs(lines: ChatLine[]): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = [];
  let q: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.text || /^\[/.test(l.text)) continue;
    if (!l.fromMe) { q.push(l.text); continue; }
    if (q.length) {
      const a = l.text;
      if (q.join(" ").length >= 3 && a.length >= 8) out.push({ q: q.join(" "), a });
      q = [];
    }
  }
  return out.slice(-6);
}

/** Distinctive words of a customer question, as a keyword list to edit. */
export function suggestKeywords(q: string): string {
  const seen = new Set<string>();
  for (const w of words(q)) if (w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)) seen.add(w);
  return [...seen].slice(0, 4).join(", ");
}
