// Digital Target service catalog.
//
// Three levels: category (the business area) → line (sub-category, also the
// value stored on leads as `serviceType`) → service (what is actually sold,
// with its rate and package).
//
// Nothing here is hard-coded into the app: the admin edits the whole list in
// Settings → Services & Categories, and it is stored as `settings.services`.
// The lists below are only the starting configuration.

export interface ServiceCategory {
  name: string;
  lines: string[];
}

/** Category → its service lines. Lines are what a lead's "service" refers to. */
export const SERVICE_CATEGORIES: ServiceCategory[] = [
  {
    name: "Software Development",
    lines: [
      "Restaurant Software / DTPOS", "Retail POS", "Offline Windows Software", "Hybrid / Cloud Software",
      "Travel Agency Software", "Custom Software", "Web Applications", "Mobile Apps / App Development",
      "Other Custom Software Projects", "AI Software Development",
    ],
  },
  {
    name: "Digital Marketing",
    lines: [
      "Meta Ads (Facebook + Instagram)", "Google Ads", "Snapchat Ads", "TikTok Ads",
      "Social Media Management", "Page Management", "Lead Management", "Advertisement Packages", "SEO",
    ],
  },
  {
    name: "Creative Services",
    lines: ["Graphic Design", "Video Production", "Video Editing", "Branding", "Social Media Content"],
  },
  {
    name: "Development",
    lines: ["Web Development", "App Development", "Custom Development"],
  },
  { name: "Other", lines: ["Other"] },
];

/** Flat list of every line, in category order. Kept for older code and filters. */
export const SERVICE_LINES: string[] = SERVICE_CATEGORIES.flatMap((c) => c.lines);

/** How a service is billed. */
export type PricingModel = "one_time" | "recurring" | "setup_plus_monthly" | "daily";

/** Billing periods offered when a service is put on an invoice. */
export const DURATIONS = [
  { id: "3d", label: "3 Days", days: 3 },
  { id: "7d", label: "7 Days", days: 7 },
  { id: "15d", label: "15 Days", days: 15 },
  { id: "1m", label: "Monthly", months: 1 },
  { id: "3m", label: "3 Months", months: 3 },
  { id: "6m", label: "6 Months", months: 6 },
  { id: "1y", label: "Yearly", months: 12 },
  { id: "custom", label: "Custom Duration" },
  { id: "none", label: "No period (one-time)" },
] as const;

export type DurationId = (typeof DURATIONS)[number]["id"];

export interface CatalogService {
  id: string;
  name: string;
  /** Sub-category; also the value stored on a lead as `serviceType`. */
  line: string;
  /** Business area. Derived from `line` for services saved before categories existed. */
  category?: string;
  rate: number;
  unit?: string;
  /** How it is billed. Defaults to one-time. */
  pricing?: PricingModel;
  /** setup_plus_monthly: one-off setup fee; `rate` is then the monthly amount. */
  setupFee?: number;
  /** Default billing period offered on the invoice. */
  duration?: DurationId;
  /** Package / plan name shown on the invoice, e.g. "Monthly Ads Package". */
  packageName?: string;
  /** Inactive services stay on old invoices but are not offered on new ones. */
  active?: boolean;
  notes?: string;
}

/**
 * Starting catalog, from Digital Target's current pricing. Every rate is an
 * example the admin can change in Settings — nothing reads these as fixed.
 */
