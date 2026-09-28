import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { fmtMoney } from "@/lib/db";
import { monthKey, monthLabel, shiftMonth } from "@/lib/finance";
import { ServiceTarget, revenueByLine, suggestTarget, targetOf, targetProgress } from "@/lib/targets";

const rs = (n: number) => `Rs ${fmtMoney(Math.round(Number(n) || 0))}`;

/**
 * Monthly target: the owner types a number (e.g. 500,000), the AI splits it
 * by service line from past invoices (or catalog prices when there is no
 * history), shows sales and leads needed and the daily / weekly run-rate.
 * Every number is editable; nothing is saved until "Approve".
 */
export default function TargetPlanner() {
  const { can } = useAuth();
  const { data, addItem, updateItem } = useData();
  const [month, setMonth] = useState(monthKey());
  const existing = targetOf(data.targets || [], month);
  const [revenue, setRevenue] = useState<string>("");
  const [mix, setMix] = useState<ServiceTarget[] | null>(null);
  const [extra, setExtra] = useState({ expenseLimit: 0, savingTarget: 0, leadTarget: 0, clientTarget: 0 });
  const [reasons, setReasons] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const canEdit = can("finance.manage");

  // Load the saved target when the month changes.
  useEffect(() => {
    const t = targetOf(data.targets || [], month);
    setRevenue(t?.revenue ? String(t.revenue) : "");
    setMix(t?.serviceMix?.length ? t.serviceMix.map((x) => ({ ...x })) : null);
    setExtra({ expenseLimit: t?.expenseLimit || 0, savingTarget: t?.savingTarget || 0, leadTarget: t?.leadTarget || 0, clientTarget: t?.clientTarget || 0 });
    setReasons([]); setMsg("");
  }, [month, data.targets]);

  const progress = useMemo(() => targetProgress(data, month), [data, month]);
  const actualByLine = useMemo(() => revenueByLine(data.invoices || [], [month], data.settings), [data.invoices, data.settings, month]);

  const aiBreakdown = () => {
    const s = suggestTarget(data, month, Number(revenue) || undefined);
    if (!revenue) setRevenue(String(s.revenue || ""));
    setMix(s.serviceMix.map((x) => ({ ...x })));
    setExtra({ expenseLimit: s.expenseLimit, savingTarget: s.savingTarget, leadTarget: s.leadTarget, clientTarget: s.clientTarget });
    setReasons(s.reasoning);
    setMsg("");
  };
  const setLine = (i: number, patch: Partial<ServiceTarget>) => {
    if (!mix) return;
    setMix(mix.map((x, j) => {
      if (j !== i) return x;
      const n = { ...x, ...patch };
      return { ...n, units: n.unitPrice > 0 ? Math.max(1, Math.ceil(n.amount / n.unitPrice)) : 0 };
    }));
  };
  const mixTotal = (mix || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const rev = Number(revenue) || 0;
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();

  const approve = async () => {
    if (!rev) { setMsg("Revenue target likhein"); return; }
    const doc = {
      id: month, month, revenue: rev, serviceMix: mix || [], ...extra,
      approved: true, approvedAt: new Date().toISOString(), source: mix ? "ai" : "manual",
      updatedAt: new Date().toISOString(), ...(existing ? {} : { createdAt: new Date().toISOString() }),
    };
    try {
      if (existing) await updateItem("targets", { ...existing, ...doc });
      else await addItem("targets", doc);
      setMsg(`✓ ${monthLabel(month)} ka target Rs ${fmtMoney(rev)} save`);
    } catch (e) { setMsg("Save nahi hua: " + (e as Error).message); }
  };

  return (
    <section className="card targetPlanner">
      <div className="sectionHead">
        <div>
          <h2 style={{ margin: 0 }}>🎯 Monthly Target</h2>
          <div className="small">Target likhein — AI pichli invoices / service prices se service-wise breakdown banata hai. Sab numbers aap edit kar sakte hain.</div>
        </div>
        <div className="segmented">
          {[monthKey(), shiftMonth(monthKey(), 1)].map((mm) => <button key={mm} className={month === mm ? "on" : ""} onClick={() => setMonth(mm)}>{monthLabel(mm)}</button>)}
        </div>
      </div>

      {progress && (
        <div className="tpProgress">
          <div className="tpBar"><div style={{ width: `${Math.min(100, progress.pct)}%` }} className={progress.onPace ? "ok" : "late"} /></div>
          <div className="moneyStrip">
            <div><span>Target</span><b>{rs(progress.target)}</b></div>
            <div><span>Achieved</span><b>{rs(progress.achieved)}</b><em>{progress.pct}% • {progress.onPace ? "raftaar theek" : "raftaar kam"}</em></div>
            <div><span>Remaining</span><b>{rs(progress.remaining)}</b><em>{progress.daysLeft} din baqi</em></div>
            <div><span>Required daily</span><b>{rs(progress.requiredDaily)}</b><em>weekly {rs(progress.requiredWeekly)}</em></div>
          </div>
        </div>
      )}

      <div className="tpInput">
        <label>Revenue target (Rs)</label>
        <input type="number" min="0" value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="e.g. 500000" disabled={!canEdit} />
        {canEdit && <button className="btnSolid" onClick={aiBreakdown}>✨ AI breakdown</button>}
        {rev > 0 && <span className="small">= {rs(rev / days)} rozana • {rs((rev / days) * 7)} hafta</span>}
      </div>

      {mix && (
        <>
          <div className="tablewrap" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Service</th><th className="num">Target (Rs)</th><th className="num">Ek sale ki qeemat</th><th className="num">Sales chahiye</th><th>Is mahine ab tak</th><th>Basis</th></tr></thead>
              <tbody>
                {mix.map((x, i) => {
                  const actual = Math.round(actualByLine.get(x.line)?.amount || 0);
                  const pct = x.amount ? Math.round((actual / x.amount) * 100) : 0;
                  return (
                    <tr key={x.line}>
                      <td><b>{x.line}</b><div className="small">{x.category}</div></td>
                      <td className="num"><input type="number" min="0" value={x.amount} onChange={(e) => setLine(i, { amount: +e.target.value })} disabled={!canEdit} style={{ textAlign: "right", maxWidth: 130 }} /></td>
                      <td className="num"><input type="number" min="0" value={x.unitPrice} onChange={(e) => setLine(i, { unitPrice: +e.target.value })} disabled={!canEdit} style={{ textAlign: "right", maxWidth: 120 }} /></td>
                      <td className="num"><b>{x.units}</b></td>
                      <td>{rs(actual)} <span className={`badge ${pct >= 100 ? "ok" : pct >= 50 ? "warn" : ""}`}>{pct}%</span></td>
                      <td><span className="badge">{x.basis === "history" ? "history" : "catalog"}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="small" style={{ marginTop: 4 }}>
            Breakdown total {rs(mixTotal)}{rev && Math.abs(mixTotal - rev) > 1000 ? ` — target se ${rs(Math.abs(mixTotal - rev))} ${mixTotal > rev ? "zyada" : "kam"}` : ""}
          </div>
          <div className="tpExtra">
            {([["expenseLimit", "Expense limit"], ["savingTarget", "Saving target"], ["leadTarget", "Leads chahiye"], ["clientTarget", "Clients"]] as const).map(([k, l]) => (
              <div key={k}><label>{l}</label><input type="number" min="0" value={extra[k]} onChange={(e) => setExtra({ ...extra, [k]: +e.target.value })} disabled={!canEdit} /></div>
            ))}
          </div>
          {reasons.length > 0 && <ul className="small tpReasons">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        </>
      )}
      {canEdit && (
        <div className="rowActions" style={{ marginTop: 10 }}>
          <button className="btnSolid" onClick={approve} disabled={!rev}>✓ Approve &amp; save target</button>
          {existing?.approved && <span className="small">Saved{existing.approvedAt ? ` ${new Date(existing.approvedAt).toLocaleDateString("en-PK")}` : ""}</span>}
          {msg && <span className="small">{msg}</span>}
        </div>
      )}
    </section>
  );
}
