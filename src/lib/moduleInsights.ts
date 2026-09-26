// Per-module growth analysis ("AI Analysis" card at the top of each module).
// Rule-based, computed in the browser from the portal's own data. Each point
// says what was found and what to do; the action can become a Growth Task.
import { analyzeBusiness, Insight, Severity } from "./insights";
import { invoiceView } from "./invoice";
import { isLateProject } from "./db";

export type ModuleKey = "dashboard" | "leads" | "whatsapp" | "clients" | "projects" | "assignments" | "invoices" | "finance" | "team";

export interface ModuleInsight {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  action?: string;
  /** Suggested deadline for the task, in days from today. */
  dueDays?: number;
}

export interface ModuleStat { label: string; value: string; hint?: string }
export interface ModuleAnalysis { stats: ModuleStat[]; insights: ModuleInsight[] }

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-PK")}`;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (today: Date, n: number) => iso(new Date(today.getTime() - n * 864e5));
const CLOSED = ["Converted", "Lost", "Invalid"];
const DONE = /complete|done|approved|paid|delivered/i;

const AREA_OF: Record<ModuleKey, Insight["area"][]> = {
  dashboard: ["Revenue", "Growth", "Cash"],
  leads: ["Leads", "Growth"],
  whatsapp: [],
  clients: ["Clients"],
  projects: [],
  assignments: [],
  invoices: ["Receivables"],
  finance: ["Revenue", "Expenses", "Cash"],
  team: ["Team"],
};

const dueFor = (s: Severity) => (s === "risk" ? 2 : s === "warn" ? 5 : 7);
const fromBusiness = (i: Insight): ModuleInsight => ({ id: i.id, severity: i.severity, title: i.title, detail: i.detail, action: i.action, dueDays: dueFor(i.severity) });
const leadDate = (l: any) => String(l.date || l.createdAt || "").slice(0, 10);

