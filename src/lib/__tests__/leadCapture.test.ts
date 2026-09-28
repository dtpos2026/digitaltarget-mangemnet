import { describe, expect, it } from "vitest";
import { findLeadForChat, planCapture, shouldMoveStatus } from "../leadCapture";

const opts = { updateExisting: true, newId: () => "LD-NEW", today: "2026-09-26", createdBy: "test" };

describe("shouldMoveStatus", () => {
  it("only moves forward, or to Lost / Converted", () => {
    expect(shouldMoveStatus("New", "Interested")).toBe(true);
    expect(shouldMoveStatus("Interested", "Contacted")).toBe(false);
    expect(shouldMoveStatus("Follow-up", "Lost")).toBe(true);
    expect(shouldMoveStatus("Converted", "Lost")).toBe(false);
    expect(shouldMoveStatus("New", "New")).toBe(false);
  });
});

describe("findLeadForChat", () => {
  const leads = [
    { id: "A", phone: "0300-1234567" },
    { id: "B", phone: "", waJid: "12345@lid" },
  ];
  it("matches old leads saved in local format", () => {
    expect(findLeadForChat({ key: "x", phone: "923001234567", name: "" }, leads)?.id).toBe("A");
  });
  it("matches by WhatsApp id when the number is hidden", () => {
    expect(findLeadForChat({ key: "x", jid: "12345@lid", name: "" }, leads)?.id).toBe("B");
  });
  it("returns undefined for a new number", () => {
    expect(findLeadForChat({ key: "x", phone: "923339999999", name: "" }, leads)).toBeUndefined();
  });
});

describe("planCapture", () => {
  it("creates a WhatsApp lead with service, status and the chat in notes", () => {
    const plan = planCapture(
      { key: "923001112222@c.us", jid: "923001112222@c.us", phone: "923001112222", name: "Ali Khan" },
      [
        { text: "Salam, mujhe apne restaurant ke liye facebook ads chalwane hain", fromMe: false },
        { text: "Ji zaroor, budget kitna hai?", fromMe: true },
        { text: "price kitni hogi monthly?", fromMe: false },
      ],
      [],
      opts
    );
    expect(plan.kind).toBe("create");
    if (plan.kind !== "create") return;
    expect(plan.lead).toMatchObject({ id: "LD-NEW", name: "Ali Khan", phone: "03001112222", phoneE164: "923001112222", source: "WhatsApp", serviceType: "Meta Ads (Facebook + Instagram)", waJid: "923001112222@c.us" });
    expect(plan.lead.status).toBe("Interested");
    expect(plan.lead.notes).toContain("Ali Khan: price kitni hogi monthly?");
    expect(plan.lead.notes).toContain("Hum: Ji zaroor");
  });

  it("moves an existing lead forward and fills missing fields", () => {
    const lead = { id: "A", name: "Ali", phone: "03001112222", status: "New", serviceType: "" };
    const plan = planCapture({ key: "k", jid: "923001112222@c.us", phone: "923001112222", name: "Ali" },
      [{ text: "advance bhej diya hai, kaam shuru karein", fromMe: false }], [lead], opts);
    expect(plan.kind).toBe("update");
    if (plan.kind !== "update") return;
    expect(plan.patch.status).toBe("Converted");
    expect(plan.patch.waJid).toBe("923001112222@c.us");
  });

  it("never moves a lead backwards", () => {
    const lead = { id: "A", phone: "03001112222", status: "Follow-up", serviceType: "Branding", waJid: "923001112222@c.us" };
    const plan = planCapture({ key: "k", jid: "923001112222@c.us", phone: "923001112222", name: "Ali" },
      [{ text: "hello", fromMe: false }], [lead], opts);
    expect(plan.kind).toBe("same");
  });

  it("leaves status alone when updating existing leads is off", () => {
    const lead = { id: "A", phone: "03001112222", status: "New", serviceType: "Branding", waJid: "923001112222@c.us" };
    const plan = planCapture({ key: "k", jid: "923001112222@c.us", phone: "923001112222", name: "Ali" },
      [{ text: "not interested, shukriya", fromMe: false }], [lead], { ...opts, updateExisting: false });
    expect(plan.kind).toBe("same");
  });
});
