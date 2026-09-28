import { describe, expect, it } from "vitest";
import { inMonth, monthEnd, scopeOf, shiftMonth, summarize } from "../finance";
import { categoryOfLine, firstInvoiceAmount, monthlyValue, servicesOf } from "../catalog";
import { daysToEnd, endDateFor, paidTotal, paymentsOf, renewalState } from "../invoice";
import { suggestTarget, targetProgress } from "../targets";

describe("finance.summarize", () => {
  const rows = [
    { type: "IN", category: "Invoice Paid", amount: 100000, date: "2026-09-02" },
    { type: "IN", category: "Software Sale", amount: 20000, date: "2026-09-03" },
    { type: "IN", category: "Account Adjustment", amount: 50000, date: "2026-09-03" }, // neutral
    { type: "OUT", category: "Ads Run", amount: 10000, date: "2026-09-04" },
    { type: "OUT", category: "Team Salary", amount: 30000, date: "2026-09-05" },
    { type: "OUT", category: "Meal / Dinner", amount: 5000, date: "2026-09-06" },
    { type: "OUT", category: "Something new", amount: 2000, date: "2026-09-06", scope: "personal" }, // explicit scope
    { type: "OUT", category: "Account Adjustment", amount: 9999, date: "2026-09-06" }, // neutral
  ];
  it("splits business and personal and computes net saving", () => {
    const s = summarize(rows);
    expect(s.income).toBe(120000);
    expect(s.businessExpense).toBe(40000);
    expect(s.personalExpense).toBe(7000);
    expect(s.totalExpense).toBe(47000);
    expect(s.businessProfit).toBe(80000);
    expect(s.netSaving).toBe(73000); // income - business - personal
    expect(s.marketingSpend).toBe(10000);
    expect(s.savingMargin).toBe(61);
  });
  it("settings categories decide the scope; name hints are the fallback", () => {
    expect(scopeOf({ type: "OUT", category: "Team Lunch" }, { expenseCategories: [{ name: "Team Lunch", scope: "business" }] })).toBe("business");
    expect(scopeOf({ type: "OUT", category: "Family dinner" })).toBe("personal");
  });
  it("month helpers", () => {
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(inMonth(rows, "2026-09").length).toBe(rows.length);
  });
});

describe("catalog v2", () => {
  it("older saved services keep working and get a category", () => {
    const [s] = servicesOf({ services: [{ id: "x", name: "Old", line: "Graphic Design", rate: 500, unit: "post" }] });
    expect(s.category).toBe("Creative Services");
    expect(s.active).toBe(true);
    expect(categoryOfLine("Meta Ads (Facebook + Instagram)")).toBe("Digital Marketing");
  });
  it("prices setup + monthly and daily services", () => {
    const cloud = { id: "c", name: "Cloud POS", line: "Restaurant Software / DTPOS", rate: 3000, setupFee: 10000, pricing: "setup_plus_monthly" as const };
    expect(firstInvoiceAmount(cloud)).toBe(13000);
    expect(monthlyValue(cloud)).toBe(3000);
    expect(monthlyValue({ id: "m", name: "Meta daily", line: "x", rate: 700, pricing: "daily" as const, unit: "day" })).toBe(21000);
  });
});

describe("invoice periods & payments", () => {
  it("computes the end date from the duration (inclusive)", () => {
    expect(endDateFor("2026-09-01", "3d")).toBe("2026-09-03");
    expect(endDateFor("2026-09-01", "7d")).toBe("2026-09-07");
    expect(endDateFor("2026-09-10", "15d")).toBe("2026-09-24");
    expect(endDateFor("2026-09-15", "1m")).toBe("2026-10-14");
    expect(endDateFor("2026-09-15", "custom")).toBe("");
  });
  it("tracks renewal state", () => {
    const today = new Date("2026-09-28T10:00:00");
    expect(renewalState({ endDate: "2026-10-02" }, 7, today)).toBe("due_soon");
    expect(renewalState({ endDate: "2026-09-20" }, 7, today)).toBe("expired");
    expect(renewalState({ endDate: "2026-11-30" }, 7, today)).toBe("active");
    expect(renewalState({ endDate: "2026-09-20", renewedBy: "INV-2" }, 7, today)).toBe("none");
    expect(daysToEnd("2026-09-30", today)).toBe(2);
  });
  it("reads payment history of old and new invoices", () => {
    expect(paymentsOf({ paidAmount: 5000, dateISO: "2026-09-01" })).toHaveLength(1);
    const p = paymentsOf({ payments: [{ id: "a", date: "2026-09-01", amount: 3000, method: "Cash" }, { id: "b", date: "2026-09-05", amount: 2000, method: "Bank Transfer" }] });
    expect(paidTotal(p)).toBe(5000);
  });
});

