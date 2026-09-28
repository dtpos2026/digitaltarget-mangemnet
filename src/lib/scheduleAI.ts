// Schedule assistant: turns a note like
//   "Abdullah Medicare se kal follow-up karna hai, package renewal discuss karna hai"
// into a schedule suggestion (client, task, date, time, priority, type,
// reminder). Rule-based, English + Roman Urdu + common Urdu words; the user
// always accepts / edits before anything is saved.

export const SCHEDULE_TYPES = [
  "Follow-up", "Meeting", "Call", "Payment Reminder", "Renewal", "Project Deadline", "Pending Work", "Client Response",
] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export interface ScheduleSuggestion {
  clientId: string;
  clientName: string;
  leadId: string;
  task: string;
  date: string; // yyyy-mm-dd
  time: string; // HH:MM or ""
  priority: "High" | "Medium" | "Low";
  type: ScheduleType;
  notes: string;
  reminder: string; // ISO datetime of the reminder
  /** What the parser recognised, shown to the user. */
  found: string[];
}

const TYPE_RULES: [ScheduleType, RegExp][] = [
  ["Payment Reminder", /\b(payment|paisay|paise|raqam|dues?|balance|invoice|wasooli|reminder bhej)\b|ادائیگی|پیمنٹ/i],
  ["Renewal", /\b(renew\w*|renewal|package khatam|expire|expiry)\b|تجدید/i],
  ["Project Deadline", /\b(deadline|deliver\w*|submit|handover|last date)\b/i],
  ["Meeting", /\b(meeting|milna|mulaqat|visit|demo|presentation)\b|ملاقات|میٹنگ/i],
  ["Call", /\b(call|phone|baat karni|fon)\b|کال|فون/i],
  ["Client Response", /\b(jawab|reply|response|wait for|intezar)\b|جواب/i],
  ["Pending Work", /\b(pending|kaam baqi|complete karna|finish|design bhejna|video bhejni)\b/i],
  ["Follow-up", /\b(follow[- ]?up|folow|dobara (poochna|puchna)|yaad dilana)\b|فالو/i],
];

const DAY_NAMES: [number, RegExp][] = [
  [0, /\b(sunday|itwar|itwaar)\b|اتوار/i], [1, /\b(monday|peer|pir)\b|پیر/i], [2, /\b(tuesday|mangal)\b|منگل/i],
  [3, /\b(wednesday|budh)\b|بدھ/i], [4, /\b(thursday|jumeraat|jumerat)\b|جمعرات/i], [5, /\b(friday|juma|jummah)\b|جمعہ/i],
  [6, /\b(saturday|hafta|hafte ko)\b|ہفتہ/i],
];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function parseDate(text: string, today: Date): { date: string; found?: string } {
  const t = text.toLowerCase();
  if (/\b(parson|parso|day after tomorrow)\b|پرسوں/.test(t)) return { date: iso(addDays(today, 2)), found: "parson" };
  if (/\b(kal|tomorrow|tmrw)\b|کل/.test(t)) return { date: iso(addDays(today, 1)), found: "kal" };
  if (/\b(aaj|aj|today|abhi)\b|آج/.test(t)) return { date: iso(today), found: "aaj" };
  if (/\bnext week|agle hafte|agle haftay\b/.test(t)) return { date: iso(addDays(today, 7)), found: "agle hafte" };
  const inDays = t.match(/\b(\d{1,2})\s*(din|days?)\s*(baad|bad|mein|later)\b/);
  if (inDays) return { date: iso(addDays(today, +inDays[1])), found: `${inDays[1]} din baad` };
  // "5 oct", "oct 5", "5 october"
  const m1 = t.match(/\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/) || t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})\b/);
  if (m1) {
    const day = +(/\d/.test(m1[1]) ? m1[1] : m1[2]);
    const mon = MONTHS.indexOf((/\d/.test(m1[1]) ? m1[2] : m1[1]).slice(0, 3));
    let d = new Date(today.getFullYear(), mon, day);
    if (d < addDays(today, -1)) d = new Date(today.getFullYear() + 1, mon, day);
    return { date: iso(d), found: m1[0] };
  }
  // "12/10" or "12-10-2026" (day first, Pakistani format)
  const m2 = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (m2 && +m2[2] >= 1 && +m2[2] <= 12) {
    const y = m2[3] ? (m2[3].length === 2 ? 2000 + +m2[3] : +m2[3]) : today.getFullYear();
    return { date: iso(new Date(y, +m2[2] - 1, +m2[1])), found: m2[0] };
  }
  for (const [dow, re] of DAY_NAMES) {
    if (re.test(t)) {
      const diff = (dow - today.getDay() + 7) % 7 || 7;
      return { date: iso(addDays(today, diff)), found: t.match(re)?.[0] };
    }
  }
  return { date: iso(addDays(today, 1)) }; // default: tomorrow
}

