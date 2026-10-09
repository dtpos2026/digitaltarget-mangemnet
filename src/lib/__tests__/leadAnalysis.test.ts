import { describe, expect, it } from "vitest";
import { analyzeLead, applyAnalysis, budgetFromChat, conversationOf, leadTypeOf, withHistory } from "../leadAnalysis";

const today = new Date("2026-09-28T12:00:00");

describe("conversationOf", () => {
  it("reads the transcript capture wrote into notes", () => {
    const lines = conversationOf({ notes: "WhatsApp chat:\nBilal: facebook ads ka package?\nHum: Ji 17,500 monthly\nBilal: budget 20k hai" });
    expect(lines).toEqual([
      { text: "facebook ads ka package?", fromMe: false },
      { text: "Ji 17,500 monthly", fromMe: true },
      { text: "budget 20k hai", fromMe: false },
    ]);
  });
});

describe("analyzeLead", () => {
  it("existing captured lead: service, ads type, hot interest; value = catalog starting price, budget kept apart", () => {
    const lead = { id: "1", name: "Bilal", source: "Facebook Ads", status: "New", date: "2026-09-27", notes: "WhatsApp chat:\nBilal: facebook ads ka package kya hai?\nBilal: price kitni hai? budget 20k hai" };
    const ai = analyzeLead(lead, {}, today);
    expect(ai.line).toBe("Meta Ads (Facebook + Instagram)");
    expect(ai.category).toBe("Digital Marketing");
    expect(ai.leadType).toBe("ads");
    expect(ai.suggestedStatus).toBe("Interested");
    expect(ai.potentialValue).toBe(4900); // cheapest Meta Ads package: 7 days × 700 = weekly 4,900
    expect(ai.valueBasis).toBe("catalog price");
    expect(ai.budget).toBe(20000);
    expect(ai.level).toBe("Hot");
    expect(ai.followUp.required).toBe(true); // customer's last message is unanswered
    expect(ai.nextAction).toMatch(/jawab/);
  });

  it("uses catalog price when no budget and never invents a category", () => {
    const ai = analyzeLead({ id: "2", name: "03001234567", source: "WhatsApp", status: "New", date: "2026-09-27", notes: "Client: logo design karwana hai" }, {}, today);
    expect(ai.line).toBe("Graphic Design");
    expect(ai.leadType).toBe("unsaved");
    expect(ai.valueBasis).toBe("catalog price");
    expect(ai.potentialValue).toBeGreaterThan(0);
    const none = analyzeLead({ id: "3", name: "X", source: "Referral", notes: "Client: salam" }, {}, today);
    expect(none.line).toBeNull();
  });

  it("opt-out closes the lead and stops messaging", () => {
    const ai = analyzeLead({ id: "4", name: "Ali", status: "Interested", notes: "Ali: please stop messaging me" }, {}, today);
    expect(ai.optOut).toBe(true);
    expect(ai.suggestedStatus).toBe("Lost");
    expect(ai.interest).toBeLessThanOrEqual(5);
    expect(ai.followUp.required).toBe(false);
  });

  it("stale cold lead gets a later follow-up and lower interest", () => {
    const ai = analyzeLead({ id: "5", name: "Old", status: "Contacted", date: "2026-08-01", notes: "Old: salam\nHum: ji farmaiye" }, {}, today);
    expect(ai.level).toBe("Cold");
    expect(ai.followUp.required).toBe(true);
  });
});

describe("helpers", () => {
  it("budget parsing", () => {
    expect(budgetFromChat([{ text: "budget Rs 15,000 hai", fromMe: false }])).toBe(15000);
    expect(budgetFromChat([{ text: "1.5 lakh tak", fromMe: false }])).toBe(150000);
    expect(budgetFromChat([{ text: "50 hazar", fromMe: false }])).toBe(50000);
    expect(budgetFromChat([{ text: "budget 20k", fromMe: true }])).toBe(0); // our own message
  });
  it("lead type", () => {
    expect(leadTypeOf({ source: "WhatsApp", name: "Sara" }, [{ text: "maine aap ka ad dekha", fromMe: false }])).toBe("ads");
    expect(leadTypeOf({ source: "WhatsApp", name: "Sara" }, [])).toBe("saved");
  });
  it("applyAnalysis moves status forward only and records history", () => {
    const lead = { id: "1", name: "Bilal", source: "Facebook Ads", status: "New", date: "2026-09-27", notes: "Bilal: price kitni hai facebook ads ki?" };
    const out = applyAnalysis(lead, analyzeLead(lead, {}, today));
    expect(out.status).toBe("Interested");
    expect(out.serviceType).toBe("Meta Ads (Facebook + Instagram)");
    expect(out.history.at(-1).type).toBe("ai");
    const back = applyAnalysis({ ...lead, status: "Proposal" }, analyzeLead({ ...lead, status: "Proposal" }, {}, today));
    expect(back.status).toBe("Proposal");
    expect(withHistory({}, { type: "note", text: "x" }).history).toHaveLength(1);
  });
});
