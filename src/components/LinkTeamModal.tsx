import React, { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { RoleDoc, useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { uid } from "@/lib/db";

/**
 * Links a login account to a Team member record (needed for My Portal).
 * Pick an existing member, or create one from the account's name / email.
 */
export default function LinkTeamModal({ account, onClose, onLinked }: { account: RoleDoc; onClose: () => void; onLinked?: () => void }) {
  const { data, addItem } = useData();
  const { user, can, refreshRole } = useAuth();
  const [pick, setPick] = useState(account.teamId || "");
  const [name, setName] = useState(account.displayName || account.email?.split("@")[0] || "");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const canCreate = can("team.manage");
  const self = account.uid === user?.uid;

  const link = async (teamId: string) => {
    await setDoc(doc(db, "roles", account.uid), { ...account, teamId, updatedAt: Date.now(), updatedBy: user?.uid });
    if (self) await refreshRole();
    onLinked?.();
  };
  const save = async () => {
    if (!pick) { setMsg("Team member chunein"); return; }
    setBusy(true);
    try { await link(pick); onClose(); } catch (e) { setMsg("Link nahi hua: " + (e as Error).message); }
    setBusy(false);
  };
  const createAndLink = async () => {
    if (!name.trim()) { setMsg("Naam likhein"); return; }
    setBusy(true);
    try {
      const id = uid("T");
      await addItem("team", { id, name: name.trim(), role: role.trim(), email: account.email || "", status: "Active", paid: 0, createdAt: new Date().toISOString() });
      await link(id);
      onClose();
    } catch (e) { setMsg("Nahi hua: " + (e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="dtModalBackdrop" onClick={onClose}>
      <div className="dtModal" onClick={(e) => e.stopPropagation()}>
        <div className="dtModalHead">
          <div><b>🔗 Team member se link — {account.displayName || account.email}</b><div className="small">Link hone ke baad ye account "My Portal" mein apna kaam, payouts aur queries dekh sakta hai.</div></div>
          <button className="btnSmall" onClick={onClose}>✕</button>
        </div>
        <label>Maujooda team member</label>
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">— chunein —</option>
          {data.team.map((t: any) => <option key={t.id} value={t.id}>{t.name}{t.role ? ` (${t.role})` : ""}</option>)}
        </select>
        <div className="rowActions" style={{ marginTop: 8 }}>
          <button className="btnSolid" onClick={save} disabled={busy || !pick}>Link karein</button>
          {account.teamId && <button className="btnSmall" disabled={busy} onClick={async () => { setBusy(true); try { await setDoc(doc(db, "roles", account.uid), { ...account, teamId: "", updatedAt: Date.now(), updatedBy: user?.uid }); if (self) await refreshRole(); onLinked?.(); onClose(); } catch (e) { setMsg((e as Error).message); } setBusy(false); }}>Link hatayein</button>}
        </div>
        {canCreate && (
          <div className="capBox" style={{ marginTop: 12 }}>
            <b>Ya naya team member banayein{data.team.length === 0 ? " (abhi koi member nahi)" : ""}</b>
            <label>Naam<input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label>Role (e.g. Video Editor, Manager)<input value={role} onChange={(e) => setRole(e.target.value)} /></label>
            <button className="btnSolid" onClick={createAndLink} disabled={busy}>＋ Banayein aur link karein</button>
          </div>
        )}
        {msg && <div className="small waErrText" style={{ marginTop: 6 }}>{msg}</div>}
      </div>
    </div>
  );
}
