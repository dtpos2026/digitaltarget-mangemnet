import React, { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { uid, todayISO, fmtMoney } from "@/lib/db";
import { writeSafeDocument } from "@/lib/safeHtml";
import { activeOnly } from "@/lib/closing";

export default function ScheduleTab() {
  const { data, addItem, removeItem, updateItem } = useData();
  const [date, setDate] = useState(todayISO());
  const [category, setCategory] = useState("Meeting");
  const [status, setStatus] = useState("Pending");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [task, setTask] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [payFollow, setPayFollow] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  const categories = ["Meeting", "Payment Collection", "Project Follow-up", "Call / Reminder", "Delivery / Visit", "Personal Task", "Other"];

  const handleAdd = async () => {
    if (!task.trim()) { alert("Task required"); return; }
    await addItem("schedule", {
      id: uid("S"), date, category, clientId, projectId, task: task.trim(),
      status, priority, payFollow: payFollow.trim(), assignedTo: assignedTo.trim(),
      time, location: location.trim(), notes: notes.trim(),
    });
    setTask(""); setPayFollow(""); setAssignedTo(""); setTime(""); setLocation(""); setNotes("");
    setPriority("Medium"); setStatus("Pending"); setCategory("Meeting");
  };

  const toggleStatus = async (s: any) => {
    const order = ["Pending", "In Progress", "Done", "Cancel"];
    const i = order.indexOf(s.status);
    const next = order[(i + 1) % order.length];
    await updateItem("schedule", { ...s, status: next });
  };

  const getStatusBadge = (st: string) => {
    if (st === "Done") return "ok";
    if (st === "Cancel") return "bad";
    if (st === "In Progress") return "pri";
    return "warn";
  };

  const filteredProjects = clientId ? data.projects.filter(p => p.clientId === clientId) : data.projects;

  const buildBrandedSheet = (mode: "today" | "all" | "range", fromDate?: string, toDate?: string) => {
    const logo = data.settings?.logo?.data || "";
    let rows = activeOnly(data.schedule).slice();
    let title = "";
    if (mode === "today") {
      rows = rows.filter(s => s.date === date);
      title = `Daily Schedule — ${date}`;
    } else if (mode === "all") {
      title = `Complete Schedule History (${rows.length} entries)`;
    } else if (mode === "range" && fromDate && toDate) {
      rows = rows.filter(s => s.date >= fromDate && s.date <= toDate);
      title = `Schedule ${fromDate} → ${toDate}`;
    }
    rows.sort((a: any, b: any) => {
      const d = String(a.date || "").localeCompare(String(b.date || ""));
      if (d !== 0) return d;
      return String(a.time || "").localeCompare(String(b.time || ""));
    });

    const html = rows.map(s => {
      const c = data.clients.find(x => x.id === s.clientId);
      const p = data.projects.find(x => x.id === s.projectId);
      return `<tr>
        <td>${s.date || ""}</td>
        <td>${s.time || "-"}</td>
        <td>${s.category || "Other"}</td>
        <td>${c?.name || ""}</td>
        <td>${p?.title || ""}</td>
        <td>${s.task || ""}</td>
        <td>${s.payFollow || ""}</td>
        <td>${s.assignedTo || ""}</td>
        <td>${s.priority || "Medium"}</td>
        <td>${s.status || ""}</td>
      </tr>`;
    }).join("");

    return `<html><head><title>Schedule Report</title><style>
      body{font-family:system-ui,sans-serif;padding:14px;color:#111}
      .brand{display:flex;gap:14px;align-items:center;border-bottom:3px solid #111;padding-bottom:10px;margin-bottom:14px}
      .brand img{max-height:64px;max-width:140px;object-fit:contain}
      .brand h1{margin:0;font-size:24px;font-weight:900;letter-spacing:1px}
      table{width:100%;border-collapse:collapse;margin-top:6px}
      th,td{border-bottom:1px solid #ccc;padding:7px;text-align:left;font-size:12px}
      th{font-size:10px;text-transform:uppercase;background:#f4f4f4;font-weight:900}
      .footer{margin-top:14px;font-size:11px;color:#666;text-align:center;border-top:1px solid #ccc;padding-top:8px}
      @media print{body{margin:0;padding:8px}}
    </style></head><body>
      <div class="brand">
        ${logo ? `<img src="${logo}" alt="logo" />` : `<div style="width:64px;height:64px;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:20px;border-radius:10px">DT</div>`}
        <div>
          <h1>${data.settings?.exportName || "DIGITAL TARGET"}</h1>
          <div style="font-weight:900;margin-top:2px">📅 ${title}</div>
          <div style="font-size:11px;color:#666">Generated: ${new Date().toLocaleString()}</div>
        </div>
      </div>
      <table>
        <thead><tr><th>Date</th><th>Time</th><th>Category</th><th>Client</th><th>Project</th><th>Task</th><th>Payment</th><th>Assigned</th><th>Priority</th><th>Status</th></tr></thead>
        <tbody>${html || "<tr><td colspan='10'>No tasks</td></tr>"}</tbody>
      </table>
      <div class="footer">${data.settings?.footer || "Digital Target — Business Management"}</div>
    </body></html>`;
  };

  const printDailySchedule = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    writeSafeDocument(w, buildBrandedSheet("today"));
    setTimeout(() => w.print(), 300);
  };

  const printAllHistory = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    writeSafeDocument(w, buildBrandedSheet("all"));
    setTimeout(() => w.print(), 300);
  };

  const printRange = () => {
    const from = prompt("From date (YYYY-MM-DD)?", todayISO());
    if (!from) return;
    const to = prompt("To date (YYYY-MM-DD)?", todayISO());
    if (!to) return;
    const w = window.open("", "_blank");
    if (!w) return;
    writeSafeDocument(w, buildBrandedSheet("range", from, to));
    setTimeout(() => w.print(), 300);
  };

  const exportThermal = (mm: string, fmt: string) => {
    const rows = activeOnly(data.schedule).filter(s => s.date === date).sort((a: any, b: any) => String(a.time || "").localeCompare(String(b.time || "")));
    const width = mm === "80" ? "78mm" : "56mm";
    const logo = data.settings?.logo?.data || "";
    const body = rows.map((s, idx) => {
      const c = data.clients.find(x => x.id === s.clientId);
      const p = data.projects.find(x => x.id === s.projectId);
      return `<div style="padding:6px 0;border-bottom:1px dashed #999;font-size:${mm === "80" ? "11px" : "10px"};line-height:1.35">
        <div style="font-weight:800">${idx + 1}. ${s.category || "Task"} ${s.time ? `- ${s.time}` : ""}</div>
        <div><b>Task:</b> ${s.task || ""}</div>
        ${c?.name ? `<div><b>Client:</b> ${c.name}</div>` : ""}
        ${p?.title ? `<div><b>Project:</b> ${p.title}</div>` : ""}
        ${s.payFollow ? `<div><b>Payment:</b> ${s.payFollow}</div>` : ""}
        ${s.assignedTo ? `<div><b>Assigned:</b> ${s.assignedTo}</div>` : ""}
        ${s.location ? `<div><b>Location:</b> ${s.location}</div>` : ""}
        <div><b>Priority:</b> ${s.priority || "Medium"} | <b>Status:</b> ${s.status || "Pending"}</div>
        ${s.notes ? `<div><b>Notes:</b> ${s.notes}</div>` : ""}
      </div>`;
    }).join("") || `<div style="padding:10px 0;font-size:11px">No schedule items for this date.</div>`;

    const w = window.open("", "_blank");
    if (!w) return;
    writeSafeDocument(w, `<html><head><title>Schedule ${mm}mm</title></head><body style="margin:0;padding:0">
      <div style="width:${width};background:#fff;color:#000;padding:8px 6px;font-family:Arial,sans-serif">
        ${logo ? `<div style="text-align:center;margin-bottom:4px"><img src="${logo}" style="max-height:40px;max-width:60mm;object-fit:contain" /></div>` : ""}
        <div style="text-align:center;font-weight:900;font-size:${mm === "80" ? "16px" : "14px"}">${data.settings?.exportName || "DIGITAL TARGET"}</div>
        <div style="text-align:center;font-size:${mm === "80" ? "11px" : "10px"};font-weight:700">${mm}mm Thermal Schedule</div>
        <div style="text-align:center;font-size:${mm === "80" ? "11px" : "10px"}">Date: ${date}</div>
        <div style="border-top:1px dashed #999;margin:6px 0"></div>
        ${body}
        <div style="padding-top:8px;text-align:center;font-size:${mm === "80" ? "10px" : "9px"}">Generated: ${new Date().toLocaleString()}</div>
        <div style="text-align:center;font-size:${mm === "80" ? "9px" : "8px"};color:#666;margin-top:2px">${data.settings?.footer || ""}</div>
      </div>
    </body></html>`);
    setTimeout(() => w.print(), 300);
  };

  return (
    <section className="card">
      <h2>Schedule / Daily Work</h2>
      <div className="small">Meeting, payment collection, project follow-up, calls, reminders aur daily field work ko alag categories mein manage karein. Thermal printer ke liye 58mm aur 80mm PNG/JPG export bhi available hai.</div>

      <div className="grid3" style={{ marginTop: 12 }}>
        <div><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div><label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option>Pending</option><option>In Progress</option><option>Done</option><option>Cancel</option>
          </select>
        </div>
      </div>
      <div className="grid3">
        <div><label>Client</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Select...</option>
            {data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div><label>Project (optional)</label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">(Optional)</option>
            {filteredProjects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
        <div><label>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option>High</option><option>Medium</option><option>Low</option>
          </select>
        </div>
      </div>
      <div className="grid2">
        <div><label>Title / Main Task</label><input value={task} onChange={(e) => setTask(e.target.value)} placeholder="e.g. Meezan payment collect, Dr Bilal meeting, reel follow-up" /></div>
        <div><label>Assigned To (optional)</label><input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="team member / self" /></div>
      </div>
      <div className="grid3">
        <div><label>Payment Note (optional)</label><input value={payFollow} onChange={(e) => setPayFollow(e.target.value)} placeholder="e.g. collect 20,000 from client" /></div>
        <div><label>Time (optional)</label><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
        <div><label>Location / Source (optional)</label><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="office / whatsapp / client office" /></div>
      </div>
      <div>
        <label>Notes / Follow-up detail</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="meeting reason, payment details, follow-up message, next action"></textarea>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <button className="btnSolid" onClick={handleAdd}>Save Schedule Item</button>
        <button className="btnSmall" onClick={printDailySchedule}>📄 Daily Sheet (Branded)</button>
        <button className="btnSmall" onClick={printAllHistory}>📚 Full History</button>
        <button className="btnSmall" onClick={printRange}>📅 Date Range</button>
        <button className="btnSmall" onClick={() => exportThermal("58", "png")}>58mm</button>
        <button className="btnSmall" onClick={() => exportThermal("80", "png")}>80mm</button>
      </div>

      <hr />
      <div className="tablewrap">
        <table>
          <thead><tr><th>Date</th><th>Category</th><th>Client / Project</th><th>Task</th><th>Priority</th><th>Status</th><th>Payment</th><th>Assigned</th><th>Action</th></tr></thead>
          <tbody>
            {activeOnly(data.schedule).slice().reverse().map((s) => {
              const c = data.clients.find(x => x.id === s.clientId);
              const p = data.projects.find(x => x.id === s.projectId);
              return (
                <tr key={s.id}>
                  <td>{s.date || ""}<div className="small">{s.time || ""}</div></td>
                  <td>{s.category || "Other"}</td>
                  <td>{c?.name || ""}<div className="small">{p?.title || s.location || ""}</div></td>
                  <td>{s.task || ""}<div className="small">{s.notes || ""}</div></td>
                  <td><span className={`badge ${s.priority === "High" ? "bad" : (s.priority === "Low" ? "ok" : "warn")}`}>{s.priority || "Medium"}</span></td>
                  <td><span className={`badge ${getStatusBadge(s.status)}`}>{s.status}</span></td>
                  <td>{s.payFollow || ""}</td>
                  <td>{s.assignedTo || "—"}</td>
                  <td className="rowActions">
                    <button className="btnSmall" onClick={() => toggleStatus(s)}>Status</button>
                    <button className="btnSmall" onClick={() => { if (confirm("Delete?")) removeItem("schedule", s.id); }}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
