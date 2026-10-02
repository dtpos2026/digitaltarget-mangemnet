import React, { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { fmtMoney, todayISO } from "@/lib/db";
import { monthKey, monthEnd, monthStart } from "@/lib/finance";
import { marginReport } from "@/lib/margin";
import { targetProgress } from "@/lib/targets";
import { analyzeLead, applyAnalysis, levelClass } from "@/lib/leadAnalysis";
import { projectMetrics } from "@/lib/projectInsights";
import { activeOnly } from "@/lib/closing";
import { navigate } from "@/lib/navigation";
import { setInlineAI, useInlineAI } from "@/lib/inlineAI";
import type { ModuleKey } from "@/lib/moduleInsights";
import AiSuggestions from "@/components/AiSuggestions";
import TargetPlanner from "@/components/TargetPlanner";
import SchedulePlanner from "@/components/SchedulePlanner";
import GrowthAnalysis from "@/components/GrowthAnalysis";
import MarginReport from "@/components/MarginReport";
import ModuleInsights from "@/components/ModuleInsights";
import { BusinessReport } from "@/components/tabs/ReportsTab";
import LeadBriefCard from "@/components/LeadBriefCard";

const rs = (n: number) => `Rs ${fmtMoney(Math.round(Number(n) || 0))}`;
const CLOSED = ["Converted", "Lost", "Invalid"];

function LeadAiPanel() {
  const { data, updateItem } = useData();
  const { can, user } = useAuth();
  const [run, setRun] = useState<{ done: number; total: number } | null>(null);
  const open = data.leads.filter((l: any) => !CLOSED.includes(l.status));
  const withAi = open.filter((l: any) => l.ai);
  const rank: Record<string, number> = { Hot: 0, Warm: 1, Cold: 2 };
  const prio: Record<string, number> = { P1: 0, P2: 1, P3: 2 };
  // VIP first, then priority, then interest.
  const list = [...withAi].sort((a: any, b: any) => (Number(!!b.vip) - Number(!!a.vip)) || ((prio[a.ai.brief?.priority] ?? 1) - (prio[b.ai.brief?.priority] ?? 1)) || (rank[a.ai.level] - rank[b.ai.level]) || (b.ai.interest - a.ai.interest));
  const count = (lvl: string) => withAi.filter((l: any) => l.ai.level === lvl).length;
  const today = todayISO();
  const due = open.filter((l: any) => l.followUpDate && l.followUpDate <= today);

  const analyzeAll = async () => {
    setRun({ done: 0, total: open.length });
    let i = 0;
    for (const l of open) {
      try { await updateItem("leads", applyAnalysis(l, analyzeLead(l, data.settings), { by: user?.email || "" })); } catch { /* keep going */ }
      setRun({ done: ++i, total: open.length });
    }
    setTimeout(() => setRun(null), 2500);
  };

  return (
    <section className="card">
      <div className="sectionHead">
        <div><h2 style={{ margin: 0 }}>🎯 Lead analysis</h2><div className="small">Interest ek andaza hai (chat + status se), guarantee nahi.</div></div>
        {can("leads.edit") && <button className="btnSolid" onClick={analyzeAll} disabled={!!run}>{run ? `Analysis… ${run.done}/${run.total}` : `✨ Sab open leads analyze (${open.length})`}</button>}
      </div>
      <div className="moneyStrip" style={{ marginTop: 8 }}>
        <div><span>Open leads</span><b>{open.length}</b><em>analyze hui {withAi.length}</em></div>
        <div><span>High (Hot)</span><b>{count("Hot")}</b></div>
        <div><span>Medium (Warm)</span><b>{count("Warm")}</b></div>
        <div><span>Low (Cold)</span><b>{count("Cold")}</b></div>
        <div><span>⭐ VIP</span><b>{open.filter((l: any) => l.vip).length}</b><em>P1: {withAi.filter((l: any) => l.ai.brief?.priority === "P1").length}</em></div>
        <div><span>Follow-up due</span><b className={due.length ? "warnText" : ""}>{due.length}</b></div>
      </div>
      <div className="tablewrap" style={{ marginTop: 8, maxHeight: 460 }}>
        <table>
          <thead><tr><th>Lead</th><th>Service</th><th>Interest</th><th>Agla qadam</th><th>Follow-up</th><th /></tr></thead>
          <tbody>
            {list.slice(0, 80).map((l: any) => (
              <tr key={l.id}>
                <td><b>{l.name}</b><div className="small">{l.phone || ""} • {l.status}</div></td>
                <td>{l.serviceType || l.ai.line || "—"}</td>
                <td><span className={`badge ${levelClass(l.ai.level)}`}>{l.ai.level === "Hot" ? "High" : l.ai.level === "Warm" ? "Medium" : "Low"} {l.ai.interest}%</span>{l.ai.potentialValue ? <div className="small">≈ {rs(l.ai.potentialValue)}</div> : null}</td>
                <td className="small">{l.ai.brief ? <LeadBriefCard brief={l.ai.brief} compact /> : l.ai.nextAction}</td>
                <td className="small">{l.followUpDate || l.ai.followUp?.date || "—"}</td>
                <td><button className="btnSmall" onClick={() => navigate({ tab: "leads" })}>Leads →</button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={6} className="small">Abhi kisi lead ka analysis nahi — upar wala button dabayein.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WorkAiPanel() {
  const { data } = useData();
  const today = todayISO();
  const projects = activeOnly(data.projects).filter((p: any) => !["Complete", "Done"].includes(p.status))
    .map((p: any) => ({ p, m: projectMetrics(p, data) })).filter((x) => x.m.urgency !== "low")
    .sort((a, b) => (a.m.urgency === "high" ? 0 : 1) - (b.m.urgency === "high" ? 0 : 1));
  const load = data.team.map((t: any) => {
    const open = activeOnly(data.assignments).filter((a: any) => a.memberId === t.id && !["Completed", "Cancelled"].includes(a.status));
    return { t, open: open.length, late: open.filter((a: any) => a.deadline && String(a.deadline).slice(0, 10) < today).length };
  }).sort((a: any, b: any) => b.open - a.open);
  return (
    <>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>📁 Projects — AI ka agla qadam</h2>
        {projects.length === 0 ? <div className="small">Sab projects theek chal rahe hain. 🎉</div> : projects.map(({ p, m }) => (
          <div key={p.id} className="aiAutoItem">
            <div><b>{p.title}</b><div className="small">{data.clients.find((c: any) => c.id === p.clientId)?.name || ""} • progress {m.progress}% • {m.paymentStatus}</div><div className={`prjNext ${m.urgency}`}>🤖 {m.nextAction}</div></div>
            <button className="btnSmall" onClick={() => navigate({ tab: "projects" })}>Kholein →</button>
          </div>
        ))}
      </section>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>👥 Team workload</h2>
        <div className="small">Nayi assignment dete waqt yahan dekh lein kis ke paas kitna kaam hai (Assignments mein type karne par AI suggest bhi karta hai — "Doosre pages par AI" on karein).</div>
        <div className="tablewrap" style={{ marginTop: 8 }}>
          <table>
            <thead><tr><th>Member</th><th>Role</th><th className="num">Open kaam</th><th className="num">Late</th></tr></thead>
            <tbody>{load.map(({ t, open, late }: any) => <tr key={t.id}><td><b>{t.name}</b></td><td>{t.role || "—"}</td><td className="num">{open}</td><td className={`num ${late ? "neg" : ""}`}>{late}</td></tr>)}
              {load.length === 0 && <tr><td colSpan={4} className="small">Team member nahi.</td></tr>}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}

const ALL_MODULES: ModuleKey[] = ["dashboard", "leads", "whatsapp", "clients", "projects", "assignments", "invoices", "finance", "team"];

type Sec = "suggestions" | "targets" | "schedule" | "profit" | "leads" | "work" | "modules" | "reports";

/**
 * The one place for AI: suggestions, targets, schedule plan, profit & growth,
 * lead analysis, work planning, module-wise analysis and reports. Other pages
 * stay clean (switch below to also show AI there).
 */
export default function AiHubTab() {
  const { can, hasFullAccess } = useAuth();
  const { data } = useData();
  const inline = useInlineAI();
  const month = monthKey();
  const money = hasFullAccess || can("finance.view");
  const sections: { id: Sec; label: string; show: boolean }[] = [
    { id: "suggestions", label: "✨ Suggestions", show: true },
    { id: "targets", label: "🏁 Targets", show: money },
    { id: "schedule", label: "📅 Schedule plan", show: can("schedule.view") || can("schedule.manage") },
    { id: "profit", label: "💰 Profit & Growth", show: money },
    { id: "leads", label: "🎯 Leads", show: can("leads.view") },
    { id: "work", label: "📁 Work & Team", show: can("projects.view") || can("assignments.manage") || can("team.view") },
    { id: "modules", label: "🧩 Module analysis", show: hasFullAccess || can("reports.view") },
    { id: "reports", label: "📊 Reports", show: hasFullAccess || can("reports.view") },
  ];
  const visible = sections.filter((s) => s.show);
  const [sec, setSec] = useState<Sec>(visible[0]?.id || "suggestions");
  const active = visible.find((s) => s.id === sec) ? sec : visible[0]?.id;

  const target = useMemo(() => (money ? targetProgress(data, month) : null), [data, month, money]);
  const mr = useMemo(() => (money ? marginReport(data, monthStart(month), monthEnd(month)) : null), [data, month, money]);

  return (
    <>
      <section className="card aiHubHead">
        <div className="sectionHead">
          <div>
            <h2 style={{ margin: 0 }}><Sparkles size={20} style={{ verticalAlign: "-3px" }} /> AI Analysis</h2>
            <div className="small">Planning ke waqt yahan aayein: reports, suggestions, schedule, targets aur growth — sab ek jagah. Baaqi pages saaf rehte hain.</div>
          </div>
          <label className="permItem" style={{ margin: 0 }}>
            <input type="checkbox" checked={inline} onChange={(e) => setInlineAI(e.target.checked)} />
            <span className="small">Doosre pages par bhi AI dikhayein</span>
          </label>
        </div>
        {money && (
          <div className="moneyStrip" style={{ marginTop: 8 }}>
            <div><span>Monthly target</span><b>{target ? rs(target.target) : "set nahi"}</b><em>{target ? `${target.pct}% • ${target.onPace ? "raftaar theek" : "raftaar kam"}` : "Targets mein set karein"}</em></div>
            <div><span>Roz ka target</span><b>{target ? rs(target.requiredDaily) : "—"}</b><em>{target ? `${target.daysLeft} din baqi` : ""}</em></div>
            <div><span>Sales margin</span><b className={mr && mr.grossProfit < 0 ? "neg" : "pos"}>{mr ? `${mr.grossMargin}%` : "—"}</b><em>{mr ? `profit ${rs(mr.grossProfit)}${mr.missingCost ? " • cost baaqi" : ""}` : ""}</em></div>
          </div>
        )}
        <div className="segmented aiHubTabs" style={{ marginTop: 10 }}>
          {visible.map((s) => <button key={s.id} className={active === s.id ? "on" : ""} onClick={() => setSec(s.id)}>{s.label}</button>)}
        </div>
      </section>

      {active === "suggestions" && <AiSuggestions />}
      {active === "targets" && <TargetPlanner />}
      {active === "schedule" && <SchedulePlanner />}
      {active === "profit" && (<><GrowthAnalysis /><MarginReport /></>)}
      {active === "leads" && <LeadAiPanel />}
      {active === "work" && <WorkAiPanel />}
      {active === "modules" && ALL_MODULES.map((m) => <ModuleInsights key={m} module={m} force limit={6} />)}
      {active === "reports" && (<><MarginReport /><BusinessReport /></>)}
    </>
  );
}
