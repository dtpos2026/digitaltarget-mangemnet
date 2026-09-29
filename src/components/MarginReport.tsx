import React, { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { fmtMoney, todayISO } from "@/lib/db";
import { monthKey, monthEnd, monthStart, shiftMonth } from "@/lib/finance";
import { DEFAULT_MIN_MARGIN, marginInsights, marginReport } from "@/lib/margin";
import { downloadXlsx } from "@/lib/xlsx";
import { printElementHTML } from "@/lib/exportUtils";
import { navigate } from "@/lib/navigation";

const rs = (n: number) => `Rs ${fmtMoney(Math.round(Number(n) || 0))}`;
type Preset = "month" | "last" | "3m" | "year" | "custom";

/**
 * Category-wise profit & margin: what each service category earned, what it
 * cost, and what is left — plus overhead and where the money was spent.
 * INTERNAL: none of this is printed on invoices.
 */
export default function MarginReport() {
  const { data } = useData();
  const { can } = useAuth();
  const [preset, setPreset] = useState<Preset>("month");
  const [from, setFrom] = useState(monthStart(monthKey()));
  const [to, setTo] = useState(todayISO());
  const [open, setOpen] = useState<string>("");
  const minMargin = Number(data.settings?.minMarginPct) || DEFAULT_MIN_MARGIN;

  const range = useMemo(() => {
    const m = monthKey();
    if (preset === "month") return { from: monthStart(m), to: monthEnd(m) };
    if (preset === "last") { const p = shiftMonth(m, -1); return { from: monthStart(p), to: monthEnd(p) }; }
    if (preset === "3m") return { from: monthStart(shiftMonth(m, -2)), to: monthEnd(m) };
    if (preset === "year") return { from: `${m.slice(0, 4)}-01-01`, to: `${m.slice(0, 4)}-12-31` };
    return { from: from || "0000-01-01", to: to || "9999-12-31" };
  }, [preset, from, to]);

  const r = useMemo(() => marginReport(data, range.from, range.to), [data, range.from, range.to]);
  const notes = useMemo(() => marginInsights(r, minMargin), [r, minMargin]);
  if (!can("finance.view")) return null;

  const badge = (m: number) => (m < 0 ? "bad" : m < minMargin ? "warn" : "ok");

  const excel = () => downloadXlsx(`Profit_Margin_${range.from}_${range.to}`, [
    {
      name: "By category", widths: [26, 16, 16, 16, 12, 10, 16],
      rows: [["Category", "Revenue", "Direct cost", "Profit", "Margin %", "Sales", "Received"],
        ...r.categories.map((c) => [c.category, c.revenue, c.cost, c.profit, c.margin, c.sales, c.received]),
        ["Total", r.revenue, r.directCost, r.grossProfit, r.grossMargin, r.sales.length, ""],
        ["Overhead (unlinked business expenses)", "", r.overhead], ["Net after overhead", "", "", r.netAfterOverhead, r.netMargin]],
    },
    {
      name: "Sales", widths: [18, 12, 22, 14, 14, 14, 14, 10, 10],
      rows: [["Invoice", "Date", "Category", "Revenue", "Planned cost", "Actual cost", "Profit", "Margin %", "Cost basis"],
        ...r.sales.map((s) => [s.number, s.date, s.category, Math.round(s.revenue), Math.round(s.planned), Math.round(s.actual), Math.round(s.profit), s.margin, s.basis])],
    },
    {
      name: "Spending", widths: [28, 12, 16, 16],
      rows: [["Expense category", "Type", "Amount", "Linked to a sale/project"], ...r.spendByCategory.map((x) => [x.name, x.scope, Math.round(x.amount), Math.round(x.linked)])],
    },
  ]);

  const print = () => {
    const t = (rows: string[][], head: string[]) => `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((x) => `<tr>${x.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    printElementHTML(
      `<div class="small">INTERNAL — ye report client ko na dein.</div>` +
      t([["Revenue", rs(r.revenue)], ["Direct cost", rs(r.directCost)], ["Gross profit", `${rs(r.grossProfit)} (${r.grossMargin}%)`], ["Overhead", rs(r.overhead)], ["Net after overhead", `${rs(r.netAfterOverhead)} (${r.netMargin}%)`]], ["", ""]) +
      `<h3>Category-wise</h3>` + t(r.categories.map((c) => [c.category, rs(c.revenue), rs(c.cost), rs(c.profit), `${c.margin}%`, String(c.sales)]), ["Category", "Revenue", "Cost", "Profit", "Margin", "Sales"]) +
      `<h3>Kharcha kahan hua</h3>` + t(r.spendByCategory.map((x) => [x.name, x.scope, rs(x.amount)]), ["Category", "Type", "Amount"]) +
      `<h3>AI notes</h3><ul>${notes.map((n) => `<li>${n.text}</li>`).join("")}</ul>`,
      { title: "Profit & Margin Report", subtitle: `${range.from} → ${range.to}`, filename: `Profit_Margin_${range.from}_${range.to}` });
  };

  return (
    <section className="card marginReport">
      <div className="sectionHead">
        <div>
          <h2 style={{ margin: 0 }}>Profit &amp; Margin (category-wise)</h2>
          <div className="small">🔒 Internal — invoice par kahin nahi aata. {range.from} → {range.to} • closed months bhi shamil</div>
        </div>
        <div className="segmented">
          {([["month", "Is mahina"], ["last", "Pichla mahina"], ["3m", "3 mahine"], ["year", "Saal"], ["custom", "Custom"]] as [Preset, string][]).map(([k, l]) => (
            <button key={k} className={preset === k ? "on" : ""} onClick={() => setPreset(k)}>{l}</button>
          ))}
        </div>
      </div>
      {preset === "custom" && <div className="grid2"><div><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div><div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div></div>}

      <div className="moneyStrip" style={{ marginTop: 10 }}>
        <div><span>Sales (revenue)</span><b>{rs(r.revenue)}</b><em>{r.sales.length} invoices</em></div>
        <div><span>Direct cost</span><b>{rs(r.directCost)}</b><em>sale se juda kharcha</em></div>
        <div><span>Gross profit</span><b className={r.grossProfit < 0 ? "neg" : "pos"}>{rs(r.grossProfit)}</b><em>margin {r.grossMargin}%{r.missingCost ? " (adhoora — cost baaqi)" : ""}</em></div>
        <div><span>Overhead</span><b>{rs(r.overhead)}</b><em>rent, salary, general</em></div>
        <div><span>Net after overhead</span><b className={r.netAfterOverhead < 0 ? "neg" : "pos"}>{rs(r.netAfterOverhead)}</b><em>{r.netMargin}%</em></div>
        <div><span>Cash (Accounting)</span><b>{rs(r.cash.income)}</b><em>aaya • gaya {rs(r.cash.businessExpense + r.cash.personalExpense)} • bacha {rs(r.cash.netSaving)}</em></div>
      </div>

      <h3 className="growthH">🤖 AI notes (sirf aap ke records se)</h3>
      <ul className="marginNotes">{notes.map((n, i) => <li key={i} className={n.level}>{n.text}</li>)}</ul>

      <h3 className="growthH">Category-wise</h3>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Category</th><th className="num">Revenue</th><th className="num">Cost</th><th className="num">Profit</th><th>Margin</th><th className="num">Sales</th><th className="num">Received</th></tr></thead>
          <tbody>
            {r.categories.map((c) => (
              <React.Fragment key={c.category}>
                <tr onClick={() => setOpen(open === c.category ? "" : c.category)} style={{ cursor: "pointer" }}>
                  <td><b>{open === c.category ? "▾" : "▸"} {c.category}</b>{c.missing > 0 && <span className="badge warn" style={{ marginLeft: 6 }}>{c.missing} cost baaqi</span>}</td>
                  <td className="num">{rs(c.revenue)}</td><td className="num">{rs(c.cost)}</td>
                  <td className={`num ${c.profit < 0 ? "neg" : ""}`}><b>{rs(c.profit)}</b></td>
                  <td><span className={`badge ${c.missing ? "warn" : badge(c.margin)}`} title={c.missing ? "Kuch sales ki cost nahi likhi — margin adhoora" : ""}>{c.missing ? `${c.margin}%?` : `${c.margin}%`}</span></td>
                  <td className="num">{c.sales}</td><td className="num">{rs(c.received)}</td>
                </tr>
                {open === c.category && c.lines.map((l) => (
                  <tr key={l.line} className="marginSub">
                    <td>&nbsp;&nbsp;↳ {l.line}</td><td className="num">{rs(l.revenue)}</td><td className="num">{rs(l.cost)}</td>
                    <td className="num">{rs(l.revenue - l.cost)}</td><td><span className={`badge ${badge(l.revenue > 0 ? ((l.revenue - l.cost) / l.revenue) * 100 : 0)}`}>{l.revenue > 0 ? Math.round(((l.revenue - l.cost) / l.revenue) * 1000) / 10 : 0}%</span></td><td className="num">{Math.round(l.units)} unit</td><td />
                  </tr>
                ))}
              </React.Fragment>
            ))}
            {r.categories.length === 0 && <tr><td colSpan={7} className="small">Is muddat mein koi sale nahi.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="grid2" style={{ marginTop: 10 }}>
        <div>
          <h3 className="growthH">Kharcha kahan hua</h3>
          {r.spendByCategory.length ? r.spendByCategory.slice(0, 12).map((x) => (
            <div key={x.scope + x.name} className="lpRow"><span>{x.name} <em className="small">({x.scope === "personal" ? "personal" : "business"}{x.linked ? `, ${rs(x.linked)} sale se juda` : ""})</em></span><b>{rs(x.amount)}</b></div>
          )) : <div className="small">—</div>}
        </div>
        <div>
          <h3 className="growthH">Har sale ka margin</h3>
          <div className="tablewrap" style={{ maxHeight: 260 }}>
            <table>
              <thead><tr><th>Invoice</th><th className="num">Profit</th><th>Margin</th></tr></thead>
              <tbody>
                {r.sales.slice(0, 40).map((s) => (
                  <tr key={s.id}>
                    <td>{s.number}<div className="small">{s.date} • {s.category}{s.basis === "missing" ? " • cost baaqi" : ""}</div></td>
                    <td className={`num ${s.profit < 0 ? "neg" : ""}`}>{rs(s.profit)}</td>
                    <td><span className={`badge ${s.basis === "missing" ? "warn" : badge(s.margin)}`}>{s.basis === "missing" ? "?" : `${s.margin}%`}</span></td>
                  </tr>
                ))}
                {r.sales.length === 0 && <tr><td colSpan={3} className="small">—</td></tr>}
              </tbody>
            </table>
          </div>
          {r.missingCost > 0 && <button className="linkBtn small" onClick={() => navigate({ tab: "invoices" })}>Cost baaqi wali invoices kholein →</button>}
        </div>
      </div>
      <div className="rowActions" style={{ marginTop: 10 }}>
        <button className="btnSmall" onClick={excel}>Excel</button>
        <button className="btnSmall" onClick={print}>PDF / Print</button>
      </div>
    </section>
  );
}
