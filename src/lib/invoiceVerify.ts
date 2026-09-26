import { doc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { invoiceView } from "./invoice";

// "Scan to verify": each invoice gets a random, unguessable token. A small
// public summary lives at invoiceVerify/{token} (readable by exact token only,
// see firestore.rules) and the QR opens /verify/{token} on the portal.

export function newVerifyToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function verifyUrl(token: string): string {
  return `${window.location.origin}/verify/${token}`;
}

export interface VerifySummary {
  token: string;
  workspaceUid: string;
  number: string;
  company: string;
  companyPhone: string;
  companyWebsite: string;
  clientName: string;
  date: string;
  dueDate: string;
  items: { desc: string; qty: number; price: number; total: number }[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  taxRate: number;
  grandTotal: number;
  paid: number;
  due: number;
  status: string;
  paymentMethod: string;
  void: boolean;
  updatedAt: string;
}

/** Writes (or refreshes) the public summary. Never blocks the invoice save. */
export async function publishVerification(ws: string, inv: any, clientName: string, settings: any, voided = false) {
  if (!inv?.verifyToken) return;
  const v = invoiceView(inv);
  const summary: VerifySummary = {
    token: inv.verifyToken,
    workspaceUid: ws,
    number: v.number,
    company: settings?.companyName || "Digital Target",
    companyPhone: settings?.phone || "",
    companyWebsite: settings?.companyWebsite || "",
    clientName: clientName || "",
    date: v.date,
    dueDate: inv.dueDate || "",
    items: v.items.slice(0, 40).map((i) => ({ desc: String(i.desc || "").slice(0, 200), qty: Number(i.qty) || 0, price: Number(i.price) || 0, total: Number(i.total) || 0 })),
    subtotal: v.subtotal,
    discountAmount: v.discountAmount,
    taxAmount: v.taxAmount,
    taxRate: v.taxRate,
    grandTotal: v.grandTotal,
    paid: v.paid,
    due: v.due,
    status: voided ? "Cancelled" : v.status,
    paymentMethod: inv.paymentMethod || "",
    void: voided,
    updatedAt: new Date().toISOString(),
  };
  try {
    await setDoc(doc(db, "invoiceVerify", inv.verifyToken), summary);
  } catch (e) {
    console.warn("verification publish failed", e);
  }
}
