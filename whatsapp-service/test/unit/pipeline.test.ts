import { beforeEach, describe, expect, it } from "vitest";
import { CapturePipeline, localDate } from "../../src/pipeline.js";
import { mergeSettings, type AccountSettings } from "../../src/types.js";
import { FakeStore } from "./fake-store.js";
import { waMsg } from "./msg.js";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const CUSTOMER = "923001234567@s.whatsapp.net";

let store: FakeStore;
let settings: AccountSettings;
let pipe: CapturePipeline;
let lidMap: Record<string, string>;

beforeEach(() => {
  store = new FakeStore();
  store.recipients = [
    { uid: "admin", perms: ["leads.view", "whatsapp.view"] },
    { uid: "sales", perms: ["whatsapp.view"], teamId: "T1" },
    { uid: "acct", perms: ["finance.view"] },
  ];
  settings = mergeSettings({});
  lidMap = {};
  pipe = new CapturePipeline(store, {
    ws: "ws1",
    accountId: "main",
    settings: () => settings,
    timezone: "Asia/Karachi",
    log: silent,
    resolvePnForLid: async (lid) => lidMap[lid] || null,
  });
});

describe("new WhatsApp contact → lead", () => {
  it("creates conversation, message, lead (source WhatsApp) and notifies lead/inbox users", async () => {
    await pipe.handleMessages([waMsg({ jid: CUSTOMER, pushName: "Bilal", ts: 1790000000, message: { conversation: "Ads ka rate kya hai?" } })], "realtime");

    const conv = store.conversations.get("923001234567")!;
    expect(conv).toMatchObject({ phone: "923001234567", pushName: "Bilal", unreadCount: 1, inboundCount: 1, lastMessageText: "Ads ka rate kya hai?" });
    expect(conv.firstInboundAt).toBe(1790000000000);

    const [lead] = [...store.leads.values()];
    expect(lead).toMatchObject({
      name: "Bilal", phone: "03001234567", whatsapp: "03001234567", phoneE164: "923001234567",
      source: "WhatsApp", status: "New", conversationId: "923001234567", createdBy: "whatsapp-service",
      date: localDate(1790000000000, "Asia/Karachi"),
    });
    expect(lead.id).toMatch(/^LD-/);
    expect(conv.leadId).toBe(lead.id);

    expect(store.notifications.map((n) => n.uid).sort()).toEqual(["admin", "sales"]);
    expect(store.notifications[0].n).toMatchObject({ type: "lead.new", link: { tab: "whatsapp", conversationId: "923001234567" } });
  });

  it("does not duplicate the lead for follow-up messages", async () => {
    await pipe.handleMessages([waMsg({ jid: CUSTOMER, message: { conversation: "hi" } })], "realtime");
    await pipe.handleMessages([waMsg({ jid: CUSTOMER, message: { conversation: "hello?" } })], "realtime");
    expect(store.leads.size).toBe(1);
    expect(store.conversations.get("923001234567")!.unreadCount).toBe(2);
    expect(store.messages.get("923001234567")!.size).toBe(2);
  });

  it("creates one lead when two first messages are processed concurrently", async () => {
    await Promise.all([
      pipe.handleMessages([waMsg({ jid: CUSTOMER, message: { conversation: "1" } })], "realtime"),
      pipe.handleMessages([waMsg({ jid: CUSTOMER, message: { conversation: "2" } })], "realtime"),
    ]);
    expect(store.leads.size).toBe(1);
  });

  it("links to an existing lead saved with a local-format number instead of creating one", async () => {
    store.leads.set("LD-OLD", { id: "LD-OLD", name: "Old Lead", phone: "0300-1234567" } as never);
    await pipe.handleMessages([waMsg({ jid: CUSTOMER, message: { conversation: "salam" } })], "realtime");
    expect(store.leads.size).toBe(1);
    expect(store.conversations.get("923001234567")!.leadId).toBe("LD-OLD");
    expect(store.leads.get("LD-OLD")).toMatchObject({ conversationId: "923001234567" });
    expect(store.notifications).toHaveLength(0);
  });

  it("assigns new leads to the default assignee", async () => {
    settings = mergeSettings({ defaultAssignee: "T1" });
    await pipe.handleMessages([waMsg({ jid: CUSTOMER, message: { conversation: "hi" } })], "realtime");
    expect([...store.leads.values()][0].assignedTo).toBe("T1");
    expect(store.conversations.get("923001234567")!.assignedTo).toBe("T1");
  });

  it("respects autoCreateLeads = false", async () => {
    settings = mergeSettings({ autoCreateLeads: false });
    await pipe.handleMessages([waMsg({ jid: CUSTOMER, message: { conversation: "hi" } })], "realtime");
    expect(store.leads.size).toBe(0);
    expect(store.conversations.size).toBe(1);
  });
});

