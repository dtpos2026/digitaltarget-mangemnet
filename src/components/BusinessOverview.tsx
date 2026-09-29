import React, { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { fmtMoney, isLateProject, todayISO } from "@/lib/db";
import { inMonth, monthEnd, monthKey, monthLabel, monthStart, summarize } from "@/lib/finance";
import { marginReport } from "@/lib/margin";
import { invoiceView } from "@/lib/invoice";
import { targetProgress } from "@/lib/targets";
import { activeOnly } from "@/lib/closing";
import { navigate } from "@/lib/navigation";

const rs = (n: number) => `Rs ${fmtMoney(Math.round(Number(n) || 0))}`;
const CLOSED = ["Converted", "Lost", "Invalid"];
const INTERESTED = ["Interested", "Qualified", "Proposal", "Meeting Scheduled", "Demo Given", "Negotiation"];

/**
 * Main dashboard (current month): Financial, Sales, Projects, Schedule,
 * and Target. (AI suggestions live in the AI Analysis tab.)
 */
export default function BusinessOverview() {
  const { can, hasFullAccess } = useAuth();
  const { data } = useData();
  const month = monthKey();
  const today = todayISO();
  const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const canMoney = hasFullAccess || can("finance.view");


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

    </section>
  );
}
