import React, { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { uid, todayISO, fmtMoney, dtLocalNowValue, normalizeDT, parseDT, fmtDTShort, durationText, isLateProject } from "@/lib/db";
import ModuleInsights from "@/components/ModuleInsights";
import { printElementHTML } from "@/lib/exportUtils";
import { activeOnly } from "@/lib/closing";
import { projectMetrics } from "@/lib/projectInsights";

export default function ProjectsTab() {
  const { data, addItem, removeItem, updateItem } = useData();
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Ads Run");
  const [budget, setBudget] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [view, setView] = useState<"list"|"calendar"|"timeline">("list");
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());

  const categories = ["Ads Run","Local Business Ads","Monthly Management","Design Service","Video Editing","Other"];

  const handleAdd = async () => {
    if (!clientId || !title.trim()) { alert("Select client & title"); return; }
    const startVal = normalizeDT(start || dtLocalNowValue(), "09:00");
    const endVal = normalizeDT(end || "", "18:00");
    await addItem("projects", {
      id: uid("P"), clientId, title: title.trim(), category, budget: +budget || 0,
      start: startVal, end: endVal, status: "Running",
    });
    setTitle(""); setBudget(""); setEnd("");
  };

  const toggleStatus = async (p: any) => {
    const order = ["Running", "Done", "Complete"];
    const i = order.indexOf(p.status || "Running");
    const next = order[(i + 1) % order.length];
    if (next === "Complete" && !p.end) {
      const v = prompt("Enter End Date & Time (YYYY-MM-DDTHH:MM)", dtLocalNowValue());
      if (v === null) return;
      await updateItem("projects", { ...p, end: normalizeDT(v, "18:00"), status: next });
      return;
    }
    await updateItem("projects", { ...p, status: next });
  };

  const projectStatusClass = (p: any) => {
    if (isLateProject(p)) return "late";
    if (p.status === "Complete") return "comp";
    if (p.status === "Done") return "done";
    return "run";
  };

  const activeOnDate = (p: any, dayDate: Date) => {
    const s = parseDT(p.start);
    if (!s) return false;
    const e = parseDT(p.end) || new Date();
    const dayStart = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 0, 0, 0, 0);
    const dayEnd = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 23, 59, 59, 999);
    return s <= dayEnd && e >= dayStart;
  };

  const active = React.useMemo(() => activeOnly(data.projects), [data.projects]);
  const metrics = React.useMemo(() => {
    const m = new Map<string, ReturnType<typeof projectMetrics>>();
    for (const p of active) m.set(p.id, projectMetrics(p, data));
    return m;
  }, [active, data]);
  const totals = Array.from(metrics.values()).reduce((t, x) => ({ budget: t.budget + x.budget, paid: t.paid + x.paid, due: t.due + x.due, cost: t.cost + x.cost }), { budget: 0, paid: 0, due: 0, cost: 0 });

  const printProjects = () => {
    const rows = activeOnly(data.projects).map(p => {
      const c = data.clients.find(x => x.id === p.clientId);
      const m = projectMetrics(p, data);
      return `<tr><td>${c?.name || ""}</td><td>${p.title || ""}</td><td>${p.category || ""}</td><td>${p.status || ""}</td><td>Rs ${fmtMoney(m.budget)}</td><td>Rs ${fmtMoney(m.paid)}</td><td>Rs ${fmtMoney(m.cost)}</td><td>Rs ${fmtMoney(m.profit)}</td><td>${m.paymentStatus}</td></tr>`;
    }).join("");
    printElementHTML(`    <table><thead><tr><th>Client</th><th>Title</th><th>Category</th><th>Status</th><th>Budget</th><th>Received</th><th>Cost</th><th>Profit</th><th>Payment</th></tr></thead><tbody>${rows || "<tr><td colspan='9'>No projects</td></tr>"}</tbody></table>`, "Projects Report");
  };

  const renderCalendar = () => {
    const first = new Date(calYear, calMonth, 1);
    const last = new Date(calYear, calMonth + 1, 0);
    const calTitle = first.toLocaleString(undefined, { month: "long", year: "numeric" });
    const weekDays = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) {
      cells.push(<div key={`blank-${i}`} className="dayCell" style={{ opacity: 0.35 }}><div className="dayNum"> </div></div>);
    }
    for (let day = 1; day <= last.getDate(); day++) {
      const dateObj = new Date(calYear, calMonth, day);
      const todays = activeOnly(data.projects).filter(p => activeOnDate(p, dateObj));
      cells.push(
        <div key={day} className="dayCell">
          <div className="dayNum">{day}</div>
          <div className="dayBadges">
            {todays.slice(0, 4).map(p => {
              const c = data.clients.find(x => x.id === p.clientId);
              return <div key={p.id} className={`prjPill ${projectStatusClass(p)}`} title={`${c?.name || ""} • ${p.title}`}>{c?.name || ""}: {p.title}</div>;
            })}
            {todays.length > 4 && <div className="small">+{todays.length - 4} more</div>}
          </div>
        </div>
      );
    }
    return (
      <div className="subcard" style={{ marginTop: 12 }}>
        <div className="calHdr">
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btnSmall" onClick={() => { let m = calMonth - 1; let y = calYear; if (m < 0) { m = 11; y--; } setCalMonth(m); setCalYear(y); }}>◀</button>
            <b>{calTitle}</b>
            <button className="btnSmall" onClick={() => { let m = calMonth + 1; let y = calYear; if (m > 11) { m = 0; y++; } setCalMonth(m); setCalYear(y); }}>▶</button>
          </div>
          <div className="small">Projects visible on their active dates (start → end). Late ones are marked.</div>
        </div>
        <div className="calGrid">
          {weekDays.map(w => <div key={w} className="dayCell" style={{ minHeight: 40 }}><div className="dayNum">{w}</div></div>)}
          {cells}
        </div>
      </div>
    );
  };

  const renderTimeline = () => {
    const sorted = [...activeOnly(data.projects)].sort((a, b) => {
      const sa = parseDT(a.start) || new Date(0);
      const sb = parseDT(b.start) || new Date(0);
      return sa.getTime() - sb.getTime();
    });
    if (!sorted.length) return <div className="subcard" style={{ marginTop: 12 }}><div className="small">No projects yet.</div></div>;
    return (
      <div className="subcard" style={{ marginTop: 12 }}>
        <div className="small">Sorted by start date. Late projects highlighted.</div>
        <div className="timeline">
          {sorted.map(p => {
            const c = data.clients.find(x => x.id === p.clientId);
            const late = isLateProject(p);
            const dotCls = late ? "late" : (p.status === "Complete" ? "comp" : (p.status === "Done" ? "done" : ""));
            const dur = durationText(p.start, p.end);
            const endTxt = p.end ? fmtDTShort(p.end) : "—";
            return (
              <div key={p.id} className="tlItem">
                <div className={`tlDot ${dotCls}`}></div>
                <div className="tlCard">
                  <div className="tlTop">
                    <div><b>{c?.name || ""}</b> — <span style={{ fontWeight: 900 }}>{p.title}</span></div>
                    <div>
                      <span className={`badge ${p.status === "Complete" ? "ok" : "warn"}`}>{p.status || "Running"}</span>
                      {late && <span className="badge badgeLate" style={{ marginLeft: 6 }}>LATE</span>}
                    </div>
                  </div>
                  <div className="small">Start: {fmtDTShort(p.start)} • End: {endTxt} • Duration: {dur || "—"} • Budget: {fmtMoney(p.budget)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
      <ModuleInsights module="projects" />
    <section className="card">
      <h2>Projects</h2>
      <div className="grid2">
        <div><label>Client</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Select...</option>
            {data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div><label>Project Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Monthly Management / Ads / etc" /></div>
      </div>
      <div className="grid2">
        <div><label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div><label>Budget / Price</label><input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. 15000" /></div>
      </div>
      <div className="grid2">
        <div><label>Start Date & Time</label><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div><label>End Date & Time</label><input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btnSolid" onClick={handleAdd}>Add Project</button>
        <button className="btnSmall" onClick={printProjects}>Export Projects</button>
      </div>
      <hr />
      <div className="moneyStrip">
        <div><span>Active projects</span><b>{active.length}</b></div>
        <div><span>Total budget</span><b>Rs {fmtMoney(totals.budget)}</b></div>
        <div><span>Received</span><b>Rs {fmtMoney(totals.paid)}</b><em>due Rs {fmtMoney(totals.due)}</em></div>
        <div><span>Cost</span><b>Rs {fmtMoney(totals.cost)}</b></div>
        <div><span>Profit so far</span><b className={totals.paid - totals.cost < 0 ? "neg" : "pos"}>Rs {fmtMoney(totals.paid - totals.cost)}</b></div>
      </div>
      <div className="small" style={{ margin: "6px 0" }}>Cost = is project se linked expenses (Accounting) + assignments ke rates. Received = is project ki invoices ki payments.</div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Client</th><th>Title</th><th>Dates</th><th>Money</th><th>Progress / Next action</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {active.map((p) => {
              const client = data.clients.find(c => c.id === p.clientId);
              const late = isLateProject(p);
              const dur = durationText(p.start, p.end);
              const m = metrics.get(p.id) || projectMetrics(p, data);
              return (
                <tr key={p.id} className={late ? "lateRow" : ""}>
                  <td>{client?.name || ""}</td>
                  <td><b>{p.title}</b><div className="small">{p.category}{m.team.length ? ` • Team: ${m.team.join(", ")}` : ""}</div></td>
                  <td className="small">{fmtDTShort(p.start)} → {p.end ? fmtDTShort(p.end) : "—"}<div>{dur || ""}{m.daysLeft !== null && p.status !== "Complete" ? ` • ${m.daysLeft >= 0 ? `${m.daysLeft} din baqi` : `${-m.daysLeft} din late`}` : ""}</div></td>
                  <td className="small prjMoney">
                    <div>Budget <b>Rs {fmtMoney(m.budget)}</b></div>
                    <div>Received Rs {fmtMoney(m.paid)}{m.due > 0 ? ` • due Rs ${fmtMoney(m.due)}` : ""}</div>
                    <div>Cost Rs {fmtMoney(m.cost)} • Profit <b className={m.profit < 0 ? "neg" : "pos"}>Rs {fmtMoney(m.profit)}</b></div>
                    <span className={`badge ${m.paymentStatus === "Paid" ? "ok" : m.paymentStatus === "No invoice" ? "" : "warn"}`}>{m.paymentStatus}</span>
                  </td>
                  <td className="small" style={{ minWidth: 200 }}>
                    <div className="tpBar prjBar"><div className={m.progress >= 100 ? "ok" : ""} style={{ width: `${m.progress}%` }} /></div>
                    <div>{m.progress}% • tasks {m.tasksDone}/{m.tasks}</div>
                    <div className={`prjNext ${m.urgency}`}>🤖 {m.nextAction}</div>
                  </td>
                  <td>
                    <span className={`badge ${p.status === "Complete" ? "ok" : "warn"}`}>{p.status || "Running"}</span>
                    {late && <span className="badge badgeLate" style={{ marginLeft: 6 }}>LATE</span>}
                  </td>
                  <td className="rowActions">
                    <button className="btnSmall" onClick={() => toggleStatus(p)}>Toggle</button>
                    <button className="btnSmall" onClick={() => { if (confirm("Delete?")) removeItem("projects", p.id); }}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="viewToggle">
        <button className="btnSmall" onClick={() => setView("list")}>List View</button>
        <button className="btnSmall" onClick={() => setView("calendar")}>Calendar View</button>
        <button className="btnSmall" onClick={() => setView("timeline")}>Timeline View</button>
      </div>

      {view === "list" && <div className="subcard" style={{ marginTop: 12, display: "none" }}><b>Tip:</b> List view is above. Use Calendar/Timeline for planning.</div>}
      {view === "calendar" && renderCalendar()}
      {view === "timeline" && renderTimeline()}
    </section>
    </>
  );
}
