import { describe, expect, it } from "vitest";
import { marginInsights, marginReport, saleMargin } from "../margin";

const inv = (o: any) => ({ id: "I1", clientId: "C1", dateISO: "2026-09-05", category: "Digital Marketing", paidAmount: 0, ...o });
const item = (desc: string, qty: number, price: number, extra: any = {}) => ({ desc, qty, price, total: qty * price, ...extra });

describe("margin", () => {
  it("planned cost from the invoice lines", () => {
    const m = saleMargin(inv({ items: [item("Meta ads", 7, 700, { service: "s-meta-daily", costPrice: 500 })], grandTotal: 4900, subtotal: 4900 }), { settings: {}, invoices: [], accounting: [] });
    expect(m).toMatchObject({ revenue: 4900, planned: 3500, cost: 3500, profit: 1400, basis: "planned" });
    expect(m.margin).toBeCloseTo(28.6, 1);
    expect(m.category).toBe("Digital Marketing");
  });
  it("uses the larger of planned and actual, and excludes tax", () => {
    const i = inv({ id: "I2", items: [item("Logo", 1, 10000, { service: "s-logo", costPrice: 2000 })], subtotal: 10000, taxAmount: 1000, grandTotal: 11000 });
    const acc = [{ id: "A1", type: "OUT", category: "Team Payout", amount: 3000, date: "2026-09-06", invoiceId: "I2" }];
    const m = saleMargin(i, { settings: {}, invoices: [i], accounting: acc });
    expect(m.revenue).toBe(10000);
    expect(m).toMatchObject({ planned: 2000, actual: 3000, cost: 3000, profit: 7000, basis: "actual" });
  });
  it("splits project expenses between the project's invoices by revenue", () => {
    const a = inv({ id: "A", projectId: "P", items: [item("x", 1, 30000, { costPrice: 0 })], subtotal: 30000, grandTotal: 30000 });
    const b = inv({ id: "B", projectId: "P", items: [item("y", 1, 10000, { costPrice: 0 })], subtotal: 10000, grandTotal: 10000 });
    const acc = [{ id: "E", type: "OUT", category: "Ads Spend", amount: 8000, date: "2026-09-07", projectId: "P" }];
    const d = { settings: {}, invoices: [a, b], accounting: acc, assignments: [] };
    expect(saleMargin(a, d).actual).toBe(6000);
    expect(saleMargin(b, d).actual).toBe(2000);
  });
  it("flags a sale with no cost", () => {
    const m = saleMargin(inv({ items: [item("x", 1, 5000)], subtotal: 5000, grandTotal: 5000 }), { settings: {}, invoices: [], accounting: [] });
    expect(m.basis).toBe("missing");
    expect(m.missing).toBeGreaterThan(0);
  });
  it("rolls up by category with overhead and reconciles with accounting", () => {
    const i1 = inv({ id: "I1", items: [item("Reels", 4, 2500, { service: "s-reel", costPrice: 1500 })], subtotal: 10000, grandTotal: 10000, paidAmount: 10000 });
    const i2 = inv({ id: "I2", category: "Software Development", items: [item("POS", 1, 5000, { service: "s-pos-small", costPrice: 500 })], subtotal: 5000, grandTotal: 5000 });
    const acc = [
      { id: "A1", type: "IN", category: "Invoice Paid", amount: 10000, date: "2026-09-06" },
      { id: "A2", type: "OUT", category: "Team Payout", amount: 6000, date: "2026-09-07", invoiceId: "I1" },
      { id: "A3", type: "OUT", category: "Office Rent", amount: 20000, date: "2026-09-08" },
      { id: "A4", type: "OUT", category: "Personal", amount: 2000, date: "2026-09-09", scope: "personal" },
    ];
    const r = marginReport({ settings: {}, invoices: [i1, i2], accounting: acc, assignments: [] }, "2026-09-01", "2026-09-30");
    const creative = r.categories.find((c) => c.category === "Creative Services")!;
    const sw = r.categories.find((c) => c.category === "Software Development")!;
    expect(creative).toMatchObject({ revenue: 10000, cost: 6000, profit: 4000, margin: 40 });
    expect(sw).toMatchObject({ revenue: 5000, cost: 500, profit: 4500, margin: 90 });
    expect(r).toMatchObject({ revenue: 15000, directCost: 6500, grossProfit: 8500, overhead: 20000, netAfterOverhead: -11500 });
    expect(r.cash).toMatchObject({ income: 10000, businessExpense: 26000, personalExpense: 2000 });
    expect(marginInsights(r).some((x) => /Overhead/.test(x.text))).toBe(true);
  });
});