export const DEFAULT_SERVICES: CatalogService[] = [
  // --- Software Development
  { id: "s-pos-small", name: "Small Retail POS", line: "Retail POS", category: "Software Development", rate: 5000, unit: "license", pricing: "one_time", duration: "none", packageName: "Basic POS (billing, reports)" },
  { id: "s-pos-offline", name: "Offline / Hybrid Windows Software", line: "Offline Windows Software", category: "Software Development", rate: 15000, unit: "license", pricing: "one_time", duration: "none" },
  { id: "s-rest-cloud", name: "Hybrid Cloud Restaurant Software (DTPOS)", line: "Restaurant Software / DTPOS", category: "Software Development", rate: 3000, unit: "month", pricing: "setup_plus_monthly", setupFee: 10000, duration: "1m", packageName: "Setup + Monthly" },
  { id: "s-travel", name: "Travel Agency Software", line: "Travel Agency Software", category: "Software Development", rate: 60000, unit: "project", pricing: "one_time", duration: "none" },
  { id: "s-custom-sw", name: "Custom Software / Automation", line: "Custom Software", category: "Software Development", rate: 100000, unit: "project", pricing: "one_time", duration: "none" },
  { id: "s-ai-app", name: "AI-based custom software / app", line: "AI Software Development", category: "Software Development", rate: 150000, unit: "project", pricing: "one_time", duration: "none" },
  { id: "s-chatbot", name: "AI chatbot / WhatsApp automation", line: "AI Software Development", category: "Software Development", rate: 40000, unit: "project", pricing: "one_time", duration: "none" },
  { id: "s-mobile", name: "Mobile app (Android / iOS)", line: "Mobile Apps / App Development", category: "Software Development", rate: 120000, unit: "project", pricing: "one_time", duration: "none" },

  // --- Digital Marketing
  { id: "s-meta-daily", name: "Meta Ads (Facebook + Instagram) — daily", line: "Meta Ads (Facebook + Instagram)", category: "Digital Marketing", rate: 700, unit: "day", pricing: "daily", duration: "7d", packageName: "Daily Ads" },
  { id: "s-meta-weekly", name: "Meta Ads — weekly package", line: "Meta Ads (Facebook + Instagram)", category: "Digital Marketing", rate: 4900, unit: "week", pricing: "recurring", duration: "7d", packageName: "Weekly Ads Package" },
  { id: "s-meta-monthly", name: "Meta Ads — monthly package", line: "Meta Ads (Facebook + Instagram)", category: "Digital Marketing", rate: 17500, unit: "month", pricing: "recurring", duration: "1m", packageName: "Monthly Ads Package" },
  { id: "s-google-ads", name: "Google Ads management", line: "Google Ads", category: "Digital Marketing", rate: 25000, unit: "month", pricing: "recurring", duration: "1m" },
  { id: "s-snap-ads", name: "Snapchat Ads management", line: "Snapchat Ads", category: "Digital Marketing", rate: 20000, unit: "month", pricing: "recurring", duration: "1m" },
  { id: "s-smm", name: "Social media management (monthly)", line: "Social Media Management", category: "Digital Marketing", rate: 35000, unit: "month", pricing: "recurring", duration: "1m" },
  { id: "s-page", name: "Page management", line: "Page Management", category: "Digital Marketing", rate: 15000, unit: "month", pricing: "recurring", duration: "1m" },
  { id: "s-lead-mgmt", name: "Lead management", line: "Lead Management", category: "Digital Marketing", rate: 20000, unit: "month", pricing: "recurring", duration: "1m" },
  { id: "s-doctor-pkg", name: "Monthly marketing package (clinic / business)", line: "Advertisement Packages", category: "Digital Marketing", rate: 15000, unit: "month", pricing: "recurring", duration: "1m", packageName: "Monthly Package" },
  { id: "s-seo", name: "SEO (monthly)", line: "SEO", category: "Digital Marketing", rate: 30000, unit: "month", pricing: "recurring", duration: "1m" },

  // --- Creative Services
  { id: "s-post", name: "Social media post design", line: "Graphic Design", category: "Creative Services", rate: 500, unit: "post", pricing: "one_time", duration: "none" },
  { id: "s-logo", name: "Logo design", line: "Graphic Design", category: "Creative Services", rate: 15000, unit: "project", pricing: "one_time", duration: "none" },
  { id: "s-reel", name: "Reel / short video editing", line: "Video Editing", category: "Creative Services", rate: 2500, unit: "video", pricing: "one_time", duration: "none" },
  { id: "s-shoot", name: "Video shoot / production", line: "Video Production", category: "Creative Services", rate: 20000, unit: "day", pricing: "one_time", duration: "none" },
  { id: "s-brand", name: "Brand identity package", line: "Branding", category: "Creative Services", rate: 45000, unit: "project", pricing: "one_time", duration: "none" },
  { id: "s-content", name: "Content writing & captions", line: "Social Media Content", category: "Creative Services", rate: 10000, unit: "month", pricing: "recurring", duration: "1m" },

  // --- Development
  { id: "s-website", name: "Business website", line: "Web Development", category: "Development", rate: 60000, unit: "project", pricing: "one_time", duration: "none" },
  { id: "s-ecom", name: "E-commerce store", line: "Web Development", category: "Development", rate: 120000, unit: "project", pricing: "one_time", duration: "none" },
  { id: "s-app-dev", name: "App development", line: "App Development", category: "Development", rate: 120000, unit: "project", pricing: "one_time", duration: "none" },
];

