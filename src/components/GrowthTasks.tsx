import React, { useState } from "react";
import { Target } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { todayISO } from "@/lib/db";
import { analyzeModule, ModuleKey } from "@/lib/moduleInsights";
import { MODULE_LABEL, useGrowthTasks } from "@/lib/growthTasks";

const MODULES: ModuleKey[] = ["leads", "whatsapp", "invoices", "clients", "projects", "assignments", "team", "finance"];

/** Owner's growth to-do list, built from the AI analysis of every module. */
export default function GrowthTasks() {
  const { can, hasFullAccess } = useAuth();
  const { data } = useData();
  const g = useGrowthTasks();
  const [showDone, setShowDone] = useState(false);
  const [msg, setMsg] = useState("");
  if (!(hasFullAccess || can("settings.manage"))) return null;

  const today = todayISO();
  const open = g.tasks.filter((t) => !t.done).sort((a, b) => a.due.localeCompare(b.due));
  const done = g.tasks.filter((t) => t.done);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const doneWeek = done.filter((t) => (t.doneAt || "") >= weekAgo).length;
  const progress = open.length + doneWeek ? Math.round((doneWeek / (open.length + doneWeek)) * 100) : 0;

  const plan = async () => {
    try {
      const entries = MODULES.flatMap((module) =>
        analyzeModule(module, data).insights
          .filter((i) => i.action && (i.severity === "risk" || i.severity === "warn"))
          .slice(0, 2)
          .map((insight) => ({ module, insight })));
      const n = await g.add(entries);
      setMsg(n ? `✓ ${n} naye tasks bane` : "Koi naya urgent kaam nahi mila — sab tasks pehle se list mein hain");
    } catch (e) { setMsg("Save nahi hua: " + (e as Error).message); }
  };

  return (
    <section className="card growthTasks">
      <div className="gtHead">
        <div>
          <h3><Target size={18} /> Growth Tasks</h3>
          <div className="small">AI analysis se aap ke liye kaam — har module ka urgent kaam pehle.</div>
        </div>
        <button className="btnSolid" onClick={plan}>✨ AI se is hafte ka plan banayein</button>
      </div>
      <div className="gtProgress" title={`Is hafte ${doneWeek} mukammal`}>
        <div style={{ width: `${progress}%` }} />
      </div>
      <div className="small">{open.length} baqi • is hafte {doneWeek} mukammal ({progress}%){msg ? ` • ${msg}` : ""}</div>
      {open.length === 0 ? (
        <div className="small gtEmpty">Koi task nahi. Upar wala button dabayein ya kisi module ke "AI Growth Analysis" se ＋ Task karein.</div>
      ) : (
        <ul className="gtList">
          {open.map((t) => (
            <li key={t.id} className={`sev-${t.severity}${t.due < today ? " late" : ""}`}>
              <input type="checkbox" checked={false} onChange={() => g.toggle(t.id)} aria-label="Mukammal" />
              <div>
                <b>{t.title}</b>
                <div className="small">{MODULE_LABEL[t.module]} • {t.detail}</div>
              </div>
              <span className={`badge ${t.due < today ? "bad" : t.due === today ? "warn" : ""}`}>{t.due < today ? "Late " : ""}{t.due}</span>
              <button className="btnSmall" onClick={() => g.remove(t.id)} aria-label="Delete task">✕</button>
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <div className="gtDone">
          <button className="linkBtn" onClick={() => setShowDone(!showDone)}>{showDone ? "Mukammal chhupayein" : `Mukammal (${done.length})`}</button>
          {showDone && (
            <>
              <ul className="gtList done">
                {done.slice(-20).reverse().map((t) => (
                  <li key={t.id}>
                    <input type="checkbox" checked onChange={() => g.toggle(t.id)} aria-label="Wapas kholein" />
                    <div><s>{t.title}</s></div>
                  </li>
                ))}
              </ul>
              <button className="btnSmall" onClick={() => g.clearDone()}>Mukammal saaf karein</button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
