// Monthly Closing: snapshot + archive.
//
// Closing a month never deletes anything. It:
//  1. writes a complete, read-only snapshot of the month to
//     `monthlyArchives/{YYYY-MM}` (status "closing"),
//  2. stamps finished operational records of that month with
//     `archivedMonth` (paid invoices, completed projects / tasks, done
//     schedule items) so they leave the active workspace — the rules then
//     let only the administrator change or delete them,
//  3. marks the snapshot "closed".
// If step 2 fails part-way the snapshot stays "closing" and the close can be
// retried: stamping is idempotent, so a half-finished close never leaves
// data in a different state than a finished one.
//
// Accounting entries dated up to the month end are archived too, so the
// Accounting screen starts the new month at zero. Wallet balances are never
// changed by a close: the closing balance carries forward as it is.
//
// Never touched: clients, services, team, accounts / wallets (balances),
// settings, leads, and anything still open (unpaid invoices, running
// projects, pending tasks) — those carry forward.
import { activeServicesOf, categoryOfLine, serviceById } from "./catalog";
import { MoneySummary, inMonth, isExpense, isIncome, monthEnd, monthStart, scopeOf, shiftMonth, summarize } from "./finance";
import { invoiceView } from "./invoice";
import { analyzeBusiness } from "./insights";
import { suggestTarget, targetOf } from "./targets";

export const ARCHIVABLE = ["invoices", "projects", "assignments", "schedule", "accounting"] as const;
export type Archivable = (typeof ARCHIVABLE)[number];

const DONE = /complete|done|approved|delivered|cancel/i;
const MAX_ROWS = 1500; // keeps a snapshot well under Firestore's 1 MB document limit
const cap = <T,>(rows: T[]) => ({ rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS });
const day = (v: unknown) => String(v || "").slice(0, 10);

export const isArchived = (x: { archivedMonth?: string } | null | undefined) => !!x?.archivedMonth;
/** Records still in the active workspace (not in a closed month). */
export const activeOnly = <T extends { archivedMonth?: string }>(list: T[]) => (list || []).filter((x) => !isArchived(x));

/** Which records a close of `month` moves out of the active workspace. */
export function recordsToArchive(data: any, month: string): Record<Archivable, string[]> {
  const end = monthEnd(month);
  const inOrBefore = (d: string) => !!d && d <= end;
  return {
    // Paid invoices dated up to the month end. Unpaid ones carry forward.
    invoices: (data.invoices || []).filter((i: any) => !i.archivedMonth && invoiceView(i).due <= 0 && invoiceView(i).grandTotal > 0 && inOrBefore(day(invoiceView(i).date))).map((i: any) => i.id),
    // Completed projects that ended by the month end.
    projects: (data.projects || []).filter((p: any) => !p.archivedMonth && ["Complete", "Done"].includes(p.status) && inOrBefore(day(p.end || p.start))).map((p: any) => p.id),
    // Finished assignments.
    assignments: (data.assignments || []).filter((a: any) => !a.archivedMonth && DONE.test(a.status || "") && inOrBefore(day(a.deadline || a.updatedAt || a.assignedAt))).map((a: any) => a.id),
    // Schedule items of the month that are done / cancelled. Pending ones stay visible.
    schedule: (data.schedule || []).filter((s: any) => !s.archivedMonth && DONE.test(s.status || "") && inOrBefore(day(s.date))).map((s: any) => s.id),
    // Every accounting entry dated up to the month end (the ledger of the closed period).
    accounting: (data.accounting || []).filter((a: any) => !a.archivedMonth && inOrBefore(day(a.date))).map((a: any) => a.id),
  };
}

export interface ClosingCheck { level: "info" | "warn"; text: string }

