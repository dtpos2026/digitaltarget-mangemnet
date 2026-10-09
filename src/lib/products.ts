// Sales catalog: what the team sells (software and services), with the details a
// customer sees — logo / icon, price, features, description, demo — and the
// message an assistant shares on WhatsApp. Stored in users/{ws}/products.
//
// A product can point to a catalog service (serviceId), so invoices keep using
// the service catalog and its price stays in step.
import { CatalogService, PricingModel, servicesOf, typicalSaleValue } from "./catalog";
import { unitOfLine } from "./business";

export interface Product {
  id: string;
  name: string;
  /** Business unit id (Software, Digital Marketing…). */
  unit: string;
  /** Catalog category / line (AI matches leads to products through the line). */
  category?: string;
  line?: string;
  /** Linked catalog service (invoices). */
  serviceId?: string;
  icon?: string;
  /** Small logo as a data URL (resized on upload). */
  logo?: string;
  tagline?: string;
  description?: string;
  features: string[];
  pricing: PricingModel;
  /** Price per `per`; for setup_plus_monthly the monthly amount. */
  price: number;
  setupFee?: number;
  /** Billing unit: month, license, project, day… */
  per?: string;
  /** Default number of periods in a first sale (daily ads: 7 days). */
  periods?: number;
  demoUrl?: string;
  videoUrl?: string;
  popular?: boolean;
  active: boolean;
  order?: number;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export const PRICING_LABEL: Record<PricingModel, string> = {
  one_time: "One-time",
  recurring: "Recurring (har period)",
  setup_plus_monthly: "Setup + monthly",
  daily: "Daily rate",
};

const rs = (n: number) => `Rs ${Math.round(Number(n) || 0).toLocaleString("en-PK")}`;

/** "Rs 10,000 setup + Rs 3,000 / month", "Rs 17,500 / month", "Rs 5,000 / license". */
export function priceLabel(p: Pick<Product, "pricing" | "price" | "setupFee" | "per">): string {
  if (!p.price && !p.setupFee) return "Price on request";
  const per = p.per ? ` / ${p.per}` : "";
  if (p.pricing === "setup_plus_monthly") return `${rs(p.setupFee || 0)} setup + ${rs(p.price)}${per || " / month"}`;
  return `${rs(p.price)}${per}`;
}

/** Value of a first sale: setup + first period, a daily rate × its periods, else the price. */
export function productSaleValue(p: Pick<Product, "pricing" | "price" | "setupFee" | "periods">): number {
  const price = Number(p.price) || 0;
  if (p.pricing === "setup_plus_monthly") return (Number(p.setupFee) || 0) + price;
  if (p.pricing === "daily") return price * (Number(p.periods) || 7);
  return price;
}

export const activeProducts = (list: Product[], unit?: string) =>
  list.filter((p) => p && p.active !== false && (!unit || p.unit === unit)).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));

const ICON_BY_CATEGORY: Record<string, string> = {
  "Software Development": "💻", "Digital Marketing": "📣", "Creative Services": "🎨", Development: "🌐",
};

/** Catalog service → product (used to start the products list from the existing catalog). */
export function productFromService(s: CatalogService, settings: unknown): Product {
  const days = s.pricing === "daily" ? (s.duration === "15d" ? 15 : s.duration === "3d" ? 3 : 7) : undefined;
  return {
    id: s.id, serviceId: s.id, name: s.name, unit: unitOfLine(settings, s.line), category: s.category, line: s.line,
    icon: ICON_BY_CATEGORY[s.category || ""] || "⭐", tagline: s.packageName || "", description: s.notes || "",
    features: [], pricing: s.pricing || "one_time", price: Number(s.rate) || 0, setupFee: s.setupFee || 0, per: s.unit || "",
    ...(days ? { periods: days } : {}), active: s.active !== false,
  };
}

/** Catalog services that have no product yet. */
export const servicesWithoutProduct = (settings: unknown, products: Product[]) =>
  servicesOf(settings).filter((s) => s.active !== false && !products.some((p) => p.serviceId === s.id || p.id === s.id));

/** The catalog with a product's price written into its linked service (invoices then use the same price). */
export function syncServicePrice(settings: unknown, p: Product): CatalogService[] | null {
  if (!p.serviceId) return null;
  const list = servicesOf(settings);
  const i = list.findIndex((s) => s.id === p.serviceId);
  if (i < 0) return null;
  const s = list[i];
  if (s.rate === p.price && (s.setupFee || 0) === (p.setupFee || 0) && s.pricing === p.pricing) return null;
  const next = [...list];
  next[i] = { ...s, rate: Number(p.price) || 0, setupFee: Number(p.setupFee) || 0, pricing: p.pricing, ...(p.per ? { unit: p.per } : {}) };
  return next;
}

/** Products that fit a service line (for estimates and "suggested products" on a lead). */
export const productsForLine = (list: Product[], line?: string | null) =>
  line ? activeProducts(list).filter((p) => p.line === line) : [];

/** WhatsApp message for one product. */
export function productMessage(p: Product, o: { customer?: string; company?: string; phone?: string; website?: string } = {}): string {
  const lines = [
    o.customer ? `Assalam o Alaikum ${o.customer}!` : "Assalam o Alaikum!",
    "",
    `${p.icon ? `${p.icon} ` : ""}*${p.name}*${p.tagline ? ` — ${p.tagline}` : ""}`,
    p.description ? `\n${p.description.trim()}` : "",
    p.features.length ? `\n${p.features.filter(Boolean).slice(0, 8).map((f) => `✅ ${f}`).join("\n")}` : "",
    `\n💰 *Price:* ${priceLabel(p)}`,
    p.demoUrl ? `🎥 *Demo:* ${p.demoUrl}` : "",
    p.videoUrl && p.videoUrl !== p.demoUrl ? `▶️ *Video:* ${p.videoUrl}` : "",
    "",
    "Demo ya details ke liye reply karein. 🙂",
    [o.company, o.phone, o.website].filter(Boolean).join(" | "),
  ];
  return lines.filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n").trim();
}

/** Default value for estimates when only the catalog is known (no products saved yet). */
export const catalogLineValue = (settings: unknown, line?: string | null) => {
  if (!line) return 0;
  const prices = servicesOf(settings).filter((s) => s.active !== false && s.line === line).map(typicalSaleValue).filter((n) => n > 0);
  return prices.length ? Math.min(...prices) : 0;
};
