import React, { useEffect, useMemo, useState } from "react";
import { useData } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { activeOnly } from "@/lib/closing";
import { listArchives } from "@/lib/closingStore";
import { DayClose, clearEntries, clearableEntries, closeDay, entriesToCloseDay, isDayArchive, reopenDay } from "@/lib/accountingClose";
import { uid, todayISO, fmtMoney } from "@/lib/db";
import { writeSafeDocument } from "@/lib/safeHtml";
import ModuleInsights from "@/components/ModuleInsights";
import { printElementHTML } from "@/lib/exportUtils";
import {
  expenseCategoriesOf, incomeCategoriesOf, inRange, monthEnd, monthKey, monthStart, scopeOf, summarize, NEUTRAL_CATEGORIES, ExpenseScope,
} from "@/lib/finance";

export default function AccountingTab() {
  const { data, addItem, removeItem, updateItem, adjustWallet, updateSettings, reload, logAudit } = useData();
  const { can, workspaceUid, user } = useAuth();
  const isAdminHist = can("history.manage");
  const [showClosed, setShowClosed] = useState(false);
  const [closeDate, setCloseDate] = useState(todayISO());
  const [closedMonths, setClosedMonths] = useState<Set<string>>(new Set());
  const [busyClose, setBusyClose] = useState("");
  const [closeMsg, setCloseMsg] = useState("");
  useEffect(() => {
    if (!workspaceUid || !isAdminHist) return;
    listArchives(workspaceUid).then((l) => setClosedMonths(new Set(l.filter((a) => a.status === "closed").map((a) => a.month)))).catch(() => {});
  }, [workspaceUid, isAdminHist, data.accounting.length]);
  const active = useMemo(() => activeOnly(data.accounting), [data.accounting]);
  const archivedCount = data.accounting.length - active.length;
  const dayCloses: DayClose[] = Array.isArray(data.settings?.accountingDayCloses) ? data.settings.accountingDayCloses : [];
  const lastDayClose = dayCloses[dayCloses.length - 1];
  const clearable = useMemo(() => clearableEntries(data.accounting, closedMonths), [data.accounting, closedMonths]);
  const walletTotal = data.wallets.reduce((s: number, w: any) => s + (Number(w.balance) || 0), 0);
  const [editId, setEditId] = useState<string | null>(null);
  const [type, setType] = useState("IN");
  const [date, setDate] = useState(todayISO());
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
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
  const rows = (showClosed ? data.accounting : active)
    .filter((a: any) => filterScope === "all" || (filterScope === "IN" ? a.type === "IN" : a.type === "OUT" && scopeOf(a, data.settings) === filterScope))
    .slice()
    .sort((a: any, b: any) => String(b.date || "").localeCompare(String(a.date || "")));
  const thisMonth = monthKey();
  // Only what is still open: after a day / month close this starts again from zero.
  const monthSum = summarize(inRange(active, monthStart(thisMonth), monthEnd(thisMonth)), data.settings);

  const doCloseDay = async () => {
    if (!workspaceUid) return;
    const n = entriesToCloseDay(data.accounting, closeDate).length;
    if (!n) { setCloseMsg(`${closeDate} tak koi khuli entry nahi.`); return; }
    if (!confirm(`${closeDate} tak ki ${n} accounting entries close karein?\n\n• Accounting screen zero se shuru hogi\n• Har account ka balance WAISE HI rahega (closing balance aage jayega)\n• Entries Administrator History / Reports mein rahengi, koi delete nahi hogi\n• Close ki hui entries sirf Administrator badal sakta hai`)) return;
    setBusyClose("day"); setCloseMsg("");
    try {
      const rec = await closeDay(workspaceUid, data, closeDate, user?.email || "");
      await updateSettings({ ...data.settings, accountingDayCloses: [...dayCloses.filter((d) => d.date !== rec.date), rec].slice(-400) });
      logAudit({ action: "accounting.close_day", collection: "accounting", entityId: closeDate, details: `${rec.entries} entries closed; income ${rec.income}, expense ${rec.expense}` });
      await reload({ silent: true });
      setCloseMsg(`✓ ${closeDate} close — ${rec.entries} entries archive, balances same`);
    } catch (e) { setCloseMsg("Close nahi hua: " + (e as Error).message); }
    setBusyClose("");
  };
  const doReopenDay = async (d: DayClose) => {
    if (!workspaceUid || !confirm(`${d.date} ka din dobara kholein? Us din ki entries Accounting screen par wapas aa jayengi (balances par koi asar nahi).`)) return;
    setBusyClose("reopen");
    try {
      const n = await reopenDay(workspaceUid, d.date);
      await updateSettings({ ...data.settings, accountingDayCloses: dayCloses.filter((x) => x.date !== d.date) });
      logAudit({ action: "accounting.reopen_day", collection: "accounting", entityId: d.date, details: `${n} entries reopened` });
      await reload({ silent: true });
      setCloseMsg(`✓ ${d.date} dobara khul gaya (${n} entries)`);
    } catch (e) { setCloseMsg("Nahi hua: " + (e as Error).message); }
    setBusyClose("");
  };
  const doClear = async () => {
    if (!workspaceUid || !clearable.length) return;
    if (!confirm(`This action will permanently delete the selected historical data from the database. This cannot be undone.\n\n${clearable.length} accounting entries (sirf un mahinon ki jo close ho chuke hain aur jin ka snapshot Administrator History mein hai) delete hongi.\n\nAccount balances par KOI asar nahi hoga.`)) return;
    setBusyClose("clear");
    try {
      const n = await clearEntries(workspaceUid, clearable.map((a: any) => a.id));
      logAudit({ action: "accounting.clear_closed", collection: "accounting", entityId: "closed", details: `${n} archived entries deleted; wallet balances unchanged` });
      await reload({ silent: true });
      setCloseMsg(`✓ ${n} purani entries saaf — balances same`);
    } catch (e) { setCloseMsg("Saaf nahi hua: " + (e as Error).message); }
    setBusyClose("");
  };

  const clearForm = () => {
    setEditId(null);
    setType("IN"); setDate(todayISO()); setClientId(""); setProjectId(""); setInvoiceId("");
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
        date, type, clientId, projectId, invoiceId, category, walletId, amount: amt, desc,
        scope: type === "OUT" ? scope : "",
      });
      alert("Entry updated ✅");
    } else {
      if (walletId && data.wallets.some((x) => x.id === walletId)) await adjustWallet(walletId, signed(type, amt), category);
      await addItem("accounting", { id: uid("A"), date, type, clientId, projectId, invoiceId, category, walletId, amount: amt, desc, receipt: null, scope: type === "OUT" ? scope : "", createdAt: new Date().toISOString() });
    }
    clearForm();
  };

  const handleEdit = (a: any) => {
    setEditId(a.id);
    setType(a.type || "IN");
    setDate(a.date || todayISO());
    setClientId(a.clientId || "");
    setProjectId(a.projectId || ""); setInvoiceId(a.invoiceId || "");
    setCategory(a.category || "Other");
    setWalletId(a.walletId || "");
    setAmount(String(a.amount || ""));
    setDesc(a.desc || "");
    setScope(scopeOf(a, data.settings));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (a: any) => {
    if (a.archivedMonth) { alert("Ye entry close ho chuki hai (Administrator History). Isay yahan se delete nahi kar sakte — account balance kharab na ho."); return; }
    if (!confirm(`Entry delete karein?\n${a.date} • ${a.category} • Rs ${fmtMoney(a.amount)}`)) return;
    const w = a.walletId ? data.wallets.find((x) => x.id === a.walletId) : null;
    // Balance is only changed when the user asks: a wrong entry (typo) should give its money back,
    // but deleting a real, already-counted entry must not change the account.
    if (w && confirm(`"${w.name}" ka balance bhi wapas theek karein?\n\nOK = haan, ye entry ghalat thi — ${a.type === "IN" ? `Rs ${fmtMoney(a.amount)} balance se kam hoga` : `Rs ${fmtMoney(a.amount)} balance mein wapas aayega`}\nCancel = balance JAISA HAI waisa rahe (sirf entry hatayein)`)) {
      await adjustWallet(a.walletId, a.type === "IN" ? -(Number(a.amount) || 0) : Number(a.amount) || 0, "Accounting entry deleted");
    }
    await removeItem("accounting", a.id);
    if (editId === a.id) clearForm();
  };

  const printAccounting = () => {
    const rows = active.slice().reverse().map(a => {
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
      {type === "OUT" && (
        <div className="grid2">
          <div><label>Invoice / sale (margin ke liye)</label>
            <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
              <option value="">(Optional — kisi sale ka direct kharcha ho to chunein)</option>
              {data.invoices.slice().sort((a: any, b: any) => String(b.dateISO || "").localeCompare(String(a.dateISO || ""))).slice(0, 200).map((i: any) => {
                const c = data.clients.find((x) => x.id === i.clientId);
                return <option key={i.id} value={i.id}>{(i.invoiceNo || i.id) + " — " + (c?.name || "")}</option>;
              })}
            </select>
          </div>
          <div className="small" style={{ alignSelf: "end" }}>Rent, salary jaisa aam kharcha khali chhor dein (overhead ban jata hai). Ads spend / freelancer ko sale se jorein taake uska margin sahi aaye.</div>
        </div>
      )}
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
      <div className="moneyStrip" style={{ marginTop: 8 }}>
        <div><span>Accounts mein abhi (closing balance)</span><b>Rs {fmtMoney(walletTotal)}</b><em>{data.wallets.map((w: any) => `${w.name}: ${fmtMoney(w.balance || 0)}`).join(" • ") || "—"}</em></div>
        <div><span>Khuli entries</span><b>{active.length}</b><em>{archivedCount ? `${archivedCount} close ho chuki (History)` : "sab khuli"}</em></div>
        {lastDayClose && <div><span>Aakhri din close</span><b>{lastDayClose.date}</b><em>{lastDayClose.entries} entries • {lastDayClose.closedBy}</em></div>}
      </div>
      {isAdminHist && (
        <div className="acctClose">
          <b>📅 Din / hisaab close</b>
          <input type="date" value={closeDate} max={todayISO()} onChange={(e) => setCloseDate(e.target.value)} aria-label="Close date" />
          <button className="btnSolid" onClick={doCloseDay} disabled={!!busyClose}>{busyClose === "day" ? "Close ho raha hai…" : "Din close karein"}</button>
          {lastDayClose && <button className="btnSmall" onClick={() => doReopenDay(lastDayClose)} disabled={!!busyClose}>↺ {lastDayClose.date} dobara kholein</button>}
          <button className="btnDanger" onClick={doClear} disabled={!!busyClose || !clearable.length} title="Sirf close shuda mahinon ki entries, jin ka snapshot History mein hai">🧹 Close shuda data saaf karein ({clearable.length})</button>
          <span className="small">Mahina close: Admin History. Balances kabhi nahi badalte.</span>
          {closeMsg && <span className="small"><b>{closeMsg}</b></span>}
        </div>
      )}
      <label className="permItem" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={showClosed} onChange={(e) => { setShowClosed(e.target.checked); setShown(100); }} />
        <span className="small">Close ki hui entries bhi dikhayein (sirf dekhne ke liye)</span>
      </label>
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
                <tr key={a.id} className={a.archivedMonth ? "capSkip" : ""}>
                  <td>{a.date}{a.archivedMonth ? <div className="small">🔒 {isDayArchive(a.archivedMonth) ? "din close" : `${a.archivedMonth} close`}</div> : null}</td>
                  <td><span className={`badge ${a.type === "IN" ? "ok" : "bad"}`}>{a.type}</span></td>
                  <td>{c?.name || ""}</td>
                  <td>{a.category}</td>
                  <td>{a.type === "OUT" ? <span className={`badge ${scopeOf(a, data.settings) === "personal" ? "warn" : ""}`}>{scopeOf(a, data.settings) === "personal" ? "Personal" : "Business"}</span> : ""}</td>
                  <td>{fmtMoney(a.amount)}</td>
                  <td>{w?.name || ""}</td>
                  <td>{a.receipt?.data ? <button className="btnSmall" onClick={() => { const wi = window.open(""); if(wi) writeSafeDocument(wi, `<img src="${a.receipt.data}" style="max-width:100%"/>`); }}>View</button> : ""}</td>
                  <td className="rowActions">
                    {!a.archivedMonth && <button className="btnSmall" onClick={() => handleEdit(a)}>Edit</button>}
                    {!a.archivedMonth && <button className="btnSmall" onClick={() => handleDelete(a)}>Delete</button>}
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
