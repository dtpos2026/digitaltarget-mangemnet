// Business report for any date range. Pure function over AppData: every
// number comes from records (nothing estimated). Archived (closed-month)
// records are included because reports are read-only history.
import { summarize, inRange, isMarketing, isIncome } from "./finance";
import { invoiceView, paymentsOf } from "./invoice";
import { serviceById } from "./catalog";

const num = (v: unknown) => Number(v) || 0;
const day = (v: unknown) => String(v || "").slice(0, 10);

export interface BusinessReport {
  from: string; to: string;
  income: number; businessExpense: number; personalExpense: number; totalExpense: number;
  businessProfit: number; netSaving: number; adsSpend: number;
  invoices: { count: number; billed: number; paidCount: number; unpaidCount: number };
  payments: { count: number; amount: number };
  outstanding: number; // all-time outstanding as of today (carry-forward safe)
  services: { line: string; amount: number; count: number }[];
  leads: { total: number; converted: number; lost: number; bySource: Record<string, number> };
  clients: { added: number; active: number };
  projects: { started: number; completed: number; running: number };
  team: { name: string; tasks: number; done: number; cost: number }[];
  expenseByCategory: { name: string; amount: number }[];
}

export function buildBusinessReport(data: any, from: string, to: string): BusinessReport {
  const settings = data.settings;
  const acc = inRange(data.accounting || [], from, to);
  const s = summarize(acc, settings);

  const invs = (data.invoices || []).filter((i: any) => { const d = day(invoiceView(i).date); return d >= from && d <= to; });
  const views = invs.map((i: any) => invoiceView(i));
  const pays = (data.invoices || []).flatMap((i: any) => paymentsOf(i).map((p) => ({ ...p })))
    .filter((p: any) => day(p.date) >= from && day(p.date) <= to);

  const byLine = new Map<string, { amount: number; count: number }>();
  invs.forEach((inv: any, k: number) => {
    const v = views[k];
    for (const it of v.items || []) {
      const line = (it.service && serviceById(settings, it.service)?.line) || inv.category || "Other";
      const e = byLine.get(line) || { amount: 0, count: 0 };
      e.amount += num(it.total) || num(it.qty || 1) * num(it.price); e.count++;
      byLine.set(line, e);
    }
  });

  const leads = (data.leads || []).filter((l: any) => { const d = day(l.createdAt || l.date); return d >= from && d <= to; });
  const bySource: Record<string, number> = {};
  leads.forEach((l: any) => { const k = l.source || "Other"; bySource[k] = (bySource[k] || 0) + 1; });

  const clientsNew = (data.clients || []).filter((c: any) => day(c.createdAt) >= from && day(c.createdAt) <= to);
  const activeClientIds = new Set([...views.map((v: any, k: number) => invs[k].clientId), ...acc.filter(isIncome).map((a: any) => a.clientId)].filter(Boolean));

  const projects = data.projects || [];
  const started = projects.filter((p: any) => day(p.start) >= from && day(p.start) <= to);
  const completed = projects.filter((p: any) => p.status === "Complete" && day(p.end) >= from && day(p.end) <= to);

  const team = (data.team || []).map((m: any) => {
    const as = (data.assignments || []).filter((a: any) => a.memberId === m.id && day(a.assignedAt) >= from && day(a.assignedAt) <= to);
    const cost = acc.filter((a: any) => a.type === "OUT" && String(a.desc || "").includes(`payout to ${m.name} (`)).reduce((t: number, a: any) => t + num(a.amount), 0);
    return { name: m.name, tasks: as.length, done: as.filter((a: any) => a.status === "Completed").length, cost };
  }).filter((t: any) => t.tasks || t.cost);

  const cat = new Map<string, number>();
  acc.forEach((a: any) => { if (a.type === "OUT") cat.set(a.category || "Other", (cat.get(a.category || "Other") || 0) + num(a.amount)); });

  return {
    from, to,
    income: s.income, businessExpense: s.businessExpense, personalExpense: s.personalExpense, totalExpense: s.totalExpense,
    businessProfit: s.businessProfit, netSaving: s.netSaving,
    adsSpend: acc.filter((a: any) => isMarketing(a, settings)).reduce((t: number, a: any) => t + num(a.amount), 0),
    invoices: {
      count: views.length, billed: views.reduce((t: number, v: any) => t + v.grandTotal, 0),
      paidCount: views.filter((v: any) => v.due <= 0 && v.grandTotal > 0).length, unpaidCount: views.filter((v: any) => v.due > 0).length,
    },
    payments: { count: pays.length, amount: pays.reduce((t: number, p: any) => t + num(p.amount), 0) },
    outstanding: (data.invoices || []).reduce((t: number, i: any) => t + Math.max(0, invoiceView(i).due), 0),
    services: [...byLine.entries()].map(([line, v]) => ({ line, ...v })).sort((a, b) => b.amount - a.amount),
    leads: { total: leads.length, converted: leads.filter((l: any) => l.status === "Converted").length, lost: leads.filter((l: any) => l.status === "Lost").length, bySource },
    clients: { added: clientsNew.length, active: activeClientIds.size },
    projects: { started: started.length, completed: completed.length, running: projects.filter((p: any) => (p.status || "Running") === "Running").length },
    team,
    expenseByCategory: [...cat.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
  };
}

export function rangeFor(kind: "daily" | "weekly" | "monthly" | "custom", today: string, custom?: { from: string; to: string }) {
  if (kind === "custom" && custom) return custom;
  const d = new Date(`${today}T12:00:00`);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  if (kind === "daily") return { from: today, to: today };
  if (kind === "weekly") { const f = new Date(d); f.setDate(f.getDate() - 6); return { from: iso(f), to: today }; }
  return { from: `${today.slice(0, 7)}-01`, to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)) };
}