function parseTime(text: string): { time: string; found?: string } {
  const t = text.toLowerCase();
  const hm = t.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/);
  if (hm) {
    let h = +hm[1];
    if (hm[3] === "pm" && h < 12) h += 12;
    if (hm[3] === "am" && h === 12) h = 0;
    return { time: `${String(h).padStart(2, "0")}:${hm[2]}`, found: hm[0] };
  }
  const baje = t.match(/\b(\d{1,2})\s*(baje|bje|am|pm|o'?clock)\b/);
  if (baje) {
    let h = +baje[1];
    const isPm = baje[2] === "pm" || (/\b(sham|shaam|raat|evening|dopahar|dopehar)\b/.test(t) && h < 12) || (baje[2] !== "am" && h >= 1 && h <= 7);
    if (isPm && h < 12) h += 12;
    return { time: `${String(h).padStart(2, "0")}:00`, found: baje[0] };
  }
  if (/\b(subah|morning)\b|صبح/.test(t)) return { time: "10:00", found: "subah" };
  if (/\b(dopahar|dopehar|afternoon)\b/.test(t)) return { time: "14:00", found: "dopahar" };
  if (/\b(sham|shaam|evening)\b|شام/.test(t)) return { time: "17:00", found: "sham" };
  if (/\b(raat|night)\b|رات/.test(t)) return { time: "20:00", found: "raat" };
  return { time: "" };
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

/** Best client / lead whose name appears in the text (longest match wins). */
function matchParty(text: string, clients: any[], leads: any[]) {
  const t = ` ${norm(text)} `;
  let best: { kind: "client" | "lead"; item: any; len: number } | null = null;
  const tryList = (list: any[], kind: "client" | "lead") => {
    for (const x of list || []) {
      const n = norm(String(x.name || ""));
      if (n.length < 3) continue;
      // full name, or its first two words (e.g. "Abdullah Medicare Hospital" → "abdullah medicare")
      const variants = [n, n.split(" ").slice(0, 2).join(" ")].filter((v) => v.length >= 3);
      for (const v of variants) {
        if (t.includes(` ${v} `) && (!best || v.length > best.len)) best = { kind, item: x, len: v.length };
      }
    }
  };
  tryList(clients, "client");
  tryList(leads, "lead");
  return best as { kind: "client" | "lead"; item: any; len: number } | null;
}

export function parseScheduleText(text: string, ctx: { clients: any[]; leads: any[] }, today = new Date()): ScheduleSuggestion {
  const clean = text.trim().replace(/\s+/g, " ");
  const found: string[] = [];
  const party = matchParty(clean, ctx.clients, ctx.leads);
  if (party) found.push(`${party.kind === "client" ? "Client" : "Lead"}: ${party.item.name}`);
  const { date, found: df } = parseDate(clean, today);
  if (df) found.push(`Date: ${df}`);
  const { time, found: tf } = parseTime(clean);
  if (tf) found.push(`Time: ${tf}`);
  const type = (TYPE_RULES.find(([, re]) => re.test(clean))?.[0] || "Follow-up") as ScheduleType;
  found.push(`Type: ${type}`);
  const priority: ScheduleSuggestion["priority"] = /\b(urgent|zaroori|zaruri|asap|foran|important|jaldi)\b|ضروری|فوری/i.test(clean) || type === "Payment Reminder" && /overdue|late/i.test(clean)
    ? "High" : /\b(jab waqt mile|later|kabhi|no rush)\b/i.test(clean) ? "Low" : type === "Renewal" || type === "Project Deadline" ? "High" : "Medium";

  // Task title: the note without the party name and date words, trimmed.
  let task = clean;
  if (party) task = task.replace(new RegExp(party.item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").trim();
  task = task.replace(/^(se|sy|ko|ka|ki|ke|with|to)\s+/i, "").replace(/\b(kal|aaj|parson|tomorrow|today)\b/gi, "").replace(/\s+/g, " ").replace(/^[,\s-]+|[,\s-]+$/g, "");
  const title = `${type}${party ? ` — ${party.item.name}` : ""}: ${task.charAt(0).toUpperCase()}${task.slice(1)}`.slice(0, 160);

  // Reminder: 30 min before a set time, else 10:00 on the day.
  const when = new Date(`${date}T${time || "10:00"}:00`);
  const reminder = new Date(when.getTime() - (time ? 30 * 60000 : 0)).toISOString();

  return {
    clientId: party?.kind === "client" ? party.item.id : "",
    clientName: party?.item.name || "",
    leadId: party?.kind === "lead" ? party.item.id : "",
    task: title, date, time, priority, type, notes: clean, reminder, found,
  };
}
