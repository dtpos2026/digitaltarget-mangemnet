// Single source of truth for money classification.
//
// Before this file the "what counts as income / expense" rule was written out
// four times (Dashboard, Budget header, Budget savings history, insights) and
// two of them disagreed, so the same month showed different numbers. Every
// screen now asks this module instead.
//
// Business vs personal: the spec needs
//   Net Saving = Income - Business Expenses - Personal Expenses
// Entries created from now on carry `scope`; older entries are classified from
// their category, so nothing has to be migrated by hand.

export type ExpenseScope = "business" | "personal";

export interface ExpenseCategory {
  name: string;
  scope: ExpenseScope;
  /** Ads / marketing money, reported separately as marketing spend. */
  marketing?: boolean;
}

/** Internal transfers and corrections: never income, never expense. */
export const NEUTRAL_CATEGORIES = ["Account Adjustment", "Wallet Transfer", "Opening Balance"];

export const DEFAULT_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { name: "Ads / Marketing Spend", scope: "business", marketing: true },
  { name: "Ads Run", scope: "business", marketing: true },
  { name: "Local Business Ads", scope: "business", marketing: true },
  { name: "Marketing", scope: "business", marketing: true },
  { name: "Team Salary", scope: "business" },
  { name: "Team Payout", scope: "business" },
  { name: "Designer", scope: "business" },
  { name: "Video Editor", scope: "business" },
  { name: "Developer", scope: "business" },
  { name: "Office", scope: "business" },
  { name: "Office Expense", scope: "business" },
  { name: "Internet", scope: "business" },
  { name: "Hosting / Domain", scope: "business" },
  { name: "Software / Tools", scope: "business" },
  { name: "Design Service", scope: "business" },
  { name: "Video Editing", scope: "business" },
  { name: "Travel", scope: "business" },
  { name: "Other Business Cost", scope: "business" },
  { name: "Meal / Dinner", scope: "personal" },
  { name: "Personal Expense", scope: "personal" },
  { name: "Personal Spending", scope: "personal" },
  { name: "Other Miscellaneous", scope: "personal" },
];

export const DEFAULT_INCOME_CATEGORIES = [
  "Invoice Paid", "Software Sale", "Ads Package", "Monthly Management",
  "Design Service", "Video Service", "Development Project", "Other Income",
];

/** Expense categories in use: the admin's list from Settings, else the defaults. */
export function expenseCategoriesOf(settings: unknown): ExpenseCategory[] {
  const s = settings as { expenseCategories?: ExpenseCategory[] } | undefined;
  const list = Array.isArray(s?.expenseCategories) && s!.expenseCategories!.length ? s!.expenseCategories! : DEFAULT_EXPENSE_CATEGORIES;
  return list.filter((c) => c && c.name).map((c) => ({ ...c, scope: c.scope === "personal" ? "personal" : "business" }));
}

export function incomeCategoriesOf(settings: unknown): string[] {
  const s = settings as { incomeCategories?: string[] } | undefined;
  return Array.isArray(s?.incomeCategories) && s!.incomeCategories!.length ? s!.incomeCategories! : DEFAULT_INCOME_CATEGORIES;
}

const PERSONAL_HINT = /personal|meal|dinner|grocer|khana|ghar|family|miscellaneous|misc\b/i;
const MARKETING_HINT = /\bads?\b|marketing|boost|campaign/i;

export interface Entry {
  type?: string;
  category?: string;
  scope?: string;
  amount?: unknown;
  date?: string;
  [k: string]: unknown;
}

export const amountOf = (a: Entry) => Number(a?.amount) || 0;
export const isNeutral = (a: Entry) => NEUTRAL_CATEGORIES.includes(String(a?.category || ""));
export const isIncome = (a: Entry) => a?.type === "IN" && !isNeutral(a);
export const isExpense = (a: Entry) => a?.type === "OUT" && !isNeutral(a);

/**
 * Business or personal for one expense. An explicit `scope` on the entry wins;
 * otherwise the settings list decides, and finally the category name is read.
 */
export function scopeOf(a: Entry, settings?: unknown): ExpenseScope {
  if (a?.scope === "personal" || a?.scope === "business") return a.scope;
  const name = String(a?.category || "");
  const known = expenseCategoriesOf(settings).find((c) => c.name === name);
  if (known) return known.scope;
  return PERSONAL_HINT.test(name) ? "personal" : "business";
}

export function isMarketing(a: Entry, settings?: unknown): boolean {
  if (!isExpense(a)) return false;
  const name = String(a?.category || "");
  const known = expenseCategoriesOf(settings).find((c) => c.name === name);
  if (known) return !!known.marketing;
  return MARKETING_HINT.test(name);
}

export interface MoneySummary {
  income: number;
  businessExpense: number;
  personalExpense: number;
  totalExpense: number;
  /** Income - business expenses: what the business itself earned. */
  businessProfit: number;
  /** Income - all expenses: what is actually saved. */
  netSaving: number;
  marketingSpend: number;
  savingMargin: number; // % of income kept
}

export const emptySummary = (): MoneySummary => ({
  income: 0, businessExpense: 0, personalExpense: 0, totalExpense: 0,
  businessProfit: 0, netSaving: 0, marketingSpend: 0, savingMargin: 0,
});

/** The one calculation every screen uses. `rows` is already date-filtered. */
export function summarize(rows: Entry[], settings?: unknown): MoneySummary {
  const s = emptySummary();
  for (const a of rows || []) {
    if (isIncome(a)) { s.income += amountOf(a); continue; }
    if (!isExpense(a)) continue;
    const amt = amountOf(a);
    if (scopeOf(a, settings) === "personal") s.personalExpense += amt;
    else s.businessExpense += amt;
    if (isMarketing(a, settings)) s.marketingSpend += amt;
  }
  s.totalExpense = s.businessExpense + s.personalExpense;
  s.businessProfit = s.income - s.businessExpense;
  s.netSaving = s.income - s.totalExpense;
  s.savingMargin = s.income > 0 ? Math.round((s.netSaving / s.income) * 100) : 0;
  return s;
}

/** Rows whose `date` is inside [from, to] (ISO yyyy-mm-dd, both inclusive). */
export const inRange = (rows: Entry[], from: string, to: string) =>
  (rows || []).filter((a) => { const d = String(a?.date || "").slice(0, 10); return d && d >= from && d <= to; });

/** Rows of one month, "2026-09". */
export const inMonth = (rows: Entry[], month: string) =>
  (rows || []).filter((a) => String(a?.date || "").slice(0, 7) === month);

export const monthKey = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const monthStart = (month: string) => `${month}-01`;
export const monthEnd = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
};
export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleString("en-PK", { month: "long", year: "numeric" });
}
/** "2026-09" → "2026-08" (offset -1), "2026-10" (offset +1). */
export function shiftMonth(month: string, offset: number) {
  const [y, m] = month.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + offset, 1));
}