function leadsModule(data: any, today: Date, onlyWhatsApp: boolean): ModuleAnalysis {
  const all: any[] = (data.leads || []).filter((l: any) => !onlyWhatsApp || l.source === "WhatsApp");
  const t = iso(today);
  const monthStart = t.slice(0, 8) + "01";
  const lastMonthStart = iso(new Date(today.getFullYear(), today.getMonth() - 1, 1));
  const thisMonth = all.filter((l) => leadDate(l) >= monthStart).length;
  const lastMonth = all.filter((l) => leadDate(l) >= lastMonthStart && leadDate(l) < monthStart).length;
  const converted = all.filter((l) => l.status === "Converted").length;
  const closed = all.filter((l) => CLOSED.includes(l.status)).length;
  const open = all.length - closed;
  const out: ModuleInsight[] = [];

  // Demand by service line (last 90 days).
  const recent = all.filter((l) => leadDate(l) >= daysAgo(today, 90));
  const byLine = new Map<string, { n: number; won: number }>();
  for (const l of recent) {
    const k = l.serviceType || "Other";
    const e = byLine.get(k) || { n: 0, won: 0 };
    e.n++; if (l.status === "Converted") e.won++;
    byLine.set(k, e);
  }
  const lines = [...byLine.entries()].filter(([k]) => k !== "Other").sort((a, b) => b[1].n - a[1].n);
  if (lines.length) {
    const [name, e] = lines[0];
    out.push({ id: "demand", severity: "info", title: `Sab se zyada demand: ${name} (${e.n} leads, 90 din)`,
      detail: `Is service mein ${e.won} convert hui (${pct(e.won, e.n)}%).`,
      action: `${name} ka ek khaas offer / package banayein aur isi ka ad chalayein.`, dueDays: 7 });
    const weak = lines.find(([, x]) => x.n >= 4 && x.won === 0);
    if (weak) out.push({ id: "weak-line", severity: "warn", title: `${weak[0]}: ${weak[1].n} leads, ek bhi convert nahi`,
      detail: "Log poochte hain lekin deal nahi hoti — price, portfolio ya follow-up mein kami ho sakti hai.",
      action: `${weak[0]} ki pichli 5 chats parhein, price / portfolio behtar karein aur sab ko follow-up bhejein.`, dueDays: 4 });
  }

  // Source quality.
  const bySource = new Map<string, { n: number; won: number }>();
  for (const l of all) {
    const k = l.source || "Unknown";
    const e = bySource.get(k) || { n: 0, won: 0 };
    e.n++; if (l.status === "Converted") e.won++;
    bySource.set(k, e);
  }
  if (!onlyWhatsApp) {
    const dead = [...bySource.entries()].find(([, e]) => e.n >= 5 && e.won === 0);
    if (dead) out.push({ id: "dead-source", severity: "warn", title: `${dead[0]} se ${dead[1].n} leads — 0 converted`,
      detail: "Is source par waqt / paisa lag raha hai lekin sale nahi.", action: `${dead[0]} ki targeting / message badlein ya budget behtar source par lagayein.`, dueDays: 7 });
  }

  // Follow-ups and untouched leads.
  const overdue = all.filter((l) => l.followUpDate && l.followUpDate < t && !CLOSED.includes(l.status));
  if (overdue.length) out.push({ id: "fu-overdue", severity: "risk", title: `${overdue.length} follow-up ki tareekh guzar chuki`,
    detail: overdue.slice(0, 4).map((l) => l.name).join(", ") + (overdue.length > 4 ? "…" : ""),
    action: `Aaj ${overdue.length} leads ko call / WhatsApp karein aur agli tareekh set karein.`, dueDays: 1 });
  const fresh = all.filter((l) => (l.status || "New") === "New" && leadDate(l) && leadDate(l) <= daysAgo(today, 1));
  if (fresh.length) out.push({ id: "new-untouched", severity: fresh.length > 5 ? "risk" : "warn", title: `${fresh.length} nayi leads se abhi tak rabta nahi hua`,
    detail: "Jitni jaldi jawab, utni zyada sale — pehle 1 ghante ka jawab sab se behtar convert hota hai.",
    action: `${fresh.length} New leads ko aaj contact karein aur status "Contacted" karein.`, dueDays: 1 });

  if (onlyWhatsApp) {
    const others = (data.leads || []).filter((l: any) => l.source !== "WhatsApp");
    const oc = others.filter((l: any) => l.status === "Converted").length;
    if (all.length >= 3) out.push({ id: "wa-vs", severity: pct(converted, all.length) >= pct(oc, others.length) ? "good" : "info",
      title: `WhatsApp conversion ${pct(converted, all.length)}% (baaki sources ${pct(oc, others.length)}%)`,
      detail: "WhatsApp leads ka muqabla doosre sources se.",
      action: "WhatsApp par jawab ke liye templates istemal karein aur har chat ko lead mein capture karein.", dueDays: 7 });
    if (!all.length) out.push({ id: "wa-none", severity: "info", title: "Abhi koi WhatsApp lead nahi",
      detail: "WhatsApp Web link kar ke \"Capture all chats\" chalayein.", action: "WhatsApp Web link karein aur saari chats capture karein.", dueDays: 1 });
  }

  const change = lastMonth ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : 0;
  return {
    stats: [
      { label: onlyWhatsApp ? "WhatsApp leads" : "Total leads", value: String(all.length), hint: `${open} open` },
      { label: "Is mahine", value: String(thisMonth), hint: lastMonth ? `${change >= 0 ? "+" : ""}${change}% vs last month` : "pichle mahine 0" },
      { label: "Conversion", value: `${pct(converted, all.length)}%`, hint: `${converted} converted` },
      { label: "Follow-up late", value: String(overdue.length) },
    ],
    insights: out,
  };
}

