import React, { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { todayISO, fmtMoney } from "@/lib/db";
import { printElementHTML } from "@/lib/exportUtils";
import { buildBusinessReport, rangeFor } from "@/lib/reports";

const rs = (n: number) => `Rs ${fmtMoney(Math.round(Number(n) || 0))}`;

/** Full business report: money, invoices, services, leads, clients, projects, team, ads spend. */
function BusinessReport() {
  const { data } = useData();
  const [kind, setKind] = useState<"daily" | "weekly" | "monthly" | "custom">("monthly");
  const [from, setFrom] = useState(todayISO().slice(0, 8) + "01");
  const [to, setTo] = useState(todayISO());
  const range = kind === "custom" ? { from, to } : rangeFor(kind, todayISO());
  const r = React.useMemo(() => buildBusinessReport(data, range.from, range.to), [data, range.from, range.to]);

  const print = () => {
    const rows = (t: string, list: string[][]) => `<h3>${t}</h3><table><tbody>${list.map((x) => `<tr>${x.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    printElementHTML(
      rows("Money", [["Income", rs(r.income)], ["Business expense", rs(r.businessExpense)], ["Personal expense", rs(r.personalExpense)], ["Business profit", rs(r.businessProfit)], ["Net saving", rs(r.netSaving)], ["Ads spend", rs(r.adsSpend)]]) +
      rows("Invoices & payments", [["Invoices", `${r.invoices.count} (billed ${rs(r.invoices.billed)})`], ["Payments received", `${r.payments.count} (${rs(r.payments.amount)})`], ["Outstanding", rs(r.outstanding)]]) +
      rows("Services", r.services.map((x) => [x.line, rs(x.amount), String(x.count)])) +
      rows("Leads / Clients / Projects", [["Leads", `${r.leads.total} (converted ${r.leads.converted}, lost ${r.leads.lost})`], ["Clients", `new ${r.clients.added}, active ${r.clients.active}`], ["Projects", `started ${r.projects.started}, completed ${r.projects.completed}, running ${r.projects.running}`]]) +
      rows("Team", r.team.map((t) => [t.name, `${t.done}/${t.tasks} tasks`, rs(t.cost)])),
      `Business Report ${r.from} → ${r.to}`);
  };

  return (
    <section className="card bizReport">
      <div className="sectionHead">
        <div><h2 style={{ margin: 0 }}>Business Report</h2><div className="small">{r.from} → {r.to} • closed months bhi shamil</div></div>
        <div className="segmented">
          {(["daily", "weekly", "monthly", "custom"] as const).map((k) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{k}</button>)}
        </div>
      </div>
      {kind === "custom" && <div className="grid2"><div><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div><div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div></div>}
      <div className="moneyStrip" style={{ marginTop: 10 }}>
        <div><span>Income</span><b>{rs(r.income)}</b></div>
        <div><span>Business expense</span><b>{rs(r.businessExpense)}</b></div>
        <div><span>Personal expense</span><b>{rs(r.personalExpense)}</b></div>
        <div><span>Business profit</span><b className={r.businessProfit < 0 ? "neg" : "pos"}>{rs(r.businessProfit)}</b></div>
        <div><span>Net saving</span><b className={r.netSaving < 0 ? "neg" : "pos"}>{rs(r.netSaving)}</b></div>
        <div><span>Ads spend</span><b>{rs(r.adsSpend)}</b></div>
      </div>
      <div className="moneyStrip" style={{ marginTop: 8 }}>
        <div><span>Invoices</span><b>{r.invoices.count}</b><em>billed {rs(r.invoices.billed)} • paid {r.invoices.paidCount} • unpaid {r.invoices.unpaidCount}</em></div>
        <div><span>Payments</span><b>{r.payments.count}</b><em>{rs(r.payments.amount)}</em></div>
        <div><span>Outstanding (abhi)</span><b>{rs(r.outstanding)}</b></div>
        <div><span>Leads</span><b>{r.leads.total}</b><em>converted {r.leads.converted} • lost {r.leads.lost}</em></div>
        <div><span>Clients</span><b>+{r.clients.added}</b><em>active {r.clients.active}</em></div>
        <div><span>Projects</span><b>{r.projects.started}</b><em>completed {r.projects.completed} • running {r.projects.running}</em></div>
      </div>
      <div className="grid2" style={{ marginTop: 10 }}>
        <div>
          <h3 className="growthH">Services (invoiced)</h3>
          {r.services.length ? r.services.map((x) => <div key={x.line} className="lpRow"><span>{x.line}</span><b>{rs(x.amount)} <em className="small">×{x.count}</em></b></div>) : <div className="small">—</div>}
          <h3 className="growthH">Expense by category</h3>
          {r.expenseByCategory.length ? r.expenseByCategory.slice(0, 8).map((x) => <div key={x.name} className="lpRow"><span>{x.name}</span><b>{rs(x.amount)}</b></div>) : <div className="small">—</div>}
        </div>
        <div>
          <h3 className="growthH">Team</h3>
          {r.team.length ? r.team.map((t) => <div key={t.name} className="lpRow"><span>{t.name} • {t.done}/{t.tasks} tasks</span><b>{rs(t.cost)}</b></div>) : <div className="small">—</div>}
          <h3 className="growthH">Lead sources</h3>
          {Object.keys(r.leads.bySource).length ? Object.entries(r.leads.bySource).map(([k, n]) => <div key={k} className="lpRow"><span>{k}</span><b>{n}</b></div>) : <div className="small">—</div>}
        </div>
      </div>
      <div className="rowActions" style={{ marginTop: 10 }}><button className="btnSmall" onClick={print}>Export / Print</button></div>
    </section>
  );
}

export default function ReportsTab() {
  const { data } = useData();
  const [type, setType] = useState("daily");
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const [clientId, setClientId] = useState("");
  const [report, setReport] = useState<any>(null);

  const inRange = (date: string, s: string, e: string) => {
    if (!date) return false;
    return date >= s && date <= e;
  };

  const generate = () => {
    let rows: any[] = [];
    if (type === "daily") {
      rows = data.accounting.filter(a => a.date === start);
    } else if (type === "weekly" || type === "monthly") {
      rows = data.accounting.filter(a => inRange(a.date, start, end));
    } else if (type === "clientprofit") {
      rows = data.accounting.filter(a => a.clientId === clientId);
    } else if (type === "projectfinance") {
      rows = data.accounting.filter(a => inRange(a.date, start, end));
    }
    let income = 0, expense = 0;
    rows.forEach(a => { if (a.type === "IN") income += a.amount; else expense += a.amount; });
    setReport({ rows, income, expense, net: income - expense });
  };

  const getTitle = () => {
    if (type === "daily") return `Daily Closing Report (${start})`;
    if (type === "weekly") return `Weekly Closing Report (${start} to ${end})`;
    if (type === "monthly") return `Monthly Closing Report (${start} to ${end})`;
    if (type === "projectfinance") return `Project-wise Cost vs Income`;
    return `Client Profit Report`;
  };

  const exportCSV = () => {
    const rows = [["date", "type", "client", "category", "amount", "account", "desc"]];
    data.accounting.forEach(a => {
      const c = data.clients.find(x => x.id === a.clientId);
      const w = data.wallets.find(x => x.id === a.walletId);
      rows.push([a.date, a.type, c?.name || "", a.category, String(a.amount), w?.name || "", a.desc || ""]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${data.settings.exportName || "DigitalTarget"}_accounting.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const printReport = () => {
    if (!report) { alert("Generate report first"); return; }
    const rows = report.rows.map((a: any) => {
      const c = data.clients.find(x => x.id === a.clientId);
      return `<tr><td>${a.date}</td><td>${c?.name || ""}</td><td>${a.type}</td><td>${a.category || ""}</td><td>${fmtMoney(a.amount)}</td></tr>`;
    }).join("");
    printElementHTML(`    <table><thead><tr><th>Date</th><th>Name</th><th>Type</th><th>Category</th><th>Amount</th></tr></thead><tbody>${rows || "<tr><td colspan='5'>No data</td></tr>"}</tbody></table>
    <hr/><div>Income: Rs ${fmtMoney(report.income)} | Expense: Rs ${fmtMoney(report.expense)} | Net: Rs ${fmtMoney(report.net)}</div>`, getTitle());
  };

  const printMasterReport = () => {
    let income = 0, expense = 0;
    data.accounting.forEach(a => {
      if (a.type === "IN" && a.category === "Invoice Paid") income += a.amount || 0;
      if (a.type === "OUT") expense += a.amount || 0;
    });
    printElementHTML(`    <div>Income: Rs ${fmtMoney(income)}</div><div>Expense: Rs ${fmtMoney(expense)}</div><div>Profit: Rs ${fmtMoney(income - expense)}</div><hr/>
    <div style="font-size:12px">Invoices: ${data.invoices.length} | Clients: ${data.clients.length} | Projects: ${data.projects.length}</div>`, "Master Summary Report");
  };

  return (
    <>
    <BusinessReport />
    <section className="card">
      <h2>Reports Engine</h2>
      <div className="small">Daily / Weekly / Monthly Closing + Client-wise Profit</div>

      <div className="grid2">
        <div><label>Report Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="daily">Daily Closing</option>
            <option value="weekly">Weekly Closing</option>
            <option value="monthly">Monthly Closing</option>
            <option value="clientprofit">Client-wise Profit</option>
            <option value="projectfinance">Project-wise Cost vs Income</option>
          </select>
        </div>
        <div><label>Date / Start</label><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
      </div>
      <div className="grid2">
        <div><label>End Date (weekly/monthly)</label><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        <div><label>Client (client-profit)</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Select...</option>
            {data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btnSolid" onClick={generate}>Generate Report</button>
        <button className="btnSmall" onClick={printReport}>Export Report</button>
        <button className="btnSolid" onClick={printMasterReport}>Master Summary</button>
        <button className="btnDanger" onClick={exportCSV}>Export CSV</button>
      </div>

      {report && (
        <>
          <hr />
          <div className="small">{getTitle()}</div>
          <div className="grid3" style={{ marginTop: 10 }}>
            <div className="kpi"><div className="t">Income</div><div className="v">Rs {fmtMoney(report.income)}</div></div>
            <div className="kpi"><div className="t">Expense</div><div className="v">Rs {fmtMoney(report.expense)}</div></div>
            <div className="kpi"><div className="t">Net</div><div className="v">Rs {fmtMoney(report.net)}</div></div>
          </div>
          <div className="tablewrap" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>Date</th><th>Client</th><th>Type</th><th>Category</th><th>Amount</th></tr></thead>
              <tbody>
                {report.rows.length === 0 ? (
                  <tr><td colSpan={5} className="small">No data</td></tr>
                ) : report.rows.map((a: any) => {
                  const c = data.clients.find(x => x.id === a.clientId);
                  return (
                    <tr key={a.id}>
                      <td>{a.date}</td>
                      <td>{c?.name || ""}</td>
                      <td><span className={`badge ${a.type === "IN" ? "ok" : "bad"}`}>{a.type}</span></td>
                      <td>{a.category}</td>
                      <td>Rs {fmtMoney(a.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
    </>
  );
}
