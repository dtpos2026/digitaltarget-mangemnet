import React, { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { uid, todayISO, fmtMoney } from "@/lib/db";

export default function KhataTab() {
  const { data, addItem, removeItem, updateItem } = useData();
  const [type, setType] = useState("LENA");
  const [date, setDate] = useState(todayISO());
  const [clientId, setClientId] = useState("");
  const [walletId, setWalletId] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [filterType, setFilterType] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterClient, setFilterClient] = useState("ALL");

  let openLena = 0, openDena = 0;
  data.khata.forEach((k) => {
    const due = Math.max(0, (k.amount || 0) - (k.paid || 0));
    if (k.status !== "SETTLED") {
      if (k.type === "LENA") openLena += due;
      else openDena += due;
    }
  });

  const handleAdd = async () => {
    const amt = +amount || 0;
    if (!amt) { alert("Amount required"); return; }
    const c = data.clients.find(x => x.id === clientId);
    const party = clientId ? (c?.name || "Client") : "Other";
    await addItem("khata", {
      id: uid("KH"), type, date, clientId: clientId || "", party, note: note.trim(),
      amount: amt, paid: 0, dueDate, status: "OPEN", walletId, linkedInvoiceId: "",
    });
    setAmount(""); setNote(""); setDueDate("");
  };

  const handlePayment = async (k: any) => {
    const due = Math.max(0, (k.amount || 0) - (k.paid || 0));
    if (due <= 0) { await updateItem("khata", { ...k, status: "SETTLED" }); return; }
    const amtStr = prompt("Enter amount to pay/receive:", String(due));
    if (amtStr === null) return;
    const amt = +amtStr || 0;
    if (amt <= 0) { alert("Invalid amount"); return; }
    const walletName = prompt("Enter Account Name (exact):", "Cash");
    if (walletName === null) return;
    const w = data.wallets.find(x => String(x.name).toLowerCase() === String(walletName).toLowerCase());
    if (!w) { alert("Account not found"); return; }

    const newPaid = (k.paid || 0) + amt;
    const newStatus = newPaid >= (k.amount || 0) ? "SETTLED" : (newPaid > 0 ? "PARTIAL" : "OPEN");
    await updateItem("khata", { ...k, paid: Math.min(newPaid, k.amount || 0), status: newStatus, walletId: w.id });

    const accType = k.type === "LENA" ? "IN" : "OUT";
    const newBal = (w.balance || 0) + (accType === "IN" ? amt : -amt);
    await updateItem("wallets", { ...w, balance: newBal });
    await addItem("accounting", {
      id: uid("A"), date: todayISO(), type: accType, clientId: k.clientId || "", projectId: "",
      category: k.type === "LENA" ? "Khata Receive" : "Khata Pay", walletId: w.id, amount: amt,
      desc: `Auto from khata ${k.id}`, receipt: null,
    });
  };

  const handleSettle = async (k: any) => {
    await updateItem("khata", { ...k, paid: k.amount || 0, status: "SETTLED" });
  };

  const syncFromInvoices = async () => {
    const existingLinked = new Set(data.khata.filter(k => k.linkedInvoiceId).map(k => k.linkedInvoiceId));
    for (const inv of data.invoices) {
      const due = Math.max(0, (inv.grandTotal || 0) - (inv.paidAmount || 0));
      if (existingLinked.has(inv.id)) {
        const existing = data.khata.find(k => k.linkedInvoiceId === inv.id);
        if (existing) {
          const c = data.clients.find(x => x.id === inv.clientId);
          await updateItem("khata", {
            ...existing, amount: inv.grandTotal || 0, paid: inv.paidAmount || 0,
            party: c?.name || existing.party,
            status: due <= 0 ? "SETTLED" : ((inv.paidAmount || 0) > 0 ? "PARTIAL" : "OPEN"),
          });
        }
      } else if (due > 0) {
        const c = data.clients.find(x => x.id === inv.clientId);
        await addItem("khata", {
          id: uid("KH"), type: "LENA",
          date: (inv.dateTime || "").slice(0, 10) || todayISO(),
          clientId: inv.clientId, party: c?.name || "Client",
          note: `Invoice due (${inv.id})`, amount: inv.grandTotal || 0,
          paid: inv.paidAmount || 0, dueDate: "",
          status: due <= 0 ? "SETTLED" : ((inv.paidAmount || 0) > 0 ? "PARTIAL" : "OPEN"),
          walletId: inv.paidWalletId || (data.wallets[0]?.id || ""),
          linkedInvoiceId: inv.id,
        });
      }
    }
    alert("Khata synced from invoices ✅");
  };

  const khStatusLabel = (st: string) => {
    if (st === "OPEN") return "Pending (Open)";
    if (st === "PARTIAL") return "Partial";
    if (st === "SETTLED") return "Settled (Done)";
    return st;
  };

  const filtered = data.khata.filter((k) => {
    if (filterType !== "ALL" && k.type !== filterType) return false;
    if (filterStatus !== "ALL" && k.status !== filterStatus) return false;
    if (filterClient !== "ALL" && String(k.clientId || "") !== String(filterClient)) return false;
    return true;
  }).sort((a: any, b: any) => String(b.date || "").localeCompare(String(a.date || "")));

  return (
    <section className="card">
      <h2>Khata (Lena / Dena Ledger)</h2>
      <div className="small">Use this for *receivables (Lena)* and *payables (Dena)*.</div>

      <div className="grid3" style={{ marginTop: 10 }}>
        <div className="kpi"><div className="t">Open Lena</div><div className="v">Rs {fmtMoney(openLena)}</div></div>
        <div className="kpi"><div className="t">Open Dena</div><div className="v">Rs {fmtMoney(openDena)}</div></div>
        <div className="kpi"><div className="t">Net</div><div className="v">Rs {fmtMoney(openLena - openDena)}</div></div>
      </div>

      <hr />
      <div className="grid2">
        <div><label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="LENA">Lena (Receive)</option><option value="DENA">Dena (Pay)</option>
          </select>
        </div>
        <div><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <div className="grid2">
        <div><label>Client (optional)</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">-- None --</option>
            {data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div><label>Account</label>
          <select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            {data.wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid2">
        <div><label>Total Amount</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 5000" /></div>
        <div><label>Due Date (optional)</label><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
      </div>
      <div><label>Description</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Jan package pending / supplier bill" /></div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <button className="btnSolid" onClick={handleAdd}>Add Khata</button>
      </div>

      <hr />
      <div className="grid2">
        <div>
          <label>Filter</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="ALL">All</option><option value="LENA">Lena</option><option value="DENA">Dena</option>
            </select>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="ALL">All Status</option><option value="OPEN">Pending (Open)</option><option value="PARTIAL">Partial</option><option value="SETTLED">Settled (Done)</option>
            </select>
            <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
              <option value="ALL">All Clients</option>
              {data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label>Quick Actions</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btnSmall" onClick={syncFromInvoices}>Sync from Invoices</button>
          </div>
        </div>
      </div>

      <div className="tablewrap" style={{ marginTop: 10 }}>
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Party</th><th>Description</th><th>Total</th><th>Paid</th><th>Due</th><th>Status</th><th>Account</th><th>Action</th></tr></thead>
          <tbody>
            {filtered.map((k) => {
              const w = data.wallets.find(x => x.id === k.walletId);
              const due = Math.max(0, (k.amount || 0) - (k.paid || 0));
              const dueLate = k.dueDate ? new Date(k.dueDate) < new Date(todayISO()) : false;
              return (
                <tr key={k.id} className={k.status !== "SETTLED" && dueLate ? "lateRow" : ""}>
                  <td>{k.date || ""}</td>
                  <td>
                    <span className={`badge ${k.type === "LENA" ? "ok" : "warn"}`}>{k.type === "LENA" ? "Lena" : "Dena"}</span>
                    {k.linkedInvoiceId && <div className="small">{k.linkedInvoiceId}</div>}
                  </td>
                  <td>{k.party || ""}</td>
                  <td>{k.note || ""}</td>
                  <td>{fmtMoney(k.amount || 0)}</td>
                  <td>{fmtMoney(k.paid || 0)}</td>
                  <td><b>{fmtMoney(due)}</b>{k.dueDate && <div className="small">Due: {k.dueDate}</div>}</td>
                  <td><span className={`badge ${k.status === "SETTLED" ? "ok" : (k.status === "PARTIAL" ? "warn" : "bad")}`}>{khStatusLabel(k.status)}</span></td>
                  <td>{w?.name || ""}</td>
                  <td className="rowActions">
                    <button className="btnSmall" onClick={() => handlePayment(k)}>Pay/Recv</button>
                    <button className="btnSmall" onClick={() => handleSettle(k)}>Settle</button>
                    <button className="btnDanger" onClick={() => { if (confirm("Delete?")) removeItem("khata", k.id); }}>Del</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="small" style={{ marginTop: 8 }}>Tip: Status is automatic: OPEN=0 payment, PARTIAL=some payment, SETTLED=due 0.</div>
    </section>
  );
}
