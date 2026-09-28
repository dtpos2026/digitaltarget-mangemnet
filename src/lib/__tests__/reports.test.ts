import { describe, expect, it } from "vitest";
import { buildBusinessReport, rangeFor } from "../reports";
import { projectMetrics } from "../projectInsights";

const data: any = {
  settings: {},
  clients: [{ id: "C1", name: "Ali", createdAt: "2026-09-03T10:00:00Z" }],
  invoices: [{ id: "I1", clientId: "C1", projectId: "P1", dateISO: "2026-09-05", items: [{ qty: 1, price: 10000, total: 10000, description: "x" }], grandTotal: 10000, subtotal: 10000, paidAmount: 4000, category: "Meta Ads" }],
  accounting: [
    { id: "A1", date: "2026-09-06", type: "IN", category: "Invoice Paid", amount: 4000, clientId: "C1" },
    { id: "A2", date: "2026-09-07", type: "OUT", category: "Ads Spend", amount: 1000, projectId: "P1" },
    { id: "A3", date: "2026-09-08", type: "OUT", category: "Personal", amount: 500, scope: "personal" },
  ],
  leads: [{ id: "L1", createdAt: "2026-09-04T10:00:00Z", status: "Converted", source: "Ads" }],
  projects: [{ id: "P1", clientId: "C1", start: "2026-09-01T09:00", end: "", status: "Running", budget: 10000 }],
  assignments: [{ id: "S1", projectId: "P1", memberId: "T1", rate: 500, status: "Completed" }],
  team: [{ id: "T1", name: "Hamza" }], schedule: [],
};

describe("business report", () => {
  it("splits business / personal and counts records", () => {
    const r = buildBusinessReport(data, "2026-09-01", "2026-09-30");
    expect(r.income).toBe(4000);
    expect(r.personalExpense).toBe(500);
    expect(r.businessExpense).toBe(1000);
    expect(r.netSaving).toBe(2500);
    expect(r.invoices.count).toBe(1);
    expect(r.outstanding).toBe(6000);
    expect(r.leads.converted).toBe(1);
    expect(r.services[0].line).toBe("Meta Ads");
  });
  it("respects the range", () => {
    expect(buildBusinessReport(data, "2026-08-01", "2026-08-31").income).toBe(0);
    expect(rangeFor("monthly", "2026-09-28")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});

describe("project metrics", () => {
  it("computes profit from linked records", () => {
    const m = projectMetrics(data.projects[0], data, new Date("2026-09-28T10:00:00"));
    expect(m.paid).toBe(4000);
    expect(m.cost).toBe(1500); // 1000 expense + 500 assignment rate
    expect(m.profit).toBe(2500);
    expect(m.paymentStatus).toBe("Partial");
    expect(m.progress).toBe(100 * 1 / 1);
  });
});
