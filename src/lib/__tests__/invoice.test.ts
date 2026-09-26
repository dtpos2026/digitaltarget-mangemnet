import { describe, expect, it } from "vitest";
import { calcTotals, invoiceView, nextInvoiceNo } from "../invoice";

const items = [
  { desc: "FB Ads management", qty: 1, price: 20000, total: 20000 },
  { desc: "Post designs", qty: 10, price: 500, total: 5000 },
];

describe("calcTotals", () => {
  it("applies percent discount then tax on the discounted amount", () => {
    expect(calcTotals(items, "percent", 10, 5)).toEqual({ subtotal: 25000, discountAmount: 2500, taxAmount: 1125, grandTotal: 23625 });
  });
  it("caps a flat discount at the subtotal and ignores negatives", () => {
    expect(calcTotals(items, "amount", 99999, 0).grandTotal).toBe(0);
    expect(calcTotals(items, "amount", -50, -5).grandTotal).toBe(25000);
  });
});

describe("nextInvoiceNo", () => {
  it("continues the sequence per prefix and year", () => {
    const inv = [{ invoiceNo: "DT-INV-2026-0007" }, { invoiceNo: "DT-INV-2025-0099" }, { invoiceNo: undefined }];
    expect(nextInvoiceNo(inv, "DT-INV", 2026)).toBe("DT-INV-2026-0008");
    expect(nextInvoiceNo([], "DT-INV", 2026)).toBe("DT-INV-2026-0001");
  });
});

describe("invoiceView", () => {
  it("renders legacy invoices (no discount/tax/number fields)", () => {
    const v = invoiceView({ id: "INV-OLD", items, grandTotal: 25000, paidAmount: 10000, status: "Partial", dateTime: "9/1/2026, 10:00:00 AM" });
    expect(v).toMatchObject({ date: "2026-09-01", number: "INV-OLD", subtotal: 25000, discountAmount: 0, taxAmount: 0, due: 15000, status: "Partial" });
  });
  it("marks fully paid and overdue invoices", () => {
    expect(invoiceView({ id: "A", items, grandTotal: 25000, paidAmount: 25000, status: "Partial" }).status).toBe("Paid");
    expect(invoiceView({ id: "B", items, grandTotal: 25000, paidAmount: 0, dueDate: "2000-01-01" }).status).toBe("Overdue");
  });
});
