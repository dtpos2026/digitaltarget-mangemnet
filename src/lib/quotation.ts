// Quotation / sales card data (pure). The PNG itself is drawn by salesCard.ts
// and can be re-drawn any time from the saved record.
import { withHistory } from "./leadHistory";
import { Product, priceLabel, productSaleValue } from "./products";

export interface QuoteLine { productId?: string; name: string; icon?: string; detail?: string; qty: number; unitPrice: number }
export interface QuotePerson { teamId: string; name: string; designation?: string; phone?: string; email?: string }
export interface Quotation {
  id: string;
  number: string;
  leadId?: string;
  unit?: string;
  customer: { name: string; business?: string; phone?: string; city?: string };
  items: QuoteLine[];
  subtotal: number;
  discount: number;
  total: number;
  validTill: string;
  notes?: string;
  /** Credited assistant (rules: an assistant writes only their own). */
  teamId: string;
  preparedBy: QuotePerson;
  status: "Sent" | "Draft" | "Accepted" | "Rejected";
  sentVia?: string[];
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

const num = (v: unknown) => Number(v) || 0;

export function quoteTotals(items: QuoteLine[], discount = 0) {
  const subtotal = items.reduce((s, it) => s + num(it.unitPrice) * Math.max(1, num(it.qty) || 1), 0);
  const d = Math.min(Math.max(0, num(discount)), subtotal);
  return { subtotal, discount: d, total: subtotal - d };
}

export const formatQuoteNumber = (year: number, n: number) => `QT-${year}-${String(n).padStart(4, "0")}`;

export function lineFromProduct(p: Product, qty = 1): QuoteLine {
  return { productId: p.id, name: p.name, icon: p.icon || "", detail: p.tagline || priceLabel(p), qty, unitPrice: productSaleValue(p) };
}

export const addDaysISO = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

// Stages a quotation should not pull a lead back from.
const LATER = ["Proposal", "Negotiation", "Converted", "Lost", "Invalid"];

/** Lead after a quotation is sent: value, products, QUOTATION status and the history entry. */
export function leadAfterQuotation(l: any, q: Quotation, by: string, at = new Date().toISOString()) {
  const next: any = {
    ...l,
    quotationId: q.id, quotationNo: q.number, quotationTotal: q.total, quotationAt: at,
    products: q.items.filter((i) => i.productId).map((i) => ({ productId: i.productId!, name: i.name, qty: i.qty, price: i.unitPrice })),
    discount: q.discount,
    updatedAt: at,
  };
  if (!LATER.includes(l.status)) next.status = "Proposal";
  const items = q.items.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""}`).join(", ");
  return withHistory(next, {
    type: "quotation", by, at, ...(next.status !== l.status ? { to: next.status } : {}),
    text: `Quotation ${q.number} — Rs ${q.total.toLocaleString("en-PK")} (${items})${q.discount ? `, discount Rs ${q.discount.toLocaleString("en-PK")}` : ""}`,
  });
}