describe("history, own messages, groups", () => {
  it("history import stores chats without unread counts or leads by default", async () => {
    await pipe.handleMessages([waMsg({ jid: CUSTOMER, message: { conversation: "old" } })], "history");
    expect(store.conversations.get("923001234567")!.unreadCount).toBe(0);
    expect(store.leads.size).toBe(0);
    settings = mergeSettings({ leadsFromHistory: true });
    await pipe.handleMessages([waMsg({ jid: "923005556666@s.whatsapp.net", message: { conversation: "old" } })], "history");
    expect(store.leads.size).toBe(1);
    expect(store.notifications).toHaveLength(0); // no notification storm from history
  });

  it("our replies never create leads and set first-response time", async () => {
    await pipe.handleMessages([waMsg({ jid: CUSTOMER, ts: 1790000000, message: { conversation: "price?" } })], "realtime");
    await pipe.handleMessages([waMsg({ jid: CUSTOMER, fromMe: true, ts: 1790000300, message: { conversation: "Rs 15,000" } })], "realtime");
    const conv = store.conversations.get("923001234567")!;
    expect(conv).toMatchObject({ firstResponseMs: 300_000, outboundCount: 1, lastMessageFromMe: true, unreadCount: 1 });
    expect(store.leads.size).toBe(1);

    await pipe.handleMessages([waMsg({ jid: "923007778888@s.whatsapp.net", fromMe: true, message: { conversation: "outreach" } })], "realtime");
    expect(store.leads.size).toBe(1);
  });

  it("groups and status updates are ignored by default", async () => {
    await pipe.handleMessages([waMsg({ jid: "12036300@g.us", participant: CUSTOMER, message: { conversation: "group msg" } })], "realtime");
    await pipe.handleMessages([waMsg({ jid: "status@broadcast", message: { conversation: "story" } })], "realtime");
    expect(store.conversations.size).toBe(0);
    settings = mergeSettings({ ignoreGroups: false });
    await pipe.handleMessages([waMsg({ jid: "12036300@g.us", participant: CUSTOMER, message: { conversation: "group msg" } })], "realtime");
    expect(store.conversations.has("g_12036300")).toBe(true);
    expect(store.leads.size).toBe(0);
  });
});

