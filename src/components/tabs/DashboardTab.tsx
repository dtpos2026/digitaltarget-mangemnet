import React, { useRef, useEffect, useCallback } from "react";
import { useData } from "@/contexts/DataContext";
import { fmtMoney, todayISO, nowText } from "@/lib/db";
import { saveElementAsImage, printElementHTML } from "@/lib/exportUtils";
import { sanitizeHtml } from "@/lib/safeHtml";

function useChart(drawFn: (canvas: HTMLCanvasElement) => void) {
  const ref = useRef<HTMLCanvasElement>(null);
  const draw = useCallback(drawFn, [drawFn]);
  useEffect(() => {
    if (ref.current) draw(ref.current);
  }, [draw]);
  return ref;
}

function drawBarChart(canvas: HTMLCanvasElement, labels: string[], values: number[], color: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width = canvas.parentElement?.clientWidth || 300;
  const h = canvas.height = 150;
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(...values, 1);
  const barW = Math.min(60, (w - 40) / labels.length - 10);
  const startX = (w - (barW + 10) * labels.length) / 2;
  const isDark = document.body.classList.contains("dark");
  const textColor = isDark ? "#e5e7eb" : "#0f172a";
  const mutedColor = isDark ? "#94a3b8" : "#64748b";

  labels.forEach((label, i) => {
    const barH = (values[i] / max) * (h - 40);
    const x = startX + i * (barW + 10);
    const y = h - 20 - barH;
    ctx.fillStyle = i === 0 ? color : (i === 1 ? "#ec4899" : "#f59e0b");
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, 6);
    ctx.fill();
    ctx.fillStyle = mutedColor;
    ctx.font = "800 10px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(label, x + barW / 2, h - 6);
    ctx.fillStyle = textColor;
    ctx.font = "900 11px system-ui";
    ctx.fillText(fmtMoney(values[i]), x + barW / 2, y - 4);
  });
}

function drawDonutChart(canvas: HTMLCanvasElement, parts: { name: string; value: number }[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width = canvas.parentElement?.clientWidth || 300;
  const h = canvas.height = 180;
  ctx.clearRect(0, 0, w, h);
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) * 0.40;
  const inner = r * 0.62;
  const palette = ["#3b82f6", "#22c55e", "#8b5cf6", "#f59e0b", "#ec4899", "#14b8a6"];
  let start = -Math.PI / 2;
  parts.forEach((p, i) => {
    const val = Math.max(0, p.value);
    const ang = (val / total) * (Math.PI * 2);
    const end = start + ang;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = palette[i % palette.length];
    ctx.fill();
    start = end;
  });
  const isDark = document.body.classList.contains("dark");
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fillStyle = isDark ? "#0f172a" : "#fff";
  ctx.fill();
  ctx.fillStyle = isDark ? "#e5e7eb" : "#0f172a";
  ctx.font = "900 12px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("TOTAL BALANCE", cx, cy - 6);
  ctx.font = "900 16px system-ui";
  ctx.fillText("Rs " + fmtMoney(total), cx, cy + 16);
}

function drawRing(canvas: HTMLCanvasElement, value: number, max: number, color: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width = canvas.parentElement?.clientWidth ? canvas.parentElement.clientWidth - 6 : 200;
  const h = canvas.height = 120;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2 + 6;
  const r = Math.min(w, h) * 0.32;
  const thickness = r * 0.28;
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const isDark = document.body.classList.contains("dark");

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = isDark ? "rgba(255,255,255,.10)" : "rgba(15,23,42,.08)";
  ctx.lineWidth = thickness;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.fillStyle = isDark ? "#e5e7eb" : "#0f172a";
  ctx.font = "900 18px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("Rs " + fmtMoney(value || 0), cx, cy + 6);
  ctx.fillStyle = isDark ? "rgba(229,231,235,.70)" : "rgba(15,23,42,.55)";
  ctx.font = "800 11px system-ui";
  ctx.fillText(Math.round(pct * 100) + "%", cx, cy + 26);
}

