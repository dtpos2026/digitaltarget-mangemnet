// Monthly targets and the data-driven target breakdown.
//
// A target lives in `targets/{YYYY-MM}`. The suggestion engine only uses the
// portal's own history (invoices, accounting, leads) and the service catalog:
// no invented numbers. When there is no history it says so and falls back to
// the catalog prices, clearly labelled. The user always approves / edits.
import { CatalogService, activeServicesOf, categoryOfLine, isRecurring, monthlyValue, serviceById } from "./catalog";
import { inMonth, monthEnd, monthKey, shiftMonth, summarize } from "./finance";
import { invoiceView } from "./invoice";

export interface ServiceTarget {
  line: string;
  category: string;
  amount: number;
  /** Typical price of one sale in this line (history, else catalog). */
  unitPrice: number;
  /** Sales needed = ceil(amount / unitPrice). */
  units: number;
  /** Where the share came from. */
  basis: "history" | "catalog";
  share: number; // 0..1
}

export interface MonthTarget {
  id: string; // = month
  month: string; // "2026-10"
  revenue: number;
  expenseLimit?: number;
  savingTarget?: number;
  leadTarget?: number;
  clientTarget?: number;
  serviceMix?: ServiceTarget[];
  approved?: boolean;
  approvedAt?: string;
  notes?: string;
  source?: "manual" | "ai";
  createdAt?: string;
  updatedAt?: string;
  archivedMonth?: string;
}

export const targetOf = (targets: MonthTarget[], month: string) => (targets || []).find((t) => t.month === month || t.id === month);

const round = (n: number, step = 100) => Math.round(n / step) * step;

/** Revenue per service line from invoices dated in the given months. */
export function revenueByLine(invoices: any[], months: string[], settings: unknown): Map<string, { amount: number; items: number }> {
  const out = new Map<string, { amount: number; items: number }>();
  // `items` counts units sold (qty), so amount / items = price of one sale.
  const add = (line: string, amount: number, qty: number) => {
    const e = out.get(line) || { amount: 0, items: 0 };
    e.amount += amount; e.items += Math.max(1, qty);
    out.set(line, e);
  };
  for (const inv of invoices || []) {
    const v = invoiceView(inv);
    if (!months.includes(String(v.date).slice(0, 7))) continue;
    const itemsTotal = v.items.reduce((s, i) => s + (Number(i.total) || 0), 0) || 1;
    for (const it of v.items) {
      const svc = it.service ? serviceById(settings, it.service) : undefined;
      const line = svc?.line || inv.serviceLine || inv.category || "Other";
      // Share the invoice total (after discount / tax) by item weight.
      add(line, (v.grandTotal * (Number(it.total) || 0)) / itemsTotal, Number(it.qty) || 1);
    }
  }
  return out;
}

/** Typical single-sale price for a line: history first, then the catalog. */
function unitPriceOf(line: string, history: Map<string, { amount: number; items: number }>, catalog: CatalogService[]) {
  const h = history.get(line);
  if (h && h.items > 0 && h.amount > 0) return { price: h.amount / h.items, basis: "history" as const };
  const svc = catalog.filter((s) => s.line === line && (s.rate || s.setupFee));
  if (svc.length) {
    const avg = svc.reduce((s, x) => s + (x.pricing === "setup_plus_monthly" ? (x.setupFee || 0) + x.rate : x.rate), 0) / svc.length;
    return { price: avg, basis: "catalog" as const };
  }
  return { price: 0, basis: "catalog" as const };
}

export interface TargetSuggestion {
  month: string;
  revenue: number;
  /** Plain-language explanation of how each number was reached. */
  reasoning: string[];
  historyMonths: string[];
  avgIncome: number;
  lastIncome: number;
  expenseLimit: number;
  savingTarget: number;
  leadTarget: number;
  clientTarget: number;
  conversionRate: number;
  recurringBase: number;
  serviceMix: ServiceTarget[];
  hasHistory: boolean;
}

/**
 * Suggests next month's target from the last `lookback` months.
 * `requested` = the owner's own number (e.g. 500,000); when given, the mix is
 * built for that number, otherwise for a +15% growth target.
 */
