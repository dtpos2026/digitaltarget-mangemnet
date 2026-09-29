import React, { useEffect, useMemo, useState } from "react";
import { useAuth, RoleDoc } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import LinkTeamModal from "@/components/LinkTeamModal";
import { db } from "@/lib/firebase";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import {
  effectivePermissions,
  isSuperRole,
  PERMISSIONS,
  presetFor,
  roleLabel,
  ROLE_OPTIONS,
} from "@/lib/permissions";

const GROUPS = Array.from(new Set(PERMISSIONS.map((p) => p.group)));

function PermissionGrid({
  value,
  onChange,
  grantable,
  disabled,
}: {
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  grantable: Set<string>;
  disabled?: boolean;
}) {
  const toggle = (key: string) => {
    const next = new Set(value);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(next);
  };
  return (
    <div className="permGrid">
      {GROUPS.map((g) => (
        <div key={g} className="permGroup">
          <div className="permGroupTitle">{g}</div>
          {PERMISSIONS.filter((p) => p.group === g).map((p) => {
            const locked = disabled || !grantable.has(p.key);
            return (
              <label key={p.key} className={`permItem ${locked ? "locked" : ""}`} title={locked && !disabled ? "Aap yeh permission khud nahi rakhte, is liye de nahi sakte" : p.key}>
                <input type="checkbox" checked={value.has(p.key)} disabled={locked} onChange={() => toggle(p.key)} />
                <span>{p.label}</span>
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function UserManagement() {
  const { createUserAccount, can, user, workspaceUid, isAdmin, perms } = useAuth();
  const { data, logAudit } = useData();
  const [users, setUsers] = useState<RoleDoc[]>([]);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState("sales_support");
  const [linkedTeamId, setLinkedTeamId] = useState("");
  const [newPerms, setNewPerms] = useState<Set<string>>(new Set(presetFor("sales_support")));
  const [showNewPerms, setShowNewPerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<RoleDoc | null>(null);
  const [editPerms, setEditPerms] = useState<Set<string>>(new Set());
  const [showDisabled, setShowDisabled] = useState(false);

  const canManage = can("users.manage");
  // Non-super admins can only hand out permissions they hold themselves (enforced by rules too).
  const grantable = perms;
  const roleChoices = ROLE_OPTIONS.filter((r) => isAdmin || !isSuperRole(r.value));

  const loadUsers = async () => {
    if (!workspaceUid) return;
    try {
      const snap = await getDocs(query(collection(db, "roles"), where("workspaceUid", "==", workspaceUid)));
      setUsers(snap.docs.map((d) => d.data() as RoleDoc).sort((a, b) => (a.email || "").localeCompare(b.email || "")));
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (canManage) loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, workspaceUid]);

  const visibleUsers = useMemo(() => users.filter((u) => showDisabled || !u.disabled), [users, showDisabled]);

  if (!canManage) return null;

  const onNewRole = (r: string) => {
    setNewRole(r);
    setNewPerms(new Set(presetFor(r).filter((p) => grantable.has(p))));
  };

  const handleCreate = async () => {
    if (!email.trim() || password.length < 8) { alert("Email aur kam az kam 8 characters ka password zaruri hai"); return; }
    if (newPerms.has("myportal.view") && !linkedTeamId) {
      if (!confirm("My Portal ke liye user ko Team record se link karna zaruri hai. Bina link ke continue?")) return;
    }
    setBusy(true);
    try {
      const newUid = await createUserAccount({
        email: email.trim(),
        password,
        role: newRole,
        teamId: linkedTeamId || undefined,
        permissions: isSuperRole(newRole) ? undefined : Array.from(newPerms),
        displayName: displayName.trim() || undefined,
      });
      logAudit({
        action: "user.create", collection: "roles", entityId: newUid, entityLabel: email.trim(),
        details: `Role ${newRole}; permissions: ${Array.from(newPerms).join(", ")}`,
      });
      alert(`${roleLabel(newRole)} account ban gaya ✅\n\nUser ko email aur password alag se share karein.`);
      setEmail(""); setPassword(""); setLinkedTeamId(""); setDisplayName("");
      await loadUsers();
    } catch (e) {
      alert("Error: " + ((e as Error).message || "Failed"));
    }
    setBusy(false);
  };

  const saveRoleDoc = async (next: RoleDoc, audit: { action: string; details: string }) => {
    try {
      await setDoc(doc(db, "roles", next.uid), { ...next, updatedAt: Date.now(), updatedBy: user?.uid });
      logAudit({ action: audit.action, collection: "roles", entityId: next.uid, entityLabel: next.email, details: audit.details });
      await loadUsers();
    } catch (e) {
      alert("Error: " + ((e as Error).message || e));
    }
  };

  const [linking, setLinking] = useState<RoleDoc | null>(null);
  const editable = (u: RoleDoc) => u.uid !== user?.uid && (isAdmin || !isSuperRole(u.role));

  const handleChangeRole = async (u: RoleDoc, role: string) => {
    if (!editable(u)) return;
    if (!confirm(`${u.email} ka role "${roleLabel(role)}" karein? Permissions us role ke default par reset ho jayengi.`)) return;
    const permissions = isSuperRole(role) ? undefined : presetFor(role).filter((p) => grantable.has(p));
    const next: RoleDoc = { ...u, role };
    if (permissions) next.permissions = permissions; else delete next.permissions;
    await saveRoleDoc(next, { action: "user.role", details: `${u.role} → ${role}` });
  };

  const handleLinkTeam = async (u: RoleDoc, teamId: string) => {
    const next: RoleDoc = { ...u };
    if (teamId) next.teamId = teamId; else delete next.teamId;
    await saveRoleDoc(next, { action: "user.link_team", details: `teamId ${u.teamId || "—"} → ${teamId || "—"}` });
  };

  const handleToggleDisabled = async (u: RoleDoc) => {
    if (!editable(u)) return;
    const disabling = !u.disabled;
    if (disabling && !confirm(`${u.email} ka access band karein? (Record aur history mehfooz rahegi, baad mein dobara enable ho sakta hai)`)) return;
    await saveRoleDoc({ ...u, disabled: disabling }, { action: disabling ? "user.disable" : "user.enable", details: "" });
  };

  const openPermissions = (u: RoleDoc) => {
    setEditing(u);
    setEditPerms(new Set(effectivePermissions({ ...u, disabled: false })));
  };

  const savePermissions = async () => {
    if (!editing) return;
    const before = effectivePermissions({ ...editing, disabled: false });
    const added = [...editPerms].filter((p) => !before.has(p));
    const removed = [...before].filter((p) => !editPerms.has(p));
    await saveRoleDoc({ ...editing, permissions: Array.from(editPerms) }, {
      action: "user.permissions",
      details: `added: ${added.join(", ") || "—"}; removed: ${removed.join(", ") || "—"}`,
    });
    setEditing(null);
  };

  const teamName = (id?: string) => data.team.find((t) => t.id === id)?.name;

  return (
    <section className="card" style={{ marginTop: 14 }}>
      <h2>👥 Users, Roles &amp; Permissions</h2>
      <div className="small">
        Har user ka role default permissions deta hai; "Permissions" button se checkbox ke zariye customize karein.
        Designers / editors / employees ko Team record se link karein taake unko My Portal mein apna kaam dikhe.
      </div>

      <div className="grid3" style={{ marginTop: 12 }}>
        <div><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" autoComplete="off" /></div>
        <div><label>Name</label><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Ahmed (Sales)" /></div>
        <div><label>Password (min 8)</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="strong password" autoComplete="new-password" /></div>
      </div>
      <div className="grid3" style={{ marginTop: 10 }}>
        <div><label>Role</label>
          <select value={newRole} onChange={(e) => onNewRole(e.target.value)}>
            {roleChoices.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div><label>Link to Team Record (optional)</label>
          <select value={linkedTeamId} onChange={(e) => setLinkedTeamId(e.target.value)}>
            <option value="">-- none --</option>
            {data.team.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.role || "—"})</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
          {!isSuperRole(newRole) && (
            <button className="btnSmall" onClick={() => setShowNewPerms(!showNewPerms)}>
              {showNewPerms ? "Hide" : "Customize"} permissions ({newPerms.size})
            </button>
          )}
          <button className="btnSolid" onClick={handleCreate} disabled={busy}>{busy ? "Creating..." : "+ Create User"}</button>
        </div>
      </div>
      {showNewPerms && !isSuperRole(newRole) && (
        <div style={{ marginTop: 10 }}>
          <PermissionGrid value={newPerms} onChange={setNewPerms} grantable={grantable} />
        </div>
      )}

      <hr />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: "10px 0" }}>Users ({visibleUsers.length})</h3>
        <label style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
          <input type="checkbox" checked={showDisabled} onChange={(e) => setShowDisabled(e.target.checked)} style={{ width: "auto" }} />
          <span className="small">Disabled users bhi dikhayein</span>
        </label>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>User</th><th>Role</th><th>Linked Team</th><th>Status</th><th>Created</th><th>Action</th></tr>
          </thead>
          <tbody>
            {visibleUsers.map((u) => {
              const canEdit = editable(u);
              return (
                <tr key={u.uid}>
                  <td>
                    <b>{u.displayName || u.email}</b>
                    {u.displayName && <div className="small">{u.email}</div>}
                    {u.uid === user?.uid && <span className="badge ok" style={{ marginLeft: 6 }}>You</span>}
                  </td>
                  <td>
                    {canEdit ? (
                      <select value={u.role} onChange={(e) => handleChangeRole(u, e.target.value)}>
                        {roleChoices.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        {!roleChoices.find((r) => r.value === u.role) && <option value={u.role}>{u.role}</option>}
                      </select>
                    ) : (
                      <span className={`badge ${isSuperRole(u.role) ? "ok" : "pri"}`}>{roleLabel(u.role)}</span>
                    )}
                  </td>
                  <td>
                    {canEdit || (u.uid === user?.uid && isSuperRole(u.role)) ? (
                      <button className={`btnSmall ${u.teamId ? "" : "btnSolid"}`} onClick={() => setLinking(u)}>
                        🔗 {u.teamId ? (teamName(u.teamId) || "Linked") : "Link karein"}
                      </button>
                    ) : (teamName(u.teamId) || "—")}
                  </td>
                  <td><span className={`badge ${u.disabled ? "bad" : "ok"}`}>{u.disabled ? "Disabled" : "Active"}</span></td>
                  <td>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</td>
                  <td className="rowActions">
                    {canEdit && !isSuperRole(u.role) && <button className="btnSmall" onClick={() => openPermissions(u)}>Permissions</button>}
                    {canEdit && <button className="btnSmall" onClick={() => handleToggleDisabled(u)}>{u.disabled ? "Enable" : "Disable"}</button>}
                  </td>
                </tr>
              );
            })}
            {visibleUsers.length === 0 && (<tr><td colSpan={6}>No users</td></tr>)}
          </tbody>
        </table>
      </div>

      {linking && <LinkTeamModal account={linking} onClose={() => setLinking(null)} onLinked={() => loadUsers()} />}

      {editing && (
        <div className="dtModalBackdrop" onClick={() => setEditing(null)}>
          <div className="dtModal wide" onClick={(e) => e.stopPropagation()}>
            <div className="dtModalHead">
              <div>
                <b>Permissions — {editing.displayName || editing.email}</b>
                <div className="small">Role: {roleLabel(editing.role)}</div>
              </div>
              <button className="btnSmall" onClick={() => setEditing(null)}>✕</button>
            </div>
            <PermissionGrid value={editPerms} onChange={setEditPerms} grantable={grantable} />
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button className="btnSolid" onClick={savePermissions}>Save Permissions</button>
              <button className="btnSmall" onClick={() => setEditPerms(new Set(presetFor(editing.role).filter((p) => grantable.has(p))))}>Reset to role default</button>
              <button className="btnSmall" onClick={() => setEditPerms(new Set())}>Clear all</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
