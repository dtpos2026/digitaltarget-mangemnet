import { DURATIONS, DurationId } from "./catalog";

// Invoice model helpers. Older invoices only have items/grandTotal/paidAmount;
// everything here treats the newer fields (discount, tax, numbering, payment
// method, due date, terms) as optional so those invoices keep rendering.

export interface InvoiceItem {
  desc: string;
  /** Catalog service id when picked from the service list. */
  service?: string;
  qty: number;
  price: number;
  total: number;
}

export type DiscountType = "amount" | "percent";

export interface InvoiceTotals {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
}

export const PAYMENT_METHODS = ["Cash", "Bank Transfer", "JazzCash", "EasyPaisa", "Cheque", "Card", "Other"];
export const DEFAULT_INVOICE_PREFIX = "DT-INV";
export const DEFAULT_TERMS =
  "1. Payment due within 7 days of invoice date.\n2. Work starts after advance payment confirmation.\n3. Ads budget is paid separately to the platform unless stated.";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function lineTotal(qty: number, price: number) {
  return round2((Number(qty) || 0) * (Number(price) || 0));
}

export function calcTotals(items: InvoiceItem[], discountType: DiscountType, discountValue: number, taxRate: number): InvoiceTotals {
  const subtotal = round2(items.reduce((s, i) => s + lineTotal(i.qty, i.price), 0));
  const rawDiscount = discountType === "percent" ? (subtotal * (Number(discountValue) || 0)) / 100 : Number(discountValue) || 0;
  const discountAmount = round2(Math.min(Math.max(rawDiscount, 0), subtotal));
  const taxAmount = round2(((subtotal - discountAmount) * Math.max(Number(taxRate) || 0, 0)) / 100);
  return { subtotal, discountAmount, taxAmount, grandTotal: round2(subtotal - discountAmount + taxAmount) };
}

/** Next number like DT-INV-2026-0007 (per prefix and year). */
export function nextInvoiceNo(invoices: { invoiceNo?: string }[], prefix = DEFAULT_INVOICE_PREFIX, year = new Date().getFullYear()) {
  const head = `${prefix}-${year}-`;
  const max = invoices.reduce((m, inv) => {
    if (!inv.invoiceNo?.startsWith(head)) return m;
    const n = parseInt(inv.invoiceNo.slice(head.length), 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `${head}${String(max + 1).padStart(4, "0")}`;
}

/** Older invoices only stored a locale string like "9/26/2026, 10:15:00 AM". */
function legacyDate(dateTime: unknown): string {
  if (!dateTime) return "";
  const text = String(dateTime).split(",")[0].trim();
  const d = new Date(text);
  return isNaN(d.getTime()) ? text : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Normalised read of any invoice (legacy or new). */
export function invoiceView(inv: any) {
  const items: InvoiceItem[] = (inv.items || []).map((i: any) => ({ ...i, total: i.total ?? lineTotal(i.qty, i.price) }));
  const subtotal = inv.subtotal ?? round2(items.reduce((s, i) => s + (Number(i.total) || 0), 0));
  const discountAmount = inv.discountAmount ?? 0;
  const taxAmount = inv.taxAmount ?? 0;
  const grandTotal = inv.grandTotal ?? subtotal - discountAmount + taxAmount;
  const paid = Math.min(Number(inv.paidAmount) || 0, grandTotal);
  const due = round2(Math.max(0, grandTotal - paid));
  const overdue = !!inv.dueDate && due > 0 && inv.dueDate < new Date().toISOString().slice(0, 10);
  return {
    number: inv.invoiceNo || inv.id,
    items, subtotal, discountAmount, taxAmount, grandTotal, paid, due, overdue,
    taxRate: inv.taxRate || 0,
    discountLabel: inv.discountType === "percent" && inv.discountValue ? `Discount (${inv.discountValue}%)` : "Discount",
    status: due <= 0 && grandTotal > 0 ? "Paid" : overdue ? "Overdue" : inv.status || "Unpaid",
    date: inv.dateISO || legacyDate(inv.dateTime),
    startDate: inv.startDate || "",
    endDate: inv.endDate || "",
    duration: inv.duration || "",
    packageName: inv.packageName || "",
  };
}

export function statusClass(status: string) {
  if (status === "Paid") return "ok";
  if (status === "Partial") return "warn";
  return "bad";
}

// ---------------------------------------------------------------- periods
// Ads / management / subscription work is sold for a period. The invoice
// stores startDate + endDate so renewals and expiry can be tracked.

/** End date for a period that starts on `start`. Inclusive, so 7 days = start + 6. */
export function endDateFor(start: string, duration: DurationId): string {
  const d = DURATIONS.find((x) => x.id === duration);
  if (!start || !d || duration === "none" || duration === "custom") return "";
  const base = new Date(`${start}T00:00:00`);
  if (isNaN(base.getTime())) return "";
  if ("days" in d && d.days) base.setDate(base.getDate() + d.days - 1);
  else if ("months" in d && d.months) { base.setMonth(base.getMonth() + d.months); base.setDate(base.getDate() - 1); }
  return base.toISOString().slice(0, 10);
}

export const durationLabel = (id?: string) => DURATIONS.find((d) => d.id === id)?.label || "";

/** Days until the period ends; negative once it has expired. */
export function daysToEnd(endDate?: string, today = new Date()): number | null {
  if (!endDate) return null;
  const end = new Date(`${endDate}T00:00:00`).getTime();
  if (isNaN(end)) return null;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((end - t) / 86400000);
}

export type RenewalState = "none" | "active" | "due_soon" | "expired";

/** Where a recurring invoice stands. `withinDays` sets the "due soon" window. */
export function renewalState(inv: { endDate?: string; renewal?: boolean; renewedBy?: string }, withinDays = 7, today = new Date()): RenewalState {
  if (!inv?.endDate || inv.renewal === false || inv.renewedBy) return "none";
  const left = daysToEnd(inv.endDate, today);
  if (left === null) return "none";
  if (left < 0) return "expired";
  return left <= withinDays ? "due_soon" : "active";
}

// ---------------------------------------------------------------- payments

export interface InvoicePayment {
  id: string;
  date: string;
  amount: number;
  method: string;
  /** Wallet / bank account the money landed in. */
  walletId?: string;
  reference?: string;
  notes?: string;
  /** Accounting row created for this payment, so edits stay in sync. */
  accountingId?: string;
  by?: string;
}

/** Payment history of an invoice; older invoices only have `paidAmount`. */
export function paymentsOf(inv: { payments?: InvoicePayment[]; paidAmount?: number; dateISO?: string; paymentMethod?: string; paidWalletId?: string }): InvoicePayment[] {
  if (Array.isArray(inv?.payments) && inv.payments.length) {
    return inv.payments.map((p, i) => ({ ...p, id: p.id || `P${i + 1}`, amount: Number(p.amount) || 0 }));
  }
  const paid = Number(inv?.paidAmount) || 0;
  if (paid <= 0) return [];
  return [{ id: "P1", date: inv?.dateISO || "", amount: paid, method: inv?.paymentMethod || "Cash", walletId: inv?.paidWalletId, notes: "Pehle se darj payment" }];
}

export const paidTotal = (payments: InvoicePayment[]) => Math.round(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0) * 100) / 100;
