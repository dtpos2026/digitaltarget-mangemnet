// What a lead is worth, from real prices — never a guess from the customer's
// budget. In order of certainty:
//   1. WON: the amount the sale closed at (wonAmount)
//   2. the latest quotation sent (quotationTotal)
//   3. the products picked on the lead (product price × qty − discount)
//   4. estimate: the starting price of the lead's service line (products, else catalog)
import { Product, catalogLineValue, productSaleValue, productsForLine } from "./products";

export interface LeadProductLine {
  productId: string;
  name?: string;
  qty: number;
  /** Agreed value per unit (defaults to the product's sale value). */
  price?: number;
}

export type ValueBasis = "won" | "quotation" | "products" | "estimate" | "none";
export interface LeadValue { amount: number; basis: ValueBasis; label: string; budget: number }

const num = (v: unknown) => Number(v) || 0;

export function linesTotal(items: LeadProductLine[] = [], products: Product[] = []): number {
  return items.reduce((sum, it) => {
    const p = products.find((x) => x.id === it.productId);
    const unit = it.price !== undefined && it.price !== null ? num(it.price) : p ? productSaleValue(p) : 0;
    return sum + unit * Math.max(1, num(it.qty) || 1);
  }, 0);
}

export function leadValue(l: any, products: Product[] = [], settings?: unknown): LeadValue {
  const budget = num(l?.ai?.budget);
  if (!l) return { amount: 0, basis: "none", label: "—", budget };
  if (l.status === "Converted" && num(l.wonAmount) > 0) return { amount: num(l.wonAmount), basis: "won", label: "Sale (WON)", budget };
  if (num(l.quotationTotal) > 0) return { amount: num(l.quotationTotal), basis: "quotation", label: `Quotation${l.quotationNo ? ` ${l.quotationNo}` : ""}`, budget };
  if (Array.isArray(l.products) && l.products.length) {
    const amount = Math.max(0, linesTotal(l.products, products) - num(l.discount));
    if (amount > 0) return { amount, basis: "products", label: "Chune hue products", budget };
  }
  const line = l.serviceType && l.serviceType !== "Other" ? l.serviceType : l.ai?.line;
  const fit = productsForLine(products, line);
  if (fit.length) {
    const best = fit.reduce((a, b) => (productSaleValue(b) < productSaleValue(a) ? b : a));
    const amount = productSaleValue(best);
    if (amount > 0) return { amount, basis: "estimate", label: `Andaza — ${best.name} (starting price)`, budget };
  }
  const cat = catalogLineValue(settings, line);
  if (cat > 0) return { amount: cat, basis: "estimate", label: "Andaza — catalog starting price", budget };
  return { amount: 0, basis: "none", label: "Product chunein", budget };
}

/** Closed sale value (WON) for revenue numbers. */
export const wonValue = (l: any, products: Product[] = [], settings?: unknown) =>
  l?.status === "Converted" ? (num(l.wonAmount) || leadValue({ ...l, status: "" }, products, settings).amount) : 0;
