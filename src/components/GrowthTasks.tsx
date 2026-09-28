import React, { useState } from "react";
import { Target } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { todayISO } from "@/lib/db";
import { analyzeModule, ModuleKey } from "@/lib/moduleInsights";
import { MODULE_LABEL, isSnoozed, statusOf, useGrowthTasks } from "@/lib/growthTasks";

const MODULES: ModuleKey[] = ["leads", "whatsapp", "invoices", "clients", "projects", "assignments", "team", "finance"];

/** Owner's growth to-do list, built from the AI analysis of every module. */
export default function GrowthTasks() {
  const { can, hasFullAccess } = useAuth();
  const { data } = useData();
  const g = useGrowthTasks();
  const [showDone, setShowDone] = useState(false);
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", due: "" });
  if (!(hasFullAccess || can("settings.manage"))) return null;

  const today = todayISO();
  const open = g.tasks.filter((t) => statusOf(t) === "open" && !isSnoozed(t, today)).sort((a, b) => a.due.localeCompare(b.due));
  const snoozed = g.tasks.filter((t) => statusOf(t) === "open" && isSnoozed(t, today));
  const done = g.tasks.filter((t) => statusOf(t) === "done");
  const dismissed = g.tasks.filter((t) => statusOf(t) === "dismissed").length;
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
              <button className="gtCheck" onClick={() => g.complete(t.id)} aria-label="Complete" title="Complete ✓">✓</button>
              {editing === t.id ? (
                <div className="gtEdit">
                  <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Task" />
                  <input type="date" value={draft.due} onChange={(e) => setDraft({ ...draft, due: e.target.value })} aria-label="Due date" />
                  <button className="btnSmall" onClick={() => { g.edit(t.id, { title: draft.title.trim() || t.title, due: draft.due || t.due }); setEditing(null); }}>Save</button>
                  <button className="btnSmall" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              ) : (
                <div>
                  <b>{t.title}</b>
                  <div className="small">{MODULE_LABEL[t.module] || t.module} • {t.detail}{t.edited ? " • edited" : ""}</div>
                </div>
              )}
              <span className={`badge ${t.due < today ? "bad" : t.due === today ? "warn" : ""}`}>{t.due < today ? "Late " : ""}{t.due}</span>
              <div className="gtActions">
                <button className="btnSmall" onClick={() => { setEditing(t.id); setDraft({ title: t.title, due: t.due }); }} title="Edit">✎</button>
                <select className="gtSnooze" value="" onChange={(e) => e.target.value && g.snooze(t.id, Number(e.target.value))} aria-label="Snooze" title="Snooze">
                  <option value="">⏰</option><option value="1">1 din</option><option value="3">3 din</option><option value="7">1 hafta</option>
                </select>
                <button className="btnSmall" onClick={() => g.dismiss(t.id)} aria-label="Dismiss" title="Dismiss — dobara nahi aayega">✕</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {(snoozed.length > 0 || dismissed > 0) && (
        <div className="small" style={{ marginTop: 6 }}>
          {snoozed.length > 0 && <>⏰ {snoozed.length} snoozed ({snoozed.map((t) => t.snoozeUntil).sort()[0]} tak) </>}
          {dismissed > 0 && <>• ✕ {dismissed} dismissed (AI dobara nahi dikhayega)</>}
        </div>
      )}
      {done.length > 0 && (
        <div className="gtDone">
          <button className="linkBtn" onClick={() => setShowDone(!showDone)}>{showDone ? "Mukammal chhupayein" : `Mukammal (${done.length})`}</button>
          {showDone && (
            <>
              <ul className="gtList done">
                {done.slice(-20).reverse().map((t) => (
                  <li key={t.id}>
                    <button className="gtCheck on" onClick={() => g.reopen(t.id)} aria-label="Wapas kholein" title="Wapas kholein">✓</button>
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
