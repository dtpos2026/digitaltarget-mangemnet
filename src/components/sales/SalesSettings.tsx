import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { RoleDoc, useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { effectivePermissions, roleLabel } from "@/lib/permissions";
import { SalesAssistant, SalesSettings as SS, salesSettingsOf } from "@/lib/salesPipeline";
import { BusinessUnit, DEFAULT_BUSINESSES } from "@/lib/business";
import { categoriesOf } from "@/lib/catalog";

/**
 * Sales team & lead assignment (CEO / admin): which logins are sales
 * assistants, how new WhatsApp leads are assigned (pool / round-robin /
 * manual), who else is notified, and real-time auto-capture on/off.
 */
export default function SalesSettings() {
  const { data, updateSettings } = useData();
  const { can, workspaceUid } = useAuth();
  const [users, setUsers] = useState<RoleDoc[]>([]);
  const [s, setS] = useState<SS>(() => salesSettingsOf(data.settings));
  const [msg, setMsg] = useState("");
  // Business units: the raw list (inactive ones too) so they can be switched back on.
  const unitsOf = () => (Array.isArray(data.settings?.businesses) && data.settings.businesses.length ? data.settings.businesses : DEFAULT_BUSINESSES) as BusinessUnit[];
  const [units, setUnits] = useState<BusinessUnit[]>(unitsOf);
  useEffect(() => { setS(salesSettingsOf(data.settings)); setUnits(unitsOf()); }, [data.settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const categories = categoriesOf(data.settings);
  const patchUnit = (i: number, p: Partial<BusinessUnit>) => setUnits(units.map((u, j) => (j === i ? { ...u, ...p } : u)));
  const addUnit = () => setUnits([...units, { id: `biz-${Date.now().toString(36)}`, name: "Naya business", icon: "🏢", color: "#0f766e", categories: [], active: true }]);
  // A category belongs to one business only.
  const toggleCategory = (i: number, cat: string, on: boolean) =>
    setUnits(units.map((u, j) => (j === i ? { ...u, categories: on ? [...new Set([...u.categories, cat])] : u.categories.filter((c) => c !== cat) } : { ...u, categories: on ? u.categories.filter((c) => c !== cat) : u.categories })));
  useEffect(() => {
    if (!workspaceUid || !can("users.manage")) return;
    getDocs(query(collection(db, "roles"), where("workspaceUid", "==", workspaceUid)))
      .then((snap) => setUsers(snap.docs.map((d) => d.data() as RoleDoc).filter((u) => !u.disabled)))
      .catch(() => {});
  }, [workspaceUid, can]);
  const teamName = (id?: string) => data.team.find((t: any) => t.id === id)?.name || "";
  const candidates = useMemo(() => users.filter((u) => u.teamId && effectivePermissions(u).has("leads.own")), [users]);
  if (!can("settings.manage")) return null;

  const isAssistant = (u: RoleDoc) => s.assistants.some((a) => a.teamId === u.teamId && a.active !== false);
  const toggleAssistant = (u: RoleDoc, on: boolean) => {
    const rest = s.assistants.filter((a) => a.teamId !== u.teamId);
    const entry: SalesAssistant = { teamId: u.teamId!, name: teamName(u.teamId) || u.displayName || u.email, uid: u.uid, active: true };
    setS({ ...s, assistants: on ? [...rest, entry] : rest });
  };
  const toggleNotify = (uid: string, on: boolean) => setS({ ...s, notifyUids: on ? [...new Set([...s.notifyUids, uid])] : s.notifyUids.filter((x) => x !== uid) });
  const toggleUnit = (teamId: string, unitId: string, on: boolean) => setS({
    ...s, assistants: s.assistants.map((a) => (a.teamId !== teamId ? a : { ...a, units: on ? [...new Set([...(a.units || []), unitId])] : (a.units || []).filter((x) => x !== unitId) })),
  });
  const save = async () => {
    if (units.some((u) => !u.name.trim())) { setMsg("Har business ka naam likhein"); return; }
    try { await updateSettings({ ...data.settings, sales: s, businesses: units.map((u) => ({ ...u, name: u.name.trim() })) }); setMsg("✓ Save ho gaya"); }
    catch (e) { setMsg("Save nahi hua: " + (e as Error).message); }
  };

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>🧲 Sales team &amp; WhatsApp lead assignment</h2>
      <div className="grid2">
        <label>Naye lead kaise assign hon
          <select value={s.mode} onChange={(e) => setS({ ...s, mode: e.target.value as SS["mode"] })}>
            <option value="pool">Pool — sab assistants ko notification, jo pehle TAKE LEAD kare</option>
            <option value="roundrobin">Round-robin — baari baari auto-assign</option>
            <option value="manual">Manual — CEO / admin assign kare</option>
          </select>
        </label>
        <label className="permItem" style={{ alignSelf: "end" }}>
          <input type="checkbox" checked={s.autoCapture} onChange={(e) => setS({ ...s, autoCapture: e.target.checked })} />
          <span>Naye WhatsApp message par lead khud banayein (extension, Fast mode)</span>
        </label>
      </div>

      <h3 className="growthH">Sales assistants</h3>
      {!can("users.manage") ? <div className="small">Users ki list ke liye "Users manage" permission chahiye.</div> : candidates.length === 0 ? (
        <div className="small">Koi sales assistant nahi. User Management mein user ko role <b>Sales Assistant</b> dein aur 🔗 se team member se link karein.</div>
      ) : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Assistant</th><th>Role</th><th>Team member</th><th>Leads milein</th><th>Business (khali = sab)</th></tr></thead>
            <tbody>
              {candidates.map((u) => {
                const a = s.assistants.find((x) => x.teamId === u.teamId);
                return (
                  <tr key={u.uid}>
                    <td><b>{u.displayName || u.email}</b><div className="small">{u.email}</div></td>
                    <td>{roleLabel(u.role)}</td>
                    <td>{teamName(u.teamId) || u.teamId}</td>
                    <td><input type="checkbox" checked={isAssistant(u)} onChange={(e) => toggleAssistant(u, e.target.checked)} aria-label={`Assistant ${u.email}`} /></td>
                    <td className="small">
                      {a ? units.filter((x) => x.active !== false).map((x) => (
                        <label key={x.id} className="permItem" style={{ display: "inline-flex", marginRight: 8 }}>
                          <input type="checkbox" checked={!!a.units?.includes(x.id)} onChange={(e) => toggleUnit(a.teamId, x.id, e.target.checked)} />
                          <span>{x.icon} {x.name}</span>
                        </label>
                      )) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="growthH">🏢 Businesses (Multi-business CRM)</h3>
      <div className="small">Har business ki apni products, leads, assistants aur numbers. Catalog ki category jis business mein ho, us ki leads usi business mein jati hain.</div>
      <div className="bizEditor">
        {units.map((u, i) => (
          <div key={u.id} className={`bizRow ${u.active === false ? "off" : ""}`}>
            <div className="bizHead">
              <input value={u.icon} onChange={(e) => patchUnit(i, { icon: e.target.value.slice(0, 4) })} aria-label="Icon" className="bizIcon" />
              <input value={u.name} onChange={(e) => patchUnit(i, { name: e.target.value })} aria-label="Business name" />
              <input type="color" value={u.color} onChange={(e) => patchUnit(i, { color: e.target.value })} aria-label="Color" />
              <label className="permItem"><input type="checkbox" checked={u.active !== false} onChange={(e) => patchUnit(i, { active: e.target.checked })} /><span>Active</span></label>
            </div>
            <div className="capLevels">
              {categories.map((c) => (
                <label key={c} className="permItem">
                  <input type="checkbox" checked={u.categories.includes(c)} onChange={(e) => toggleCategory(i, c, e.target.checked)} />
                  <span>{c}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
        <button className="btnSmall" onClick={addUnit}>+ Naya business</button>
      </div>

      <h3 className="growthH">Har naye lead ki notification (CEO / admin)</h3>
      <div className="capLevels">
        {users.filter((u) => !isAssistant(u) && effectivePermissions(u).has("leads.view")).map((u) => (
          <label key={u.uid} className="permItem">
            <input type="checkbox" checked={s.notifyUids.includes(u.uid)} onChange={(e) => toggleNotify(u.uid, e.target.checked)} />
            <span>{u.displayName || u.email}</span>
          </label>
        ))}
      </div>
      <div className="rowActions" style={{ marginTop: 10 }}>
        <button className="btnSolid" onClick={save}>Save</button>
        {msg && <span className="small">{msg}</span>}
      </div>
      <div className="small" style={{ marginTop: 6 }}>
        Assistant sirf apni leads aur pool (unassigned) dekhta hai; CEO / admin sab. TAKE LEAD par lead us assistant ki ho jati hai aur us chat ke liye AI replies / campaigns band ho jati hain.
      </div>
    </section>
  );
}
