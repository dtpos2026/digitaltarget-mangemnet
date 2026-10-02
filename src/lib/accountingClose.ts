// Day close and clean-up for the Accounting ledger.
//
//  - Day close: every active accounting entry dated up to the chosen day is
//    stamped `archivedMonth = "day:YYYY-MM-DD"` so the Accounting screen
//    starts again from zero. Wallet balances are NOT touched — the balance in
//    each account is the closing balance and carries forward. A small summary
//    of the day is kept in settings.accountingDayCloses.
//  - Month close (closing.ts) archives the remaining entries of the month.
//  - Clear: permanently deletes archived entries of months that already have
//    a closed snapshot in Administrator History. Balances stay as they are.
// Archived entries can only be changed / deleted by the administrator
// (firestore.rules), so a closed day or month cannot be broken by accident.
import { collection, deleteDoc, deleteField, doc, getDocs, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "./firebase";
import { summarize } from "./finance";

export const dayArchiveKey = (date: string) => `day:${date}`;
export const isDayArchive = (k?: string) => String(k || "").startsWith("day:");

export interface DayClose {
  date: string;
  closedAt: string;
  closedBy: string;
  entries: number;
  income: number;
  expense: number;
  wallets: { id: string; name: string; balance: number }[];
}

const dayOf = (v: unknown) => String(v || "").slice(0, 10);

/** Active entries a day close would archive. */
export const entriesToCloseDay = (accounting: any[], date: string) =>
  (accounting || []).filter((a: any) => !a.archivedMonth && dayOf(a.date) && dayOf(a.date) <= date);

async function batched(refs: ReturnType<typeof doc>[], apply: (b: ReturnType<typeof writeBatch>, r: ReturnType<typeof doc>) => void) {
  for (let i = 0; i < refs.length; i += 400) {
    const b = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => apply(b, r));
    await b.commit();
  }
}

/** Closes the ledger up to `date`. Returns the summary saved for that day. */
export async function closeDay(ws: string, data: any, date: string, by: string): Promise<DayClose> {
  const rows = entriesToCloseDay(data.accounting, date);
  const sum = summarize(rows, data.settings);
  const at = new Date().toISOString();
  await batched(rows.map((a: any) => doc(db, "users", ws, "accounting", a.id)), (b, r) => b.update(r, { archivedMonth: dayArchiveKey(date), archivedAt: at }));
  return {
    date, closedAt: at, closedBy: by, entries: rows.length, income: sum.income, expense: sum.totalExpense,
    wallets: (data.wallets || []).map((w: any) => ({ id: w.id, name: w.name, balance: Number(w.balance) || 0 })),
  };
}

/** Undo a day close (administrator): its entries come back to the Accounting screen. */
export async function reopenDay(ws: string, date: string): Promise<number> {
  const snap = await getDocs(query(collection(db, "users", ws, "accounting"), where("archivedMonth", "==", dayArchiveKey(date))));
  for (const d of snap.docs) await updateDoc(d.ref, { archivedMonth: deleteField(), archivedAt: deleteField() });
  return snap.size;
}

/**
 * Archived entries that are safe to delete: their month is closed (a
 * snapshot exists in Administrator History).
 */
export const clearableEntries = (accounting: any[], closedMonths: Set<string>) =>
  (accounting || []).filter((a: any) => a.archivedMonth && closedMonths.has(dayOf(a.date).slice(0, 7)));

/** Permanently deletes the given archived entries. Wallet balances are not changed. */
export async function clearEntries(ws: string, ids: string[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    try {
      const b = writeBatch(db);
      chunk.forEach((id) => b.delete(doc(db, "users", ws, "accounting", id)));
      await b.commit();
      n += chunk.length;
    } catch {
      for (const id of chunk) { try { await deleteDoc(doc(db, "users", ws, "accounting", id)); n++; } catch { /* skip */ } }
    }
  }
  return n;
}

/** Ledger effect of an entry on its wallet: + money in, − money out. */
export const walletEffect = (a: any) => (a.type === "IN" ? 1 : a.type === "OUT" ? -1 : 0) * (Number(a.amount) || 0);