/** Where a line sits. Falls back to "Other" for lines the admin invented. */
export function categoryOfLine(line: string): string {
  const hit = SERVICE_CATEGORIES.find((c) => c.lines.includes(line));
  return hit ? hit.name : "Other";
}

/** Fills in fields that older saved services do not have. */
function normalize(s: CatalogService): CatalogService {
  return {
    ...s,
    category: s.category || categoryOfLine(s.line),
    pricing: s.pricing || (s.unit === "month" ? "recurring" : "one_time"),
    duration: s.duration || (s.unit === "month" ? "1m" : "none"),
    active: s.active !== false,
  };
}

/** The catalog in use: the admin's list from Settings, else the defaults. */
export function servicesOf(settings: unknown): CatalogService[] {
  const s = settings as { services?: CatalogService[] } | undefined;
  const list = Array.isArray(s?.services) && s!.services!.length ? s!.services! : DEFAULT_SERVICES;
  return list.filter((x) => x && x.id && x.name).map(normalize);
}

/** Only what can be sold today (used by the invoice service picker). */
export const activeServicesOf = (settings: unknown) => servicesOf(settings).filter((s) => s.active !== false);

/** Every service line, catalog first, then any extra line the admin typed. */
export function linesOf(settings: unknown): string[] {
  const fromCatalog = servicesOf(settings).map((s) => s.line);
  return Array.from(new Set([...SERVICE_LINES.filter((l) => l !== "Other"), ...fromCatalog, "Other"]));
}

/** Category list, including any category the admin added to a service. */
export function categoriesOf(settings: unknown): string[] {
  const extra = servicesOf(settings).map((s) => s.category || "Other");
  return Array.from(new Set([...SERVICE_CATEGORIES.map((c) => c.name), ...extra]));
}

/** Lines that belong to one category (for the category → line picker). */
export function linesOfCategory(settings: unknown, category: string): string[] {
  const base = SERVICE_CATEGORIES.find((c) => c.name === category)?.lines || [];
  const extra = servicesOf(settings).filter((s) => (s.category || "Other") === category).map((s) => s.line);
  return Array.from(new Set([...base, ...extra]));
}

export const serviceById = (settings: unknown, id: string) => servicesOf(settings).find((s) => s.id === id);

/** What one unit of this service costs up front (setup + first period). */
export function firstInvoiceAmount(s: CatalogService): number {
  return s.pricing === "setup_plus_monthly" ? (Number(s.setupFee) || 0) + (Number(s.rate) || 0) : Number(s.rate) || 0;
}

/** Money this service brings in every month, 0 for one-time work. */
export function monthlyValue(s: CatalogService): number {
  if (s.pricing === "recurring" || s.pricing === "setup_plus_monthly") {
    if (s.unit === "week") return Math.round((Number(s.rate) || 0) * 4.33);
    if (s.unit === "day") return Math.round((Number(s.rate) || 0) * 30);
    return Number(s.rate) || 0;
  }
  if (s.pricing === "daily") return Math.round((Number(s.rate) || 0) * 30);
  return 0;
}

/** Services that renew (their invoices get an end date and a renewal reminder). */
export const isRecurring = (s?: CatalogService) =>
  !!s && (s.pricing === "recurring" || s.pricing === "setup_plus_monthly" || s.pricing === "daily");
