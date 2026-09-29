// Profit & margin per service category — INTERNAL only.
//
// Every sale (invoice) carries an internal cost: a cost per unit on each
// invoice line (pre-filled from the catalog) and/or real expenses linked to
// the invoice or its project in Accounting. Nothing here is ever printed on
// an invoice or shared with a client.
//
// Cost of one invoice = the larger of
//   - planned: Σ qty × costPrice of its lines, and
//   - actual : expenses linked to the invoice (invoiceId) + its share of the
//              expenses / team rates linked to its project.
// The larger figure is used on purpose: a partly recorded expense must not
// make a sale look more profitable than it was.
//
// Business expenses that belong to no invoice or project (rent, salaries,
// general ads) are "overhead" and reported separately, so the overall profit
// still equals what Accounting says.
import { invoiceView } from "./invoice";
import { categoryOfLine, serviceById } from "./catalog";
import { isExpense, scopeOf, summarize, inRange } from "./finance";

const num = (v: unknown) => Number(v) || 0;
const day = (v: unknown) => String(v || "").slice(0, 10);
const r0 = (n: number) => Math.round(n);
export const DEFAULT_MIN_MARGIN = 25;

export interface LineMargin { line: string; category: string; revenue: number; cost: number; units: number }
export interface SaleMargin {
  id: string;
  number: string;
  clientId: string;
  projectId: string;
  date: string;
  category: string;
  revenue: number; // net of tax, after discount
  received: number;
  planned: number;
  actual: number;
  cost: number;
  profit: number;
  margin: number; // % of revenue, 0 when no revenue
  /** Lines with no cost entered. */
  missing: number;
  basis: "actual" | "planned" | "missing";
  lines: LineMargin[];
}
export interface CategoryMargin {
  category: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  sales: number;
  received: number;
  missing: number; // sales without any cost
  lines: LineMargin[];
}
export interface MarginReport {
  from: string;
  to: string;
  revenue: number;
  directCost: number;
  grossProfit: number;
  grossMargin: number;
  overhead: number;
  netAfterOverhead: number;
  netMargin: number;
  sales: SaleMargin[];
  categories: CategoryMargin[];
  spendByCategory: { name: string; amount: number; scope: "business" | "personal"; linked: number }[];
  cash: { income: number; businessExpense: number; personalExpense: number; netSaving: number };
  missingCost: number;
}

const pct = (profit: number, revenue: number) => (revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0);

function projectSharedCost(projectId: string, data: any) {
  if (!projectId) return 0;
  const exp = (data.accounting || []).filter((a: any) => a.projectId === projectId && !a.invoiceId && isExpense(a) && scopeOf(a, data.settings) !== "personal");
  const covered = new Set(exp.map((a: any) => a.assignmentId).filter(Boolean));
  const team = (data.assignments || []).filter((a: any) => a.projectId === projectId && !covered.has(a.id));
  return exp.reduce((s: number, a: any) => s + num(a.amount), 0) + team.reduce((s: number, a: any) => s + num(a.rate), 0);
}

