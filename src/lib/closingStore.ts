// Firestore side of Monthly Closing (see closing.ts for the rules).
import {
  collection, deleteDoc, deleteField, doc, getDoc, getDocs, orderBy, query, setDoc, updateDoc, writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { ARCHIVABLE, MonthSnapshot, toStorable } from "./closing";

const archiveRef = (ws: string, month: string) => doc(db, "users", ws, "monthlyArchives", month);

export async function listArchives(ws: string): Promise<MonthSnapshot[]> {
  const snap = await getDocs(query(collection(db, "users", ws, "monthlyArchives"), orderBy("month", "desc")));
  return snap.docs.map((d) => d.data() as MonthSnapshot);
}

export async function getArchive(ws: string, month: string): Promise<MonthSnapshot | null> {
  const d = await getDoc(archiveRef(ws, month));
  return d.exists() ? (d.data() as MonthSnapshot) : null;
}

type Op = { col: string; id: string };

/** Applies one change to many docs, 400 per batch; falls back to one-by-one if a batch fails (e.g. a doc was deleted meanwhile). */
async function forEachDoc(ws: string, ops: Op[], apply: (b: ReturnType<typeof writeBatch> | null, ref: ReturnType<typeof doc>) => Promise<void> | void, onProgress?: (done: number, total: number) => void) {
  let done = 0;
  for (let i = 0; i < ops.length; i += 400) {
    const chunk = ops.slice(i, i + 400);
    try {
      const b = writeBatch(db);
      for (const o of chunk) await apply(b, doc(db, "users", ws, o.col, o.id));
      await b.commit();
    } catch {
      for (const o of chunk) {
        try { await apply(null, doc(db, "users", ws, o.col, o.id)); } catch { /* missing doc: skip */ }
      }
    }
    done += chunk.length;
    onProgress?.(done, ops.length);
  }
}

const opsOf = (s: MonthSnapshot): Op[] => ARCHIVABLE.flatMap((col) => (s.archived?.[col] || []).map((id) => ({ col, id })));

/**
 * Closes a month: snapshot first ("closing"), then stamps the records, then
 * marks it "closed". Safe to call again on a snapshot left in "closing".
 */
export async function closeMonth(ws: string, snapshot: MonthSnapshot, onProgress?: (done: number, total: number) => void) {
  const existing = await getArchive(ws, snapshot.month);
  if (existing?.status === "closed") throw new Error(`${snapshot.month} pehle se close hai`);
  // A retry keeps the original snapshot (same numbers the admin confirmed).
  const snap = existing?.status === "closing" ? existing : toStorable({ ...snapshot, status: "closing" as const });
  if (!existing) await setDoc(archiveRef(ws, snapshot.month), snap);
  const at = new Date().toISOString();
  await forEachDoc(ws, opsOf(snap), (b, ref) => {
    const patch = { archivedMonth: snap.month, archivedAt: at };
    if (b) b.update(ref, patch); else return updateDoc(ref, patch);
  }, onProgress);
  await updateDoc(archiveRef(ws, snap.month), { status: "closed", closedAt: at });
}

/** Undo a close: records go back to the active workspace, the snapshot is removed. */
export async function reopenMonth(ws: string, month: string) {
  const s = await getArchive(ws, month);
  if (!s) throw new Error("Archive nahi mila");
  await forEachDoc(ws, opsOf(s), (b, ref) => {
    const patch = { archivedMonth: deleteField(), archivedAt: deleteField() };
    if (b) b.update(ref, patch); else return updateDoc(ref, patch);
  });
  await deleteDoc(archiveRef(ws, month));
}

/** Permanently deletes a month's archive — and, if asked, its archived records. Cannot be undone. */
export async function deleteMonth(ws: string, month: string, withRecords: boolean) {
  const s = await getArchive(ws, month);
  if (!s) throw new Error("Archive nahi mila");
  if (withRecords) {
    await forEachDoc(ws, opsOf(s), (b, ref) => { if (b) b.delete(ref); else return deleteDoc(ref); });
  }
  await deleteDoc(archiveRef(ws, month));
}
