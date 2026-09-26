import React, { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { uid } from "@/lib/db";

export default function ClientsTab() {
  const { data, addItem, removeItem } = useData();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [ref, setRef] = useState("");
  const [status, setStatus] = useState("Active");

  const handleAdd = async () => {
    if (!name.trim()) { alert("Client name required"); return; }
    await addItem("clients", { id: uid("C"), name: name.trim(), phone: phone.trim(), ref: ref.trim(), status });
    setName(""); setPhone(""); setRef("");
  };

  const printClients = () => {
    const rows = data.clients.map(c => `<tr><td>${c.name}</td><td>${c.phone || ""}</td><td>${c.status || ""}</td><td>${c.ref || ""}</td></tr>`).join("");
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>Clients</title><style>body{font-family:system-ui;padding:14px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ccc;padding:8px;text-align:left}th{font-size:11px;text-transform:uppercase}</style></head><body>
    <h2 style="margin:0">DIGITAL TARGET</h2><div style="font-weight:900;margin-top:4px">Clients Report</div><div style="font-size:12px;color:#666">Generated: ${new Date().toLocaleString()}</div><hr/>
    <table><thead><tr><th>Name</th><th>Phone</th><th>Status</th><th>Notes</th></tr></thead><tbody>${rows || "<tr><td colspan='4'>No clients</td></tr>"}</tbody></table></body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
  };

  return (
    <section className="card">
      <h2>Clients</h2>
      <div className="grid2">
        <div><label>Client Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ali Store" /></div>
        <div><label>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xxxxxxxxx" /></div>
      </div>
      <div className="grid2">
        <div><label>Reference / Notes</label><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="optional" /></div>
        <div><label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option>Active</option><option>Inactive</option>
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btnSolid" onClick={handleAdd}>Add Client</button>
        <button className="btnSmall" onClick={printClients}>Export Clients</button>
      </div>
      <hr />
      <div className="tablewrap">
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {data.clients.map((c) => (
              <tr key={c.id}>
                <td><b>{c.name}</b><div className="small">{c.ref || ""}</div></td>
                <td>{c.phone || ""}</td>
                <td><span className={`badge ${c.status === "Active" ? "ok" : "warn"}`}>{c.status}</span></td>
                <td className="rowActions">
                  <button className="btnSmall" onClick={() => { if (confirm("Delete client?")) removeItem("clients", c.id); }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