/** Margin of one invoice. `data` supplies expenses, assignments, catalog. */
export function saleMargin(inv: any, data: any): SaleMargin {
  const v = invoiceView(inv);
  const settings = data.settings;
  const revenue = Math.max(0, num(v.grandTotal) - num(v.taxAmount));
  const subtotal = num(v.subtotal) || v.items.reduce((s: number, i: any) => s + num(i.total), 0);
  const factor = subtotal > 0 ? revenue / subtotal : 0; // discount applied evenly to lines

  const lines: LineMargin[] = v.items.map((it: any) => {
    const svc = it.service ? serviceById(settings, it.service) : undefined;
    const line = svc?.line || inv.category || "Other";
    const category = svc?.category || (inv.category && !svc ? inv.category : categoryOfLine(line));
    const hasCost = it.costPrice !== undefined && it.costPrice !== null && String(it.costPrice) !== "";
    return { line, category, revenue: num(it.total) * factor, cost: hasCost ? num(it.qty) * num(it.costPrice) : 0, units: num(it.qty), _has: hasCost } as any;
  });
  const missing = lines.filter((l: any) => !l._has).length;
  const planned = lines.reduce((s, l) => s + l.cost, 0);

  // Actual: expenses tied to this invoice, plus a revenue-weighted share of its project's shared costs.
  const direct = (data.accounting || []).filter((a: any) => a.invoiceId === inv.id && isExpense(a) && scopeOf(a, settings) !== "personal")
    .reduce((s: number, a: any) => s + num(a.amount), 0);
  let shared = 0;
  if (inv.projectId) {
    const siblings = (data.invoices || []).filter((i: any) => i.projectId === inv.projectId);
    const total = siblings.reduce((s: number, i: any) => s + Math.max(0, num(invoiceView(i).grandTotal) - num(invoiceView(i).taxAmount)), 0);
    const pool = projectSharedCost(inv.projectId, data);
    shared = total > 0 ? pool * (revenue / total) : siblings.length ? pool / siblings.length : 0;
  }
  const actual = direct + shared;
  const cost = Math.max(planned, actual);

  // Spread the cost over lines: their own planned cost first, the rest by revenue share.
  const extra = cost - planned;
  const lineRev = lines.reduce((s, l) => s + l.revenue, 0);
  const out: LineMargin[] = lines.map((l: any) => ({
    line: l.line, category: l.category, units: l.units, revenue: l.revenue,
    cost: l.cost + (lineRev > 0 ? extra * (l.revenue / lineRev) : extra / Math.max(1, lines.length)),
  }));
  const cats = Array.from(new Set(out.map((l) => l.category)));
  return {
    id: inv.id, number: v.number, clientId: inv.clientId || "", projectId: inv.projectId || "", date: day(v.date),
    category: cats.length === 1 ? cats[0] : cats.length ? "Mixed" : inv.category || "Other",
    revenue, received: Math.min(num(v.paid), num(v.grandTotal)), planned, actual, cost, profit: revenue - cost,
    margin: pct(revenue - cost, revenue), missing: cost > 0 ? missing : missing || (lines.length ? 1 : 0),
    basis: actual > 0 && actual >= planned ? "actual" : planned > 0 ? "planned" : "missing",
    lines: out,
  };
}

/** Category-wise margin report for any date range (closed months included). */
export function marginReport(data: any, from: string, to: string): MarginReport {
  const settings = data.settings;
  const sales = (data.invoices || [])
    .filter((i: any) => { const d = day(invoiceView(i).date); return d >= from && d <= to; })
    .map((i: any) => saleMargin(i, data))
    .sort((a: SaleMargin, b: SaleMargin) => b.date.localeCompare(a.date));

  const catMap = new Map<string, CategoryMargin>();
  const lineMap = new Map<string, Map<string, LineMargin>>();
  for (const s of sales) {
    const seenCat = new Set<string>();
    for (const l of s.lines) {
      const c = catMap.get(l.category) || { category: l.category, revenue: 0, cost: 0, profit: 0, margin: 0, sales: 0, received: 0, missing: 0, lines: [] };
      c.revenue += l.revenue; c.cost += l.cost;
      if (!seenCat.has(l.category)) {
        seenCat.add(l.category); c.sales++;
        // received / missing are per sale; attribute to the category of its first line
        c.received += s.received * (s.revenue > 0 ? s.lines.filter((x) => x.category === l.category).reduce((t, x) => t + x.revenue, 0) / s.revenue : 0);
        if (s.basis === "missing") c.missing++;
      }
      catMap.set(l.category, c);
      const lm = lineMap.get(l.category) || new Map<string, LineMargin>();
      const e = lm.get(l.line) || { line: l.line, category: l.category, revenue: 0, cost: 0, units: 0 };
      e.revenue += l.revenue; e.cost += l.cost; e.units += l.units;
      lm.set(l.line, e); lineMap.set(l.category, lm);
    }
  }
  const categories = [...catMap.values()].map((c) => ({
    ...c, revenue: r0(c.revenue), cost: r0(c.cost), received: r0(c.received), profit: r0(c.revenue - c.cost), margin: pct(c.revenue - c.cost, c.revenue),
    lines: [...(lineMap.get(c.category)?.values() || [])].map((l) => ({ ...l, revenue: r0(l.revenue), cost: r0(l.cost) })).sort((a, b) => b.revenue - a.revenue),
  })).sort((a, b) => b.revenue - a.revenue);

  const revenue = r0(sales.reduce((s: number, x: SaleMargin) => s + x.revenue, 0));
  const directCost = r0(sales.reduce((s: number, x: SaleMargin) => s + x.cost, 0));

  // Money that really went out in the period.
  const acc = inRange(data.accounting || [], from, to);
  const cash = summarize(acc, settings);
  const spend = new Map<string, { name: string; amount: number; scope: "business" | "personal"; linked: number }>();
  let linkedBusiness = 0;
  for (const a of acc) {
    if (!isExpense(a)) continue;
    const scope = scopeOf(a, settings) === "personal" ? "personal" : "business";
    const key = `${scope}:${a.category || "Other"}`;
    const e = spend.get(key) || { name: a.category || "Other", amount: 0, scope, linked: 0 };
    e.amount += num(a.amount);
    if (a.invoiceId || a.projectId) { e.linked += num(a.amount); if (scope === "business") linkedBusiness += num(a.amount); }
    spend.set(key, e);
  }
  // Overhead = business expenses no sale or project claims.
  const overhead = r0(Math.max(0, cash.businessExpense - linkedBusiness));
  const grossProfit = revenue - directCost;
  return {
    from, to, revenue, directCost, grossProfit, grossMargin: pct(grossProfit, revenue), overhead,
    netAfterOverhead: grossProfit - overhead, netMargin: pct(grossProfit - overhead, revenue),
    sales, categories, spendByCategory: [...spend.values()].sort((a, b) => b.amount - a.amount),
    cash: { income: cash.income, businessExpense: cash.businessExpense, personalExpense: cash.personalExpense, netSaving: cash.netSaving },
    missingCost: sales.filter((s: SaleMargin) => s.basis === "missing").length,
  };
}

