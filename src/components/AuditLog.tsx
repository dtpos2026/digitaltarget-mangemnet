import React, { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { RETENTION_OPTIONS, countAuditOlderThan, purgeAuditLogs } from "@/lib/auditPurge";

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
  const { data, updateSettings, logAudit } = useData();
  const canClean = can("history.manage");
  const retention = Number(data.settings?.auditRetentionDays) || 0;
  const [cleanDays, setCleanDays] = useState(30);
  const [cleanMsg, setCleanMsg] = useState("");
  const [cleaning, setCleaning] = useState(false);
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

  const clean = async () => {
    if (!workspaceUid) return;
    setCleaning(true); setCleanMsg("");
    try {
      const n = await countAuditOlderThan(workspaceUid, cleanDays);
      if (!n) { setCleanMsg(cleanDays ? `${cleanDays} din se purani koi entry nahi.` : "Audit log khali hai."); setCleaning(false); return; }
      const label = cleanDays ? `${cleanDays} din se purani ${n >= 5000 ? "5000+" : n}` : `sab ${n >= 5000 ? "5000+" : n}`;
      if (!confirm(`${label} audit entries hamesha ke liye delete karein?\n\nYe wapas nahi aayengi. (Business data par koi asar nahi.)`)) { setCleaning(false); return; }
      const removed = await purgeAuditLogs(workspaceUid, cleanDays);
      logAudit({ action: "audit.purge", collection: "auditLogs", entityId: "auditLogs", details: `${removed} entries deleted (${cleanDays ? `older than ${cleanDays} days` : "all"})` });
      setCleanMsg(`✓ ${removed} entries delete ho gayi`);
      await load();
    } catch (e) { setCleanMsg("Saaf nahi hua: " + (e as Error).message); }
    setCleaning(false);
  };
  const setRetention = async (days: number) => {
    try { await updateSettings({ ...data.settings, auditRetentionDays: days }); setCleanMsg(days ? `✓ Ab roz ${days} din se purani entries khud saaf hongi` : "✓ Khud-saaf band"); }
    catch (e) { setCleanMsg("Save nahi hua: " + (e as Error).message); }
  };

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
      <div className="small">Kis user ne kab kya create / edit / delete kiya — entries badli nahi ja sakti. Storage kam rakhne ke liye administrator purani entries saaf kar sakta hai.</div>
      {canClean && (
        <div className="auditClean">
          <b>🧹 Saaf karein</b>
          <select value={cleanDays} onChange={(e) => setCleanDays(Number(e.target.value))} aria-label="Kitni purani">
            <option value={7}>7 din se purani</option><option value={30}>30 din se purani</option><option value={90}>90 din se purani</option><option value={0}>Sab entries</option>
          </select>
          <button className="btnDanger" onClick={clean} disabled={cleaning}>{cleaning ? "Saaf ho rahi hai…" : "Delete"}</button>
          <span className="small">Roz khud saaf:</span>
          <select value={retention} onChange={(e) => setRetention(Number(e.target.value))} aria-label="Auto cleanup">
            {RETENTION_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
          </select>
          {cleanMsg && <span className="small">{cleanMsg}</span>}
        </div>
      )}
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