export function suggestTarget(data: any, month: string, requested?: number, lookback = 3): TargetSuggestion {
  const settings = data.settings;
  const catalog = activeServicesOf(settings);
  const history = Array.from({ length: lookback }, (_, i) => shiftMonth(month, -(i + 1)));
  const sums = history.map((m) => summarize(inMonth(data.accounting || [], m), settings));
  const withIncome = sums.filter((s) => s.income > 0);
  const avgIncome = withIncome.length ? withIncome.reduce((s, x) => s + x.income, 0) / withIncome.length : 0;
  const avgBusiness = withIncome.length ? withIncome.reduce((s, x) => s + x.businessExpense, 0) / withIncome.length : 0;
  const avgPersonal = withIncome.length ? withIncome.reduce((s, x) => s + x.personalExpense, 0) / withIncome.length : 0;
  const lastIncome = sums[0]?.income || 0;
  const hasHistory = withIncome.length > 0;
  const reasoning: string[] = [];

  let revenue: number;
  if (requested && requested > 0) {
    revenue = requested;
    reasoning.push(`Target aap ne diya: Rs ${Math.round(requested).toLocaleString("en-PK")}.`);
    if (hasHistory) {
      const gap = Math.round(((requested - avgIncome) / (avgIncome || 1)) * 100);
      reasoning.push(`Pichle ${withIncome.length} mahine ki average income Rs ${Math.round(avgIncome).toLocaleString("en-PK")} thi — ye target us se ${gap >= 0 ? gap + "% zyada" : Math.abs(gap) + "% kam"} hai.`);
    }
  } else if (hasHistory) {
    revenue = round(avgIncome * 1.15, 1000);
    reasoning.push(`Pichle ${withIncome.length} mahine ki average income Rs ${Math.round(avgIncome).toLocaleString("en-PK")} + 15% growth = Rs ${revenue.toLocaleString("en-PK")}.`);
  } else {
    revenue = 0;
    reasoning.push("Pichle mahino ki income entries nahi hain, is liye target khud likhein — breakdown catalog ki prices se banega.");
  }

  // Money already "on the table": recurring packages still running or ending
  // recently (not yet renewed). Each is counted once at its monthly value.
  const prevStart = shiftMonth(month, -1) + "-01";
  const recurringBase = (data.invoices || []).reduce((s: number, inv: any) => {
    if (!inv.endDate || inv.endDate < prevStart || inv.renewal === false || inv.renewedBy) return s;
    const v = invoiceView(inv);
    const svc = v.items.map((i) => (i.service ? serviceById(settings, i.service) : undefined)).find(isRecurring);
    return svc ? s + monthlyValue(svc) : s;
  }, 0);
  if (recurringBase > 0) reasoning.push(`Recurring packages / renewals se taqreeban Rs ${Math.round(recurringBase).toLocaleString("en-PK")} mahana pehle se expected hai (agar renew hon).`);

  // Service mix: share of each line from history, else equal across priced lines.
  const hist = revenueByLine(data.invoices || [], history, settings);
  const histTotal = Array.from(hist.values()).reduce((s, x) => s + x.amount, 0);
  let lines: { line: string; share: number; basis: "history" | "catalog" }[];
  if (histTotal > 0) {
    lines = Array.from(hist.entries())
      .filter(([, x]) => x.amount > 0)
      .map(([line, x]) => ({ line, share: x.amount / histTotal, basis: "history" as const }));
    reasoning.push("Service-wise hissa pichle mahino ki invoices ke mutabiq rakha gaya hai.");
  } else {
    const priced = Array.from(new Set(catalog.filter((s) => s.rate > 0).map((s) => s.line)));
    lines = priced.map((line) => ({ line, share: 1 / (priced.length || 1), basis: "catalog" as const }));
    if (priced.length) reasoning.push("Service history nahi thi, is liye target active services mein barabar baanta gaya (catalog prices se). Apni marzi se edit karein.");
  }
  lines.sort((a, b) => b.share - a.share);

  const serviceMix: ServiceTarget[] = lines.map(({ line, share, basis }) => {
    const amount = round(revenue * share, 100);
    const { price, basis: pb } = unitPriceOf(line, hist, catalog);
    const unitPrice = Math.round(price);
    return {
      line, category: categoryOfLine(line), amount, share,
      unitPrice, units: unitPrice > 0 ? Math.max(1, Math.ceil(amount / unitPrice)) : 0,
      basis: basis === "history" && pb === "history" ? "history" : "catalog",
    };
  });

  // Leads: sales needed ÷ historical conversion rate.
  const since = shiftMonth(month, -lookback) + "-01";
  const recentLeads = (data.leads || []).filter((l: any) => String(l.date || l.createdAt || "").slice(0, 10) >= since);
  const won = recentLeads.filter((l: any) => l.status === "Converted").length;
  const conversionRate = recentLeads.length >= 5 ? won / recentLeads.length : 0;
  const salesNeeded = serviceMix.reduce((s, x) => s + x.units, 0);
  const leadTarget = conversionRate > 0 ? Math.ceil(salesNeeded / conversionRate) : salesNeeded * 5;
  reasoning.push(conversionRate > 0
    ? `Leads: ${salesNeeded} sales chahiye aur pichli conversion ${Math.round(conversionRate * 100)}% thi → taqreeban ${leadTarget} leads.`
    : `Leads: conversion ka data kam hai, is liye 5 leads per sale ka andaza → ${leadTarget} leads.`);

  const monthsWithClients = new Set((data.invoices || []).filter((i: any) => history.includes(String(invoiceView(i).date).slice(0, 7))).map((i: any) => i.clientId)).size;
  const clientTarget = Math.max(1, Math.ceil((monthsWithClients / Math.max(1, withIncome.length)) * (revenue && avgIncome ? revenue / avgIncome : 1)));

  // Spending: keep business cost at its historical ratio, personal flat, save the rest.
  const businessRatio = avgIncome > 0 ? avgBusiness / avgIncome : 0.4;
  const expenseLimit = round(revenue * businessRatio + avgPersonal, 500);
  const savingTarget = Math.max(0, round(revenue - expenseLimit, 500));
  reasoning.push(avgIncome > 0
    ? `Kharcha limit: business kharcha pichle ratio (${Math.round(businessRatio * 100)}%) par + personal average → Rs ${expenseLimit.toLocaleString("en-PK")}.`
    : `Kharcha limit: history nahi, is liye 40% business kharcha maan kar Rs ${expenseLimit.toLocaleString("en-PK")}.`);

  return {
    month, revenue, reasoning, historyMonths: history, avgIncome: Math.round(avgIncome), lastIncome: Math.round(lastIncome),
    expenseLimit, savingTarget, leadTarget, clientTarget, conversionRate, recurringBase: Math.round(recurringBase), serviceMix, hasHistory,
  };
}

