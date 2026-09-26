import React, { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { uid, todayISO, fmtMoney } from "@/lib/db";
import { writeSafeDocument } from "@/lib/safeHtml";
import ModuleInsights from "@/components/ModuleInsights";
import { printElementHTML } from "@/lib/exportUtils";

export default function AccountingTab() {
  const { data, addItem, removeItem, updateItem } = useData();
  const [editId, setEditId] = useState<string | null>(null);
  const [type, setType] = useState("IN");
  const [date, setDate] = useState(todayISO());
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [category, setCategory] = useState("Ads Run");
  const [walletId, setWalletId] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");

  const categories = ["Ads Run","Local Business Ads","Monthly Management","Design Service","Video Editing","Office Expense","Personal Expense","Meal / Dinner","Travel","Team Payout","Invoice Paid","Account Adjustment","Other"];

  const clearForm = () => {
    setEditId(null);
    setType("IN"); setDate(todayISO()); setClientId(""); setProjectId("");
    setCategory("Ads Run"); setWalletId(""); setAmount(""); setDesc("");
  };

  const adjustWallet = async (wId: string, deltaIn: number, oldAmt: number, oldType: string, oldWalletId: string) => {
    // Reverse old effect
    if (oldWalletId) {
      const ow = data.wallets.find(x => x.id === oldWalletId);
      if (ow) {
        const reversed = oldType === "IN" ? (ow.balance || 0) - oldAmt : (ow.balance || 0) + oldAmt;
        await updateItem("wallets", { ...ow, balance: reversed });
      }
    }
    // Apply new effect
    if (wId) {
      const nw = data.wallets.find(x => x.id === wId);
      if (nw) {
        const updated = type === "IN" ? (nw.balance || 0) + deltaIn : (nw.balance || 0) - deltaIn;
        // refetch in case same wallet was just updated
        const fresh = data.wallets.find(x => x.id === wId);
        const base = fresh?.balance ?? 0;
        // Use the value we already computed by re-applying
        await updateItem("wallets", { ...nw, balance: (oldWalletId === wId ? base : updated) });
      }
    }
  };

  const handleSave = async () => {
    const amt = +amount || 0;
    if (!amt) { alert("Amount required"); return; }

    if (editId) {
      // Edit existing
      const old = data.accounting.find(a => a.id === editId);
      if (!old) { alert("Entry not found"); return; }

      // Reverse old wallet effect
      if (old.walletId) {
        const ow = data.wallets.find(x => x.id === old.walletId);
        if (ow) {
          const reversed = old.type === "IN" ? (ow.balance || 0) - (old.amount || 0) : (ow.balance || 0) + (old.amount || 0);
          await updateItem("wallets", { ...ow, balance: reversed });
        }
      }
      // Apply new wallet effect
      if (walletId) {
        const nw = data.wallets.find(x => x.id === walletId);
        if (nw) {
          // If same wallet, balance was already reversed above, so apply on the reversed value
          const currBal = walletId === old.walletId
            ? (type === "IN" ? (nw.balance || 0) - (old.amount || 0) : (nw.balance || 0) + (old.amount || 0))
            : (nw.balance || 0);
          const newBal = type === "IN" ? currBal + amt : currBal - amt;
          await updateItem("wallets", { ...nw, balance: newBal });
        }
      }

      await updateItem("accounting", {
        ...old,
        date, type, clientId, projectId, category, walletId, amount: amt, desc,
      });
      alert("Entry updated ✅");
    } else {
      // Add new
      if (walletId) {
        const w = data.wallets.find(x => x.id === walletId);
        if (w) {
          const newBal = type === "IN" ? (w.balance || 0) + amt : (w.balance || 0) - amt;
          await updateItem("wallets", { ...w, balance: newBal });
        }
      }
      await addItem("accounting", { id: uid("A"), date, type, clientId, projectId, category, walletId, amount: amt, desc, receipt: null });
    }
    clearForm();
  };

  const handleEdit = (a: any) => {
    setEditId(a.id);
    setType(a.type || "IN");
    setDate(a.date || todayISO());
    setClientId(a.clientId || "");
    setProjectId(a.projectId || "");
    setCategory(a.category || "Other");
    setWalletId(a.walletId || "");
    setAmount(String(a.amount || ""));
    setDesc(a.desc || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (a: any) => {
    if (!confirm("Delete entry?")) return;
    if (a.walletId) {
      const w = data.wallets.find(x => x.id === a.walletId);
      if (w) {
        const newBal = a.type === "IN" ? (w.balance || 0) - a.amount : (w.balance || 0) + a.amount;
        await updateItem("wallets", { ...w, balance: newBal });
      }
    }
    await removeItem("accounting", a.id);
    if (editId === a.id) clearForm();
  };

  const printAccounting = () => {
    const rows = data.accounting.slice().reverse().map(a => {
      const c = data.clients.find(x => x.id === a.clientId);
      const w = data.wallets.find(x => x.id === a.walletId);
      return `<tr><td>${a.date || ""}</td><td>${a.type || ""}</td><td>${c?.name || ""}</td><td>${a.category || ""}</td><td>Rs ${fmtMoney(a.amount || 0)}</td><td>${w?.name || ""}</td><td>${a.desc || ""}</td></tr>`;
    }).join("");
    printElementHTML(`    <table><thead><tr><th>Date</th><th>Type</th><th>Client</th><th>Category</th><th>Amount</th><th>Account</th><th>Description</th></tr></thead><tbody>${rows || "<tr><td colspan='7'>No entries</td></tr>"}</tbody></table>`, "Accounting Report");
  };

  return (
    <>
      <ModuleInsights module="finance" />
    <section className="card">
      <h2>Accounting (Khata) {editId && <span className="badge warn">Editing</span>}</h2>
      <div className="grid2">
        <div><label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="IN">Receive (Income)</option><option value="OUT">Spend (Expense)</option>
          </select>
        </div>
        <div><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <div className="grid2">
        <div><label>Client</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Select...</option>
            {data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div><label>Project</label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">(Optional)</option>
            {data.projects.map(p => {
              const c = data.clients.find(x => x.id === p.clientId);
              return <option key={p.id} value={p.id}>{(c?.name || "") + " - " + p.title}</option>;
            })}
          </select>
        </div>
      </div>
      <div className="grid2">
        <div><label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div><label>Account / Wallet</label>
          <select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            <option value="">(Optional)</option>
            {data.wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid2">
        <div><label>Amount</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 5000" /></div>
        <div><label>Receipt Upload (optional)</label><input type="file" accept="image/*" /></div>
      </div>
      <div><label>Description</label><input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="details..." /></div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <button className="btnSolid" onClick={handleSave}>{editId ? "Update Entry" : "Add Entry"}</button>
        <button className="btnDanger" onClick={clearForm}>{editId ? "Cancel Edit" : "Clear"}</button>
        <button className="btnSmall" onClick={printAccounting}>Export Accounting</button>
      </div>
      <hr />
      <div className="tablewrap">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Client</th><th>Category</th><th>Amount</th><th>Account</th><th>Receipt</th><th>Action</th></tr></thead>
          <tbody>
            {data.accounting.slice().reverse().map((a) => {
              const c = data.clients.find(x => x.id === a.clientId);
              const w = data.wallets.find(x => x.id === a.walletId);
              return (
                <tr key={a.id}>
                  <td>{a.date}</td>
                  <td><span className={`badge ${a.type === "IN" ? "ok" : "bad"}`}>{a.type}</span></td>
                  <td>{c?.name || ""}</td>
                  <td>{a.category}</td>
                  <td>{fmtMoney(a.amount)}</td>
                  <td>{w?.name || ""}</td>
                  <td>{a.receipt?.data ? <button className="btnSmall" onClick={() => { const wi = window.open(""); if(wi) writeSafeDocument(wi, `<img src="${a.receipt.data}" style="max-width:100%"/>`); }}>View</button> : ""}</td>
                  <td className="rowActions">
                    <button className="btnSmall" onClick={() => handleEdit(a)}>Edit</button>
                    <button className="btnSmall" onClick={() => handleDelete(a)}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
    </>
  );
}
