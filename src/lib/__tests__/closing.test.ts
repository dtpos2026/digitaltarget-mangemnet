import { describe, expect, it } from "vitest";
import { activeOnly, buildMonthSnapshot, closingChecks, recordsToArchive, toStorable } from "../closing";

const data = {
  settings: {},
  clients: [{ id: "C1", name: "Abdullah Medicare" }, { id: "C2", name: "Sky Travels" }],
  team: [{ id: "T1", name: "Fatima", role: "Video Editor", rate: 20000, paid: 10000 }],
  wallets: [{ id: "W1", name: "Cash", balance: 50000 }],
  khata: [{ id: "K1", type: "LENA", amount: 8000, paid: 3000, status: "OPEN" }],
  invoices: [
    { id: "I1", invoiceNo: "INV-1", clientId: "C1", dateISO: "2026-09-05", grandTotal: 15000, paidAmount: 15000, category: "Advertisement Packages", items: [{ desc: "Pkg", service: "s-doctor-pkg", qty: 1, price: 15000, total: 15000 }] },
    { id: "I2", invoiceNo: "INV-2", clientId: "C2", dateISO: "2026-09-10", grandTotal: 120000, paidAmount: 40000, category: "Mobile Apps / App Development", items: [{ desc: "App", service: "s-mobile", qty: 1, price: 120000, total: 120000 }] },
    { id: "I3", invoiceNo: "INV-3", clientId: "C1", dateISO: "2026-10-02", grandTotal: 5000, paidAmount: 5000, items: [{ desc: "x", qty: 1, price: 5000, total: 5000 }] },
    { id: "I4", invoiceNo: "INV-0", clientId: "C1", dateISO: "2026-08-02", grandTotal: 5000, paidAmount: 5000, archivedMonth: "2026-08", items: [] },
  ],
  accounting: [
    { id: "A1", type: "IN", category: "Invoice Paid", amount: 15000, date: "2026-09-06", clientId: "C1" },
    { id: "A2", type: "IN", category: "Invoice Paid", amount: 40000, date: "2026-09-11", clientId: "C2" },
    { id: "A3", type: "OUT", category: "Team Salary", amount: 20000, date: "2026-09-01" },
    { id: "A4", type: "OUT", category: "Ads Run", amount: 5000, date: "2026-09-12" },
    { id: "A5", type: "OUT", category: "Meal / Dinner", amount: 3000, date: "2026-09-20" },
    { id: "A6", type: "IN", category: "Invoice Paid", amount: 5000, date: "2026-10-02" },
  ],
  projects: [
    { id: "P1", title: "Reels", clientId: "C1", status: "Complete", end: "2026-09-20T18:00", budget: 12000 },
    { id: "P2", title: "App", clientId: "C2", status: "Running", end: "2026-10-20T18:00" },
    { id: "P3", title: "Oct done", clientId: "C1", status: "Complete", end: "2026-10-03T18:00" },
  ],
  assignments: [
    { id: "AS1", memberId: "T1", title: "5 reels", status: "Completed", deadline: "2026-09-18T18:00" },
    { id: "AS2", memberId: "T1", title: "Posts", status: "In Progress", deadline: "2026-09-25T18:00" },
  ],
  schedule: [
    { id: "S1", date: "2026-09-10", status: "Done", task: "Meeting" },
    { id: "S2", date: "2026-09-28", status: "Pending", task: "Follow-up" },
  ],
  leads: [
    { id: "L1", date: "2026-09-03", status: "Converted", source: "WhatsApp", serviceType: "Retail POS", assignedTo: "T1" },
    { id: "L2", date: "2026-09-15", status: "Lost", source: "Facebook Ads" },
    { id: "L3", date: "2026-08-15", status: "New" },
  ],
  targets: [{ id: "2026-09", month: "2026-09", revenue: 100000 }],
};

describe("recordsToArchive", () => {
  it("moves only finished work; open work and other months stay", () => {
    const r = recordsToArchive(data, "2026-09");
    expect(r.invoices).toEqual(["I1"]); // I2 unpaid (carry forward), I3 is October, I4 already archived
    expect(r.projects).toEqual(["P1"]);
    expect(r.assignments).toEqual(["AS1"]);
    expect(r.schedule).toEqual(["S1"]);
    // every ledger entry up to the month end (October ones stay open)
    expect(r.accounting.length).toBe((data.accounting || []).filter((a: any) => !a.archivedMonth && String(a.date).slice(0, 10) <= "2026-09-30").length);
  });
});

describe("buildMonthSnapshot", () => {
  const s = buildMonthSnapshot(data, "2026-09", { closedBy: "admin@dt.pk", now: new Date("2026-10-01T09:00:00") });
  it("accountability: income, business, personal, saving, target achievement", () => {
    expect(s.summary.income).toBe(55000);
    expect(s.summary.businessExpense).toBe(25000);
    expect(s.summary.personalExpense).toBe(3000);
    expect(s.summary.netSaving).toBe(27000);
    expect(s.accountability).toMatchObject({ target: 100000, income: 55000, netSaving: 27000, achievementPct: 55 });
  });
  it("outstanding carries forward (unpaid invoice, team dues, khata)", () => {
    expect(s.outstanding.receivable).toBe(80000);
    expect(s.outstanding.invoices.map((i) => i.number)).toEqual(["INV-2"]);
    expect(s.outstanding.teamDues).toBe(10000);
    expect(s.outstanding.khataLena).toBe(5000);
  });
  it("records services, clients, leads, work and next-month plan", () => {
    expect(s.services[0]).toMatchObject({ line: "Mobile Apps / App Development", revenue: 120000 });
    expect(s.clients.find((c) => c.id === "C2")).toMatchObject({ billed: 120000, received: 40000 });
    expect(s.leads).toMatchObject({ newInMonth: 2, converted: 1, lost: 1, conversionPct: 50 });
    expect(s.projects.completed.map((p) => p.id)).toEqual(["P1"]);
    expect(s.tasks.assignmentsDone.map((a) => a.id)).toEqual(["AS1"]);
    expect(s.tasks.schedulePending.map((x) => x.id)).toEqual(["S2"]);
    expect(s.team[0]).toMatchObject({ name: "Fatima", tasksDone: 1, leadsAssigned: 1, leadsConverted: 1 });
    expect(s.ai.nextMonth.month).toBe("2026-10");
    expect(s.invoices.rows).toHaveLength(2);
    expect(s.expenseByCategory.find((e) => e.category === "Meal / Dinner")?.scope).toBe("personal");
  });
  it("is storable (no undefined, no functions)", () => {
    const stored = toStorable(s);
    expect(JSON.stringify(stored)).not.toContain("undefined");
    expect(stored.month).toBe("2026-09");
  });
});

describe("helpers", () => {
  it("activeOnly hides archived records", () => {
    expect(activeOnly(data.invoices).map((i: any) => i.id)).toEqual(["I1", "I2", "I3"]);
  });
  it("checks warn when the month has not ended and list carry-forwards", () => {
    const c = closingChecks(data, "2026-09", new Date("2026-09-28T10:00:00"));
    expect(c[0].level).toBe("warn");
    expect(c.map((x) => x.text).join(" ")).toMatch(/carry forward/);
  });
});