function clientsModule(data: any, today: Date): ModuleAnalysis {
  const clients: any[] = data.clients || [];
  const invoices: any[] = data.invoices || [];
  const out: ModuleInsight[] = [];
  const lastInv = new Map<string, string>();
  const count = new Map<string, number>();
  const revenue = new Map<string, number>();
  for (const inv of invoices) {
    const v = invoiceView(inv);
    count.set(inv.clientId, (count.get(inv.clientId) || 0) + 1);
    revenue.set(inv.clientId, (revenue.get(inv.clientId) || 0) + v.grandTotal);
    if ((lastInv.get(inv.clientId) || "") < v.date) lastInv.set(inv.clientId, v.date);
  }
  const repeat = clients.filter((c) => (count.get(c.id) || 0) > 1).length;
  const cutoff = daysAgo(today, 60);
  const inactive = clients.filter((c) => lastInv.get(c.id) && lastInv.get(c.id)! < cutoff);
  const never = clients.filter((c) => !count.get(c.id));
  if (inactive.length) out.push({ id: "inactive", severity: "warn", title: `${inactive.length} purane clients 60+ din se koi kaam nahi`,
    detail: inactive.slice(0, 5).map((c) => c.name).join(", ") + (inactive.length > 5 ? "…" : ""),
    action: `In ${Math.min(inactive.length, 10)} clients ko naya offer bhejein (social media / ads / software upgrade).`, dueDays: 5 });
  if (never.length) out.push({ id: "no-invoice", severity: "info", title: `${never.length} clients ki abhi tak koi invoice nahi`,
    detail: "Ya to kaam shuru nahi hua ya invoice banana reh gaya.", action: "In clients ki invoice / proposal check karein.", dueDays: 3 });
  const top = [...revenue.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) {
    const c = clients.find((x) => x.id === top[0]);
    if (c) out.push({ id: "top-client", severity: "good", title: `Sab se qeemti client: ${c.name} (${rs(top[1])})`,
      detail: "Achhe clients se referral sab se sasti nayi sale hoti hai.", action: `${c.name} se referral / review maangein aur upsell offer dein.`, dueDays: 7 });
  }
  return {
    stats: [
      { label: "Clients", value: String(clients.length) },
      { label: "Repeat clients", value: `${pct(repeat, clients.length)}%`, hint: `${repeat} ne 2+ dafa kaam karwaya` },
      { label: "Inactive 60d+", value: String(inactive.length) },
    ],
    insights: out,
  };
}

function projectsModule(data: any): ModuleAnalysis {
  const projects: any[] = data.projects || [];
  const running = projects.filter((p) => !["Complete", "Done"].includes(p.status || "Running"));
  const late = projects.filter(isLateProject);
  const out: ModuleInsight[] = [];
  if (late.length) out.push({ id: "late", severity: "risk", title: `${late.length} projects deadline se late`,
    detail: late.slice(0, 4).map((p) => p.title).join(", "), action: `Late projects ki team se aaj update lein aur clients ko nayi tareekh batayein.`, dueDays: 1 });
  const noBudget = running.filter((p) => !Number(p.budget));
  if (noBudget.length) out.push({ id: "no-budget", severity: "warn", title: `${noBudget.length} chalte projects ka budget darj nahi`,
    detail: "Budget ke baghair profit ka pata nahi chalta.", action: "Har project ka budget / price darj karein.", dueDays: 3 });
  const byCat = new Map<string, number>();
  for (const p of projects) byCat.set(p.category || "Other", (byCat.get(p.category || "Other") || 0) + (Number(p.budget) || 0));
  const best = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] > 0) out.push({ id: "best-cat", severity: "good", title: `Sab se zyada kamai wali category: ${best[0]}`,
    detail: `Kul ${rs(best[1])} ke projects.`, action: `${best[0]} ke 2 case studies bana kar social media par dalein.`, dueDays: 7 });
  return {
    stats: [
      { label: "Running", value: String(running.length) },
      { label: "Late", value: String(late.length) },
      { label: "Total", value: String(projects.length) },
    ],
    insights: out,
  };
}

