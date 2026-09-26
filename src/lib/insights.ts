// Automatic business analysis for the Budget & Growth page.
// Pure, rule-based and computed in the browser from data the portal already
// has — nothing is sent anywhere. Every insight says why it fired and what to do.
import { invoiceView } from "./invoice";

export type Severity = "good" | "info" | "warn" | "risk";

export interface Insight {
  id: string;
  severity: Severity;
  area: "Revenue" | "Expenses" | "Cash" | "Receivables" | "Clients" | "Leads" | "Team" | "Growth";
  title: string;
  detail: string;
  action?: string;
}

export interface MonthPoint { month: string; income: number; expense: number; profit: number }

export interface Analysis {
  score: number;
  months: MonthPoint[];
  thisMonth: MonthPoint;
  lastMonth: MonthPoint;
  forecastIncome: number;
  growthTarget: number;
  leadsNeeded: number | null;
  avgDeal: number;
  conversionRate: number;
  insights: Insight[];
}

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const pctChange = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : a > 0 ? 100 : 0);
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-PK")}`;
const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

/** Income counts every IN entry except internal adjustments (the old dashboard only counted "Invoice Paid"). */
const isIncome = (a: any) => a.type === "IN" && a.category !== "Account Adjustment";
const isExpense = (a: any) => a.type === "OUT" && a.category !== "Account Adjustment";

