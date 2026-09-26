import React, { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { CatalogService, DEFAULT_SERVICES, SERVICE_LINES, servicesOf } from "@/lib/catalog";
import { uid } from "@/lib/db";

/** Settings → Services & Categories (used by invoices, leads and chat capture). */
export default function ServiceCatalog() {
  const { data, updateSettings } = useData();
  const { can } = useAuth();
  const [rows, setRows] = useState<CatalogService[]>(() => servicesOf(data.settings).map((s) => ({ ...s })));
  const [dirty, setDirty] = useState(false);
  if (!can("settings.manage")) return null;

  const set = (i: number, patch: Partial<CatalogService>) => { setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))); setDirty(true); };
  const save = async () => {
    const clean = rows.filter((r) => r.name.trim()).map((r) => ({ ...r, name: r.name.trim(), rate: Number(r.rate) || 0 }));
    await updateSettings({ ...data.settings, services: clean });
    setRows(clean); setDirty(false);
  };

  return (
    <section className="card" style={{ marginTop: 14 }}>
      <div className="sectionHead">
        <div>
          <h2 style={{ margin: 0 }}>Services &amp; Categories</h2>
          <div className="small">Aap ki services aur un ke default rates — invoice banate waqt aur leads ki category mein yahi list aati hai.</div>
        </div>
        <div className="rowActions">
          <button className="btnSmall" onClick={() => { setRows(DEFAULT_SERVICES.map((s) => ({ ...s }))); setDirty(true); }}>Default list</button>
          <button className="btnSmall" onClick={() => { setRows([...rows, { id: uid("S"), name: "", line: "Digital Marketing", rate: 0, unit: "project" }]); setDirty(true); }}>+ Add service</button>
          <button className="btnSolid" onClick={save} disabled={!dirty}>Save</button>
        </div>
      </div>
      <div className="tablewrap" style={{ marginTop: 10 }}>
        <table>
          <thead><tr><th>Service</th><th>Category</th><th className="num">Default rate (Rs)</th><th>Unit</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td><input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Service name" /></td>
                <td>
                  <select value={r.line} onChange={(e) => set(i, { line: e.target.value })}>
                    {Array.from(new Set([...SERVICE_LINES, r.line])).map((l) => <option key={l}>{l}</option>)}
                  </select>
                </td>
                <td><input type="number" min="0" value={r.rate} onChange={(e) => set(i, { rate: +e.target.value })} style={{ textAlign: "right" }} /></td>
                <td><input value={r.unit || ""} onChange={(e) => set(i, { unit: e.target.value })} placeholder="month / project / post" /></td>
                <td><button className="iconBtn" onClick={() => { setRows(rows.filter((_, j) => j !== i)); setDirty(true); }} aria-label="Remove service">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