function assignmentsModule(data: any, today: Date): ModuleAnalysis {
  const list: any[] = data.assignments || [];
  const team: any[] = data.team || [];
  const t = iso(today);
  const open = list.filter((a) => !DONE.test(a.status || ""));
  const overdue = open.filter((a) => a.deadline && String(a.deadline).slice(0, 10) < t);
  const out: ModuleInsight[] = [];
  if (overdue.length) out.push({ id: "overdue", severity: "risk", title: `${overdue.length} assignments deadline se late`,
    detail: overdue.slice(0, 4).map((a) => a.title).join(", "), action: "Late assignments ke members se aaj status lein.", dueDays: 1 });
  const load = new Map<string, number>();
  for (const a of open) load.set(a.memberId, (load.get(a.memberId) || 0) + 1);
  const busiest = [...load.entries()].sort((a, b) => b[1] - a[1])[0];
  if (busiest && busiest[1] >= 4) {
    const m = team.find((x) => x.id === busiest[0]);
    out.push({ id: "overload", severity: "warn", title: `${m?.name || "Ek member"} par ${busiest[1]} kaam khule hain`,
      detail: "Zyada load se delivery late hoti hai.", action: "Kuch kaam doosre members mein baantein.", dueDays: 2 });
  }
  const idle = team.filter((m) => !load.get(m.id));
  if (open.length && idle.length) out.push({ id: "idle", severity: "info", title: `${idle.length} members ke paas abhi koi kaam nahi`,
    detail: idle.slice(0, 5).map((m) => m.name).join(", "), action: "Content / design ka agla batch in ko assign karein.", dueDays: 2 });
  return {
    stats: [
      { label: "Open", value: String(open.length) },
      { label: "Late", value: String(overdue.length) },
      { label: "Done", value: String(list.length - open.length) },
    ],
    insights: out,
  };
}

function invoicesModule(data: any, today: Date): ModuleAnalysis {
  const views = (data.invoices || []).map((inv: any) => ({ inv, v: invoiceView(inv) }));
  const t = iso(today);
  const monthStart = t.slice(0, 8) + "01";
  const out: ModuleInsight[] = [];
  const overdue = views.filter(({ v }: any) => v.status === "Overdue");
  const overdueAmt = overdue.reduce((s: number, { v }: any) => s + v.due, 0);
  if (overdue.length) out.push({ id: "overdue", severity: "risk", title: `${overdue.length} invoices overdue — ${rs(overdueAmt)}`,
    detail: overdue.slice(0, 4).map(({ v }: any) => v.number).join(", "), action: `Overdue clients ko WhatsApp par payment reminder bhejein (${rs(overdueAmt)}).`, dueDays: 1 });
  const soon = views.filter(({ inv, v }: any) => v.due > 0 && inv.dueDate && inv.dueDate >= t && inv.dueDate <= iso(new Date(today.getTime() + 7 * 864e5)));
  if (soon.length) out.push({ id: "due-soon", severity: "info", title: `${soon.length} invoices agle 7 din mein due`,
    detail: `Kul ${rs(soon.reduce((s: number, { v }: any) => s + v.due, 0))}.`, action: "Due date se 2 din pehle reminder bhejein.", dueDays: 5 });
  const month = views.filter(({ v }: any) => v.date >= monthStart);
  const billed = month.reduce((s: number, { v }: any) => s + v.grandTotal, 0);
  const collected = month.reduce((s: number, { v }: any) => s + v.paid, 0);
  if (billed > 0 && pct(collected, billed) < 60) out.push({ id: "collection", severity: "warn", title: `Is mahine sirf ${pct(collected, billed)}% raqam wasool hui`,
    detail: `${rs(billed)} ki invoices, ${rs(collected)} wasool.`, action: "Naye kaam par 50% advance ki policy lagayein.", dueDays: 7 });
  const byCat = new Map<string, number>();
  for (const { inv, v } of views) byCat.set(inv.category || "Other", (byCat.get(inv.category || "Other") || 0) + v.grandTotal);
  const cats = [...byCat.entries()].filter(([k]) => k !== "Other").sort((a, b) => b[1] - a[1]);
  if (cats.length) out.push({ id: "cat", severity: "good", title: `Sab se zyada billing: ${cats[0][0]} (${rs(cats[0][1])})`,
    detail: cats.slice(1, 3).map(([k, n]) => `${k}: ${rs(n)}`).join(" • ") || "Baqi categories mein billing kam hai.",
    action: `${cats[0][0]} ke purane clients ko monthly package offer karein (recurring income).`, dueDays: 7 });
  const due = views.reduce((s: number, { v }: any) => s + v.due, 0);
  return {
    stats: [
      { label: "Is mahine billing", value: rs(billed) },
      { label: "Wasool", value: rs(collected) },
      { label: "Kul baqaya", value: rs(due) },
      { label: "Overdue", value: String(overdue.length) },
    ],
    insights: out,
  };
}

