// Sales numbers per person and per team, for a month (YYYY-MM): leads, contact,
// demos, quotations, sales, revenue, conversion, follow-ups, activities and the
// monthly target. Pure: works on the leads / quotations / targets the caller can see.
import { LeadEvent } from "./leadHistory";
import { Product } from "./products";
import { leadValue, wonValue } from "./leadValue";
import { followUpIsDue, hasPendingFollowUp, isClosed } from "./salesPipeline";

export interface SalesTarget { id: string; month: string; teamId: string; revenue: number; deals: number; demos: number; activities?: number }
export const targetId = (month: string, teamId: string) => `${month}_${teamId}`;

export interface MemberStats {
  teamId: string;
  name: string;
  leads: number;          // leads that came to this person this month (taken / assigned / created)
  open: number;           // open leads now
  contacted: number;
  demos: number;
  quotations: number;
  quotationValue: number;
  won: number;
  revenue: number;
  lost: number;
  conversion: number;     // won ÷ leads this month (%)
  closeRate: number;      // won ÷ (won + lost) this month (%)
  pipeline: number;       // value of open leads now
  followUpsToday: number;
  followUpsOverdue: number;
  activities: number;     // calls, WhatsApp, meetings, visits, emails logged this month
  avgTakeMins: number | null; // lead arrived → TAKE LEAD
  target?: SalesTarget;
  targetPct: { revenue: number | null; deals: number | null; demos: number | null };
}

const inMonth = (iso: unknown, month: string) => String(iso || "").slice(0, 7) === month;
const ACTIVITY = new Set(["call", "whatsapp", "meeting", "visit", "email"]);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const of = (done: number, goal?: number) => (goal && goal > 0 ? Math.round((done / goal) * 100) : null);

export function memberStats(
  teamId: string, name: string, allLeads: any[], quotations: any[], products: Product[], settings: unknown, month: string,
  targets: SalesTarget[] = [], now = new Date(),
): MemberStats {
  const mine = allLeads.filter((l) => l.assignedTo === teamId);
  const cameThisMonth = mine.filter((l) => inMonth(l.takenAt || l.assignedAt || l.createdAt, month));
  const events = (l: any): LeadEvent[] => (Array.isArray(l.history) ? l.history : []);
  const contacted = mine.filter((l) => inMonth(l.firstContactAt || l.takenAt, month)).length;
  const demos = mine.filter((l) => inMonth(l.demoAt, month) || inMonth(l.demoDoneAt, month) || events(l).some((h) => h.type === "demo" && inMonth(h.at, month))).length;
  const qs = quotations.filter((q) => q.teamId === teamId && inMonth(q.createdAt, month));
  const wonLeads = mine.filter((l) => l.status === "Converted" && inMonth(l.wonAt, month));
  const lost = mine.filter((l) => l.status === "Lost" && inMonth(l.lostAt, month)).length;
  const revenue = wonLeads.reduce((s, l) => s + wonValue(l, products, settings), 0);
  const today = now.toISOString().slice(0, 10);
  const pending = mine.filter(hasPendingFollowUp);
  const takeTimes = cameThisMonth.filter((l) => l.takenAt && l.createdAt).map((l) => (Date.parse(l.takenAt) - Date.parse(l.createdAt)) / 60000).filter((m) => m >= 0);
  const target = targets.find((t) => t.teamId === teamId && t.month === month);
  return {
    teamId, name,
    leads: cameThisMonth.length,
    open: mine.filter((l) => !isClosed(l)).length,
    contacted, demos,
    quotations: qs.length,
    quotationValue: qs.reduce((s, q) => s + (Number(q.total) || 0), 0),
    won: wonLeads.length, revenue, lost,
    conversion: Math.min(100, pct(wonLeads.length, cameThisMonth.length)),
    closeRate: pct(wonLeads.length, wonLeads.length + lost),
    pipeline: mine.filter((l) => !isClosed(l)).reduce((s, l) => s + leadValue(l, products, settings).amount, 0),
    followUpsToday: pending.filter((l) => l.followUpDate === today).length,
    followUpsOverdue: pending.filter((l) => l.followUpDate < today || (l.followUpDate === today && !!l.followUpTime && followUpIsDue(l, now))).length,
    activities: mine.reduce((s, l) => s + events(l).filter((h) => ACTIVITY.has(h.type) && inMonth(h.at, month)).length, 0),
    avgTakeMins: takeTimes.length ? Math.round(takeTimes.reduce((a, b) => a + b, 0) / takeTimes.length) : null,
    target,
    targetPct: { revenue: of(revenue, target?.revenue), deals: of(wonLeads.length, target?.deals), demos: of(demos, target?.demos) },
  };
}

/** Logged activities per day for the last `days` days (oldest first). */
export function activityByDay(leads: any[], teamId: string | null, days = 14, now = new Date()): { day: string; count: number }[] {
  const out: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    out.push({ day: d.toISOString().slice(0, 10), count: 0 });
  }
  const idx = new Map(out.map((x, i) => [x.day, i]));
  for (const l of leads) {
    if (teamId && l.assignedTo !== teamId) continue;
    for (const h of (Array.isArray(l.history) ? l.history : []) as LeadEvent[]) {
      if (!ACTIVITY.has(h.type) && !["followup", "demo", "quotation", "taken", "converted"].includes(h.type)) continue;
      const i = idx.get(String(h.at).slice(0, 10));
      if (i !== undefined) out[i].count++;
    }
  }
  return out;
}

/** Every activity a person's leads saw, newest first (for the member profile). */
export function activityFeed(leads: any[], teamId: string, limit = 150) {
  const rows: { at: string; lead: any; ev: LeadEvent }[] = [];
  for (const l of leads) {
    if (l.assignedTo !== teamId) continue;
    for (const ev of (Array.isArray(l.history) ? l.history : []) as LeadEvent[]) if (ev.type !== "ai" && ev.type !== "captured") rows.push({ at: ev.at, lead: l, ev });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export const monthLabel = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString("en-PK", { month: "long", year: "numeric" });
export const shiftMonth = (month: string, by: number) => {
  const d = new Date(`${month}-15T12:00:00`);
  d.setMonth(d.getMonth() + by);
  return d.toISOString().slice(0, 7);
};