export interface TargetProgress {
  month: string;
  target: number;
  achieved: number;
  remaining: number;
  pct: number;
  daysLeft: number;
  /** Revenue needed per remaining day to still hit the target. */
  requiredDaily: number;
  requiredWeekly: number;
  /** On pace if achieved / elapsed share of month >= target share. */
  onPace: boolean;
}

export function targetProgress(data: any, month = monthKey(), today = new Date()): TargetProgress | null {
  const t = targetOf(data.targets || [], month);
  if (!t || !t.revenue) return null;
  const achieved = summarize(inMonth(data.accounting || [], month), data.settings).income;
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const isCurrent = monthKey(today) === month;
  const dayNo = isCurrent ? today.getDate() : month < monthKey(today) ? days : 0;
  const daysLeft = Math.max(0, days - dayNo + (isCurrent ? 1 : 0));
  const remaining = Math.max(0, t.revenue - achieved);
  const requiredDaily = daysLeft > 0 ? Math.ceil(remaining / daysLeft) : remaining;
  return {
    month, target: t.revenue, achieved, remaining,
    pct: t.revenue ? Math.round((achieved / t.revenue) * 100) : 0,
    daysLeft, requiredDaily, requiredWeekly: requiredDaily * 7,
    onPace: achieved >= t.revenue * (dayNo / days),
  };
}

export { monthEnd };
