import { db } from "./firebase";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  Unsubscribe,
  getDoc,
  query,
  where,
} from "firebase/firestore";

export interface AppData {
  settings: any;
  clients: any[];
  projects: any[];
  invoices: any[];
  accounting: any[];
  khata: any[];
  wallets: any[];
  walletTransfers: any[];
  team: any[];
  teamLogs: any[];
  payouts: any[];
  schedule: any[];
  leads: any[];
  budgets: any[];
  assignments: any[];
  queries: any[];
}

export const defaultData: AppData = {
  settings: {
    logo: null,
    signature: null,
    bankQR: null,
    phone: "",
    exportName: "DigitalTarget",
    footer: "Digital Target | Phone:",
    authorizedName: "",
    authorizedDesignation: "Authorized Signatory",
  },
  clients: [],
  projects: [],
  invoices: [],
  accounting: [],
  khata: [],
  wallets: [],
  walletTransfers: [],
  team: [],
  teamLogs: [],
  payouts: [],
  schedule: [],
  leads: [],
  budgets: [],
  assignments: [],
  queries: [],
};

export const ALL_COLLECTIONS = [
  "clients", "projects", "invoices", "accounting",
  "khata", "wallets", "walletTransfers", "team",
  "teamLogs", "payouts", "schedule", "leads", "budgets",
  "assignments", "queries",
];

export function uid(prefix = "DT") {
  return (
    prefix +
    "-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random().toString(36).slice(2, 7).toUpperCase()
  );
}

export function todayISO() {
  const d = new Date();
  const tzOff = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tzOff * 60000);
  return local.toISOString().slice(0, 10);
}

export function fmtMoney(n: number) {
  return Number(n || 0).toLocaleString("en-PK");
}

export function nowText() { return new Date().toLocaleString(); }

export function dtLocalNowValue() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function normalizeDT(v: string, fallbackTime?: string) {
  if (!v) return "";
  v = String(v);
  if (v.length === 10) return v + "T" + (fallbackTime || "09:00");
  return v;
}

export function parseDT(v: string) {
  if (!v) return null;
  v = normalizeDT(v, "09:00");
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d;
}

export function fmtDT(v: string) {
  const d = parseDT(v);
  if (!d) return "";
  return d.toLocaleString();
}

export function fmtDTShort(v: string) {
  const d = parseDT(v);
  if (!d) return "";
  const dd = d.toLocaleDateString();
  const tt = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return dd + " " + tt;
}

