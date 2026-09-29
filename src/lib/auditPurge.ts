// Keeps the audit log small: deletes entries older than N days (or all of
// them) in batches. Only the administrator (history.manage) can do this — the
// database rules enforce it. One "purged" entry is written afterwards so the
// cleanup itself stays on record.
import { collection, getDocs, limit, orderBy, query, where, writeBatch } from "firebase/firestore";
import { db } from "./firebase";

export const RETENTION_OPTIONS = [
  { days: 0, label: "Band (khud saaf na karein)" },
  { days: 7, label: "7 din rakhein" },
  { days: 14, label: "14 din rakhein" },
  { days: 30, label: "30 din rakhein" },
  { days: 90, label: "90 din rakhein" },
];

const cutoffISO = (days: number, now = new Date()) => new Date(now.getTime() - days * 864e5).toISOString();

/** How many entries are older than `days` (0 = all). Capped count for speed. */
export async function countAuditOlderThan(ws: string, days: number, cap = 5000): Promise<number> {
  const base = collection(db, "users", ws, "auditLogs");
  const q = days > 0 ? query(base, where("at", "<", cutoffISO(days)), limit(cap)) : query(base, limit(cap));
  return (await getDocs(q)).size;
}

/** Deletes entries older than `days` (0 = all). Returns how many were removed. */
export async function purgeAuditLogs(ws: string, days: number, maxDocs = 5000): Promise<number> {
  const base = collection(db, "users", ws, "auditLogs");
  let removed = 0;
  while (removed < maxDocs) {
    const q = days > 0 ? query(base, where("at", "<", cutoffISO(days)), orderBy("at"), limit(400)) : query(base, limit(400));
    const snap = await getDocs(q);
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    removed += snap.size;
    if (snap.size < 400) break;
  }
  return removed;
}

const DAY_KEY = "dt.auditPurgedOn";

/** Daily automatic cleanup according to the saved retention; returns removed count or null when skipped. */
export async function runDailyAuditPurge(ws: string, retentionDays: number, today: string): Promise<number | null> {
  if (!retentionDays || retentionDays < 1) return null;
  try { if (localStorage.getItem(DAY_KEY) === `${ws}:${today}`) return null; } catch { /* ignore */ }
  const n = await purgeAuditLogs(ws, retentionDays);
  try { localStorage.setItem(DAY_KEY, `${ws}:${today}`); } catch { /* ignore */ }
  return n;
}
