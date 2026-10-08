import { describe, expect, it } from "vitest";
import {
  assignedLead, assistantStats, dailySales, followUpDone, followUpIsDue, nextRoundRobin, sourceOf, statusLabel, takeBlocker, takenLead,
  temperatureOf, visibleToAssistant, withFollowUp, withStatus,
} from "../salesPipeline";
import { extractDetails, mergeChat, planIngest } from "../leadIngest";
import { shouldMoveStatus } from "../leadCapture";
import { analyzeLead, leadTypeOf } from "../leadAnalysis";
import { buildRecipients } from "../campaign";

const ctx = { settings: {}, by: "test", today: "2026-10-07", newId: () => "LD-NEW", now: new Date("2026-10-07T10:00:00Z") };
const msg = (text: string, fromMe = false, at = Date.parse("2026-10-07T09:00:00Z"), id?: string) => ({ text, fromMe, at, id });

describe("sales pipeline", () => {
  it("labels and backward-compatible keys", () => {
    expect(statusLabel("Converted")).toBe("WON");
    expect(statusLabel("Proposal")).toBe("QUOTATION");
    expect(statusLabel("Demo Given")).toBe("DEMO COMPLETED");
    expect(statusLabel("Interested")).toBe("Interested");
  });
  it("AI / capture never moves a lead a person is working on", () => {
    expect(shouldMoveStatus("New", "Interested")).toBe(true);
    expect(shouldMoveStatus("AI Handling", "Interested")).toBe(true);
    expect(shouldMoveStatus("Assistant Handling", "Interested")).toBe(false);
    expect(shouldMoveStatus("Demo Scheduled", "Converted")).toBe(false);
    expect(shouldMoveStatus("Demo Given", "Interested")).toBe(false);
  });
  it("temperature: AI unless set by hand", () => {
    expect(temperatureOf({ ai: { level: "Hot" } })).toBe("HOT");
    expect(temperatureOf({ ai: { level: "Hot" }, temperature: "COLD", temperatureManual: true })).toBe("COLD");
    expect(withStatus({ status: "New" }, "Warm", "a").temperature).toBe("WARM");
  });
  it("sources", () => {
    expect(sourceOf({ source: "Facebook Ads" })).toBe("Meta Ads");
    expect(sourceOf({ source: "WhatsApp" })).toBe("WhatsApp Direct");
    expect(sourceOf({})).toBe("Manual");
  });
  it("take lead: first one wins, history + AI handoff", () => {
    expect(takeBlocker({ status: "New" }, "T1")).toBe("");
    expect(takeBlocker({ status: "New", assignedTo: "T2", assignedToName: "Ali" }, "T1")).toMatch(/Ali/);
    expect(takeBlocker({ status: "Assigned", assignedTo: "T1" }, "T1")).toBe("");
    expect(takeBlocker({ status: "Converted" }, "T1")).toMatch(/band/);
    expect(takeBlocker({ status: "New" }, "")).toMatch(/link/);
    const t = takenLead({ id: "L", status: "New" }, { teamId: "T1", name: "Sara", by: "s@x" }, "2026-10-07T10:00:00Z");
    expect(t).toMatchObject({ assignedTo: "T1", takenBy: "T1", status: "Assistant Handling", aiHandoff: true });
    expect(t.history.at(-1)).toMatchObject({ type: "taken", by: "s@x" });
    expect(takeBlocker(t, "T2")).toMatch(/Sara/);
  });
  it("assign / reassign / back to pool", () => {
    const a = assignedLead({ status: "New" }, { teamId: "T1", name: "Sara" }, "ceo");
    expect(a).toMatchObject({ assignedTo: "T1", status: "Assigned", takenAt: "" });
    const p = assignedLead(a, null, "ceo");
    expect(p).toMatchObject({ assignedTo: "", status: "New" });
  });
  it("round robin", () => {
    const list = [{ teamId: "A", name: "A", active: true }, { teamId: "B", name: "B", active: true }];
    expect(nextRoundRobin(list, null)?.teamId).toBe("A");
    expect(nextRoundRobin(list, "A")?.teamId).toBe("B");
    expect(nextRoundRobin(list, "B")?.teamId).toBe("A");
    expect(nextRoundRobin([], "A")).toBeNull();
  });
  it("follow-ups", () => {
    const l = withFollowUp({ status: "Assistant Handling" }, { date: "2026-10-07", time: "09:30", note: "call" }, "a");
    expect(followUpIsDue(l, new Date("2026-10-07T09:31:00"))).toBe(true);
    expect(followUpIsDue(l, new Date("2026-10-07T09:00:00"))).toBe(false);
    expect(followUpIsDue(followUpDone(l, "a"), new Date("2026-10-08T00:00:00"))).toBe(false);
  });
  it("visibility for assistants", () => {
    expect(visibleToAssistant({ assignedTo: "T1" }, "T1")).toBe(true);
    expect(visibleToAssistant({ assignedTo: "" , status: "New" }, "T1")).toBe(true);
    expect(visibleToAssistant({ assignedTo: "T2" }, "T1")).toBe(false);
  });
  it("daily numbers and assistant stats", () => {
    const at = "2026-10-07T10:00:00Z";
    const leads = [
      { id: "1", createdAt: at, ai: { level: "Hot" }, status: "New" },
      withStatus({ id: "2", createdAt: "2026-10-01T10:00:00Z", assignedTo: "T1", status: "Assistant Handling" }, "Converted", "a", at),
      withStatus({ id: "3", createdAt: "2026-10-01T10:00:00Z", assignedTo: "T1", status: "Assistant Handling" }, "Demo Scheduled", "a", at),
    ];
    const d = dailySales(leads, "2026-10-07", new Date(at));
    expect(d).toMatchObject({ newLeads: 1, hot: 1, won: 1, demosScheduled: 1 });
    expect(assistantStats(leads, [{ teamId: "T1", name: "S", active: true }])[0]).toMatchObject({ assigned: 2, sales: 1, demos: 1, conversion: 50 });
  });
  it("after TAKE LEAD the AI still reads interest from the chat (handling status is not a score)", () => {
    const chat = [msg("Mera restaurant hai, POS software ka price kya hai?"), msg("Kal demo dikha dein? Budget 50 hazar hai", false, Date.parse("2026-10-07T09:05:00Z"))];
    const fresh = analyzeLead({ id: "a", name: "Usman", status: "New", chat } as any, {}, ctx.now);
    const taken = analyzeLead({ id: "a", name: "Usman", status: "Assistant Handling", aiHandoff: true, chat } as any, {}, ctx.now);
    expect(taken.level).toBe(fresh.level);
    expect(taken.interest).toBe(fresh.interest);
    expect(taken.suggestedStatus).toBe("Assistant Handling");
  });
  it("a WhatsApp profile name is not a saved contact", () => {
    expect(leadTypeOf({ name: "Hina Boutique", source: "WhatsApp Direct", waSaved: false }, [])).toBe("unsaved");
    expect(leadTypeOf({ name: "Hina Boutique", source: "WhatsApp Direct", waSaved: true }, [])).toBe("saved");
    const p = planIngest({ channel: "wa-web-extension", phone: "923335550001", name: "Hina", saved: false, messages: [msg("boutique ke liye instagram ads ka rate bata dein")] }, null, ctx);
    expect(p.kind === "create" && p.lead.leadType).toBe("unsaved");
  });
  it("TAKE LEAD counts as contacted today", () => {
    const l = takenLead({ id: "x", status: "New", createdAt: "2026-10-07T08:00:00Z" }, { teamId: "T5", name: "Ayesha", by: "a" }, "2026-10-07T09:00:00Z");
    expect(dailySales([l], "2026-10-07").contacted).toBe(1);
  });
  it("campaigns skip a lead an assistant has taken", () => {
    const l = takenLead({ id: "x", name: "Ali", phone: "03001112222", status: "New" }, { teamId: "T5", name: "Ayesha", by: "a" });
    const [r] = buildRecipients([l], new Set(), {}, { lang: "roman", templateMode: "auto", templateKey: "" } as any);
    expect(r.status).toBe("skipped");
    expect(r.reason).toMatch(/Ayesha.*automation band/);
  });
  it("an AI-suggested follow-up date is a hint, not a reminder; a person's follow-up is", () => {
    const now = new Date("2026-10-07T15:00:00");
    const ai = { id: "x", status: "New", followUpDate: "2026-10-07", followUpAuto: true };
    expect(followUpIsDue(ai, now)).toBe(false);
    expect(dailySales([ai], "2026-10-07", now).followUpsPending).toBe(0);
    const set = withFollowUp(ai, { date: "2026-10-07", time: "14:00", note: "call" }, "a");
    expect(set.followUpAuto).toBe(false);
    expect(followUpIsDue(set, now)).toBe(true);
  });
});

