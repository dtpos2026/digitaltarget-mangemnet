import { describe, expect, it } from "vitest";
import { businessesOf, servesUnit, unitOfLead, unitOfLine } from "../business";
import { Product, priceLabel, productFromService, productMessage, productSaleValue, syncServicePrice } from "../products";
import { leadValue, linesTotal, wonValue } from "../leadValue";
import { formatQuoteNumber, leadAfterQuotation, lineFromProduct, quoteTotals, Quotation } from "../quotation";
import { filterHistory, withHistory } from "../leadHistory";
import { activityByDay, memberStats } from "../salesAnalytics";
import { hasInlineCosts, mergeServiceCosts, splitServiceCosts } from "../serviceCosts";
import { DEFAULT_SERVICES } from "../catalog";
import { assistantsForUnit } from "../salesPipeline";

const pos: Product = { id: "P-POS", name: "DTPOS", unit: "software", line: "Restaurant Software / DTPOS", features: ["Billing", "Kitchen"], pricing: "setup_plus_monthly", price: 3000, setupFee: 10000, per: "month", active: true, demoUrl: "https://demo.dt.pk" };
const ads: Product = { id: "P-ADS", name: "Meta Ads daily", unit: "marketing", line: "Meta Ads (Facebook + Instagram)", features: [], pricing: "daily", price: 700, per: "day", periods: 7, active: true };
const web: Product = { id: "P-WEB", name: "Website", unit: "software", line: "Web Development", features: [], pricing: "one_time", price: 60000, active: true };
const products = [pos, ads, web];

describe("business units", () => {
  it("defaults, line → unit, lead unit (hand > product > line)", () => {
    expect(businessesOf({}).map((b) => b.id)).toEqual(["software", "marketing"]);
    expect(unitOfLine({}, "Retail POS")).toBe("software");
    expect(unitOfLine({}, "Meta Ads (Facebook + Instagram)")).toBe("marketing");
    expect(unitOfLine({}, "Graphic Design")).toBe("marketing");
    expect(unitOfLead({ unit: "marketing", serviceType: "Retail POS" }, {}, products)).toBe("marketing");
    expect(unitOfLead({ products: [{ productId: "P-ADS", qty: 1 }], serviceType: "Retail POS" }, {}, products)).toBe("marketing");
    expect(unitOfLead({ serviceType: "Other", ai: { line: "Web Development" } }, {}, products)).toBe("software");
    expect(servesUnit(undefined, "software")).toBe(true);
    expect(servesUnit(["marketing"], "software")).toBe(false);
    const sales = { mode: "pool" as const, autoCapture: true, notifyUids: [], assistants: [
      { teamId: "A", name: "A", active: true, units: ["software"] }, { teamId: "B", name: "B", active: true }] };
    expect(assistantsForUnit(sales, "marketing").map((a) => a.teamId)).toEqual(["B"]);
    expect(assistantsForUnit(sales, "software").map((a) => a.teamId)).toEqual(["A", "B"]);
  });
});

describe("products", () => {
  it("price labels and first-sale value", () => {
    expect(priceLabel(pos)).toBe("Rs 10,000 setup + Rs 3,000 / month");
    expect(priceLabel(web)).toBe("Rs 60,000");
    expect(productSaleValue(pos)).toBe(13000);
    expect(productSaleValue(ads)).toBe(4900);
  });
  it("catalog import and price sync to the invoice catalog", () => {
    const svc = DEFAULT_SERVICES.find((s) => s.id === "s-rest-cloud")!;
    const p = productFromService(svc, {});
    expect(p).toMatchObject({ id: "s-rest-cloud", serviceId: "s-rest-cloud", unit: "software", price: 3000, setupFee: 10000, pricing: "setup_plus_monthly" });
    const next = syncServicePrice({}, { ...p, price: 3500 });
    expect(next?.find((s) => s.id === "s-rest-cloud")?.rate).toBe(3500);
    expect(syncServicePrice({}, p)).toBeNull();
  });
  it("WhatsApp message has name, features, price and demo", () => {
    const m = productMessage(pos, { customer: "Usman", company: "Digital Target" });
    expect(m).toMatch(/Usman/);
    expect(m).toMatch(/\*DTPOS\*/);
    expect(m).toMatch(/✅ Billing/);
    expect(m).toMatch(/Rs 10,000 setup/);
    expect(m).toMatch(/demo\.dt\.pk/);
  });
});