export default function DashboardTab() {
  const { data } = useData();
  const dashRef = useRef<HTMLDivElement>(null);

  let income = 0, expense = 0;
  data.accounting.forEach((a) => {
    if (a.type === "IN" && a.category === "Invoice Paid") income += a.amount || 0;
    if (a.type === "OUT") expense += a.amount || 0;
  });
  const profit = income - expense;

  let receivable = 0;
  data.invoices.forEach((inv) => {
    if (inv.status !== "Paid") receivable += Math.max(0, (inv.grandTotal || 0) - (inv.paidAmount || 0));
  });

  let payoutsDue = 0;
  data.team.forEach((t) => { payoutsDue += Math.max(0, (t.rate || 0) - (t.paid || 0)); });

  const todayTasks = data.schedule.filter((s) => s.date === todayISO()).length;
  const todaySchedule = data.schedule.filter((s) => s.date === todayISO());
  const pendingInvoices = data.invoices.filter((inv) => inv.status !== "Paid");

  let khLena = 0, khDena = 0;
  data.khata.forEach((k) => {
    const due = Math.max(0, (k.amount || 0) - (k.paid || 0));
    if (k.status !== "SETTLED") {
      if (k.type === "LENA") khLena += due; else khDena += due;
    }
  });

  const paidInv = data.invoices.filter(i => i.status === "Paid").length;
  const runningInv = data.invoices.filter(i => i.status !== "Paid").length;
  const walletParts = data.wallets.map(w => ({ name: w.name, value: +(w.balance || 0) })).filter(p => p.value > 0);
  const walletsSorted = [...data.wallets].map(w => ({ id: w.id, name: w.name, value: +(w.balance || 0) })).sort((a, b) => b.value - a.value);
  const maxBal = Math.max(...walletsSorted.map(x => x.value), 1);
  const palette = ["#8b5cf6", "#22c55e", "#3b82f6"];

  const incExpRef = useChart((c) => drawBarChart(c, ["Income", "Expense"], [income, expense], "#3b82f6"));
  const invRef = useChart((c) => drawBarChart(c, ["Paid", "Running"], [paidInv, runningInv], "#22c55e"));
  const donutRef = useChart((c) => drawDonutChart(c, walletParts.length ? walletParts : [{ name: "No data", value: 1 }]));

  const ringRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  useEffect(() => {
    walletsSorted.slice(0, 6).forEach((w, i) => {
      const c = ringRefs.current[i];
      if (c) drawRing(c, w.value, maxBal, palette[i % 3]);
    });
  }, [walletsSorted, maxBal]);

  const buildDashboardHTML = () => {
    const schedRows = todaySchedule.map(s => {
      const client = data.clients.find(c => c.id === s.clientId);
      return `<tr><td>${client?.name || ""}</td><td>${s.task || ""}</td><td>${s.status || ""}</td></tr>`;
    }).join("");
    const payRows = pendingInvoices.map(inv => {
      const c = data.clients.find(cc => cc.id === inv.clientId);
      const due = Math.max(0, (inv.grandTotal || 0) - (inv.paidAmount || 0));
      return `<tr><td>${inv.id}</td><td>${c?.name || ""}</td><td>Rs ${fmtMoney(due)}</td><td>${inv.status || ""}</td></tr>`;
    }).join("");

    return `<div style="padding:14px">
      <h2 style="margin:0">DIGITAL TARGET</h2>
      <div style="font-weight:900;margin-top:4px">Dashboard Report</div>
      <div style="font-size:12px;color:#64748b">Generated: ${nowText()}</div>
      <hr/>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div style="border:1px solid #e6eaf2;border-radius:12px;padding:10px"><b>Income:</b> Rs ${fmtMoney(income)}</div>
        <div style="border:1px solid #e6eaf2;border-radius:12px;padding:10px"><b>Expense:</b> Rs ${fmtMoney(expense)}</div>
        <div style="border:1px solid #e6eaf2;border-radius:12px;padding:10px"><b>Profit:</b> Rs ${fmtMoney(profit)}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px">
        <div style="border:1px solid #e6eaf2;border-radius:12px;padding:10px"><b>Receivables:</b> Rs ${fmtMoney(receivable)}</div>
        <div style="border:1px solid #e6eaf2;border-radius:12px;padding:10px"><b>Payouts Due:</b> Rs ${fmtMoney(payoutsDue)}</div>
        <div style="border:1px solid #e6eaf2;border-radius:12px;padding:10px"><b>Today Tasks:</b> ${todayTasks}</div>
      </div>
      <hr/>
      <h3 style="margin:0 0 6px;font-size:14px">Today Schedule (${todayISO()})</h3>
      <table><thead><tr><th>Client</th><th>Task</th><th>Status</th></tr></thead>
      <tbody>${schedRows || '<tr><td colspan="3">No tasks</td></tr>'}</tbody></table>
      <hr/>
      <h3 style="margin:0 0 6px;font-size:14px">Pending Payments</h3>
      <table><thead><tr><th>Invoice</th><th>Client</th><th>Due</th><th>Status</th></tr></thead>
      <tbody>${payRows || '<tr><td colspan="4">No pending</td></tr>'}</tbody></table>
    </div>`;
  };

  const exportDashboardPDF = () => {
    printElementHTML(buildDashboardHTML());
  };

  const exportDashboardImage = async (fmt: "png" | "jpg") => {
    // Create a temporary div with the dashboard report HTML
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = sanitizeHtml(buildDashboardHTML());
    tempDiv.style.position = "absolute";
    tempDiv.style.left = "-9999px";
    tempDiv.style.background = "#fff";
    tempDiv.style.color = "#000";
    tempDiv.style.width = "800px";
    document.body.appendChild(tempDiv);
    
    await saveElementAsImage(tempDiv, fmt, "dashboard");
    document.body.removeChild(tempDiv);
  };

  return (
    <section className="card" ref={dashRef}>
      <h2>Manager Dashboard</h2>

      <div className="kpis">
        <div className="kpi"><div className="t">Total Income</div><div className="v">Rs {fmtMoney(income)}</div></div>
        <div className="kpi"><div className="t">Total Expense</div><div className="v">Rs {fmtMoney(expense)}</div></div>
        <div className="kpi"><div className="t">Net Profit</div><div className="v">Rs {fmtMoney(profit)}</div></div>
        <div className="kpi"><div className="t">Pending Receivables</div><div className="v">Rs {fmtMoney(receivable)}</div></div>
        <div className="kpi"><div className="t">Pending Payouts</div><div className="v">Rs {fmtMoney(payoutsDue)}</div></div>
        <div className="kpi"><div className="t">Today Tasks</div><div className="v">{todayTasks}</div></div>
      </div>

      <div className="grid2" style={{ marginTop: 12 }}>
        <div className="canvasCard">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <b style={{ fontSize: 12 }}>Income vs Expense</b><span className="small">Auto</span>
          </div>
          <canvas ref={incExpRef} height={150} />
        </div>
        <div className="canvasCard">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <b style={{ fontSize: 12 }}>Invoices Paid vs Running</b><span className="small">Auto</span>
          </div>
          <canvas ref={invRef} height={150} />
        </div>
      </div>

      <div className="canvasCard" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <b style={{ fontSize: 12 }}>Accounts Balance Share</b><span className="small">Auto</span>
        </div>
        <canvas ref={donutRef} height={180} />
        <div className="small" style={{ marginTop: 6 }}>
          {walletParts.length ? walletParts.map(p => (
            <span key={p.name} className="badge" style={{ marginRight: 6 }}>{p.name}: Rs {fmtMoney(p.value)}</span>
          )) : <span>No wallet balances yet.</span>}
        </div>
      </div>

      <div className={walletsSorted.length >= 4 ? "gridAuto" : "grid3"} style={{ marginTop: 12 }}>
        {walletsSorted.slice(0, 6).map((w, i) => (
          <div key={w.id} className="canvasCard">
            <b style={{ fontSize: 12 }}>{w.name || "Account"}</b>
            <canvas ref={el => { ringRefs.current[i] = el; }} height={120} />
          </div>
        ))}
        {walletsSorted.length === 0 && <div className="small">No accounts yet.</div>}
      </div>

      <div className="grid2" style={{ marginTop: 12 }}>
        <div className="card" style={{ boxShadow: "none" }}>
          <h2 style={{ marginBottom: 6 }}>Today Schedule</h2>
          <div className="tablewrap">
            <table style={{ minWidth: 0 }}>
              <thead><tr><th>Client</th><th>Task</th><th>Status</th></tr></thead>
              <tbody>
                {todaySchedule.length === 0 ? (
                  <tr><td colSpan={3} className="small">No tasks for today</td></tr>
                ) : todaySchedule.map((s) => {
                  const client = data.clients.find((c) => c.id === s.clientId);
                  return (
                    <tr key={s.id}>
                      <td>{client?.name || ""}</td>
                      <td>{s.task || ""}</td>
                      <td><span className={`badge ${s.status === "Done" ? "ok" : "warn"}`}>{s.status || "Pending"}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card" style={{ boxShadow: "none" }}>
          <h2 style={{ marginBottom: 6 }}>Pending Payments</h2>
          <div className="tablewrap">
            <table style={{ minWidth: 0 }}>
              <thead><tr><th>Type</th><th>Name</th><th>Amount</th></tr></thead>
              <tbody>
                {pendingInvoices.length === 0 && data.team.every(t => Math.max(0, (t.rate || 0) - (t.paid || 0)) === 0) ? (
                  <tr><td colSpan={3} className="small">No pending</td></tr>
                ) : (
                  <>
                    {pendingInvoices.slice(0, 12).map((inv) => {
                      const client = data.clients.find((c) => c.id === inv.clientId);
                      const due = Math.max(0, (inv.grandTotal || 0) - (inv.paidAmount || 0));
                      return (
                        <tr key={inv.id}>
                          <td>Invoice</td>
                          <td>{client?.name || ""}</td>
                          <td>{fmtMoney(due)}</td>
                        </tr>
                      );
                    })}
                    {data.team.filter(t => Math.max(0, (t.rate || 0) - (t.paid || 0)) > 0).map(t => (
                      <tr key={t.id}>
                        <td>Team Due</td>
                        <td>{t.name}</td>
                        <td>{fmtMoney(Math.max(0, (t.rate || 0) - (t.paid || 0)))}</td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid3" style={{ marginTop: 12 }}>
        <div className="kpi"><div className="t">Khata Lena (Pending)</div><div className="v">Rs {fmtMoney(khLena)}</div></div>
        <div className="kpi"><div className="t">Khata Dena (Pending)</div><div className="v">Rs {fmtMoney(khDena)}</div></div>
        <div className="kpi"><div className="t">Khata Net</div><div className="v">Rs {fmtMoney(khLena - khDena)}</div></div>
      </div>

      {/* Dashboard Export Boxes */}
      <div className="grid3" style={{ marginTop: 12 }}>
        <div className="kpi" style={{ cursor: "pointer" }} onClick={exportDashboardPDF}>
          <div className="t">Dashboard PDF</div><div className="v">Export</div>
        </div>
        <div className="kpi" style={{ cursor: "pointer" }} onClick={() => exportDashboardImage("png")}>
          <div className="t">Dashboard PNG</div><div className="v">Save</div>
        </div>
        <div className="kpi" style={{ cursor: "pointer" }} onClick={() => exportDashboardImage("jpg")}>
          <div className="t">Dashboard JPG</div><div className="v">Save</div>
        </div>
      </div>
    </section>
  );
}
