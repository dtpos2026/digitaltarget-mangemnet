import React, { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { listArchives } from "@/lib/closingStore";
import { useData } from "@/contexts/DataContext";
import { uid, todayISO, fmtMoney } from "@/lib/db";
import { printElementHTML } from "@/lib/exportUtils";

export default function AccountsTab() {
  const { data, addItem, removeItem, updateItem } = useData();
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [title, setTitle] = useState("");
  const [balance, setBalance] = useState("");
  const [trFrom, setTrFrom] = useState("");
  const [trTo, setTrTo] = useState("");
  const [trDate, setTrDate] = useState(todayISO());
  const [trAmount, setTrAmount] = useState("");
  const [trNote, setTrNote] = useState("");
  // Balance of each account at the last close (day close or month close) — to compare / repair.
  const { workspaceUid, can } = useAuth();
  const [lastClose, setLastClose] = useState<{ label: string; at: string; wallets: { id: string; balance: number }[] } | null>(null);
  useEffect(() => {
    const days: any[] = Array.isArray(data.settings?.accountingDayCloses) ? data.settings.accountingDayCloses : [];
    const fromDay = days.length ? { label: `Din close ${days[days.length - 1].date}`, at: days[days.length - 1].closedAt, wallets: days[days.length - 1].wallets || [] } : null;
    if (!workspaceUid || !can("history.manage")) { setLastClose(fromDay); return; }
    listArchives(workspaceUid).then((l) => {
      const m = l.filter((a: any) => a.status === "closed" && Array.isArray(a.wallets)).sort((a: any, b: any) => String(b.closedAt || "").localeCompare(String(a.closedAt || "")))[0] as any;
      const fromMonth = m ? { label: `Mahina close ${m.month}`, at: m.closedAt || "", wallets: m.wallets } : null;
      setLastClose(!fromMonth ? fromDay : !fromDay ? fromMonth : String(fromDay.at) > String(fromMonth.at) ? fromDay : fromMonth);
    }).catch(() => setLastClose(fromDay));
  }, [workspaceUid, can, data.settings?.accountingDayCloses]);

  const handleAdd = async () => {
    if (!name.trim()) { alert("Account name required"); return; }
    await addItem("wallets", { id: uid("W"), name: name.trim(), number: number.trim(), title: title.trim(), balance: +balance || 0 });
    setName(""); setNumber(""); setTitle(""); setBalance("");
  };

  const handleAdjust = async (w: any) => {
    const val = prompt("New balance:", w.balance);
    if (val === null) return;
    const newBal = +val || 0;
    const diff = newBal - (w.balance || 0);
    await updateItem("wallets", { ...w, balance: newBal });
    await addItem("accounting", {
      id: uid("A"), date: todayISO(), type: diff >= 0 ? "IN" : "OUT",
      clientId: "", projectId: "", category: "Account Adjustment",
      walletId: w.id, amount: Math.abs(diff), desc: `Manual adjustment (${w.name})`, receipt: null,
    });
  };

  // An account with money or ledger entries is never deleted: entries would point to nothing and the khata breaks.
  const removeWallet = async (w: any) => {
    const used = data.accounting.filter((a: any) => a.walletId === w.id).length + data.walletTransfers.filter((t: any) => t.fromId === w.id || t.toId === w.id).length;
    if (Math.round(Number(w.balance) || 0) !== 0 || used) {
      alert(`"${w.name}" delete nahi ho sakta — is mein Rs ${fmtMoney(w.balance || 0)} balance aur ${used} entries hain.\n\nPehle balance doosre account mein Transfer karein. Entries waali account history ke liye rehti hai.`);
      return;
    }
    if (confirm(`"${w.name}" (khali account) delete karein?`)) await removeItem("wallets", w.id);
  };

  const handleTransfer = async () => {
    if (!trFrom || !trTo) { alert("Select both accounts"); return; }
    if (trFrom === trTo) { alert("Must be different accounts"); return; }
    const amt = +trAmount || 0;
    if (amt <= 0) { alert("Amount required"); return; }
    const from = data.wallets.find(x => x.id === trFrom);
    const to = data.wallets.find(x => x.id === trTo);
    if (!from || !to) return;
    await updateItem("wallets", { ...from, balance: (from.balance || 0) - amt });
    await updateItem("wallets", { ...to, balance: (to.balance || 0) + amt });
    await addItem("walletTransfers", { id: uid("TR"), date: trDate, fromId: trFrom, toId: trTo, amount: amt, note: trNote });
    setTrAmount(""); setTrNote("");
  };

  const handleDelTransfer = async (t: any) => {
    if (!confirm("Delete & reverse transfer?")) return;
    const from = data.wallets.find(x => x.id === t.fromId);
    const to = data.wallets.find(x => x.id === t.toId);
    if (from) await updateItem("wallets", { ...from, balance: (from.balance || 0) + (t.amount || 0) });
    if (to) await updateItem("wallets", { ...to, balance: (to.balance || 0) - (t.amount || 0) });
    await removeItem("walletTransfers", t.id);
  };

  const printAccounts = () => {
    const rows = data.wallets.map(w => `<tr><td>${w.name}</td><td>${w.number || ""}</td><td>Rs ${fmtMoney(w.balance || 0)}</td></tr>`).join("");
    printElementHTML(`    <table><thead><tr><th>Account</th><th>Number</th><th>Balance</th></tr></thead><tbody>${rows || "<tr><td colspan='3'>No accounts</td></tr>"}</tbody></table>`, "Accounts Sheet");
  };

  return (
    <section className="card">
      <h2>Accounts / Wallets</h2>
      <div className="grid2">
        <div><label>Account Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cash / Bank / Wallet" /></div>
        <div><label>Account Number (optional)</label><input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="optional" /></div>
      </div>
      <div className="grid2">
        <div><label>Opening / Current Balance</label><input type="number" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0" /></div>
        <div><label>Account Title (optional)</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="optional" /></div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btnSolid" onClick={handleAdd}>Add Account</button>
        <button className="btnSmall" onClick={printAccounts}>Export Accounts</button>
      </div>

      <hr />
      <div className="tablewrap">
        <table>
          <thead><tr><th>Name</th><th>Number</th><th>Balance</th>{lastClose && <th title={lastClose.label}>Close par balance</th>}<th>Action</th></tr></thead>
          <tbody>
            {data.wallets.map((w) => (
              <tr key={w.id}>
                <td><b>{w.name}</b><div className="small">{w.title || ""}</div></td>
                <td>{w.number || ""}</td>
                <td><b>Rs {fmtMoney(w.balance || 0)}</b></td>
                {lastClose && (() => { const c = lastClose.wallets.find((x) => x.id === w.id); return <td className="small">{c ? `Rs ${fmtMoney(c.balance)}` : "—"}<div>{lastClose.label}</div></td>; })()}
                <td className="rowActions">
                  <button className="btnSmall" onClick={() => handleAdjust(w)}>Edit Balance</button>
                  <button className="btnSmall" onClick={() => removeWallet(w)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <hr />
      <h2 style={{ marginTop: 0 }}>Transfer Between Accounts</h2>
      <div className="small">Yeh sirf balance transfer hai. Is se accounting/expense mein entry create nahi hogi.</div>
      <div className="grid2" style={{ marginTop: 10 }}>
        <div><label>From Account</label>
          <select value={trFrom} onChange={(e) => setTrFrom(e.target.value)}>
            <option value="">Select...</option>
            {data.wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div><label>To Account</label>
          <select value={trTo} onChange={(e) => setTrTo(e.target.value)}>
            <option value="">Select...</option>
            {data.wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid2">
        <div><label>Date</label><input type="date" value={trDate} onChange={(e) => setTrDate(e.target.value)} /></div>
        <div><label>Amount</label><input type="number" value={trAmount} onChange={(e) => setTrAmount(e.target.value)} placeholder="e.g. 5000" /></div>
      </div>
      <div><label>Notes</label><input value={trNote} onChange={(e) => setTrNote(e.target.value)} placeholder="e.g. Cash to Meezan" /></div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <button className="btnSolid" onClick={handleTransfer}>Transfer Amount</button>
        <button className="btnDanger" onClick={() => { setTrAmount(""); setTrNote(""); }}>Clear</button>
      </div>

      <hr />
      <div className="tablewrap">
        <table>
          <thead><tr><th>Date</th><th>From</th><th>To</th><th>Amount</th><th>Notes</th><th>Action</th></tr></thead>
          <tbody>
            {data.walletTransfers.slice().reverse().map((t) => {
              const from = data.wallets.find(x => x.id === t.fromId);
              const to = data.wallets.find(x => x.id === t.toId);
              return (
                <tr key={t.id}>
                  <td>{t.date}</td><td>{from?.name || ""}</td><td>{to?.name || ""}</td>
                  <td>Rs {fmtMoney(t.amount)}</td><td>{t.note || ""}</td>
                  <td><button className="btnSmall" onClick={() => handleDelTransfer(t)}>Delete</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