/** Plain-language findings from the numbers (no invented data). */
export function marginInsights(r: MarginReport, minMargin = DEFAULT_MIN_MARGIN): { level: "bad" | "warn" | "ok"; text: string }[] {
  const out: { level: "bad" | "warn" | "ok"; text: string }[] = [];
  const rs = (n: number) => `Rs ${r0(n).toLocaleString("en-PK")}`;
  if (!r.sales.length) return [{ level: "warn", text: "Is muddat mein koi invoice nahi — margin ka hisab nahi ban sakta." }];
  if (r.missingCost) out.push({ level: "warn", text: `${r.missingCost} sale(s) ki cost likhi nahi gayi — un ka margin sahi nahi (100% dikhta hai). Invoice edit karke cost bharein.` });
  // Categories with sales that have no cost look 100% profitable — leave them out of the ranking.
  const withRev = r.categories.filter((c) => c.revenue > 0 && c.missing === 0);
  const best = [...withRev].sort((a, b) => b.margin - a.margin)[0];
  const worst = [...withRev].sort((a, b) => a.margin - b.margin)[0];
  if (best) out.push({ level: "ok", text: `Sab se behtar: ${best.category} — margin ${best.margin}% (profit ${rs(best.profit)}).` });
  if (worst && worst !== best) out.push({ level: worst.margin < minMargin ? "bad" : "warn", text: `Sab se kamzor: ${worst.category} — margin sirf ${worst.margin}% (profit ${rs(worst.profit)}).` });
  for (const c of withRev) {
    if (c.margin < minMargin) {
      // Price needed for the target margin, from the real costs of that category.
      const cost = c.cost, units = c.lines.reduce((s, l) => s + l.units, 0);
      const need = units > 0 && cost > 0 ? cost / units / (1 - minMargin / 100) : 0;
      out.push({ level: "warn", text: `${c.category}: margin ${c.margin}% hai (target ${minMargin}%).${need ? ` Hedaf ke liye ek unit ki qeemat kam az kam Rs ${r0(need).toLocaleString("en-PK")} honi chahiye (aaj ki cost par).` : ""}` });
    }
  }
  const losers = r.sales.filter((s) => s.profit < 0).slice(0, 3);
  if (losers.length) out.push({ level: "bad", text: `Nuqsan wali sale: ${losers.map((s) => `${s.number} (${rs(s.profit)})`).join(", ")}.` });
  const over = r.sales.filter((s) => s.actual > s.planned && s.planned > 0 && s.actual > s.planned * 1.1).slice(0, 3);
  if (over.length) out.push({ level: "warn", text: `Asal kharcha andaze se zyada: ${over.map((s) => `${s.number} (planned ${rs(s.planned)}, asal ${rs(s.actual)})`).join(", ")}.` });
  if (r.grossProfit > 0 && r.overhead > r.grossProfit * 0.6) out.push({ level: "bad", text: `Overhead (${rs(r.overhead)}) gross profit (${rs(r.grossProfit)}) ka ${Math.round((r.overhead / r.grossProfit) * 100)}% kha raha hai.` });
  out.push({ level: r.netAfterOverhead >= 0 ? "ok" : "bad", text: `Overall: sales ${rs(r.revenue)} − direct cost ${rs(r.directCost)} − overhead ${rs(r.overhead)} = ${rs(r.netAfterOverhead)} (${r.netMargin}%).` });
  return out;
}