describe("lead value — real prices, never the budget", () => {
  const base = { id: "L", status: "Assistant Handling", serviceType: "Restaurant Software / DTPOS", ai: { budget: 300000 } };
  it("estimate = starting price of the line's product; budget kept apart", () => {
    const v = leadValue(base, products, {});
    expect(v).toMatchObject({ amount: 13000, basis: "estimate", budget: 300000 });
  });
  it("chosen products × qty − discount", () => {
    const v = leadValue({ ...base, products: [{ productId: "P-POS", qty: 2 }, { productId: "P-WEB", qty: 1, price: 50000 }], discount: 6000 }, products, {});
    expect(v).toMatchObject({ amount: 13000 * 2 + 50000 - 6000, basis: "products" });
    expect(linesTotal([{ productId: "P-ADS", qty: 1 }], products)).toBe(4900);
  });
  it("quotation beats products; WON amount beats all", () => {
    expect(leadValue({ ...base, products: [{ productId: "P-POS", qty: 1 }], quotationTotal: 12000, quotationNo: "QT-2026-0001" }, products, {}))
      .toMatchObject({ amount: 12000, basis: "quotation" });
    expect(leadValue({ ...base, status: "Converted", wonAmount: 11000, quotationTotal: 12000 }, products, {})).toMatchObject({ amount: 11000, basis: "won" });
    expect(wonValue({ ...base, status: "Converted", quotationTotal: 12000 }, products, {})).toBe(12000);
  });
  it("no products saved: catalog starting price; nothing known: 0", () => {
    expect(leadValue({ id: "x", serviceType: "Retail POS" }, [], {})).toMatchObject({ amount: 5000, basis: "estimate" });
    expect(leadValue({ id: "x", serviceType: "Other" }, [], {})).toMatchObject({ amount: 0, basis: "none" });
  });
});

describe("quotations", () => {
  it("totals, discount clamp, number format", () => {
    const items = [lineFromProduct(pos, 1), { name: "Training", qty: 2, unitPrice: 1500 }];
    expect(quoteTotals(items, 1000)).toEqual({ subtotal: 16000, discount: 1000, total: 15000 });
    expect(quoteTotals(items, 999999).total).toBe(0);
    expect(formatQuoteNumber(2026, 7)).toBe("QT-2026-0007");
  });
  it("lead after a quotation: value, products, QUOTATION status, history; later stages kept", () => {
    const q = { id: "Q1", number: "QT-2026-0001", items: [lineFromProduct(pos)], subtotal: 13000, discount: 1000, total: 12000 } as Quotation;
    const l = leadAfterQuotation({ id: "L", status: "Assistant Handling", history: [] }, q, "a@dt.pk", "2026-10-09T10:00:00Z");
    expect(l).toMatchObject({ status: "Proposal", quotationTotal: 12000, quotationNo: "QT-2026-0001", products: [{ productId: "P-POS", qty: 1, price: 13000 }] });
    expect(l.history[0]).toMatchObject({ type: "quotation", to: "Proposal" });
    expect(l.history[0].text).toMatch(/QT-2026-0001 — Rs 12,000/);
    expect(leadAfterQuotation({ id: "L", status: "Negotiation" }, q, "a").status).toBe("Negotiation");
  });
});