export function durationText(startV: string, endV: string) {
  const s = parseDT(startV);
  const e = parseDT(endV) || new Date();
  if (!s) return "";
  let ms = e.getTime() - s.getTime();
  if (ms < 0) ms = 0;
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rem = mins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${rem}m`;
  return `${rem}m`;
}

export function isLateProject(p: any) {
  const end = parseDT(p.end);
  if (!end) return false;
  if ((p.status || "Running") === "Complete") return false;
  return new Date() > end;
}

export function humanDuration(fromDate: string, toDate: string) {
  const s = new Date(fromDate);
  const e = new Date(toDate);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return "";
  let months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  const years = Math.floor(months / 12);
  months = months % 12;
  if (years > 0 && months > 0) return `${years}y ${months}m`;
  if (years > 0) return `${years}y`;
  if (months > 0) return `${months}m`;
  const days = Math.floor((e.getTime() - s.getTime()) / 86400000);
  return `${days}d`;
}

/** Images are stored inline in Firestore docs (1 MB doc limit), so keep them small. */
export const MAX_INLINE_IMAGE_BYTES = 300 * 1024;

export function fileToBase64(file: File | undefined | null, maxBytes = MAX_INLINE_IMAGE_BYTES): Promise<any> {
  return new Promise((resolve) => {
    if (!file) { resolve(null); return; }
    if (!file.type.startsWith("image/")) {
      alert(`"${file.name}" image nahi hai. Sirf PNG/JPG/WebP upload karein.`);
      resolve(null);
      return;
    }
    if (file.size > maxBytes) {
      alert(`"${file.name}" bohat bari hai (${Math.round(file.size / 1024)} KB). ${Math.round(maxBytes / 1024)} KB se choti image upload karein.`);
      resolve(null);
      return;
    }
    const r = new FileReader();
    r.onload = () => resolve({ name: file.name, data: r.result });
    r.readAsDataURL(file);
  });
}

// All paths use workspaceUid (admin's UID) so all roles share the same data store
function userCol(workspaceUid: string, colName: string) {
  return collection(db, "users", workspaceUid, colName);
}

function userDoc(workspaceUid: string, colName: string, docId: string) {
  return doc(db, "users", workspaceUid, colName, docId);
}

export async function saveItem(workspaceUid: string, colName: string, item: any) {
  const id = item.id || uid();
  await setDoc(userDoc(workspaceUid, colName, id), { ...item, id });
}

export async function deleteItem(workspaceUid: string, colName: string, docId: string) {
  await deleteDoc(userDoc(workspaceUid, colName, docId));
}

export async function saveSettings(workspaceUid: string, settings: any) {
  await setDoc(doc(db, "users", workspaceUid, "meta", "settings"), settings);
}

/**
 * What the signed-in user may load. Collections they cannot read in full are
 * either skipped or, for My Portal users, limited to their own team record —
 * the same scoping firestore.rules enforces.
 */
export interface ReadScope {
  canRead: (colName: string) => boolean;
  /** Linked team record id for My Portal users. */
  teamId?: string;
  ownScoped: Record<string, string>;
}

function scopedQuery(workspaceUid: string, colName: string, scope: ReadScope) {
  if (scope.canRead(colName)) return userCol(workspaceUid, colName);
  const field = scope.ownScoped[colName];
  if (field && scope.teamId) return query(userCol(workspaceUid, colName), where(field, "==", scope.teamId));
  return null;
}

async function loadCollection(workspaceUid: string, colName: string, scope: ReadScope): Promise<any[]> {
  if (colName === "team" && !scope.canRead("team")) {
    if (!scope.teamId) return [];
    const own = await getDoc(userDoc(workspaceUid, "team", scope.teamId));
    return own.exists() ? [own.data()] : [];
  }
  const q = scopedQuery(workspaceUid, colName, scope);
  if (!q) return [];
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

export async function loadAllData(workspaceUid: string, scope: ReadScope): Promise<AppData> {
  const data = { ...defaultData };

  try {
    const settingsDoc = await getDoc(doc(db, "users", workspaceUid, "meta", "settings"));
    if (settingsDoc.exists()) {
      data.settings = { ...defaultData.settings, ...settingsDoc.data() };
    }
  } catch (e) {
    console.warn("settings load failed", e);
  }

  await Promise.all(
    ALL_COLLECTIONS.map(async (colName) => {
      try {
        (data as any)[colName] = await loadCollection(workspaceUid, colName, scope);
      } catch (e) {
        console.warn(`load ${colName} failed`, e);
      }
    })
  );

  return data;
}

export function subscribeCollection(
  workspaceUid: string,
  colName: string,
  scope: ReadScope,
  callback: (items: any[]) => void
): Unsubscribe {
  const q = scopedQuery(workspaceUid, colName, scope);
  if (!q) return () => {};
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => d.data())),
    (err) => console.warn(`live ${colName} failed`, err)
  );
}

export interface AuditEntry {
  action: string;
  collection: string;
  entityId: string;
  entityLabel?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  details?: string;
}

/** Append-only activity log (users/{ws}/auditLogs). Never blocks the UI. */
export function writeAudit(
  workspaceUid: string,
  actor: { uid: string; email?: string | null },
  entry: AuditEntry
) {
  const id = uid("AU");
  return setDoc(userDoc(workspaceUid, "auditLogs", id), {
    id,
    at: new Date().toISOString(),
    actorUid: actor.uid,
    actorEmail: actor.email || "",
    ...entry,
  }).catch((e) => console.warn("audit write failed", e));
}

const isPrimitive = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
const clip = (v: unknown) => (typeof v === "string" && v.length > 200 ? v.slice(0, 200) + "…" : v);

/** Field-level diff for the audit log; large values (images, arrays) are summarised. */
export function diffForAudit(before: any, after: any): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    const a = before?.[k];
    const b = after?.[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (Array.isArray(a) || Array.isArray(b)) {
      changes[k] = { from: Array.isArray(a) ? `${a.length} items` : null, to: Array.isArray(b) ? `${b.length} items` : null };
    } else if (isPrimitive(a ?? null) && isPrimitive(b ?? null)) {
      changes[k] = { from: clip(a ?? null), to: clip(b ?? null) };
    } else {
      changes[k] = { from: a === undefined ? null : "(object)", to: b === undefined ? null : "(object)" };
    }
    if (Object.keys(changes).length >= 25) break;
  }
  return changes;
}

export function entityLabel(item: any): string {
  return String(item?.name || item?.title || item?.subject || item?.task || item?.desc || item?.id || "").slice(0, 120);
}