/** Things the admin should know before confirming. */
export function closingChecks(data: any, month: string, today = new Date()): ClosingCheck[] {
  const out: ClosingCheck[] = [];
  const todayIso = today.toISOString().slice(0, 10);
  if (monthEnd(month) >= todayIso) out.push({ level: "warn", text: `Mahina abhi khatam nahi hua (aakhri din ${monthEnd(month)}). Close karne ke baad is mahine ki nayi entries phir bhi ho sakti hain lekin snapshot mein nahi hongi.` });
  const prev = shiftMonth(month, -1);
  if ((data.accounting || []).some((a: any) => day(a.date).slice(0, 7) === prev) && !(data._closedMonths || []).includes(prev)) {
    out.push({ level: "info", text: `Pichla mahina (${prev}) abhi close nahi hua.` });
  }
  const unpaid = (data.invoices || []).filter((i: any) => !i.archivedMonth && invoiceView(i).due > 0 && day(invoiceView(i).date) <= monthEnd(month));
  if (unpaid.length) out.push({ level: "info", text: `${unpaid.length} unpaid / partial invoices (Rs ${Math.round(unpaid.reduce((s: number, i: any) => s + invoiceView(i).due, 0)).toLocaleString("en-PK")}) agle mahine carry forward honge.` });
  const pending = (data.schedule || []).filter((s: any) => !s.archivedMonth && !DONE.test(s.status || "") && day(s.date) && day(s.date) <= monthEnd(month));
  if (pending.length) out.push({ level: "info", text: `${pending.length} schedule items abhi pending hain — ye active rahenge.` });
  const running = (data.projects || []).filter((p: any) => !p.archivedMonth && !["Complete", "Done"].includes(p.status));
  if (running.length) out.push({ level: "info", text: `${running.length} chalte projects active rahenge.` });
  if (!targetOf(data.targets || [], month)) out.push({ level: "info", text: "Is mahine ka target set nahi tha — accountability mein target achievement nahi aayega." });
  return out;
}

export interface MonthSnapshot {
  id: string;
  month: string;
  status: "closing" | "closed";
  closedAt: string;
  closedBy: string;
  summary: MoneySummary;
  accountability: {
    target: number; income: number; businessExpense: number; personalExpense: number; netSaving: number;
    achievementPct: number | null; outstanding: number; savingMargin: number; marketingSpend: number;
  };
  target: any | null;
  outstanding: {
    receivable: number; invoices: { id: string; number: string; client: string; due: number; date: string }[];
    teamDues: number; khataLena: number; khataDena: number;
  };
  wallets: { id: string; name: string; balance: number }[];
  invoices: { rows: any[]; truncated: boolean };
  income: { rows: any[]; truncated: boolean };
  expenses: { rows: any[]; truncated: boolean };
  expenseByCategory: { category: string; scope: string; amount: number }[];
  services: { line: string; category: string; revenue: number; invoices: number }[];
  clients: { id: string; name: string; billed: number; received: number; invoices: number }[];
  leads: {
    total: number; newInMonth: number; converted: number; lost: number; conversionPct: number;
    byStatus: Record<string, number>; bySource: Record<string, number>; byService: Record<string, number>;
  };
  projects: { completed: any[]; active: number; late: number };
  tasks: { assignmentsDone: any[]; scheduleDone: number; schedulePending: any[] };
  team: { id: string; name: string; role: string; tasksDone: number; leadsAssigned: number; leadsConverted: number }[];
  campaigns: any[];
  ai: { score: number; insights: { severity: string; title: string; action?: string }[]; nextMonth: any };
  archived: Record<Archivable, string[]>;
  counts: Record<string, number>;
}

