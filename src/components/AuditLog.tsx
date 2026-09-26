import React, { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

interface AuditRow {
  id: string;
  at: string;
  actorEmail?: string;
  action: string;
  collection: string;
  entityId: string;
  entityLabel?: string;
  details?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

export default function AuditLog() {
  const { workspaceUid, can } = useAuth();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [max, setMax] = useState(200);

  const load = async () => {
    if (!workspaceUid) return;
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "users", workspaceUid, "auditLogs"), orderBy("at", "desc"), limit(max)));
      setRows(snap.docs.map((d) => d.data() as AuditRow));
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (can("audit.view")) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceUid, max]);

  if (!can("audit.view")) return null;

  const f = filter.trim().toLowerCase();
  const shown = f
    ? rows.filter((r) => [r.actorEmail, r.action, r.collection, r.entityLabel, r.entityId, r.details].join(" ").toLowerCase().includes(f))
    : rows;

  return (
    <section className="card" style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>🧾 Audit Log</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btnSmall" onClick={load} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button>
          {rows.length >= max && <button className="btnSmall" onClick={() => setMax(max + 200)}>Load more</button>}
        </div>
      </div>
      <div className="small">Kis user ne kab kya create / edit / delete kiya — yeh record badla ya delete nahi ho sakta.</div>
      <div style={{ marginTop: 10 }}>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search user, action, module, record..." />
      </div>
      <div className="tablewrap" style={{ marginTop: 10 }}>
        <table>
          <thead><tr><th>When</th><th>User</th><th>Action</th><th>Module</th><th>Record</th><th>Changes</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="small">{new Date(r.at).toLocaleString()}</td>
                <td>{r.actorEmail || "—"}</td>
                <td><span className="badge">{r.action}</span></td>
                <td>{r.collection}</td>
                <td>{r.entityLabel || r.entityId}</td>
                <td className="small">
                  {r.details && <div>{r.details}</div>}
                  {r.changes && Object.entries(r.changes).slice(0, 6).map(([k, c]) => (
                    <div key={k}><b>{k}</b>: {fmt(c.from)} → {fmt(c.to)}</div>
                  ))}
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6} className="small">{loading ? "Loading..." : "No entries"}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
