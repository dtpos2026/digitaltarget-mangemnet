import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { fmtMoney, isLateProject, todayISO } from "@/lib/db";
import { inMonth, monthEnd, monthKey, monthLabel, monthStart, summarize } from "@/lib/finance";
import { marginReport } from "@/lib/margin";
import { invoiceView } from "@/lib/invoice";
import { targetProgress } from "@/lib/targets";
import { analyzeBusiness } from "@/lib/insights";
import { analyzeModule } from "@/lib/moduleInsights";
import { activeOnly } from "@/lib/closing";
import { useGrowthTasks, statusOf, isSnoozed } from "@/lib/growthTasks";
import { Campaign, needsAttention } from "@/lib/campaign";
import { navigate } from "@/lib/navigation";
import type { ModuleInsight } from "@/lib/moduleInsights";

const rs = (n: number) => `Rs ${fmtMoney(Math.round(Number(n) || 0))}`;
const CLOSED = ["Converted", "Lost", "Invalid"];
const INTERESTED = ["Interested", "Qualified", "Proposal", "Meeting Scheduled", "Demo Given", "Negotiation"];

interface Suggestion { key: string; group: string; severity: ModuleInsight["severity"]; title: string; detail: string; action?: string; tab?: string }

/**
 * Main dashboard (current month): Financial, Sales, Projects, Schedule,
 * Target and AI Suggestions with Complete / Snooze / Dismiss.
 */
