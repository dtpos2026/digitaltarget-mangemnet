import React, { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { todayISO, fmtMoney } from "@/lib/db";
import { printElementHTML } from "@/lib/exportUtils";

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
  );
}
