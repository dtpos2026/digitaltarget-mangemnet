import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Info, ShieldAlert, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { analyzeModule, ModuleKey } from "@/lib/moduleInsights";
import { MODULE_LABEL, useGrowthTasks } from "@/lib/growthTasks";
import type { Severity } from "@/lib/insights";

const SEV: Record<Severity, { label: string; Icon: typeof Info }> = {
  risk: { label: "Urgent", Icon: ShieldAlert },
  warn: { label: "Attention", Icon: AlertTriangle },
  info: { label: "Idea", Icon: Info },
  good: { label: "Good", Icon: CheckCircle2 },
};

const openKey = (m: string) => `dt.insights.${m}`;

/**
 * "AI Growth Analysis" card at the top of a module: key numbers, what is
 * growing or stuck, and one-click Growth Tasks from each suggested action.
 */
export default function ModuleInsights({ module, limit = 4 }: { module: ModuleKey; limit?: number }) {
  const { can, hasFullAccess } = useAuth();
  const { data } = useData();
  const tasks = useGrowthTasks();
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(openKey(module)) !== "0"; } catch { return true; } });
  const [all, setAll] = useState(false);
  const [msg, setMsg] = useState("");
  const a = useMemo(() => analyzeModule(module, data), [module, data]);
  if (!(hasFullAccess || can("reports.view"))) return null;
  const canTask = hasFullAccess || can("settings.manage");
  const shown = all ? a.insights : a.insights.slice(0, limit);
  const actionable = a.insights.filter((i) => i.action && !tasks.has(module, i));

  const toggle = () => {
    setOpen(!open);
    try { localStorage.setItem(openKey(module), open ? "0" : "1"); } catch { /* ignore */ }
  };
  const add = async (items = actionable) => {
    try {
      const n = await tasks.add(items.map((insight) => ({ module, insight })));
      setMsg(n ? `✓ ${n} task Dashboard → Growth Tasks mein add` : "Ye tasks pehle se list mein hain");
    } catch (e) { setMsg("Task save nahi hua: " + (e as Error).message); }
  };

  return (
    <section className="modInsights">
      <button className="modInsightsHead" onClick={toggle} aria-expanded={open}>
        <Sparkles size={16} />
        <b>AI Growth Analysis</b>
        <span className="small">{MODULE_LABEL[module]} • {a.insights.length} points</span>
        <ChevronDown size={16} className={open ? "rot" : ""} />
      </button>
      {open && (
        <>
          <div className="modStats">
            {a.stats.map((s) => (
              <div key={s.label} className="modStat">
                <span>{s.label}</span>
                <b>{s.value}</b>
                {s.hint && <em>{s.hint}</em>}
              </div>
            ))}
          </div>
          {a.insights.length === 0 ? (
            <div className="small">Sab theek chal raha hai — abhi koi khaas masla ya mauqa nazar nahi aaya.</div>
          ) : (
            <ul className="modList">
              {shown.map((i) => {
                const { Icon, label } = SEV[i.severity];
                const added = tasks.has(module, i);
                return (
                  <li key={i.id} className={`sev-${i.severity}`}>
                    <Icon size={16} aria-label={label} />
                    <div>
                      <b>{i.title}</b>
                      <div className="small">{i.detail}</div>
                      {i.action && <div className="modAction">→ {i.action}</div>}
                    </div>
                    {i.action && canTask && (
                      <button className="btnSmall" disabled={added} onClick={() => add([i])}>{added ? "✓ Task" : "＋ Task"}</button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="modFoot">
            {a.insights.length > limit && <button className="linkBtn" onClick={() => setAll(!all)}>{all ? "Kam dikhayein" : `Sab ${a.insights.length} dekhein`}</button>}
            {canTask && actionable.length > 0 && <button className="btnSmall" onClick={() => add()}>＋ Sab actions ko tasks banayein ({actionable.length})</button>}
            {msg && <span className="small">{msg}</span>}
          </div>
        </>
      )}
    </section>
  );
}