describe("lead history", () => {
  it("keeps every human event; trims AI notes to the latest 30; caps at 500", () => {
    let l: any = { id: "L" };
    l = withHistory(l, { type: "call", text: "Call", outcome: "Interested", duration: 5, role: "assistant", who: "Ayesha", by: "a@dt.pk" });
    for (let i = 0; i < 60; i++) l = withHistory(l, { type: "ai", text: `ai ${i}` });
    l = withHistory(l, { type: "note", text: "Admin note", role: "admin", by: "ceo@dt.pk" });
    expect(l.history.filter((h: any) => h.type === "ai")).toHaveLength(30);
    expect(l.history[0]).toMatchObject({ type: "call", outcome: "Interested", duration: 5, who: "Ayesha" });
    expect(filterHistory(l.history, "admin").map((h: any) => h.text)).toEqual(["Admin note"]);
    expect(filterHistory(l.history, "calls")).toHaveLength(1);
    for (let i = 0; i < 600; i++) l = withHistory(l, { type: "note", text: `n${i}` });
    expect(l.history.length).toBe(500);
  });
});

describe("sales analytics", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const leads = [
    { id: "1", assignedTo: "T1", createdAt: "2026-10-02T09:00:00Z", takenAt: "2026-10-02T09:10:00Z", firstContactAt: "2026-10-02T09:15:00Z", status: "Converted", wonAt: "2026-10-10T10:00:00Z", wonAmount: 13000, demoAt: "2026-10-05T16:00",
      history: [{ type: "call", at: "2026-10-19T10:00:00Z", text: "c" }, { type: "whatsapp", at: "2026-10-20T08:00:00Z", text: "w" }] },
    { id: "2", assignedTo: "T1", createdAt: "2026-10-03T09:00:00Z", takenAt: "2026-10-03T09:30:00Z", status: "Lost", lostAt: "2026-10-12T10:00:00Z" },
    { id: "3", assignedTo: "T1", createdAt: "2026-10-04T09:00:00Z", takenAt: "2026-10-04T09:20:00Z", status: "Assistant Handling", serviceType: "Web Development", followUpDate: "2026-10-18", followUpAuto: false },
    { id: "4", assignedTo: "T2", createdAt: "2026-10-04T09:00:00Z", status: "Converted", wonAt: "2026-10-11T10:00:00Z", wonAmount: 99999 },
  ];
  const quotations = [{ teamId: "T1", createdAt: "2026-10-06T10:00:00Z", total: 13000 }, { teamId: "T2", createdAt: "2026-10-06T10:00:00Z", total: 50000 }];
  it("one person's month: leads, sales, revenue, conversion, pipeline, follow-ups, target", () => {
    const s = memberStats("T1", "Ayesha", leads, quotations, products, {}, "2026-10", [{ id: "2026-10_T1", month: "2026-10", teamId: "T1", revenue: 26000, deals: 2, demos: 2 }], now);
    expect(s).toMatchObject({ leads: 3, contacted: 3, demos: 1, quotations: 1, quotationValue: 13000, won: 1, revenue: 13000, lost: 1, open: 1,
      conversion: 33, closeRate: 50, pipeline: 60000, followUpsOverdue: 1, activities: 2, avgTakeMins: 20 });
    expect(s.targetPct).toEqual({ revenue: 50, deals: 50, demos: 50 });
    expect(memberStats("T1", "A", leads, quotations, products, {}, "2026-09").won).toBe(0);
  });
  it("activities per day", () => {
    const d = activityByDay(leads, "T1", 3, now);
    expect(d.map((x) => x.count)).toEqual([0, 1, 1]);
  });
});

describe("cost prices stay out of the shared settings doc", () => {
  it("split / merge / detect", () => {
    const settings = { services: [{ id: "a", name: "A", rate: 10, costPrice: 4 }, { id: "b", name: "B", rate: 5 }] };
    const { settings: clean, costs } = splitServiceCosts(settings);
    expect(costs).toEqual({ a: 4 });
    expect(hasInlineCosts(clean)).toBe(false);
    expect(hasInlineCosts(settings)).toBe(true);
    expect(mergeServiceCosts(clean, costs).services[0].costPrice).toBe(4);
  });
});
