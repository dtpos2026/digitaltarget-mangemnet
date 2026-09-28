import React, { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { uid, todayISO, fmtMoney } from "@/lib/db";
import { writeSafeDocument } from "@/lib/safeHtml";
import ModuleInsights from "@/components/ModuleInsights";
import { printElementHTML } from "@/lib/exportUtils";
import {
  expenseCategoriesOf, incomeCategoriesOf, inRange, monthEnd, monthKey, monthStart, scopeOf, summarize, NEUTRAL_CATEGORIES, ExpenseScope,
} from "@/lib/finance";

export default function AccountingTab() {
  const { data, addItem, removeItem, updateItem, adjustWallet } = useData();
  const [editId, setEditId] = useState<string | null>(null);
  const [type, setType] = useState("IN");
  const [date, setDate] = useState(todayISO());
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [category, setCategory] = useState("Invoice Paid");
  const [walletId, setWalletId] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [scope, setScope] = useState<ExpenseScope>("business");
  const [shown, setShown] = useState(100);
  const [filterScope, setFilterScope] = useState<"all" | "IN" | ExpenseScope>("all");

  // Categories come from Settings (finance.ts), grouped into business / personal.
  const expenseCats = expenseCategoriesOf(data.settings);
  const incomeCats = incomeCategoriesOf(data.settings);
  const categories = type === "IN" ? [...incomeCats, ...NEUTRAL_CATEGORIES] : [...expenseCats.map((c) => c.name), ...NEUTRAL_CATEGORIES];
  const pickCategory = (c: string) => {
    setCategory(c);
    const known = expenseCats.find((x) => x.name === c);
    if (known) setScope(known.scope);
  };
  const rows = data.accounting
    .filter((a: any) => filterScope === "all" || (filterScope === "IN" ? a.type === "IN" : a.type === "OUT" && scopeOf(a, data.settings) === filterScope))
    .slice()
    .sort((a: any, b: any) => String(b.date || "").localeCompare(String(a.date || "")));
  const thisMonth = monthKey();
  const monthSum = summarize(inRange(data.accounting, monthStart(thisMonth), monthEnd(thisMonth)), data.settings);

  const clearForm = () => {
    setEditId(null);
    setType("IN"); setDate(todayISO()); setClientId(""); setProjectId("");
    setCategory("Invoice Paid"); setWalletId(""); setAmount(""); setDesc(""); setScope("business");
  };

  const handleSave = async () => {
    const amt = +amount || 0;
    if (!amt) { alert("Amount required"); return; }

    // Wallet effect of an entry: + for money in, − for money out.
    const signed = (t: string, amount: number) => (t === "IN" ? amount : -amount);
    if (editId) {
      const old = data.accounting.find(a => a.id === editId);
      if (!old) { alert("Entry not found"); return; }
      // Undo the old effect and apply the new one as atomic increments.
      const deltas: Record<string, number> = {};
      if (old.walletId) deltas[old.walletId] = (deltas[old.walletId] || 0) - signed(old.type, Number(old.amount) || 0);
      if (walletId) deltas[walletId] = (deltas[walletId] || 0) + signed(type, amt);
      for (const [w, d] of Object.entries(deltas)) {
        if (d && data.wallets.some((x) => x.id === w)) await adjustWallet(w, d, "Accounting entry edited");
      }
      await updateItem("accounting", {
        ...old,
        date, type, clientId, projectId, category, walletId, amount: amt, desc,
        scope: type === "OUT" ? scope : "",
      });
      alert("Entry updated ✅");
    } else {
      if (walletId && data.wallets.some((x) => x.id === walletId)) await adjustWallet(walletId, signed(type, amt), category);
      await addItem("accounting", { id: uid("A"), date, type, clientId, projectId, category, walletId, amount: amt, desc, receipt: null, scope: type === "OUT" ? scope : "", createdAt: new Date().toISOString() });
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
    setScope(scopeOf(a, data.settings));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (a: any) => {
    if (!confirm("Delete entry?")) return;
    if (a.walletId && data.wallets.some((x) => x.id === a.walletId)) {
      await adjustWallet(a.walletId, a.type === "IN" ? -(Number(a.amount) || 0) : Number(a.amount) || 0, "Accounting entry deleted");
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
          <select value={type} onChange={(e) => { setType(e.target.value); setCategory(e.target.value === "IN" ? "Invoice Paid" : expenseCats[0]?.name || "Other Business Cost"); }}>
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
          <select value={category} onChange={(e) => pickCategory(e.target.value)}>
            {!categories.includes(category) && <option>{category}</option>}
            {type === "IN" ? (
              <>{incomeCats.map((c) => <option key={c}>{c}</option>)}</>
            ) : (
              <>
                <optgroup label="Business expenses">{expenseCats.filter((c) => c.scope === "business").map((c) => <option key={c.name}>{c.name}</option>)}</optgroup>
                <optgroup label="Personal / Miscellaneous">{expenseCats.filter((c) => c.scope === "personal").map((c) => <option key={c.name}>{c.name}</option>)}</optgroup>
              </>
            )}
            <optgroup label="Not income / expense">{NEUTRAL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</optgroup>
          </select>
          {type === "OUT" && (
            <div className="scopePick" role="radiogroup" aria-label="Expense type">
              <button type="button" className={scope === "business" ? "on" : ""} onClick={() => setScope("business")}>Business</button>
              <button type="button" className={scope === "personal" ? "on" : ""} onClick={() => setScope("personal")}>Personal / Misc</button>
            </div>
          )}
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
      <div className="moneyStrip">
        <div><span>Is mahine income</span><b>Rs {fmtMoney(monthSum.income)}</b></div>
        <div><span>Business kharcha</span><b>Rs {fmtMoney(monthSum.businessExpense)}</b></div>
        <div><span>Personal / misc</span><b>Rs {fmtMoney(monthSum.personalExpense)}</b></div>
        <div><span>Net saving</span><b className={monthSum.netSaving < 0 ? "neg" : "pos"}>Rs {fmtMoney(monthSum.netSaving)}</b><em>{monthSum.savingMargin}% margin</em></div>
      </div>
      <div className="segmented" style={{ margin: "10px 0" }}>
        {([["all", "Sab"], ["IN", "Income"], ["business", "Business"], ["personal", "Personal"]] as const).map(([k, l]) => (
          <button key={k} className={filterScope === k ? "on" : ""} onClick={() => { setFilterScope(k); setShown(100); }}>{l}</button>
        ))}
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Client</th><th>Category</th><th>Scope</th><th>Amount</th><th>Account</th><th>Receipt</th><th>Action</th></tr></thead>
          <tbody>
            {rows.slice(0, shown).map((a) => {
              const c = data.clients.find(x => x.id === a.clientId);
              const w = data.wallets.find(x => x.id === a.walletId);
              return (
                <tr key={a.id}>
                  <td>{a.date}</td>
                  <td><span className={`badge ${a.type === "IN" ? "ok" : "bad"}`}>{a.type}</span></td>
                  <td>{c?.name || ""}</td>
                  <td>{a.category}</td>
                  <td>{a.type === "OUT" ? <span className={`badge ${scopeOf(a, data.settings) === "personal" ? "warn" : ""}`}>{scopeOf(a, data.settings) === "personal" ? "Personal" : "Business"}</span> : ""}</td>
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
      {rows.length > shown && <button className="btnSmall" style={{ marginTop: 8 }} onClick={() => setShown(shown + 200)}>Aur dikhayein ({rows.length - shown} baqi)</button>}
    </section>
    </>
  );
}