describe("lead ingest", () => {
  it("creates a qualified lead from a Meta ad conversation", () => {
    const p = planIngest({ channel: "wa-web-extension", phone: "923001234567", name: "Ali Raza", jid: "923001234567@c.us",
      messages: [msg("Hello! Can I get more info on this?", false, Date.parse("2026-10-07T08:59:00Z"), "m1"), msg("Meri Karachi mein restaurant hai, POS software ka demo chahiye, price?", false, undefined, "m2")],
      ad: { title: "DTPOS — Restaurant software", sourceId: "1234" } }, null, ctx);
    expect(p.kind).toBe("create");
    if (p.kind !== "create") return;
    expect(p.lead).toMatchObject({ status: "New", source: "Meta Ads", city: "Karachi", assignedTo: "", phoneE164: "923001234567", channel: "wa-web-extension" });
    expect(p.lead.adInfo.sourceId).toBe("1234");
    expect(p.lead.chat).toHaveLength(2);
    expect(["HOT", "WARM"]).toContain(p.lead.temperature);
    expect(p.lead.serviceType).toBe("Restaurant Software / DTPOS");
  });
  it("skips personal chats and our own messages", () => {
    expect(planIngest({ channel: "wa-web-extension", phone: "923009999999", name: "Ammi", messages: [msg("beta khana kha lena")] }, null, ctx).kind).toBe("skip");
    expect(planIngest({ channel: "wa-web-extension", phone: "923009999999", name: "X", messages: [msg("Assalam o alaikum, price list bhej raha hun", true)] }, null, ctx).kind).toBe("skip");
  });
  it("updates an existing lead without duplicating messages and keeps the human status", () => {
    const existing = { id: "L1", name: "Ali", status: "Assistant Handling", assignedTo: "T1", aiHandoff: true, chat: [{ text: "hi", fromMe: false, at: 1, id: "m1" }] };
    const p = planIngest({ channel: "wa-web-extension", phone: "923001234567", name: "Ali", messages: [{ text: "hi", fromMe: false, at: 1, id: "m1" }, msg("payment kar di hai", false, undefined, "m3")] }, existing, ctx);
    expect(p.kind).toBe("update");
    if (p.kind !== "update") return;
    expect(p.lead.chat).toHaveLength(2);
    expect(p.lead.status).toBe("Assistant Handling");
    expect(p.lead.assignedTo).toBe("T1");
    expect(p.inbound).toBe(1);
    expect(planIngest({ channel: "wa-web-extension", phone: "923001234567", name: "Ali", messages: [{ text: "hi", fromMe: false, at: 1, id: "m1" }] }, { ...existing, lastMessageText: "hi" }, ctx).kind).toBe("skip");
  });
  it("merges chats by id / text", () => {
    expect(mergeChat([{ text: "a", fromMe: false }], [{ text: "a", fromMe: false, at: 5 }, { text: "b", fromMe: true, at: 6, id: "x" }])).toHaveLength(2);
  });
  it("extracts business name and city", () => {
    expect(extractDetails([msg("Hamara restaurant Burewala mein hai, Faisal Foods naam hai")])).toMatchObject({ city: "Burewala", businessName: "Faisal Foods" });
  });
});
