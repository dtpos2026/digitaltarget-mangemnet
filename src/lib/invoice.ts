// Invoice model helpers. Older invoices only have items/grandTotal/paidAmount;
// everything here treats the newer fields (discount, tax, numbering, payment
// method, due date, terms) as optional so those invoices keep rendering.

export interface InvoiceItem {
  desc: string;
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
  };
}

export function statusClass(status: string) {
  if (status === "Paid") return "ok";
  if (status === "Partial") return "warn";
  return "bad";
}
