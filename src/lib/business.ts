// Multi-business CRM: Digital Target runs several businesses (Software,
// Digital Marketing, and more later). Every product, lead, quotation and
// sales assistant belongs to a business unit, so each business can be
// worked and measured on its own — or all together.
//
// Units are configured in Settings (settings.businesses). A unit owns one or
// more catalog categories; a lead's unit follows from its products or its
// service line unless someone picks it by hand.
import { useSyncExternalStore } from "react";
import { categoryOfLine, servicesOf } from "./catalog";

export interface BusinessUnit {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** Catalog categories that belong to this business. */
  categories: string[];
  active?: boolean;
}

export const DEFAULT_BUSINESSES: BusinessUnit[] = [
  { id: "software", name: "Software", icon: "💻", color: "#5b21b6", categories: ["Software Development", "Development"] },
  { id: "marketing", name: "Digital Marketing", icon: "📣", color: "#c026d3", categories: ["Digital Marketing", "Creative Services"] },
];

/** Units in use (admin's list, else the two defaults); inactive ones are left out. */
export function businessesOf(settings: unknown): BusinessUnit[] {
  const s = settings as { businesses?: BusinessUnit[] } | undefined;
  const list = Array.isArray(s?.businesses) && s!.businesses!.length ? s!.businesses! : DEFAULT_BUSINESSES;
  return list.filter((b) => b && b.id && b.name && b.active !== false);
}

export const businessById = (settings: unknown, id?: string) => (id ? businessesOf(settings).find((b) => b.id === id) : undefined);

/** Category of a service line, including categories the admin gave catalog services. */
export function categoryOfLineIn(settings: unknown, line?: string): string {
  if (!line) return "";
  const svc = servicesOf(settings).find((x) => x.line === line);
  return svc?.category || categoryOfLine(line);
}

export function unitOfCategory(settings: unknown, category?: string): string {
  if (!category) return "";
  return businessesOf(settings).find((b) => b.categories.includes(category))?.id || "";
}

export const unitOfLine = (settings: unknown, line?: string) => unitOfCategory(settings, categoryOfLineIn(settings, line));

/** Business of a product: set on the product, else from its line / category. */
export function unitOfProduct(p: { unit?: string; line?: string; category?: string } | undefined, settings: unknown): string {
  if (!p) return "";
  return p.unit || unitOfCategory(settings, p.category) || unitOfLine(settings, p.line);
}

/** Business of a lead: picked by hand, else its first product, else its service line. */
export function unitOfLead(l: any, settings: unknown, products: any[] = []): string {
  if (!l) return "";
  if (l.unit) return l.unit;
  const first = Array.isArray(l.products) && l.products[0];
  const p = first ? products.find((x) => x.id === first.productId) : undefined;
  return unitOfProduct(p, settings) || unitOfLine(settings, l.serviceType && l.serviceType !== "Other" ? l.serviceType : l.ai?.line);
}

/** Does this assistant work for this unit? (no units set = all businesses) */
export const servesUnit = (assistantUnits: string[] | undefined, unit: string) =>
  !assistantUnits || !assistantUnits.length || !unit || assistantUnits.includes(unit);

// ---- the business picked in the UI (shared by Sales, Products, Team), remembered per browser
const KEY = "dt.businessUnit";
let current = (() => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } })();
const subs = new Set<() => void>();
export function setBusinessUnit(id: string) {
  current = id;
  try { localStorage.setItem(KEY, id); } catch { /* private mode */ }
  subs.forEach((f) => f());
}
export const useBusinessUnit = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => current, () => current);