export default function BusinessOverview() {
  const { can, hasFullAccess, workspaceUid } = useAuth();
  const { data } = useData();
  const g = useGrowthTasks();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const month = monthKey();
  const today = todayISO();
  const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const canMoney = hasFullAccess || can("finance.view");
  const canTask = hasFullAccess || can("settings.manage");

  useEffect(() => {
    if (!workspaceUid || !can("campaigns.manage")) return;
    getDocs(query(collection(db, "users", workspaceUid, "waCampaigns"), orderBy("createdAt", "desc"), limit(20)))
      .then((s) => setCampaigns(s.docs.map((d) => d.data() as Campaign))).catch(() => {});
  }, [workspaceUid, can]);

  const m = useMemo(() => summarize(inMonth(data.accounting, month), data.settings), [data.accounting, data.settings, month]);
  const mr = useMemo(() => marginReport(data, monthStart(month), monthEnd(month)), [data, month]);
  const weakest = [...mr.categories].filter((c) => c.revenue > 0 && c.missing === 0).sort((a, b) => a.margin - b.margin)[0];
  const target = useMemo(() => targetProgress(data, month), [data, month]);

  // Sales
  const leads = data.leads;
  const monthLeads = leads.filter((l: any) => String(l.date || l.createdAt || "").slice(0, 7) === month);
  const followUps = leads.filter((l: any) => l.followUpDate && l.followUpDate <= today && !CLOSED.includes(l.status));
  const invoices = data.invoices.map((inv: any) => ({ inv, v: invoiceView(inv) }));
  const outstanding = invoices.reduce((s: number, x: any) => s + x.v.due, 0);
  const overdue = invoices.filter((x: any) => x.v.status === "Overdue");

  // Projects
  const projects = activeOnly(data.projects);
  const running = projects.filter((p: any) => !["Complete", "Done"].includes(p.status));
  const pendingStart = running.filter((p: any) => p.start && String(p.start).slice(0, 10) > today);
  const completedMonth = data.projects.filter((p: any) => ["Complete", "Done"].includes(p.status) && String(p.end || "").slice(0, 7) === month);
  const late = running.filter(isLateProject);
  const dueSoon = running.filter((p: any) => p.end && String(p.end).slice(0, 10) >= today && String(p.end).slice(0, 10) <= week);

  // Schedule
  const sched = activeOnly(data.schedule).filter((s: any) => !["Done", "Cancel", "Dismissed"].includes(s.status));
  const todaySched = sched.filter((s: any) => s.date === today);
  const upcoming = sched.filter((s: any) => s.date > today && s.date <= week);
  const meetings = sched.filter((s: any) => /meeting|demo|visit/i.test(`${s.category} ${s.task}`) && s.date >= today && s.date <= week);

  // AI suggestions
  const suggestions = useMemo<Suggestion[]>(() => {
    const out: Suggestion[] = [];
    const openTasks = g.tasks.filter((t) => statusOf(t) === "open" && !isSnoozed(t) && t.due <= today);
    for (const t of openTasks.slice(0, 3)) out.push({ key: `task:${t.id}`, group: "Urgent task", severity: t.due < today ? "risk" : "warn", title: t.title, detail: `Growth task • due ${t.due}`, tab: "dash" });
    for (const x of overdue.slice(0, 4)) {
      const c = data.clients.find((cc: any) => cc.id === x.inv.clientId);
      out.push({ key: `pay:${x.inv.id}`, group: "Payment reminder", severity: "risk", title: `${c?.name || x.v.number}: ${rs(x.v.due)} overdue`, detail: `${x.v.number} • due ${x.inv.dueDate}`, action: "WhatsApp overdue reminder bhejein", tab: "invoices" });
    }
    for (const l of followUps.slice(0, 4)) out.push({ key: `fu:${l.id}:${l.followUpDate}`, group: "Client follow-up", severity: l.followUpDate < today ? "warn" : "info", title: `${l.name} — follow-up ${l.followUpDate < today ? "late" : "aaj"}`, detail: l.ai?.nextAction || l.serviceType || "", tab: "leads" });
    const assign = analyzeModule("assignments", data).insights.filter((i) => i.action).slice(0, 2);
    for (const i of assign) out.push({ key: `asg:${i.id}`, group: "Assignment", severity: i.severity, title: i.title, detail: i.action || "", tab: "assignments" });
    const biz = analyzeBusiness(data).insights.filter((i) => i.action && i.severity !== "good").slice(0, 3);
    for (const i of biz) out.push({ key: `biz:${i.id}`, group: "Recommendation", severity: i.severity, title: i.title, detail: i.action || "", tab: "budget" });
    for (const c of campaigns.filter(needsAttention)) out.push({ key: `cmp:${c.id}:${c.pausedReason}`, group: "WhatsApp safety", severity: "risk", title: `Campaign "${c.name}" ruk gayi`, detail: c.pausedReason || "", tab: "whatsapp" });
    return out.filter((s) => s.key.startsWith("task:") || !g.has("dashboard", { id: s.key }));
  }, [g, overdue, followUps, data, campaigns, today]);

  const act = (s: Suggestion, how: "done" | "dismissed" | { snoozeDays: number }) => {
    if (s.key.startsWith("task:")) {
      const id = s.key.slice(5);
      return how === "done" ? g.complete(id) : how === "dismissed" ? g.dismiss(id) : g.snooze(id, how.snoozeDays);
    }
    return g.resolve("dashboard", { id: s.key, severity: s.severity, title: s.title, detail: s.detail, action: s.action || s.detail }, how);
  };

  return (
    <section className="card overview">
      <div className="sectionHead">
        <div>
          <h2 style={{ margin: 0 }}>{monthLabel(month)} — Business overview</h2>
          <div className="small">Is mahine ke numbers (closed months Admin History mein).</div>
        </div>
      </div>

      <div className="ovGrid">
        {canMoney && (
          <div className="ovCard">
            <div className="ovHead">💰 Financial</div>
            <div className="ovRow"><span>Total income</span><b>{rs(m.income)}</b></div>
            <div className="ovRow"><span>Business expense</span><b>{rs(m.businessExpense)}</b></div>
            <div className="ovRow"><span>Personal / misc</span><b>{rs(m.personalExpense)}</b></div>
            <div className="ovRow"><span>Total expense</span><b>{rs(m.totalExpense)}</b></div>
            <div className="ovRow"><span>Net profit (business)</span><b className={m.businessProfit < 0 ? "neg" : "pos"}>{rs(m.businessProfit)}</b></div>
            <div className="ovRow"><span>Net saving</span><b className={m.netSaving < 0 ? "neg" : "pos"}>{rs(m.netSaving)} <em>({m.savingMargin}%)</em></b></div>
            {mr.sales.length > 0 && <div className="ovRow" onClick={() => navigate({ tab: "reports" })} style={{ cursor: "pointer" }}><span>Sales margin</span><b className={mr.grossProfit < 0 ? "neg" : "pos"}>{rs(mr.grossProfit)} <em>({mr.grossMargin}%{mr.missingCost ? "?" : ""})</em></b></div>}
            {weakest && <div className="ovRow"><span>Kamzor category</span><b className={weakest.margin < 25 ? "warnText" : ""}>{weakest.category} <em>({weakest.margin}%)</em></b></div>}
            {mr.missingCost > 0 && <div className="ovRow"><span>Cost baaqi wali sales</span><b className="warnText">{mr.missingCost}</b></div>}
          </div>
        )}
        {can("leads.view") && (
          <div className="ovCard clickable" onClick={() => navigate({ tab: "leads" })}>
            <div className="ovHead">🎯 Sales</div>
            <div className="ovRow"><span>Leads (is mahine)</span><b>{monthLeads.length}</b></div>
            <div className="ovRow"><span>Interested</span><b>{leads.filter((l: any) => INTERESTED.includes(l.status)).length}</b></div>
            <div className="ovRow"><span>Converted (is mahine)</span><b>{monthLeads.filter((l: any) => l.status === "Converted").length}</b></div>
            <div className="ovRow"><span>Pending follow-ups</span><b className={followUps.length ? "warnText" : ""}>{followUps.length}</b></div>
            {canMoney && <div className="ovRow"><span>Outstanding payments</span><b>{rs(outstanding)}</b></div>}
          </div>
        )}
        {can("projects.view") && (
          <div className="ovCard clickable" onClick={() => navigate({ tab: "projects" })}>
            <div className="ovHead">📁 Projects</div>
            <div className="ovRow"><span>Active</span><b>{running.length}</b></div>
            <div className="ovRow"><span>Pending (start baqi)</span><b>{pendingStart.length}</b></div>
            <div className="ovRow"><span>Completed (is mahine)</span><b>{completedMonth.length}</b></div>
            <div className="ovRow"><span>Deadline 7 din mein</span><b>{dueSoon.length}</b></div>
            <div className="ovRow"><span>Late</span><b className={late.length ? "neg" : ""}>{late.length}</b></div>
          </div>
        )}
        {(can("schedule.view") || can("dashboard.view")) && (
          <div className="ovCard clickable" onClick={() => navigate({ tab: "schedule" })}>
            <div className="ovHead">📅 Schedule</div>
            <div className="ovRow"><span>Aaj</span><b>{todaySched.length}</b></div>
            <div className="ovRow"><span>Agle 7 din</span><b>{upcoming.length}</b></div>
            <div className="ovRow"><span>Follow-ups</span><b>{sched.filter((s: any) => /follow/i.test(`${s.category} ${s.task}`)).length}</b></div>
            <div className="ovRow"><span>Meetings</span><b>{meetings.length}</b></div>
          </div>
        )}
        {canMoney && (
          <div className="ovCard clickable" onClick={() => navigate({ tab: "budget" })}>
            <div className="ovHead">🏁 Target</div>
            {target ? (
              <>
                <div className="tpBar"><div style={{ width: `${Math.min(100, target.pct)}%` }} className={target.onPace ? "ok" : "late"} /></div>
                <div className="ovRow"><span>Monthly target</span><b>{rs(target.target)}</b></div>
                <div className="ovRow"><span>Achieved</span><b>{rs(target.achieved)} <em>({target.pct}%)</em></b></div>
                <div className="ovRow"><span>Remaining</span><b>{rs(target.remaining)}</b></div>
                <div className="ovRow"><span>Required daily avg</span><b>{rs(target.requiredDaily)}</b></div>
              </>
            ) : <div className="small">Is mahine ka target set nahi — Budget &amp; Growth mein set karein.</div>}
          </div>
        )}
      </div>

      <div className="ovSugg">
        <div className="ovHead">✨ AI suggestions <span className="small">({suggestions.length})</span></div>
        {suggestions.length === 0 ? <div className="small">Abhi koi urgent kaam nahi. 🎉</div> : (
          <ul className="modList">
            {suggestions.map((s) => (
              <li key={s.key} className={`sev-${s.severity}`}>
                <span className="ovTag">{s.group}</span>
                <div>
                  <b>{s.title}</b>
                  {s.detail && <div className="small">{s.detail}</div>}
                </div>
                <div className="gtActions">
                  {s.tab && s.tab !== "dash" && <button className="btnSmall" onClick={() => navigate({ tab: s.tab! })} title="Kholein">→</button>}
                  {canTask && (
                    <>
                      <button className="btnSmall" onClick={() => act(s, "done")} title="Complete ✓">✓</button>
                      <select className="gtSnooze" value="" onChange={(e) => e.target.value && act(s, { snoozeDays: Number(e.target.value) })} aria-label="Snooze">
                        <option value="">⏰</option><option value="1">1 din</option><option value="3">3 din</option><option value="7">1 hafta</option>
                      </select>
                      <button className="btnSmall" onClick={() => act(s, "dismissed")} title="Dismiss — dobara nahi aayega" aria-label="Dismiss">✕</button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
