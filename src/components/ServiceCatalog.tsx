import React, { useMemo, useState } from "react";
import { useData } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  CatalogService, DEFAULT_SERVICES, DURATIONS, PricingModel, categoriesOf, linesOfCategory, monthlyValue, servicesOf,
} from "@/lib/catalog";
import { fmtMoney, uid } from "@/lib/db";

const PRICING: { id: PricingModel; label: string }[] = [
  { id: "one_time", label: "One-time" },
  { id: "recurring", label: "Recurring (package)" },
  { id: "setup_plus_monthly", label: "Setup + Monthly" },
  { id: "daily", label: "Per day" },
];

/**
 * Settings → Services & Categories. The single catalog used by invoices, leads,
 * chat capture, targets and the AI analysis. Rates are defaults the admin
 * edits here — nothing else in the app hard-codes a price.
 */
export default function ServiceCatalog() {
  const { data, updateSettings } = useData();
  const { can } = useAuth();
  const [rows, setRows] = useState<CatalogService[]>(() => servicesOf(data.settings).map((s) => ({ ...s })));
  const [dirty, setDirty] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("ALL");
  const [msg, setMsg] = useState("");
  const categories = useMemo(() => categoriesOf({ services: rows }), [rows]);
  if (!can("settings.manage")) return null;

  const set = (id: string, patch: Partial<CatalogService>) => { setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r))); setDirty(true); };
  const save = async () => {
    const clean = rows
      .filter((r) => r.name.trim())
      .map((r) => ({
        ...r,
        name: r.name.trim(),
        rate: Number(r.rate) || 0,
        costPrice: r.costPrice === undefined || r.costPrice === null || String(r.costPrice) === "" ? undefined : Math.max(0, Number(r.costPrice) || 0),
        setupFee: r.pricing === "setup_plus_monthly" ? Number(r.setupFee) || 0 : undefined,
        active: r.active !== false,
      }));
    try {
      await updateSettings({ ...data.settings, services: clean });
      setRows(clean); setDirty(false); setMsg("✓ Save ho gaya");
    } catch (e) { setMsg("Save nahi hua: " + (e as Error).message); }
  };
  /** Adds default services the admin does not have yet; never overwrites their edits. */
  const mergeDefaults = () => {
    const have = new Set(rows.map((r) => r.id));
    const missing = DEFAULT_SERVICES.filter((s) => !have.has(s.id));
    setRows([...rows, ...missing.map((s) => ({ ...s }))]);
    setDirty(true);
    setMsg(missing.length ? `${missing.length} default services add hui — Save dabayein` : "Sab default services pehle se hain");
  };
  const addService = () => {
    const category = cat !== "ALL" ? cat : "Digital Marketing";
    const line = linesOfCategory({ services: rows }, category)[0] || "Other";
    const s: CatalogService = { id: uid("S"), name: "", category, line, rate: 0, unit: "project", pricing: "one_time", duration: "none", active: true };
    setRows([s, ...rows]); setDirty(true);
  };

  const shown = rows.filter((r) => (cat === "ALL" || (r.category || "Other") === cat) && (!q || `${r.name} ${r.line} ${r.packageName || ""}`.toLowerCase().includes(q.toLowerCase())));
  const groups = categories.filter((c) => shown.some((r) => (r.category || "Other") === c));

  return (
    <section className="card" style={{ marginTop: 14 }}>
      <div className="sectionHead">
        <div>
          <h2 style={{ margin: 0 }}>Services, Packages &amp; Rates</h2>
          <div className="small">Category → service line → service. Invoice, leads, targets aur AI analysis sab isi list se chalte hain. Inactive service naye invoice mein nahi aati lekin purane invoices mein rehti hai.</div>
        </div>
        <div className="rowActions">
          <button className="btnSmall" onClick={mergeDefaults}>+ Default services</button>
          <button className="btnSmall" onClick={addService}>+ Add service</button>
          <button className="btnSolid" onClick={save} disabled={!dirty}>Save</button>
        </div>
      </div>
      <div className="catalogBar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Service dhoondein…" />
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="ALL">Sab categories</option>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        {msg && <span className="small">{msg}</span>}
      </div>

      {groups.map((g) => (
        <div key={g} className="catalogGroup">
          <h3>{g} <span className="small">({shown.filter((r) => (r.category || "Other") === g).length})</span></h3>
          <div className="tablewrap">
            <table className="catalogTable">
              <thead>
                <tr><th>Service</th><th>Line</th><th>Pricing</th><th className="num">Rate (Rs)</th><th>Unit</th><th>Default period</th><th>Package</th><th>Active</th><th /></tr>
              </thead>
              <tbody>
                {shown.filter((r) => (r.category || "Other") === g).map((r) => (
                  <tr key={r.id} className={r.active === false ? "inactive" : ""}>
                    <td>
                      <input value={r.name} onChange={(e) => set(r.id, { name: e.target.value })} placeholder="Service name" />
                      <select value={r.category || "Other"} onChange={(e) => set(r.id, { category: e.target.value, line: linesOfCategory({ services: rows }, e.target.value)[0] || r.line })} aria-label="Category" className="catSel">
                        {categories.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={r.line} onChange={(e) => set(r.id, { line: e.target.value })}>
                        {Array.from(new Set([...linesOfCategory({ services: rows }, r.category || "Other"), r.line])).map((l) => <option key={l}>{l}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={r.pricing || "one_time"} onChange={(e) => set(r.id, { pricing: e.target.value as PricingModel })}>
                        {PRICING.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                      {r.pricing === "setup_plus_monthly" && (
                        <label className="small setupFee">Setup fee
                          <input type="number" min="0" value={r.setupFee ?? 0} onChange={(e) => set(r.id, { setupFee: +e.target.value })} />
                        </label>
                      )}
                    </td>
                    <td className="num">
                      <input type="number" min="0" value={r.rate} onChange={(e) => set(r.id, { rate: +e.target.value })} style={{ textAlign: "right" }} />
                      {monthlyValue(r) > 0 && <div className="small">≈ Rs {fmtMoney(monthlyValue(r))}/mo</div>}
                      <label className="small setupFee" title="Internal — invoice par nahi chhapta">Cost / unit 🔒
                        <input type="number" min="0" value={r.costPrice ?? ""} placeholder="—" onChange={(e) => set(r.id, { costPrice: e.target.value === "" ? undefined : Math.max(0, +e.target.value) })} />
                      </label>
                      {r.costPrice !== undefined && r.rate > 0 && <div className="small">margin {Math.round(((r.rate - r.costPrice) / r.rate) * 100)}%</div>}
                    </td>
                    <td><input value={r.unit || ""} onChange={(e) => set(r.id, { unit: e.target.value })} placeholder="day / month / project" /></td>
                    <td>
                      <select value={r.duration || "none"} onChange={(e) => set(r.id, { duration: e.target.value as CatalogService["duration"] })}>
                        {DURATIONS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                      </select>
                    </td>
                    <td><input value={r.packageName || ""} onChange={(e) => set(r.id, { packageName: e.target.value })} placeholder="e.g. Monthly Ads Package" /></td>
                    <td><input type="checkbox" checked={r.active !== false} onChange={(e) => set(r.id, { active: e.target.checked })} aria-label="Active" /></td>
                    <td><button className="iconBtn" onClick={() => { if (confirm("Ye service list se hata dein? (Behtar hai Inactive kar dein — purane invoices par asar nahi hota)")) { setRows(rows.filter((x) => x.id !== r.id)); setDirty(true); } }} aria-label="Remove service">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
