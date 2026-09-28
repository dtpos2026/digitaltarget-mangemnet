import { describe, expect, it } from "vitest";
import { analyzeBusiness } from "../insights";

const today = new Date(2026, 8, 20); // 20 Sep 2026
const acc = (date: string, type: "IN" | "OUT", amount: number, category = "Invoice Paid", clientId = "C1") => ({ id: date + amount, date, type, amount, category, clientId });

describe("analyzeBusiness", () => {
  it("builds 6 months of P&L and flags a revenue drop and thin margin", () => {
    const a = analyzeBusiness({
      accounting: [
        acc("2026-08-05", "IN", 300000), acc("2026-08-10", "OUT", 100000, "Ads Run"),
        acc("2026-09-05", "IN", 60000), acc("2026-09-06", "OUT", 58000, "Ads Run"),
      ],
    }, today);
    expect(a.months).toHaveLength(6);
    expect(a.thisMonth).toMatchObject({ month: "2026-09", income: 60000, expense: 58000 });
    const ids = a.insights.map((i) => i.id);
    expect(ids).toContain("rev-down");
    expect(a.insights.find((i) => i.id === "margin-low")?.severity).toBe("risk");
    expect(a.insights[0].severity).toBe("risk"); // risks first
  });

  it("flags client concentration, overdue receivables and budget overrun", () => {
    const a = analyzeBusiness({
      accounting: [acc("2026-09-02", "IN", 90000, "Invoice Paid", "C1"), acc("2026-09-03", "IN", 10000, "Invoice Paid", "C2"), acc("2026-09-04", "OUT", 30000, "Travel")],
      clients: [{ id: "C1", name: "Biryani House" }, { id: "C2", name: "Salon" }],
      invoices: [{ id: "I1", clientId: "C1", items: [], grandTotal: 50000, paidAmount: 0, dueDate: "2026-09-01" }],
      budgets: [{ category: "Travel", limit: 20000 }],
    }, today);
    expect(a.insights.find((i) => i.id === "concentration")?.title).toContain("90%");
    expect(a.insights.find((i) => i.id === "receivables")?.detail).toContain("1 invoices late");
    expect(a.insights.find((i) => i.id === "over-Travel")?.severity).toBe("risk");
  });

  it("analyses leads: stale, best source, follow-ups and leads needed for the growth target", () => {
    const leads = [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `w${i}`, source: "WhatsApp", status: i < 2 ? "Converted" : "Contacted", date: "2026-09-10" })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, source: "Facebook", status: i < 1 ? "Converted" : "Lost", date: "2026-09-11" })),
      { id: "n1", source: "Google", status: "New", date: "2026-09-15" },
      { id: "fu", source: "Referral", status: "Interested", date: "2026-09-12", followUpDate: "2026-09-19", name: "Ali" },
    ];
    const a = analyzeBusiness({
      leads,
      invoices: [{ id: "I1", items: [], grandTotal: 40000, paidAmount: 40000 }],
      accounting: [acc("2026-09-02", "IN", 100000)],
    }, today);
    expect(a.insights.find((i) => i.id === "best-source")?.title).toContain("WhatsApp");
    expect(a.insights.find((i) => i.id === "stale-leads")).toBeTruthy();
    expect(a.insights.find((i) => i.id === "followups")?.detail).toContain("Ali");
    expect(a.growthTarget).toBe(115000);
    expect(a.leadsNeeded).toBe(Math.ceil(115000 / 40000 / (3 / 10)));
  });

  it("handles an empty workspace without crashing", () => {
    const a = analyzeBusiness({}, today);
    expect(a.insights.map((i) => i.id)).toContain("no-data");
    expect(a.score).toBeGreaterThan(0);
  });
});

describe("business questions", () => {
  const today = new Date("2026-09-28T12:00:00");
  const base = {
    accounting: [
      { type: "IN", category: "Invoice Paid", amount: 100000, date: "2026-09-05" },
      { type: "OUT", category: "Team Salary", amount: 60000, date: "2026-09-01" },
      { type: "OUT", category: "Ads Run", amount: 20000, date: "2026-09-10" },
    ],
    invoices: [
      { id: "I1", clientId: "C1", dateISO: "2026-09-02", category: "Retail POS", grandTotal: 100000, paidAmount: 100000, items: [] },
      { id: "I2", clientId: "C1", dateISO: "2026-08-20", category: "Advertisement Packages", grandTotal: 15000, paidAmount: 15000, endDate: "2026-10-02", items: [] },
    ],
    leads: [1, 2, 3, 4].map((i) => ({ id: "L" + i, date: "2026-09-10", serviceType: "Video Editing", status: "Contacted", source: "Facebook Ads" })),
    clients: [{ id: "C1", name: "Abdullah Medicare" }], team: [], wallets: [], budgets: [],
  };
  it("answers: weak service, renewal near, cost per lead, outsource", () => {
    const ids = analyzeBusiness(base, today).insights.map((i) => i.id);
    expect(ids).toContain("weak-line");
    expect(ids).toContain("renewals");
    expect(ids).toContain("cpl");
    expect(ids).toContain("outsource");
  });
});
