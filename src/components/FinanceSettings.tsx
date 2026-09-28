import React, { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES, ExpenseCategory, expenseCategoriesOf, incomeCategoriesOf } from "@/lib/finance";
import { PAYMENT_METHODS } from "@/lib/invoice";

/**
 * Settings → Finance: expense categories (business / personal / marketing),
 * income categories, payment methods and the default tax rate. Accounting,
 * Budget, Dashboard, reports and monthly closing all read these.
 */
export default function FinanceSettings() {
  const { data, updateSettings } = useData();
  const { can } = useAuth();
  const [cats, setCats] = useState<ExpenseCategory[]>(() => expenseCategoriesOf(data.settings));
  const [income, setIncome] = useState<string>(() => incomeCategoriesOf(data.settings).join("\n"));
  const [methods, setMethods] = useState<string>(() => (Array.isArray(data.settings?.paymentMethods) ? data.settings.paymentMethods : PAYMENT_METHODS).join("\n"));
  const [tax, setTax] = useState<number>(Number(data.settings?.defaultTaxRate) || 0);
  const [renewDays, setRenewDays] = useState<number>(Number(data.settings?.renewalReminderDays) || 7);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  if (!can("settings.manage")) return null;

  const touch = () => { setDirty(true); setMsg(""); };
  const setCat = (i: number, patch: Partial<ExpenseCategory>) => { setCats(cats.map((c, j) => (j === i ? { ...c, ...patch } : c))); touch(); };
  const lines = (t: string) => Array.from(new Set(t.split("\n").map((x) => x.trim()).filter(Boolean)));
  const save = async () => {
    try {
      await updateSettings({
        ...data.settings,
        expenseCategories: cats.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), scope: c.scope, marketing: !!c.marketing })),
        incomeCategories: lines(income),
        paymentMethods: lines(methods),
        defaultTaxRate: Math.max(0, Number(tax) || 0),
        renewalReminderDays: Math.max(1, Number(renewDays) || 7),
      });
      setDirty(false); setMsg("✓ Save ho gaya");
    } catch (e) { setMsg("Save nahi hua: " + (e as Error).message); }
  };

  return (
    <section className="card" style={{ marginTop: 14 }}>
      <div className="sectionHead">
        <div>
          <h2 style={{ margin: 0 }}>Finance settings</h2>
          <div className="small">Business aur personal kharche alag — Net Saving = Income − Business − Personal. Accounting, Budget, Dashboard, Reports aur Monthly Closing yahi list use karte hain.</div>
        </div>
        <div className="rowActions">
          <button className="btnSmall" onClick={() => { setCats(DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c }))); setIncome(DEFAULT_INCOME_CATEGORIES.join("\n")); touch(); }}>Defaults</button>
          <button className="btnSolid" onClick={save} disabled={!dirty}>Save</button>
        </div>
      </div>
      {msg && <div className="small">{msg}</div>}
      <div className="grid2" style={{ marginTop: 10, alignItems: "start" }}>
        <div>
          <label>Expense categories</label>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Category</th><th>Type</th><th>Marketing spend</th><th /></tr></thead>
              <tbody>
                {cats.map((c, i) => (
                  <tr key={i}>
                    <td><input value={c.name} onChange={(e) => setCat(i, { name: e.target.value })} /></td>
                    <td>
                      <select value={c.scope} onChange={(e) => setCat(i, { scope: e.target.value as ExpenseCategory["scope"] })}>
                        <option value="business">Business</option>
                        <option value="personal">Personal / Misc</option>
                      </select>
                    </td>
                    <td><input type="checkbox" checked={!!c.marketing} onChange={(e) => setCat(i, { marketing: e.target.checked })} aria-label="Marketing spend" /></td>
                    <td><button className="iconBtn" onClick={() => { setCats(cats.filter((_, j) => j !== i)); touch(); }} aria-label="Remove">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btnSmall" style={{ marginTop: 6 }} onClick={() => { setCats([...cats, { name: "", scope: "business" }]); touch(); }}>+ Category</button>
        </div>
        <div>
          <label>Income categories (har line ek)</label>
          <textarea rows={7} value={income} onChange={(e) => { setIncome(e.target.value); touch(); }} />
          <label>Payment methods (har line ek)</label>
          <textarea rows={5} value={methods} onChange={(e) => { setMethods(e.target.value); touch(); }} />
          <div className="grid2">
            <div><label>Default tax %</label><input type="number" min="0" value={tax} onChange={(e) => { setTax(+e.target.value); touch(); }} /></div>
            <div><label>Renewal reminder (din pehle)</label><input type="number" min="1" value={renewDays} onChange={(e) => { setRenewDays(+e.target.value); touch(); }} /></div>
          </div>
        </div>
      </div>
    </section>
  );
}
