// Runs against the Firestore emulator:  npm run test:integration
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { initAuthCreds } from "@whiskeysockets/baileys";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useFirestoreAuthState } from "../../src/auth-state.js";
import { SessionCipher } from "../../src/crypto.js";
import { Lease } from "../../src/lease.js";
import { CapturePipeline } from "../../src/pipeline.js";
import { FirestoreStore } from "../../src/store.js";
import { mergeSettings, type LeadRecord } from "../../src/types.js";
import { waMsg } from "../unit/msg.js";

const PRESETS = fileURLToPath(new URL("../../../src/lib/permission-presets.json", import.meta.url));
const WS = "wsInt";
let app: App;
let db: Firestore;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Run via npm run test:integration (needs the emulator)");
  app = initializeApp({ projectId: "demo-dt" }, `it-${Date.now()}`);
  db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-dt/databases/(default)/documents`, { method: "DELETE" });
});

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const lead = (id: string, phone: string): LeadRecord => ({
  id, name: "x", phone, whatsapp: phone, phoneE164: phone, category: "Other", serviceType: "", software: "", plan: "",
  status: "New", source: "WhatsApp", referralBy: "", meetingDate: "", followUpDate: "", notes: "", date: "2026-09-26",
  createdAt: new Date().toISOString(), createdBy: "test", conversationId: phone, waJid: "", waAccountId: "main", assignedTo: "",
});

describe("FirestoreStore", () => {
  it("creates exactly one lead when many first messages race (transactional dedup)", async () => {
    const store = new FirestoreStore(db, PRESETS);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => store.createLeadIfAbsent(WS, "923001234567", lead(`LD-${i}`, "923001234567")))
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.leadId)).size).toBe(1);
    const leads = await db.collection(`users/${WS}/leads`).get();
    expect(leads.size).toBe(1);
  });

  it("finds legacy leads saved with local-format numbers and indexes them", async () => {
    await db.doc(`users/${WS}/leads/LD-LEGACY`).set({ id: "LD-LEGACY", name: "Old", phone: "0300-1234567", whatsapp: "0300-1234567" });
    const store = new FirestoreStore(db, PRESETS);
    expect(await store.findLeadIdByPhone(WS, "923001234567")).toBe("LD-LEGACY");
    expect((await db.doc(`users/${WS}/leadPhoneIndex/923001234567`).get()).get("leadId")).toBe("LD-LEGACY");
  });

  it("notifies only active users with the permission (presets + explicit lists)", async () => {
    const roles = db.collection("roles");
    await roles.doc("a").set({ uid: "a", role: "admin", workspaceUid: WS });
    await roles.doc("s").set({ uid: "s", role: "sales_support", workspaceUid: WS, teamId: "T1" });
    await roles.doc("c").set({ uid: "c", role: "custom", workspaceUid: WS, permissions: ["finance.view"] });
    await roles.doc("d").set({ uid: "d", role: "lead_manager", workspaceUid: WS, disabled: true });
    await roles.doc("o").set({ uid: "o", role: "admin", workspaceUid: "other" });
    const store = new FirestoreStore(db, PRESETS);
    expect((await store.listRecipients(WS, ["whatsapp.view"])).sort()).toEqual(["a", "s"]);
    expect(await store.listRecipients(WS, ["whatsapp.view"], "T1")).toEqual(["s"]);
    await store.notify(WS, ["a", "s"], { type: "lead.new", title: "t", body: "b" });
    const n = await db.collection(`users/${WS}/notifications`).get();
    expect(n.docs.map((d) => d.get("userUid")).sort()).toEqual(["a", "s"]);
    expect(n.docs[0].get("read")).toBe(false);
  });
});

describe("pipeline on Firestore", () => {
  it("captures realtime messages into conversation, message and lead documents", async () => {
    const store = new FirestoreStore(db, PRESETS);
    const pipe = new CapturePipeline(store, { ws: WS, accountId: "main", settings: () => mergeSettings({}), timezone: "Asia/Karachi", log: silent });
    await pipe.handleMessages([waMsg({ jid: "923451873354@s.whatsapp.net", pushName: "Test", message: { conversation: "Salam" } })], "realtime");
    await pipe.handleMessages([waMsg({ jid: "923451873354@s.whatsapp.net", message: { conversation: "Rate?" } })], "realtime");

    const conv = await db.doc(`users/${WS}/waConversations/923451873354`).get();
    expect(conv.data()).toMatchObject({ phone: "923451873354", unreadCount: 2, pushName: "Test", lastMessageText: "Rate?" });
    const msgs = await conv.ref.collection("messages").get();
    expect(msgs.size).toBe(2);
    const leads = await db.collection(`users/${WS}/leads`).get();
    expect(leads.size).toBe(1);
    expect(leads.docs[0].data()).toMatchObject({ phone: "03451873354", source: "WhatsApp", conversationId: "923451873354" });
    expect(conv.get("leadId")).toBe(leads.docs[0].id);
  });

  it("writes a large history import in batches", async () => {
    const store = new FirestoreStore(db, PRESETS);
    const pipe = new CapturePipeline(store, { ws: WS, accountId: "main", settings: () => mergeSettings({}), timezone: "Asia/Karachi", log: silent });
    const messages = Array.from({ length: 300 }, (_, i) =>
      waMsg({ jid: `9230000000${String(i % 30).padStart(2, "0")}@s.whatsapp.net`, id: `H${i}`, ts: 1780000000 + i, message: { conversation: `m${i}` } })
    );
    await store.runBatch(() => pipe.handleMessages(messages, "history"));
    const convs = await db.collection(`users/${WS}/waConversations`).get();
    expect(convs.size).toBe(30);
    const one = convs.docs.find((d) => d.id === "923000000000")!;
    expect(one.get("inboundCount")).toBe(10);
    expect(one.get("lastMessageText")).toBe("m270");
    expect((await one.ref.collection("messages").get()).size).toBe(10);
    expect((await db.collection(`users/${WS}/leads`).get()).size).toBe(0);
    const stats = await db.collection(`users/${WS}/waStats`).get();
    expect(stats.docs.reduce((n, d) => n + (d.get("inbound") || 0), 0)).toBe(300);
    expect(stats.docs.reduce((n, d) => n + (d.get("newConversations") || 0), 0)).toBe(30);
  });
});

describe("session storage and lease", () => {
  it("stores creds and signal keys encrypted and reads them back", async () => {
    const cipher = new SessionCipher(randomBytes(32));
    const a = await useFirestoreAuthState(db, "ws__main", cipher);
    a.state.creds = { ...initAuthCreds(), registered: true };
    await a.saveCreds();
    await a.state.keys.set({ "pre-key": { "1": { public: Buffer.from("pub"), private: Buffer.from("priv") } } });

    const raw = await db.doc("waSessions/ws__main/keys/pre-key-1").get();
    expect(String(raw.get("v"))).toMatch(/^v1:/);
    expect(String(raw.get("v"))).not.toContain("priv");

    const b = await useFirestoreAuthState(db, "ws__main", cipher);
    expect(b.state.creds.registered).toBe(true);
    const got = await b.state.keys.get("pre-key", ["1", "2"]);
    expect(Buffer.from(got["1"].private).toString()).toBe("priv");
    expect(got["2"]).toBeUndefined();

    await b.clear();
    expect((await db.doc("waSessions/ws__main/keys/pre-key-1").get()).exists).toBe(false);
  });

  it("lets only one instance hold a session", async () => {
    const one = new Lease(db, "ws__main", "instance-1", 5_000);
    const two = new Lease(db, "ws__main", "instance-2", 5_000);
    expect(await one.acquire()).toBe(true);
    expect(await two.acquire()).toBe(false);
    await one.release();
    expect(await two.acquire()).toBe(true);
    await two.release();
  });
});
