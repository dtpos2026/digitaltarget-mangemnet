import React, { useEffect, useState } from "react";
import { useAuth, UserRole, RoleDoc } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { db } from "@/lib/firebase";
import { collection, getDocs, deleteDoc, doc, setDoc } from "firebase/firestore";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "manager", label: "Manager (Full access except role mgmt)" },
  { value: "accountant", label: "Accountant (Accounting / Khata / Invoices / Reports)" },
  { value: "lead_manager", label: "Lead Manager (Leads + Schedule)" },
  { value: "assistant", label: "Assistant (Leads + Schedule)" },
  { value: "team_member", label: "Team Member (Apna Portal only)" },
];

export default function UserManagement() {
  const { createUserAccount, hasFullAccess, user, workspaceUid, isAdmin } = useAuth();
  const { data } = useData();
  const [users, setUsers] = useState<RoleDoc[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("team_member");
  const [linkedTeamId, setLinkedTeamId] = useState("");
  const [busy, setBusy] = useState(false);

  const loadUsers = async () => {
    try {
      const snap = await getDocs(collection(db, "roles"));
      const all = snap.docs.map(d => d.data() as RoleDoc);
      // show only same workspace
      setUsers(all.filter(u => u.workspaceUid === workspaceUid));
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (hasFullAccess) loadUsers();
  }, [hasFullAccess, workspaceUid]);

  if (!hasFullAccess) return null;

  const handleCreate = async () => {
    if (!email.trim() || password.length < 6) { alert("Email aur 6+ char password zaruri hai"); return; }
    if (newRole === "team_member" && !linkedTeamId) {
      if (!confirm("Team member ko kisi team record se link nahi kiya. Continue?")) return;
    }
    setBusy(true);
    try {
      await createUserAccount(email.trim(), password, newRole, linkedTeamId || undefined);
      alert(
        `${newRole} account ban gaya ✅\n\nDhyan dein: aap ab naye user mein login ho gaye hain. Logout kar ke wapas apne email se login karein.`
      );
      setEmail(""); setPassword(""); setLinkedTeamId("");
      await loadUsers();
    } catch (e: any) {
      alert("Error: " + (e.message || "Failed"));
    }
    setBusy(false);
  };

  const handleChangeRole = async (u: RoleDoc, role: UserRole) => {
    if (u.uid === user?.uid) { alert("Apna role badal nahi sakte"); return; }
    if (u.role === "admin") { alert("Admin role lock hai"); return; }
    try {
      await setDoc(doc(db, "roles", u.uid), { ...u, role });
      await loadUsers();
    } catch (e: any) { alert("Error: " + e.message); }
  };

  const handleLinkTeam = async (u: RoleDoc, teamId: string) => {
    try {
      await setDoc(doc(db, "roles", u.uid), { ...u, teamId: teamId || undefined });
      await loadUsers();
    } catch (e: any) { alert("Error: " + e.message); }
  };

  const handleRemoveRole = async (uid: string) => {
    if (uid === user?.uid) { alert("Apna role delete nahi kar sakte"); return; }
    if (!confirm("Is user ka access remove karein?")) return;
    try { await deleteDoc(doc(db, "roles", uid)); await loadUsers(); }
    catch (e: any) { alert("Error: " + e.message); }
  };

  return (
    <section className="card" style={{ marginTop: 14 }}>
      <h2>👥 User Management {isAdmin ? "(Admin)" : "(Manager)"}</h2>
      <div className="small">
        Yahan se accounts banayein: Manager, Accountant, Lead Manager, Assistant ya Team Member.
        Team Member ko apne Team record se link karein taake unko apna portal data dikhe.
      </div>

      <div className="grid3" style={{ marginTop: 12 }}>
        <div>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
        </div>
        <div>
          <label>Password (min 6)</label>
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="strong password" />
        </div>
        <div>
          <label>Role</label>
          <select value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)}>
            {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
      </div>

      {newRole === "team_member" && (
        <div className="grid2" style={{ marginTop: 10 }}>
          <div>
            <label>Link to Team Member Record</label>
            <select value={linkedTeamId} onChange={(e) => setLinkedTeamId(e.target.value)}>
              <option value="">-- Select team member --</option>
              {data.team.map(t => <option key={t.id} value={t.id}>{t.name} ({t.role || "—"})</option>)}
            </select>
            <div className="small">Pehle Team tab se member add karein, phir yahan link karein.</div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btnSolid" onClick={handleCreate} disabled={busy}>
              {busy ? "Creating..." : "+ Create User"}
            </button>
          </div>
        </div>
      )}

      {newRole !== "team_member" && (
        <div style={{ marginTop: 10 }}>
          <button className="btnSolid" onClick={handleCreate} disabled={busy}>
            {busy ? "Creating..." : "+ Create User"}
          </button>
        </div>
      )}

      <div className="small" style={{ marginTop: 6, color: "#b45309" }}>
        ⚠️ Naya user banane ke baad aap automatically uske account mein login ho jayenge. Phir Logout kar ke apne email se wapas login karein.
      </div>

      <hr />
      <h3 style={{ margin: "10px 0" }}>Current Users ({users.length})</h3>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Email</th><th>Role</th><th>Linked Team</th><th>Created</th><th>Action</th></tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const linked = data.team.find(t => t.id === u.teamId);
              return (
                <tr key={u.uid}>
                  <td>
                    {u.email}
                    {u.uid === user?.uid && <span className="badge ok" style={{ marginLeft: 6 }}>You</span>}
                  </td>
                  <td>
                    {u.role === "admin" || u.uid === user?.uid ? (
                      <span className={`badge ${u.role === "admin" ? "ok" : "pri"}`}>{u.role}</span>
                    ) : (
                      <select value={u.role} onChange={(e) => handleChangeRole(u, e.target.value as UserRole)}>
                        {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.value}</option>)}
                      </select>
                    )}
                  </td>
                  <td>
                    {u.role === "team_member" ? (
                      <select value={u.teamId || ""} onChange={(e) => handleLinkTeam(u, e.target.value)}>
                        <option value="">-- not linked --</option>
                        {data.team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    ) : (linked ? linked.name : "—")}
                  </td>
                  <td>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</td>
                  <td>
                    {u.uid !== user?.uid && u.role !== "admin" && (
                      <button className="btnSmall" onClick={() => handleRemoveRole(u.uid)}>Remove</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (<tr><td colSpan={5}>No users</td></tr>)}
          </tbody>
        </table>
      </div>
    </section>
  );
}