/** Complete snapshot of one month, built from the loaded data. */
export function buildMonthSnapshot(data: any, month: string, opts: { closedBy: string; campaigns?: any[]; now?: Date } = { closedBy: "" }): MonthSnapshot {
  const settings = data.settings;
  const start = monthStart(month), end = monthEnd(month);
  const inM = (d: unknown) => { const x = day(d); return !!x && x >= start && x <= end; };
  const rows = inMonth(data.accounting || [], month);
  const summary = summarize(rows, settings);
  const client = (id: string) => (data.clients || []).find((c: any) => c.id === id);

  // Invoices dated in the month.
  const monthInvoices = (data.invoices || []).filter((i: any) => inM(invoiceView(i).date));
  const invoiceRows = monthInvoices.map((i: any) => {
    const v = invoiceView(i);
    return { id: i.id, number: v.number, client: client(i.clientId)?.name || "", clientId: i.clientId || "", date: v.date, category: i.category || "", total: v.grandTotal, paid: v.paid, due: v.due, status: v.status, period: i.endDate ? `${i.startDate} → ${i.endDate}` : "" };
  });

  // Services: revenue per line from the month's invoices.
  const byLine = new Map<string, { revenue: number; invoices: number }>();
  for (const i of monthInvoices) {
    const v = invoiceView(i);
    const itemsTotal = v.items.reduce((s, x) => s + (Number(x.total) || 0), 0) || 1;
    for (const it of v.items) {
      const line = (it.service && serviceById(settings, it.service)?.line) || i.category || "Other";
      const e = byLine.get(line) || { revenue: 0, invoices: 0 };
      e.revenue += (v.grandTotal * (Number(it.total) || 0)) / itemsTotal;
      e.invoices += 1;
      byLine.set(line, e);
    }
  }
  const services = Array.from(byLine.entries()).map(([line, e]) => ({ line, category: categoryOfLine(line), revenue: Math.round(e.revenue), invoices: e.invoices })).sort((a, b) => b.revenue - a.revenue);

  // Clients active in the month.
  const cmap = new Map<string, { billed: number; received: number; invoices: number }>();
  for (const i of monthInvoices) {
    const e = cmap.get(i.clientId) || { billed: 0, received: 0, invoices: 0 };
    e.billed += invoiceView(i).grandTotal; e.invoices += 1;
    cmap.set(i.clientId, e);
  }
  for (const a of rows.filter(isIncome)) {
    if (!a.clientId) continue;
    const e = cmap.get(String(a.clientId)) || { billed: 0, received: 0, invoices: 0 };
    e.received += Number(a.amount) || 0;
    cmap.set(String(a.clientId), e);
  }
  const clients = Array.from(cmap.entries()).filter(([id]) => id).map(([id, e]) => ({ id, name: client(id)?.name || id, ...e })).sort((a, b) => b.billed - a.billed);

  // Expenses by category.
  const ecat = new Map<string, { scope: string; amount: number }>();
  for (const a of rows.filter(isExpense)) {
    const k = String(a.category || "Other");
    const e = ecat.get(k) || { scope: scopeOf(a, settings), amount: 0 };
    e.amount += Number(a.amount) || 0;
    ecat.set(k, e);
  }

  // Leads.
  const leads = data.leads || [];
  const newLeads = leads.filter((l: any) => inM(l.date || l.createdAt));
  const count = (list: any[], key: (l: any) => string) => list.reduce((m: Record<string, number>, l: any) => { const k = key(l) || "—"; m[k] = (m[k] || 0) + 1; return m; }, {});
  const converted = newLeads.filter((l: any) => l.status === "Converted").length;

  // Outstanding (carried forward).
  const unpaid = (data.invoices || []).filter((i: any) => invoiceView(i).due > 0 && day(invoiceView(i).date) <= end);
  const receivable = unpaid.reduce((s: number, i: any) => s + invoiceView(i).due, 0);
  const teamDues = (data.team || []).reduce((s: number, t: any) => s + Math.max(0, (Number(t.rate) || 0) - (Number(t.paid) || 0)), 0);
  let khataLena = 0, khataDena = 0;
  for (const k of data.khata || []) {
    if (k.status === "SETTLED") continue;
    const due = Math.max(0, (Number(k.amount) || 0) - (Number(k.paid) || 0));
    if (k.type === "LENA" || k.direction === "lena") khataLena += due; else khataDena += due;
  }

  // Work.
  const toArchive = recordsToArchive(data, month);
  const projects = data.projects || [];
  const completed = projects.filter((p: any) => ["Complete", "Done"].includes(p.status) && inM(p.end || p.start))
    .map((p: any) => ({ id: p.id, title: p.title, client: client(p.clientId)?.name || "", budget: Number(p.budget) || 0, end: day(p.end) }));
  const assignmentsDone = (data.assignments || []).filter((a: any) => DONE.test(a.status || "") && inM(a.deadline || a.updatedAt || a.assignedAt))
    .map((a: any) => ({ id: a.id, title: a.title, member: (data.team || []).find((t: any) => t.id === a.memberId)?.name || "", status: a.status, rate: Number(a.rate) || 0 }));
  const monthSchedule = (data.schedule || []).filter((s: any) => inM(s.date));

  const team = (data.team || []).map((t: any) => ({
    id: t.id, name: t.name, role: t.role || "",
    tasksDone: assignmentsDone.filter((a: any) => a.member === t.name).length,
    leadsAssigned: newLeads.filter((l: any) => l.assignedTo === t.id).length,
    leadsConverted: newLeads.filter((l: any) => l.assignedTo === t.id && l.status === "Converted").length,
  }));

  // Target & AI.
  const target = targetOf(data.targets || [], month) || null;
  const outstandingNow = receivable;
  const business = analyzeBusiness({ ...data, accounting: (data.accounting || []).filter((a: any) => day(a.date) <= end) }, new Date(`${end}T12:00:00`));
  const nextMonth = suggestTarget(data, shiftMonth(month, 1), target?.revenue ? Math.round(target.revenue) : undefined);

  const campaigns = (opts.campaigns || []).filter((c: any) => inM(c.createdAt)).map((c: any) => ({
    id: c.id, name: c.name, status: c.status,
    sent: (c.recipients || []).filter((r: any) => ["sent", "delivered", "replied"].includes(r.status)).length,
    replies: (c.recipients || []).filter((r: any) => r.status === "replied").length,
  }));

  const counts = {
    invoices: monthInvoices.length, payments: rows.filter(isIncome).length, expenses: rows.filter(isExpense).length,
    newLeads: newLeads.length, projectsCompleted: completed.length, tasksDone: assignmentsDone.length,
    archivedInvoices: toArchive.invoices.length, archivedProjects: toArchive.projects.length,
    archivedAssignments: toArchive.assignments.length, archivedSchedule: toArchive.schedule.length, archivedAccounting: toArchive.accounting.length,
  };

  const compact = (a: any) => ({ id: a.id, date: day(a.date), category: a.category || "", scope: a.type === "OUT" ? scopeOf(a, settings) : "", amount: Number(a.amount) || 0, client: client(a.clientId)?.name || "", desc: String(a.desc || "").slice(0, 120), walletId: a.walletId || "" });

  return {
    id: month, month, status: "closing", closedAt: (opts.now || new Date()).toISOString(), closedBy: opts.closedBy,
    summary,
    accountability: {
      target: target?.revenue || 0, income: summary.income, businessExpense: summary.businessExpense, personalExpense: summary.personalExpense,
      netSaving: summary.netSaving, achievementPct: target?.revenue ? Math.round((summary.income / target.revenue) * 100) : null,
      outstanding: Math.round(outstandingNow), savingMargin: summary.savingMargin, marketingSpend: summary.marketingSpend,
    },
    target,
    outstanding: {
      receivable: Math.round(receivable),
      invoices: unpaid.slice(0, 300).map((i: any) => { const v = invoiceView(i); return { id: i.id, number: v.number, client: client(i.clientId)?.name || "", due: v.due, date: v.date }; }),
      teamDues, khataLena, khataDena,
    },
    wallets: (data.wallets || []).map((w: any) => ({ id: w.id, name: w.name, balance: Number(w.balance) || 0 })),
    invoices: cap(invoiceRows),
    income: cap(rows.filter(isIncome).map(compact)),
    expenses: cap(rows.filter(isExpense).map(compact)),
    expenseByCategory: Array.from(ecat.entries()).map(([category, e]) => ({ category, ...e })).sort((a, b) => b.amount - a.amount),
    services, clients,
    leads: {
      total: leads.length, newInMonth: newLeads.length, converted, lost: newLeads.filter((l: any) => l.status === "Lost").length,
      conversionPct: newLeads.length ? Math.round((converted / newLeads.length) * 100) : 0,
      byStatus: count(newLeads, (l) => l.status || "New"), bySource: count(newLeads, (l) => l.source), byService: count(newLeads, (l) => l.serviceType),
    },
    projects: { completed, active: projects.filter((p: any) => !["Complete", "Done"].includes(p.status) && !p.archivedMonth).length, late: 0 },
    tasks: {
      assignmentsDone,
      scheduleDone: monthSchedule.filter((s: any) => DONE.test(s.status || "")).length,
      schedulePending: monthSchedule.filter((s: any) => !DONE.test(s.status || "")).map((s: any) => ({ id: s.id, date: day(s.date), task: s.task || "", status: s.status || "" })),
    },
    team, campaigns,
    ai: {
      score: business.score,
      insights: business.insights.map((i) => ({ severity: i.severity, title: i.title, action: i.action })),
      nextMonth,
    },
    archived: toArchive,
    counts,
  };
}

/** Firestore cannot store undefined; strips it (and functions) from a snapshot. */
export const toStorable = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** Active catalog lines, used by the history view for service names. */
export const catalogLines = (settings: unknown) => Array.from(new Set(activeServicesOf(settings).map((s) => s.line)));