describe("targets", () => {
  const data = {
    settings: {},
    accounting: [
      { type: "IN", category: "Invoice Paid", amount: 200000, date: "2026-08-10" },
      { type: "OUT", category: "Team Salary", amount: 60000, date: "2026-08-12" },
      { type: "OUT", category: "Meal / Dinner", amount: 10000, date: "2026-08-12" },
      { type: "IN", category: "Invoice Paid", amount: 100000, date: "2026-10-05" },
    ],
    invoices: [
      { id: "1", dateISO: "2026-08-02", grandTotal: 150000, items: [{ desc: "App", service: "s-mobile", qty: 1, price: 150000 }] },
      { id: "2", dateISO: "2026-08-09", grandTotal: 50000, items: [{ desc: "Ads", service: "s-meta-monthly", qty: 2, price: 25000 }] },
    ],
    leads: Array.from({ length: 10 }, (_, i) => ({ id: String(i), date: "2026-08-05", status: i < 2 ? "Converted" : "New" })),
    targets: [{ id: "2026-10", month: "2026-10", revenue: 500000 }],
  };

  it("builds the mix from history and the owner's number", () => {
    const s = suggestTarget(data, "2026-10", 500000);
    expect(s.revenue).toBe(500000);
    expect(s.hasHistory).toBe(true);
    const mobile = s.serviceMix.find((x) => x.line === "Mobile Apps / App Development")!;
    const meta = s.serviceMix.find((x) => x.line === "Meta Ads (Facebook + Instagram)")!;
    expect(mobile.amount).toBe(375000); // 75% of history
    expect(meta.amount).toBe(125000);
    expect(mobile.unitPrice).toBe(150000);
    expect(mobile.units).toBe(3);
    expect(meta.unitPrice).toBe(25000); // per item from history
    expect(meta.units).toBe(5);
    expect(s.conversionRate).toBeCloseTo(0.2);
    expect(s.leadTarget).toBe(40); // 8 sales / 20%
  });

  it("without a requested number suggests +15% on the average", () => {
    const s = suggestTarget(data, "2026-10");
    expect(s.revenue).toBe(230000);
  });

  it("progress and required daily run-rate", () => {
    const p = targetProgress(data, "2026-10", new Date("2026-10-11T10:00:00"))!;
    expect(p.achieved).toBe(100000);
    expect(p.remaining).toBe(400000);
    expect(p.daysLeft).toBe(21);
    expect(p.requiredDaily).toBe(Math.ceil(400000 / 21));
  });
});

import { fillTemplate, lineTemplateKey, renderTemplate, OPT_OUT_RE } from "../waTemplates";
describe("whatsapp templates", () => {
  it("fills the Urdu payment message like the spec example", () => {
    const t = renderTemplate({ companyName: "Digital Target" }, "payment_received", "ur", { name: "Ali", paid_now: "10,000", invoice: "#123", balance: 0 });
    expect(t).toContain("Rs 10,000");
    expect(t).toContain("موصول ہوگئی");
    expect(t).toContain("#123");
    expect(t).not.toContain("بقایا"); // no balance line when fully paid
  });
  it("admin override wins; missing placeholders are removed", () => {
    const s = { waTemplates: { invoice: { en: "Hi {name}, invoice {invoice} {nothing}." } } };
    expect(renderTemplate(s, "invoice", "en", { name: "Sara", invoice: "INV-1" })).toBe("Hi Sara, invoice INV-1 .".replace(" .", "."));
    expect(fillTemplate("A {x} B", {})).toBe("A B");
  });
  it("picks a follow-up template by service line", () => {
    expect(lineTemplateKey("Video Production")).toBe("line:Video Production");
    expect(renderTemplate({}, lineTemplateKey("Video Production"), "en", { name: "A" })).toContain("video editing");
    expect(lineTemplateKey("Something else")).toBe("lead_followup");
  });
  it("detects opt-out", () => {
    expect(OPT_OUT_RE.test("please stop messaging")).toBe(true);
    expect(OPT_OUT_RE.test("mujhe message na karein")).toBe(true);
    expect(OPT_OUT_RE.test("price kya hai")).toBe(false);
  });
});