function teamModule(data: any, today: Date): ModuleAnalysis {
  const team: any[] = data.team || [];
  const leads: any[] = data.leads || [];
  const assignments: any[] = data.assignments || [];
  const out: ModuleInsight[] = [];
  const rows = team.map((m) => {
    const mine = leads.filter((l) => l.assignedTo === m.id);
    const won = mine.filter((l) => l.status === "Converted").length;
    const done = assignments.filter((a) => a.memberId === m.id && DONE.test(a.status || "")).length;
    return { m, leads: mine.length, won, rate: pct(won, mine.length), done };
  });
  const sellers = rows.filter((r) => r.leads >= 3).sort((a, b) => b.rate - a.rate);
  if (sellers.length >= 2) {
    const best = sellers[0], worst = sellers[sellers.length - 1];
    out.push({ id: "best-seller", severity: "good", title: `Best closer: ${best.m.name} (${best.rate}% conversion)`,
      detail: `${best.won}/${best.leads} leads convert kin.`, action: `${best.m.name} se team ko 15 minute ki sales training dilwayein.`, dueDays: 7 });
    if (best.rate - worst.rate >= 20) out.push({ id: "coach", severity: "warn", title: `${worst.m.name} ki conversion sirf ${worst.rate}%`,
      detail: `${worst.won}/${worst.leads} leads.`, action: `${worst.m.name} ki 3 chats saath review karein aur follow-up script dein.`, dueDays: 5 });
  }
  const unassigned = leads.filter((l) => !l.assignedTo && !CLOSED.includes(l.status)).length;
  if (unassigned >= 3) out.push({ id: "unassigned-leads", severity: "warn", title: `${unassigned} open leads kisi ko assign nahi`,
    detail: "Bina malik ke leads par koi follow-up nahi karta.", action: "Open leads team mein assign karein.", dueDays: 2 });
  const monthStart = iso(today).slice(0, 8) + "01";
  const doneMonth = assignments.filter((a) => DONE.test(a.status || "") && String(a.updatedAt || a.assignedAt || "").slice(0, 10) >= monthStart).length;
  return {
    stats: [
      { label: "Team", value: String(team.length) },
      { label: "Kaam mukammal (is mahine)", value: String(doneMonth) },
      { label: "Unassigned leads", value: String(unassigned) },
    ],
    insights: out,
  };
}

/** Analysis for one module. `today` is injectable for tests. */
export function analyzeModule(module: ModuleKey, data: any, today = new Date()): ModuleAnalysis {
  const business = analyzeBusiness(data, today);
  const shared = business.insights.filter((i) => AREA_OF[module].includes(i.area)).map(fromBusiness);
  let own: ModuleAnalysis;
  switch (module) {
    case "leads": own = leadsModule(data, today, false); break;
    case "whatsapp": own = leadsModule(data, today, true); break;
    case "clients": own = clientsModule(data, today); break;
    case "projects": own = projectsModule(data); break;
    case "assignments": own = assignmentsModule(data, today); break;
    case "invoices": own = invoicesModule(data, today); break;
    case "team": own = teamModule(data, today); break;
    default: {
      const m = business.thisMonth;
      own = {
        stats: [
          { label: "Health score", value: `${business.score}/100` },
          { label: "Is mahine income", value: rs(m.income) },
          { label: "Profit", value: rs(m.profit) },
          { label: "Target (+15%)", value: rs(business.growthTarget) },
        ],
        insights: [],
      };
    }
  }
  if (module === "dashboard") {
    // The dashboard shows the most urgent point of every module.
    const others: ModuleKey[] = ["leads", "whatsapp", "clients", "invoices", "projects", "assignments", "team"];
    for (const k of others) {
      const top = analyzeModule(k, data, today).insights.filter((i) => i.severity === "risk" || i.severity === "warn").slice(0, 2);
      own.insights.push(...top.map((i) => ({ ...i, id: `${k}:${i.id}` })));
    }
  }
  const seen = new Set<string>();
  const order: Record<Severity, number> = { risk: 0, warn: 1, info: 2, good: 3 };
  const insights = [...own.insights, ...shared]
    .filter((i) => (seen.has(i.title) ? false : (seen.add(i.title), true)))
    .sort((a, b) => order[a.severity] - order[b.severity]);
  return { stats: own.stats, insights };
}
