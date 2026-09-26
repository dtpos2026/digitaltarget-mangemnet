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

export function fileToBase64(file: File | undefined | null): Promise<any> {
  return new Promise((resolve) => {
    if (!file) { resolve(null); return; }
    const r = new FileReader();
    r.onload = () => resolve({ name: file.name, data: r.result });
    r.readAsDataURL(file);
  });
}

// All paths now use workspaceUid (admin's UID) so all roles share the same data store
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

export async function loadAllData(workspaceUid: string): Promise<AppData> {
  const data = { ...defaultData };

  try {
    const settingsDoc = await getDoc(doc(db, "users", workspaceUid, "meta", "settings"));
    if (settingsDoc.exists()) {
      data.settings = { ...defaultData.settings, ...settingsDoc.data() };
    }
  } catch (e) {}

  await Promise.all(
    ALL_COLLECTIONS.map(async (colName) => {
      try {
        const snap = await getDocs(userCol(workspaceUid, colName));
        (data as any)[colName] = snap.docs.map((d) => d.data());
      } catch (e) {}
    })
  );

  return data;
}

export function subscribeCollection(
  workspaceUid: string,
  colName: string,
  callback: (items: any[]) => void
): Unsubscribe {
  return onSnapshot(userCol(workspaceUid, colName), (snap) => {
    callback(snap.docs.map((d) => d.data()));
  });
}
