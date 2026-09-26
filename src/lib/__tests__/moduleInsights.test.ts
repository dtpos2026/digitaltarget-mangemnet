import { describe, expect, it } from "vitest";
import { analyzeModule } from "../moduleInsights";

const today = new Date("2026-09-26T10:00:00Z");
const data = {
  leads: [
    { id: "1", name: "A", status: "New", source: "Facebook", serviceType: "Digital Marketing", date: "2026-09-20" },
    { id: "2", name: "B", status: "Interested", source: "Facebook", serviceType: "Digital Marketing", date: "2026-09-10", followUpDate: "2026-09-20" },
    { id: "3", name: "C", status: "Converted", source: "WhatsApp", serviceType: "AI Software Development", date: "2026-08-10" },
    ...[4, 5, 6, 7, 8].map((n) => ({ id: String(n), name: `F${n}`, status: "Contacted", source: "Facebook", serviceType: "Graphic Design", date: "2026-09-01" })),
  ],
  clients: [{ id: "c1", name: "Old Client" }, { id: "c2", name: "New Client" }],
  invoices: [
    { id: "i1", clientId: "c1", dateISO: "2026-05-01", grandTotal: 50000, paidAmount: 50000, category: "Digital Marketing" },
    { id: "i2", clientId: "c1", dateISO: "2026-09-02", dueDate: "2026-09-10", grandTotal: 30000, paidAmount: 0, category: "Digital Marketing" },
  ],
  projects: [], assignments: [], team: [], accounting: [], wallets: [], budgets: [], settings: {},
};

describe("analyzeModule", () => {
  it("leads: flags late follow-ups, untouched new leads and a source with no sales", () => {
    const a = analyzeModule("leads", data, today);
    const ids = a.insights.map((i) => i.id);
    expect(ids).toContain("fu-overdue");
    expect(ids).toContain("new-untouched");
    expect(ids).toContain("dead-source");
    expect(ids).toContain("weak-line"); // Graphic Design: 5 leads, 0 won
    expect(a.insights[0].severity).toBe("risk"); // urgent first
    expect(a.stats.find((s) => s.label === "Follow-up late")?.value).toBe("1");
  });

  it("invoices: overdue amount becomes a reminder action", () => {
    const a = analyzeModule("invoices", data, today);
    const od = a.insights.find((i) => i.id === "overdue");
    expect(od?.title).toContain("Rs 30,000");
    expect(od?.action).toMatch(/reminder/i);
  });

  it("clients: finds inactive clients and clients without invoices", () => {
    const ids = analyzeModule("clients", { ...data, invoices: [data.invoices[0]] }, today).insights.map((i) => i.id);
    expect(ids).toContain("inactive");
    expect(ids).toContain("no-invoice");
  });

  it("dashboard: collects the urgent points of other modules", () => {
    const a = analyzeModule("dashboard", data, today);
    expect(a.insights.some((i) => i.id.startsWith("leads:"))).toBe(true);
    expect(a.insights.some((i) => i.id.startsWith("invoices:"))).toBe(true);
  });
});
