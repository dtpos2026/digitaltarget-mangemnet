import React, { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { fmtMoney, todayISO, uid } from "@/lib/db";
import { activeOnly } from "@/lib/closing";
import { invoiceView, renewalState } from "@/lib/invoice";
import { parseScheduleText, ScheduleSuggestion, ScheduleType } from "@/lib/scheduleAI";
import { useGrowthTasks } from "@/lib/growthTasks";

const TYPE_TO_CATEGORY: Record<ScheduleType, string> = {
  "Follow-up": "Follow-up", Meeting: "Meeting", Call: "Call / Reminder", "Payment Reminder": "Payment Collection",
  Renewal: "Renewal", "Project Deadline": "Project Deadline", "Pending Work": "Pending Work", "Client Response": "Client Response",
};

/**
 * AI schedule planner: type what you want to plan in plain words, or accept
 * what the AI found in your data (follow-ups due, renewals, overdue payments).
 * Accept / Edit / Dismiss; accepted items appear in the Schedule tab.
 */
export default function SchedulePlanner() {
  const { data, addItem } = useData();
  const { can, user } = useAuth();
  const g = useGrowthTasks();
  const canManage = can("schedule.manage");
  const [text, setText] = useState("");
  const [sugg, setSugg] = useState<ScheduleSuggestion | null>(null);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState("");

  const save = async (sg: ScheduleSuggestion, extra: Record<string, unknown> = {}) => {
    await addItem("schedule", {
      id: uid("S"), date: sg.date, time: sg.time, category: TYPE_TO_CATEGORY[sg.type], clientId: sg.clientId, leadId: sg.leadId,
      projectId: "", task: sg.task, status: "Pending", priority: sg.priority, notes: sg.notes, reminderAt: sg.reminder,
      payFollow: "", assignedTo: "", location: "", source: "ai", createdAt: new Date().toISOString(), createdBy: user?.email || "", ...extra,
    });
    setMsg(`✓ Schedule mein add: ${sg.task} (${sg.date})`);
  };

  const auto = useMemo(() => {
    const today = todayISO();
    const scheduledFor = new Set(activeOnly(data.schedule).map((x: any) => x.leadId || x.invoiceId || "").filter(Boolean));
    const out: { key: string; title: string; detail: string; sg: ScheduleSuggestion }[] = [];
    const mk = (over: Partial<ScheduleSuggestion>): ScheduleSuggestion => ({ clientId: "", clientName: "", leadId: "", task: "", date: today, time: "", priority: "Medium", type: "Follow-up", notes: "", reminder: new Date(`${today}T10:00:00`).toISOString(), found: [], ...over });
    for (const l of data.leads) {
      if (!l.followUpDate || l.followUpDate > today || ["Converted", "Lost", "Invalid"].includes(l.status) || l.optOut || scheduledFor.has(l.id)) continue;
      out.push({ key: `sched:lead:${l.id}`, title: `Follow-up: ${l.name}`, detail: `${l.serviceType || "Lead"} • follow-up ${l.followUpDate}`, sg: mk({ leadId: l.id, task: `Follow-up — ${l.name}${l.serviceType ? ` (${l.serviceType})` : ""}`, priority: l.followUpDate < today ? "High" : "Medium", notes: l.ai?.nextAction || "" }) });
    }
    for (const inv of data.invoices) {
      if (scheduledFor.has(inv.id)) continue;
      const v = invoiceView(inv);
      const client = data.clients.find((c: any) => c.id === inv.clientId);
      if (v.status === "Overdue") out.push({ key: `sched:pay:${inv.id}`, title: `Payment: ${client?.name || v.number}`, detail: `Rs ${fmtMoney(v.due)} overdue (${inv.dueDate})`, sg: mk({ clientId: inv.clientId || "", type: "Payment Reminder", priority: "High", task: `Payment Reminder — ${client?.name || ""}: ${v.number} Rs ${fmtMoney(v.due)}` }) });
      const rs = renewalState(inv, Number(data.settings?.renewalReminderDays) || 7);
      if ((rs === "due_soon" || rs === "expired") && !data.invoices.some((x: any) => x.renewalOf === inv.id)) out.push({ key: `sched:renew:${inv.id}`, title: `Renewal: ${client?.name || v.number}`, detail: `${inv.packageName || inv.category || ""} ends ${inv.endDate}`, sg: mk({ clientId: inv.clientId || "", type: "Renewal", priority: "High", task: `Renewal — ${client?.name || ""}: ${inv.packageName || inv.category || v.number}` }) });
    }
    return out.filter((x) => !g.has("dashboard", { id: x.key })).slice(0, 15);
  }, [data.leads, data.invoices, data.clients, data.schedule, data.settings, g]);

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>📅 Schedule plan</h2>
      <div className="small">Jo plan karna hai seedhe likhein — AI date, time, client aur priority nikal kar suggest karta hai. Neeche aap ke data se bane mashware hain.</div>
      {canManage && (
        <div className="aiSched" style={{ marginTop: 8 }}>
          <div className="aiSchedRow">
            <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder='Jaise: "Abdullah Medicare se kal follow-up karna hai, package renewal discuss karna hai"' onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (text.trim()) { setSugg(parseScheduleText(text, { clients: data.clients, leads: data.leads })); setEditing(false); } } }} />
            <button className="btnSolid" onClick={() => { if (text.trim()) { setSugg(parseScheduleText(text, { clients: data.clients, leads: data.leads })); setEditing(false); } }}>Suggest</button>
          </div>
          {sugg && (
            <div className="aiSchedCard">
              {editing ? (
                <div className="grid3">
                  <div><label>Task</label><input value={sugg.task} onChange={(e) => setSugg({ ...sugg, task: e.target.value })} /></div>
                  <div><label>Date</label><input type="date" value={sugg.date} onChange={(e) => setSugg({ ...sugg, date: e.target.value })} /></div>
                  <div><label>Time</label><input type="time" value={sugg.time} onChange={(e) => setSugg({ ...sugg, time: e.target.value })} /></div>
                  <div><label>Priority</label><select value={sugg.priority} onChange={(e) => setSugg({ ...sugg, priority: e.target.value as ScheduleSuggestion["priority"] })}><option>High</option><option>Medium</option><option>Low</option></select></div>
                </div>
              ) : (
                <div className="aiSchedGrid">
                  <div><span>Task</span><b>{sugg.task}</b></div>
                  <div><span>Client / lead</span><b>{sugg.clientName || "—"}</b></div>
                  <div><span>Date</span><b>{sugg.date}{sugg.time ? ` • ${sugg.time}` : ""}</b></div>
                  <div><span>Type</span><b>{sugg.type}</b></div>
                  <div><span>Priority</span><b className={sugg.priority === "High" ? "warnText" : ""}>{sugg.priority}</b></div>
                </div>
              )}
              <div className="small">Pehchana: {sugg.found.join(" • ")}</div>
              <div className="rowActions">
                <button className="btnSolid" onClick={async () => { await save(sugg); setSugg(null); setText(""); }}>✓ Accept</button>
                <button className="btnSmall" onClick={() => setEditing(!editing)}>{editing ? "Done" : "✎ Edit"}</button>
                <button className="btnSmall" onClick={() => setSugg(null)}>✕ Dismiss</button>
              </div>
            </div>
          )}
        </div>
      )}
      {msg && <div className="small" style={{ marginTop: 6 }}>{msg}</div>}
      <h3 className="growthH">AI ke mashware ({auto.length})</h3>
      {auto.length === 0 ? <div className="small">Abhi koi follow-up, renewal ya overdue payment schedule hone ko baaqi nahi. 🎉</div> : auto.map((x) => (
        <div key={x.key} className="aiAutoItem">
          <div><b>{x.title}</b><div className="small">{x.detail}</div></div>
          <span className={`badge ${x.sg.priority === "High" ? "bad" : "warn"}`}>{x.sg.priority}</span>
          {canManage && <button className="btnSmall" onClick={() => save(x.sg, { invoiceId: x.key.startsWith("sched:pay:") || x.key.startsWith("sched:renew:") ? x.key.split(":")[2] : "" })}>✓ Schedule</button>}
          <button className="iconBtn" onClick={() => g.dismissSuggestion("dashboard", { id: x.key, severity: "info", title: x.title, detail: x.detail, action: x.sg.task })} title="Dismiss — dobara nahi dikhega" aria-label="Dismiss">✕</button>
        </div>
      ))}
    </section>
  );
}