export function analyzeBusiness(data: any, today = new Date()): Analysis {
  const accounting: any[] = data.accounting || [];
  const invoices: any[] = data.invoices || [];
  const leads: any[] = data.leads || [];
  const clients: any[] = data.clients || [];
  const wallets: any[] = data.wallets || [];
  const team: any[] = data.team || [];
  const budgets: any[] = data.budgets || [];
  const todayIso = today.toISOString().slice(0, 10);
  const insights: Insight[] = [];

  // ---------- monthly P&L (last 6 months) ----------
  const months: MonthPoint[] = [];
  for (let i = 5; i >= 0; i--) {
    const key = ym(new Date(today.getFullYear(), today.getMonth() - i, 1));
    const rows = accounting.filter((a) => String(a.date || "").startsWith(key));
    const income = rows.filter(isIncome).reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const expense = rows.filter(isExpense).reduce((s, a) => s + (Number(a.amount) || 0), 0);
    months.push({ month: key, income, expense, profit: income - expense });
  }
  const thisMonth = months[5];
  const lastMonth = months[4];
  const dayOfMonth = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  // Pace-adjusted comparison: this month so far vs the same share of last month.
  const pace = dayOfMonth / daysInMonth;
  const incomeChange = pctChange(thisMonth.income, lastMonth.income * pace);

  const active = months.filter((m) => m.income > 0 || m.expense > 0);
  const recent = months.slice(2, 5).filter((m) => m.income > 0);
  const forecastIncome = recent.length ? Math.round(recent.reduce((s, m) => s + m.income, 0) / recent.length) : thisMonth.income;

  if (!active.length) {
    insights.push({ id: "no-data", severity: "info", area: "Revenue", title: "Accounting data kam hai",
      detail: "Pichle 6 mahine ki income / expense entries nahi milin, is liye trends nahi ban sake.",
      action: "Har payment aur kharcha Accounting mein darj karein (invoice payments khud darj hoti hain)." });
  } else {
    if (lastMonth.income > 0) {
      insights.push(incomeChange >= 0
        ? { id: "rev-up", severity: "good", area: "Revenue", title: `Income pichle mahine se ${incomeChange}% behtar raftaar par`,
            detail: `Is mahine ab tak ${rs(thisMonth.income)} (pichle mahine isi waqt tak ~${rs(lastMonth.income * pace)}).` }
        : { id: "rev-down", severity: incomeChange <= -20 ? "risk" : "warn", area: "Revenue", title: `Income pichle mahine se ${Math.abs(incomeChange)}% peeche`,
            detail: `Is mahine ab tak ${rs(thisMonth.income)}; pichle mahine isi waqt tak ~${rs(lastMonth.income * pace)} tha.`,
            action: "Pending invoices ki collection aur purane clients se repeat / upsell par focus karein." });
    }
    const margin = thisMonth.income ? Math.round((thisMonth.profit / thisMonth.income) * 100) : 0;
    if (thisMonth.income > 0) {
      insights.push(margin >= 30
        ? { id: "margin-ok", severity: "good", area: "Expenses", title: `Profit margin ${margin}%`, detail: `Income ${rs(thisMonth.income)}, kharcha ${rs(thisMonth.expense)}.` }
        : { id: "margin-low", severity: margin < 10 ? "risk" : "warn", area: "Expenses", title: `Profit margin sirf ${margin}%`,
            detail: `Income ${rs(thisMonth.income)} mein se ${rs(thisMonth.expense)} kharch ho gaya.`,
            action: "Sab se bare kharchay wali category check karein aur us ka budget set karein." });
    } else if (thisMonth.expense > 0) {
      insights.push({ id: "no-income", severity: "risk", area: "Revenue", title: "Is mahine abhi tak koi income darj nahi",
        detail: `Magar ${rs(thisMonth.expense)} kharcha ho chuka hai.`, action: "Pending invoices ki payments collect karein." });
    }

    // Biggest expense category growth
    const catNow: Record<string, number> = {};
    const catPrev: Record<string, number> = {};
    for (const a of accounting.filter(isExpense)) {
      const k = a.category || "Other";
      if (String(a.date).startsWith(thisMonth.month)) catNow[k] = (catNow[k] || 0) + (Number(a.amount) || 0);
      if (String(a.date).startsWith(lastMonth.month)) catPrev[k] = (catPrev[k] || 0) + (Number(a.amount) || 0);
    }
    const top = Object.entries(catNow).sort((a, b) => b[1] - a[1])[0];
    if (top && thisMonth.expense > 0) {
      const share = Math.round((top[1] / thisMonth.expense) * 100);
      const grew = catPrev[top[0]] ? pctChange(top[1], catPrev[top[0]] * pace) : 0;
      insights.push({ id: "top-expense", severity: share >= 50 || grew >= 40 ? "warn" : "info", area: "Expenses",
        title: `Sab se bara kharcha: ${top[0]} (${share}%)`,
        detail: `${rs(top[1])} is mahine${grew ? `, pichle mahine ki raftaar se ${grew > 0 ? "+" : ""}${grew}%` : ""}.`,
        action: share >= 50 && !budgets.some((b) => b.category === top[0] && b.limit > 0) ? `${top[0]} ka mahana budget set karein aur har hafte check karein.` : undefined });
    }
    // Budgets exceeded
    for (const b of budgets) {
      const spent = catNow[b.category] || 0;
      if (b.limit > 0 && spent > b.limit) {
        insights.push({ id: `over-${b.category}`, severity: "risk", area: "Expenses", title: `${b.category} budget se ${rs(spent - b.limit)} zyada`,
          detail: `Limit ${rs(b.limit)}, kharcha ${rs(spent)}.`, action: "Is category mein naya kharcha rok dein ya limit dobara plan karein." });
      } else if (b.limit > 0 && spent > b.limit * 0.8) {
        insights.push({ id: `near-${b.category}`, severity: "warn", area: "Expenses", title: `${b.category} budget 80% se upar`,
          detail: `${rs(spent)} / ${rs(b.limit)} — mahine ke ${daysInMonth - dayOfMonth} din baqi.` });
      }
    }
  }

  // ---------- cash runway ----------
  const cash = wallets.reduce((s, w) => s + (Number(w.balance) || 0), 0);
  const avgExpense = active.length ? active.reduce((s, m) => s + m.expense, 0) / active.length : 0;
  if (avgExpense > 0) {
    const runway = cash / avgExpense;
    insights.push(runway < 1
      ? { id: "runway", severity: "risk", area: "Cash", title: `Cash sirf ~${Math.max(0, Math.round(runway * 30))} din ke kharchay ka`,
          detail: `Accounts mein ${rs(cash)}; average mahana kharcha ${rs(avgExpense)}.`, action: "Receivables collect karein aur ghair-zaruri kharchay roken." }
      : { id: "runway", severity: runway < 2 ? "warn" : "good", area: "Cash", title: `Cash ~${runway.toFixed(1)} mahine ke kharchay ke liye`,
          detail: `Accounts mein ${rs(cash)}; average mahana kharcha ${rs(avgExpense)}.` });
  }

  // ---------- receivables ----------
  const open = invoices.map((i) => ({ inv: i, v: invoiceView(i) })).filter((x) => x.v.due > 0);
  const outstanding = open.reduce((s, x) => s + x.v.due, 0);
  const overdue = open.filter((x) => x.v.status === "Overdue" || (!x.inv.dueDate && x.v.date && daysBetween(x.v.date, todayIso) > 30));
  if (outstanding > 0) {
    const overdueAmt = overdue.reduce((s, x) => s + x.v.due, 0);
    const byClient: Record<string, number> = {};
    for (const x of open) byClient[x.inv.clientId] = (byClient[x.inv.clientId] || 0) + x.v.due;
    const [topId, topDue] = Object.entries(byClient).sort((a, b) => b[1] - a[1])[0];
    const topName = clients.find((c) => c.id === topId)?.name || "ek client";
    insights.push({ id: "receivables", severity: overdueAmt > 0 ? (overdueAmt > forecastIncome * 0.5 ? "risk" : "warn") : "info", area: "Receivables",
      title: `${rs(outstanding)} clients se lena baqi (${open.length} invoices)`,
      detail: `${overdue.length ? `${overdue.length} invoices late (${rs(overdueAmt)}). ` : ""}Sab se zyada: ${topName} — ${rs(topDue)}.`,
      action: overdue.length ? "Invoices tab se late clients ko WhatsApp reminder bhejein." : undefined });
  }

  // ---------- client concentration ----------
  const since = ym(new Date(today.getFullYear(), today.getMonth() - 5, 1));
  const revByClient: Record<string, number> = {};
  for (const a of accounting) {
    if (isIncome(a) && a.clientId && String(a.date) >= since) revByClient[a.clientId] = (revByClient[a.clientId] || 0) + (Number(a.amount) || 0);
  }
  const totalRev = Object.values(revByClient).reduce((s, n) => s + n, 0);
  if (totalRev > 0) {
    const [cid, amt] = Object.entries(revByClient).sort((a, b) => b[1] - a[1])[0];
    const share = Math.round((amt / totalRev) * 100);
    const name = clients.find((c) => c.id === cid)?.name || "Ek client";
    if (share >= 40) {
      insights.push({ id: "concentration", severity: share >= 60 ? "risk" : "warn", area: "Clients", title: `${share}% income sirf ${name} se`,
        detail: "Ek client par itna inhisar khatarnak hai — woh gaya to income bohat gir jayegi.",
        action: "Naye clients ke liye ads / referrals chalayein taake koi client 30% se zyada na ho." });
    }
    const activeClients = Object.keys(revByClient).length;
    insights.push({ id: "clients", severity: "info", area: "Clients", title: `${activeClients} clients ne 6 mahine mein payment ki`,
      detail: `Average ${rs(totalRev / activeClients)} per client.` });
  }

  // ---------- leads ----------
  const monthLeads = leads.filter((l) => String(l.date || "").startsWith(thisMonth.month));
  const prevLeads = leads.filter((l) => String(l.date || "").startsWith(lastMonth.month));
  const converted = leads.filter((l) => l.status === "Converted").length;
  const conversionRate = leads.length ? converted / leads.length : 0;
  if (leads.length) {
    const change = pctChange(monthLeads.length, prevLeads.length * pace);
    insights.push({ id: "leads-volume", severity: change < -20 ? "warn" : change > 10 ? "good" : "info", area: "Leads",
      title: `Is mahine ${monthLeads.length} leads (${change >= 0 ? "+" : ""}${change}% raftaar)`,
      detail: `Overall conversion ${Math.round(conversionRate * 100)}% (${converted}/${leads.length}).`,
      action: change < -20 ? "Ads / WhatsApp campaigns tez karein — pipeline khali ho rahi hai." : undefined });

    const bySource: Record<string, { n: number; c: number }> = {};
    for (const l of leads) {
      const k = l.source || "Other";
      bySource[k] = bySource[k] || { n: 0, c: 0 };
      bySource[k].n++;
      if (l.status === "Converted") bySource[k].c++;
    }
    const ranked = Object.entries(bySource).filter(([, s]) => s.n >= 3).sort((a, b) => b[1].c / b[1].n - a[1].c / a[1].n);
    if (ranked.length >= 2) {
      const [best, bs] = ranked[0];
      const [worst, ws] = ranked[ranked.length - 1];
      insights.push({ id: "best-source", severity: "good", area: "Leads", title: `Sab se acha source: ${best} (${Math.round((bs.c / bs.n) * 100)}% conversion)`,
        detail: `${worst} sirf ${Math.round((ws.c / ws.n) * 100)}% convert hota hai.`,
        action: `Ads budget ka zyada hissa ${best} ki taraf shift karein.` });
    }
    const stale = leads.filter((l) => l.status === "New" && l.date && daysBetween(l.date, todayIso) >= 2);
    if (stale.length) {
      insights.push({ id: "stale-leads", severity: stale.length >= 5 ? "risk" : "warn", area: "Leads", title: `${stale.length} leads 2+ din se "New" — kisi ne contact nahi kiya`,
        detail: "Jaldi reply na mile to leads doosri agency ke paas chali jati hain.", action: "Aaj hi in leads ko call / WhatsApp karein ya team ko assign karein." });
    }
    const followDue = leads.filter((l) => l.followUpDate && l.followUpDate <= todayIso && !["Converted", "Lost", "Invalid"].includes(l.status));
    if (followDue.length) {
      insights.push({ id: "followups", severity: "warn", area: "Leads", title: `${followDue.length} follow-ups aaj ya pehle ke due`,
        detail: followDue.slice(0, 3).map((l) => l.name).join(", ") + (followDue.length > 3 ? "…" : ""), action: "Leads tab mein Follow-up filter se aaj khatam karein." });
    }
    const unassigned = leads.filter((l) => !l.assignedTo && !["Converted", "Lost", "Invalid"].includes(l.status)).length;
    if (unassigned >= 3 && team.length) {
      insights.push({ id: "unassigned", severity: "info", area: "Team", title: `${unassigned} open leads kisi ko assign nahi`,
        detail: "Assign karne se zimmedari aur Performance report dono saaf hoti hain.", action: "WhatsApp settings mein default assignee set karein." });
    }
  }

  // ---------- team dues ----------
  const dues = team.reduce((s, t) => s + Math.max(0, (Number(t.rate) || 0) - (Number(t.paid) || 0)), 0);
  if (dues > 0) {
    insights.push({ id: "team-dues", severity: dues > cash ? "risk" : "info", area: "Team", title: `Team ko ${rs(dues)} dena baqi`,
      detail: dues > cash ? "Yeh accounts ke cash se zyada hai." : "Waqt par payout team ki performance behtar rakhta hai." });
  }

  // ---------- growth plan ----------
  const paidInvoices = invoices.map(invoiceView).filter((v) => v.grandTotal > 0);
  const avgDeal = paidInvoices.length ? paidInvoices.reduce((s, v) => s + v.grandTotal, 0) / paidInvoices.length : 0;
  const base = Math.max(forecastIncome, thisMonth.income, lastMonth.income);
  const growthTarget = Math.round((base * 1.15) / 1000) * 1000;
  const leadsNeeded = avgDeal > 0 && conversionRate > 0 ? Math.ceil(growthTarget / avgDeal / conversionRate) : null;
  if (growthTarget > 0) {
    insights.push({ id: "growth-plan", severity: "info", area: "Growth", title: `Agle mahine ka target: ${rs(growthTarget)} (+15%)`,
      detail: avgDeal > 0 ? `Average deal ${rs(avgDeal)} — yani ~${Math.ceil(growthTarget / avgDeal)} deals chahiye.` : "Invoices banne ke baad deal size ka andaza lagega.",
      action: leadsNeeded ? `${Math.round(conversionRate * 100)}% conversion par ~${leadsNeeded} leads chahiye — daily ~${Math.ceil(leadsNeeded / 30)} leads.` : undefined });
  }

  // ---------- score ----------
  // Starts at 75; each risk / attention item lowers it, each good sign raises it.
  const weights: Record<Severity, number> = { good: 5, info: 0, warn: -4, risk: -9 };
  const score = Math.max(10, Math.min(100, 75 + insights.reduce((s, i) => s + weights[i.severity], 0)));
  const order: Record<Severity, number> = { risk: 0, warn: 1, good: 2, info: 3 };
  insights.sort((a, b) => order[a.severity] - order[b.severity]);

  return { score, months, thisMonth, lastMonth, forecastIncome, growthTarget, leadsNeeded, avgDeal, conversionRate, insights };
}
