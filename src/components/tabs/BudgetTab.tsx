import React, { useState, useRef } from "react";
import { useData } from "@/contexts/DataContext";
import { fmtMoney } from "@/lib/db";
import { saveReportImage, printElementHTML } from "@/lib/exportUtils";
import GrowthAnalysis from "@/components/GrowthAnalysis";
import TargetPlanner from "@/components/TargetPlanner";
import { expenseCategoriesOf, inRange, isExpense, summarize } from "@/lib/finance";

export default function BudgetTab() {
  const { data, addItem, updateItem } = useData();
  const [cat, setCat] = useState("Ads Run");
  const [limit, setLimit] = useState("");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  // Shared money rules (src/lib/finance.ts): same numbers as the Dashboard.
  const monthRows = inRange(data.accounting, monthStart, monthEnd);
  const monthSum = summarize(monthRows, data.settings);
  const monthIncome = monthSum.income;
  const monthExpense = monthSum.totalExpense;
  const catSpend: Record<string, number> = {};
  monthRows.filter(isExpense).forEach((a: any) => {
    catSpend[a.category || "Other"] = (catSpend[a.category || "Other"] || 0) + (Number(a.amount) || 0);
  });
  const savings = monthIncome - monthExpense;
  const savingsTarget = Math.round(monthIncome * 0.5);
  const savingsPct = monthIncome > 0 ? Math.round((savings / monthIncome) * 100) : 0;

  const categories = expenseCategoriesOf(data.settings).map((c) => c.name);

  // Intelligent budget suggestions based on income
  const suggestedBudgets: Record<string, number> = {};
  if (monthIncome > 0) {
    // Business expense categories (limited allocation)
    suggestedBudgets["Ads Run"] = Math.round(monthIncome * 0.15);
    suggestedBudgets["Local Business Ads"] = Math.round(monthIncome * 0.08);
    suggestedBudgets["Monthly Management"] = Math.round(monthIncome * 0.05);
    suggestedBudgets["Design Service"] = Math.round(monthIncome * 0.05);
    suggestedBudgets["Video Editing"] = Math.round(monthIncome * 0.05);
    suggestedBudgets["Office Expense"] = Math.round(monthIncome * 0.05);
    suggestedBudgets["Personal Expense"] = Math.round(monthIncome * 0.08);
    suggestedBudgets["Meal / Dinner"] = Math.round(monthIncome * 0.04);
    suggestedBudgets["Travel"] = Math.round(monthIncome * 0.03);
    suggestedBudgets["Team Payout"] = Math.round(monthIncome * 0.25);
    suggestedBudgets["Other"] = Math.round(monthIncome * 0.05);
  }

  const handleSetBudget = async () => {
    const lim = +limit || 0;
    if (lim <= 0) { alert("Budget limit required"); return; }
    const existing = data.budgets.find((b: any) => b.category === cat);
    if (existing) {
      await updateItem("budgets", { ...existing, limit: lim });
    } else {
      await addItem("budgets", { id: cat, category: cat, limit: lim });
    }
    setLimit("");
  };

  const applySuggested = async (category: string, amount: number) => {
    const existing = data.budgets.find((b: any) => b.category === category);
    if (existing) {
      await updateItem("budgets", { ...existing, limit: amount });
    } else {
      await addItem("budgets", { id: category, category, limit: amount });
    }
  };

  const applyAllSuggested = async () => {
    for (const [category, amount] of Object.entries(suggestedBudgets)) {
      if (amount > 0) {
        const existing = data.budgets.find((b: any) => b.category === category);
        if (existing) {
          await updateItem("budgets", { ...existing, limit: amount });
        } else {
          await addItem("budgets", { id: category, category, limit: amount });
        }
      }
    }
    alert("All suggested budgets applied ✅");
  };

  // Budget alerts
  const alerts: { type: string; msg: string }[] = [];
  (data.budgets || []).forEach((b: any) => {
    const spent = catSpend[b.category] || 0;
    if (spent > b.limit) alerts.push({ type: "bad", msg: `⚠️ ${b.category}: Over budget! Rs ${fmtMoney(spent)} / Rs ${fmtMoney(b.limit)}` });
    else if (spent >= b.limit * 0.8) alerts.push({ type: "warn", msg: `⚡ ${b.category}: Near limit! Rs ${fmtMoney(spent)} / Rs ${fmtMoney(b.limit)}` });
  });
  if (!alerts.length && savings < savingsTarget && monthIncome > 0) {
    alerts.push({ type: "warn", msg: "⚠️ Savings below 50% target. Reduce expenses!" });
  }

  // All categories that have spending or budgets
  const allCats = new Set<string>();
  Object.keys(catSpend).forEach(c => allCats.add(c));
  (data.budgets || []).forEach((b: any) => allCats.add(b.category));

  // Savings history (last 6 months)
  const savingsHistory = [];
  for (let i = 0; i < 6; i++) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mStart = m.toISOString().slice(0, 10);
    const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0).toISOString().slice(0, 10);
    // Same income rule as everywhere else (previously only "Invoice Paid" counted here).
    const mSum = summarize(inRange(data.accounting, mStart, mEnd), data.settings);
    const mIncome = mSum.income, mExpense = mSum.totalExpense;
    const mSavings = mIncome - mExpense;
    const mTarget = Math.round(mIncome * 0.5);
    const mPct = mIncome > 0 ? Math.round((mSavings / mIncome) * 100) : 0;
    savingsHistory.push({
      label: m.toLocaleString(undefined, { month: "long", year: "numeric" }),
      income: mIncome, expense: mExpense, savings: mSavings, pct: mPct, met: mSavings >= mTarget,
    });
  }

  const sectionRef = useRef<HTMLDivElement>(null);

  const buildBudgetHTML = () => {
    let catRows = "";
    Array.from(allCats).forEach(c => {
      const b = data.budgets.find((x: any) => x.category === c);
      const budgetLimit = b?.limit || 0;
      const spent = catSpend[c] || 0;
      const remaining = budgetLimit - spent;
      const pct = budgetLimit > 0 ? Math.round((spent / budgetLimit) * 100) : 0;
      const st = pct > 100 ? "Over Budget" : pct >= 80 ? "Warning" : "OK";
      catRows += `<tr><td><b>${c}</b></td><td>${budgetLimit > 0 ? "Rs "+fmtMoney(budgetLimit) : "—"}</td><td>Rs ${fmtMoney(spent)}</td><td>${budgetLimit > 0 ? "Rs "+fmtMoney(remaining) : "—"}</td><td>${budgetLimit > 0 ? pct+"%" : "—"}</td><td>${st}</td></tr>`;
    });
    let savRows = "";
    savingsHistory.forEach(m => {
      savRows += `<tr><td>${m.label}</td><td>Rs ${fmtMoney(m.income)}</td><td>Rs ${fmtMoney(m.expense)}</td><td>Rs ${fmtMoney(m.savings)}</td><td>${m.pct}%</td><td>${m.met ? "✅ Yes" : "❌ No"}</td></tr>`;
    });
    const html = `
      <div style="padding:20px">
        <div style="display:flex;gap:16px;margin-bottom:16px">
          <div class="card" style="flex:1;text-align:center"><div style="font-size:12px;color:#888">Monthly Income</div><div style="font-size:20px;font-weight:900">Rs ${fmtMoney(monthIncome)}</div></div>
          <div class="card" style="flex:1;text-align:center"><div style="font-size:12px;color:#888">Monthly Expense</div><div style="font-size:20px;font-weight:900">Rs ${fmtMoney(monthExpense)}</div></div>
          <div class="card" style="flex:1;text-align:center"><div style="font-size:12px;color:#888">Savings (${savingsPct}%)</div><div style="font-size:20px;font-weight:900">Rs ${fmtMoney(savings)}</div></div>
        </div>
        <h3>Category-wise Spending</h3>
        <table><thead><tr><th>Category</th><th>Budget</th><th>Spent</th><th>Remaining</th><th>% Used</th><th>Status</th></tr></thead><tbody>${catRows}</tbody></table>
        <h3 style="margin-top:20px">Monthly Savings History</h3>
        <table><thead><tr><th>Month</th><th>Income</th><th>Expense</th><th>Savings</th><th>Savings %</th><th>Target Met</th></tr></thead><tbody>${savRows}</tbody></table>
      </div>`;
    return html;
  };
  const budgetReport = { title: "Budget & Savings Report", filename: `Budget_Report_${new Date().toISOString().slice(0, 10)}` };
  const exportBudgetPDF = () => printElementHTML(buildBudgetHTML(), budgetReport);
  const exportBudgetImage = (fmt: "png"|"jpg") => saveReportImage(buildBudgetHTML(), fmt, budgetReport);

  return (
    <>
    <TargetPlanner />
      <GrowthAnalysis />
    <section className="card" ref={sectionRef}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>Budget &amp; Savings</h2>
          <div className="small">Set monthly budgets per expense category. Get alerts when spending exceeds limits. Track savings goals.</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btnSmall" onClick={exportBudgetPDF}>PDF</button>
          <button className="btnSmall" onClick={() => exportBudgetImage("png")}>PNG</button>
          <button className="btnSmall" onClick={() => exportBudgetImage("jpg")}>JPG</button>
        </div>
      </div>

      <div className="grid3" style={{ marginTop: 10 }}>
        <div className="kpi"><div className="t">Monthly Income</div><div className="v">Rs {fmtMoney(monthIncome)}</div></div>
        <div className="kpi"><div className="t">Monthly Expense</div><div className="v">Rs {fmtMoney(monthExpense)}</div></div>
        <div className="kpi"><div className="t">Monthly Savings</div><div className="v">Rs {fmtMoney(savings)}</div></div>
      </div>
      <div className="grid3" style={{ marginTop: 10 }}>
        <div className="kpi"><div className="t">Savings Target (50%)</div><div className="v">Rs {fmtMoney(savingsTarget)}</div></div>
        <div className="kpi"><div className="t">Savings %</div><div className="v">{savingsPct}%</div></div>
        <div className="kpi"><div className="t">Status</div><div className="v">{savings >= savingsTarget ? "On track" : "Below target"}</div></div>
      </div>

      <hr />
      <h2 style={{ marginTop: 0 }}>Set Category Budgets</h2>
      <div className="grid3">
        <div><label>Category</label>
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div><label>Monthly Budget Limit</label><input type="number" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={suggestedBudgets[cat] ? `Suggested: Rs ${fmtMoney(suggestedBudgets[cat])}` : "e.g. 10000"} /></div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <button className="btnSolid" onClick={handleSetBudget}>Set Budget</button>
          {suggestedBudgets[cat] > 0 && (
            <button className="btnSmall" onClick={() => applySuggested(cat, suggestedBudgets[cat])}>Use Suggested</button>
          )}
        </div>
      </div>

      {/* Intelligent Budget Suggestions */}
      {monthIncome > 0 && (
        <>
          <hr />
          <h2 style={{ marginTop: 0 }}>Suggested Budgets</h2>
          <div className="small" style={{ marginBottom: 10 }}>Based on your monthly income of Rs {fmtMoney(monthIncome)}, here are recommended budget allocations (50% savings rule):</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <button className="btnSolid" onClick={applyAllSuggested}>Apply All Suggestions</button>
          </div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Category</th><th>Suggested Budget</th><th>% of Income</th><th>Current Budget</th><th>Spent</th><th>Action</th></tr></thead>
              <tbody>
                {categories.map(c => {
                  const suggested = suggestedBudgets[c] || 0;
                  const pct = monthIncome > 0 ? Math.round((suggested / monthIncome) * 100) : 0;
                  const current = data.budgets.find((b: any) => b.category === c);
                  const spent = catSpend[c] || 0;
                  return (
                    <tr key={c}>
                      <td><b>{c}</b></td>
                      <td>Rs {fmtMoney(suggested)}</td>
                      <td>{pct}%</td>
                      <td>{current ? `Rs ${fmtMoney(current.limit)}` : "—"}</td>
                      <td>Rs {fmtMoney(spent)}</td>
                      <td className="rowActions">
                        <button className="btnSmall" onClick={() => applySuggested(c, suggested)}>Apply</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <hr />
      <h2 style={{ marginTop: 0 }}>Category-wise Spending (This Month)</h2>
      {alerts.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {alerts.map((a, i) => (
            <span key={i} className={`badge ${a.type}`} style={{ margin: 4 }}>{a.msg}</span>
          ))}
        </div>
      )}
      <div className="tablewrap">
        <table>
          <thead><tr><th>Category</th><th>Budget</th><th>Spent</th><th>Remaining</th><th>% Used</th><th>Status</th></tr></thead>
          <tbody>
            {Array.from(allCats).map((c) => {
              const b = data.budgets.find((x: any) => x.category === c);
              const budgetLimit = b?.limit || 0;
              const spent = catSpend[c] || 0;
              const remaining = budgetLimit - spent;
              const pct = budgetLimit > 0 ? Math.round((spent / budgetLimit) * 100) : 0;
              const stClass = pct > 100 ? "bad" : pct >= 80 ? "warn" : "ok";
              return (
                <tr key={c}>
                  <td><b>{c}</b></td>
                  <td>{budgetLimit > 0 ? `Rs ${fmtMoney(budgetLimit)}` : "—"}</td>
                  <td>Rs {fmtMoney(spent)}</td>
                  <td>{budgetLimit > 0 ? `Rs ${fmtMoney(remaining)}` : "—"}</td>
                  <td>{budgetLimit > 0 ? `${pct}%` : "—"}</td>
                  <td><span className={`badge ${stClass}`}>{pct > 100 ? "Over Budget" : pct >= 80 ? "Warning" : "OK"}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <hr />
      <h2 style={{ marginTop: 0 }}>Monthly Savings History</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Month</th><th>Income</th><th>Expense</th><th>Savings</th><th>Savings %</th><th>Target Met</th></tr></thead>
          <tbody>
            {savingsHistory.map((m, i) => (
              <tr key={i}>
                <td>{m.label}</td>
                <td>Rs {fmtMoney(m.income)}</td>
                <td>Rs {fmtMoney(m.expense)}</td>
                <td>Rs {fmtMoney(m.savings)}</td>
                <td>{m.pct}%</td>
                <td><span className={`badge ${m.met ? "ok" : "bad"}`}>{m.met ? "✅ Yes" : "❌ No"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  </>
  );
}