describe("privacy ids (@lid) and message updates", () => {
  it("resolves a lid chat to the phone conversation and keeps later messages together", async () => {
    lidMap["555@lid"] = "923001234567@s.whatsapp.net";
    await pipe.handleMessages([waMsg({ jid: "555@lid", message: { conversation: "via lid" } })], "realtime");
    expect(store.conversations.has("923001234567")).toBe(true);
    await pipe.handleMessages([waMsg({ jid: CUSTOMER, alt: "555@lid", message: { conversation: "via pn" } })], "realtime");
    expect(store.conversations.size).toBe(1);
    expect(store.leads.size).toBe(1);
  });

  it("an unresolvable lid chat still becomes a conversation and a lead (deduped by chat)", async () => {
    await pipe.handleMessages([waMsg({ jid: "777@lid", pushName: "Hidden", message: { conversation: "hi" } })], "realtime");
    await pipe.handleMessages([waMsg({ jid: "777@lid", message: { conversation: "again" } })], "realtime");
    expect(store.conversations.has("lid_777")).toBe(true);
    expect(store.leads.size).toBe(1);
    expect([...store.leads.values()][0]).toMatchObject({ name: "Hidden", phone: "" });
  });

  it("applies reactions, deletes, edits and delivery receipts to the stored message", async () => {
    await pipe.handleMessages([waMsg({ jid: CUSTOMER, id: "A1", message: { conversation: "original" } })], "realtime");
    await pipe.handleMessages([waMsg({ jid: CUSTOMER, fromMe: true, id: "R1", message: { reactionMessage: { text: "❤️", key: { id: "A1" } } } })], "realtime");
    await pipe.handleMessages([waMsg({ jid: CUSTOMER, id: "E1", message: { protocolMessage: { type: 14, key: { id: "A1" }, editedMessage: { conversation: "edited" } } } })], "realtime");
    const m = store.messages.get("923001234567")!.get("A1")!;
    expect(m).toMatchObject({ text: "edited", edited: true, "reactions.me": "❤️" });

    await pipe.handleMessages([waMsg({ jid: CUSTOMER, fromMe: true, id: "B1", message: { conversation: "reply" } })], "realtime");
    await pipe.handleUpdates([{ key: { remoteJid: CUSTOMER, id: "B1", fromMe: true }, update: { status: 4 } }]);
    expect(store.messages.get("923001234567")!.get("B1")!.status).toBe("read");
  });

  it("notifies the assignee about new messages on an assigned lead conversation", async () => {
    await pipe.handleMessages([waMsg({ jid: CUSTOMER, message: { conversation: "hi" } })], "realtime");
    await store.upsertConversation("ws1", "923001234567", { assignedTo: "T1" });
    store.notifications = [];
    await pipe.handleMessages([waMsg({ jid: CUSTOMER, message: { conversation: "any update?" } })], "realtime");
    expect(store.notifications.map((n) => n.uid)).toEqual(["sales"]);
    expect(store.notifications[0].n.type).toBe("whatsapp.message");
  });
});

describe("calls and daily stats", () => {
  it("logs an incoming call, marks it missed, and creates a lead for a new caller", async () => {
    const date = new Date(1790000000000);
    await pipe.handleCalls([{ id: "C1", chatId: CUSTOMER, from: CUSTOMER, date, status: "offer", offline: false }]);
    await pipe.handleCalls([{ id: "C1", chatId: CUSTOMER, from: CUSTOMER, date, status: "timeout", offline: false }]);
    const m = store.messages.get("923001234567")!.get("call_C1")!;
    expect(m).toMatchObject({ kind: "call", text: "📵 Missed voice call", callStatus: "timeout" });
    expect(store.leads.size).toBe(1);
    const day = store.stats.get(localDate(date.getTime(), "Asia/Karachi"))!;
    expect(day).toMatchObject({ calls: 1, missedCalls: 1, newLeads: 1, newConversations: 1 });
  });

  it("counts inbound, outbound, per-user replies and first-response time", async () => {
    const sentByPortal = new Set(["R1"]);
    pipe = new CapturePipeline(store, {
      ws: "ws1", accountId: "main", settings: () => settings, timezone: "Asia/Karachi", log: silent,
      portalSender: (id) => (sentByPortal.has(id) ? { uid: "u-sales", email: "s@dt.pk" } : undefined),
    });
    await pipe.handleMessages([waMsg({ jid: CUSTOMER, ts: 1790000000, message: { conversation: "hi" } })], "realtime");
    await pipe.handleMessages([waMsg({ jid: CUSTOMER, id: "R1", fromMe: true, ts: 1790000120, message: { conversation: "Salam!" } })], "realtime");
    const day = store.stats.get(localDate(1790000000000, "Asia/Karachi"))!;
    expect(day).toMatchObject({
      inbound: 1, outbound: 1, portalSent: 1, responses: 1, responseMsTotal: 120000,
      "byUser.u-sales.sent": 1, "byUser.u-sales.responses": 1, "byUser.u-sales.email": "s@dt.pk",
    });
    expect(store.messages.get("923001234567")!.get("R1")).toMatchObject({ source: "portal", createdBy: "u-sales" });
  });
});
