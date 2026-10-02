// Security rules tests. Run with the emulator:  npm run test:rules
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const WS = "admin";
let env: RulesTestEnvironment;

const roles: Record<string, Record<string, unknown>> = {
  admin: { uid: "admin", email: "a@dt.pk", role: "admin", workspaceUid: WS },
  manager: { uid: "manager", email: "m@dt.pk", role: "manager", workspaceUid: WS },
  acct: { uid: "acct", email: "acc@dt.pk", role: "accountant", workspaceUid: WS },
  sales: { uid: "sales", email: "s@dt.pk", role: "sales_support", workspaceUid: WS },
  leadmgr: { uid: "leadmgr", email: "lm@dt.pk", role: "lead_manager", workspaceUid: WS },
  legacyAssistant: { uid: "legacyAssistant", email: "as@dt.pk", role: "assistant", workspaceUid: WS },
  designer: { uid: "designer", email: "d@dt.pk", role: "graphic_designer", workspaceUid: WS, teamId: "T1" },
  disabled: { uid: "disabled", email: "x@dt.pk", role: "lead_manager", workspaceUid: WS, disabled: true },
  outsider: { uid: "outsider", email: "o@other.pk", role: "admin", workspaceUid: "other" },
  userAdmin: {
    uid: "userAdmin", email: "ua@dt.pk", role: "custom", workspaceUid: WS,
    permissions: ["users.manage", "leads.view"],
  },
  assigner: {
    uid: "assigner", email: "asg@dt.pk", role: "custom", workspaceUid: WS,
    permissions: ["leads.view", "leads.assign"],
  },
};

const db = (uid?: string) =>
  (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();
const wsDoc = (uid: string, path: string) => doc(db(uid), `users/${WS}/${path}`);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-dt",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8085 },
    storage: { rules: readFileSync("storage.rules", "utf8"), host: "127.0.0.1", port: 9199 },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    for (const [uid, r] of Object.entries(roles)) await setDoc(doc(f, "roles", uid), r);
    const put = (p: string, d: Record<string, unknown>) => setDoc(doc(f, `users/${WS}/${p}`), d);
    await put("meta/settings", { footer: "Digital Target" });
    await put("leads/L1", { id: "L1", name: "Ali", phone: "03001234567", status: "New" });
    await put("invoices/I1", { id: "I1", grandTotal: 1000 });
    await put("wallets/W1", { id: "W1", name: "Cash", balance: 500 });
    await put("team/T1", { id: "T1", name: "Designer One" });
    await put("team/T2", { id: "T2", name: "Editor Two" });
    await put("assignments/A1", { id: "A1", memberId: "T1", title: "Logo", status: "Assigned", rate: 1000, messages: [] });
    await put("assignments/A2", { id: "A2", memberId: "T2", title: "Reel", status: "Assigned", rate: 2000, messages: [] });
    await put("queries/Q1", { id: "Q1", memberId: "T1", subject: "Pay", status: "Open", messages: [] });
    await put("schedule/S1", { id: "S1", assignedTo: "T1", task: "Call" });
    await put("waAccounts/main", { id: "main", status: "connected", command: null, settings: {} });
    await put("waConversations/C1", { id: "C1", jid: "923001234567@s.whatsapp.net", lastMessageText: "hi" });
    await put("waConversations/C1/messages/M1", { id: "M1", text: "hi" });
    await put("notifications/N1", { id: "N1", userUid: "sales", read: false, createdBy: "system" });
    await put("auditLogs/AL1", { id: "AL1", actorUid: "admin", action: "create" });
    await setDoc(doc(f, "waSessions/main"), { creds: "secret" });
  });
});

describe("accounts and sign-up", () => {
  it("a signed-in user without a role doc cannot read business data", async () => {
    await assertFails(getDoc(wsDoc("stranger", "leads/L1")));
    await assertFails(getDoc(wsDoc("stranger", "meta/settings")));
  });

  it("nobody can self-register a role (old auto-assistant / auto-admin path is closed)", async () => {
    await assertFails(setDoc(doc(db("stranger"), "roles/stranger"),
      { uid: "stranger", role: "assistant", workspaceUid: WS }));
    await assertFails(setDoc(doc(db("stranger"), "roles/stranger"),
      { uid: "stranger", role: "admin", workspaceUid: "stranger" }));
  });

  it("disabled accounts lose access", async () => {
    await assertFails(getDoc(wsDoc("disabled", "leads/L1")));
  });

  it("users of another workspace cannot read this workspace", async () => {
    await assertFails(getDoc(wsDoc("outsider", "leads/L1")));
  });

  it("users can read their own role doc but not others'", async () => {
    await assertSucceeds(getDoc(doc(db("sales"), "roles/sales")));
    await assertFails(getDoc(doc(db("sales"), "roles/admin")));
  });

  it("admin lists workspace users; sales cannot", async () => {
    const q = (uid: string) => query(collection(db(uid), "roles"), where("workspaceUid", "==", WS));
    await assertSucceeds(getDocs(q("admin")));
    await assertFails(getDocs(q("sales")));
  });

  it("admin creates and disables accounts in own workspace only, never deletes", async () => {
    await assertSucceeds(setDoc(doc(db("admin"), "roles/new1"),
      { uid: "new1", role: "sales_support", workspaceUid: WS }));
    await assertFails(setDoc(doc(db("admin"), "roles/new2"),
      { uid: "new2", role: "sales_support", workspaceUid: "other" }));
    await assertSucceeds(updateDoc(doc(db("admin"), "roles/sales"), { disabled: true }));
    await assertFails(deleteDoc(doc(db("admin"), "roles/sales")));
  });

  it("nobody edits their own role doc", async () => {
    await assertFails(updateDoc(doc(db("admin"), "roles/admin"), { role: "super_admin" }));
    await assertFails(updateDoc(doc(db("sales"), "roles/sales"), { permissions: ["finance.view"] }));
  });

  it("manager (no users.manage) cannot create accounts", async () => {
    await assertFails(setDoc(doc(db("manager"), "roles/new3"),
      { uid: "new3", role: "sales_support", workspaceUid: WS }));
  });

  it("a delegated user admin cannot escalate privileges", async () => {
    // Cannot create admins
    await assertFails(setDoc(doc(db("userAdmin"), "roles/n4"), { uid: "n4", role: "admin", workspaceUid: WS }));
    // Cannot grant permissions they do not hold (explicit or via preset)
    await assertFails(setDoc(doc(db("userAdmin"), "roles/n5"),
      { uid: "n5", role: "custom", workspaceUid: WS, permissions: ["finance.view"] }));
    await assertFails(setDoc(doc(db("userAdmin"), "roles/n6"),
      { uid: "n6", role: "sales_support", workspaceUid: WS }));
    // Cannot modify an admin account
    await assertFails(updateDoc(doc(db("userAdmin"), "roles/admin"), { disabled: true }));
    // Can create within their own grants
    await assertSucceeds(setDoc(doc(db("userAdmin"), "roles/n7"),
      { uid: "n7", role: "custom", workspaceUid: WS, permissions: ["leads.view"] }));
  });
});

describe("role-based data access", () => {
  it("sales reads and creates leads but cannot delete them or see finance", async () => {
    await assertSucceeds(getDoc(wsDoc("sales", "leads/L1")));
    await assertSucceeds(setDoc(wsDoc("sales", "leads/L2"), { id: "L2", name: "New" }));
    await assertFails(deleteDoc(wsDoc("sales", "leads/L1")));
    await assertFails(getDoc(wsDoc("sales", "invoices/I1")));
    await assertFails(getDoc(wsDoc("sales", "wallets/W1")));
  });

  it("legacy role docs without a permissions list still use the role preset", async () => {
    await assertSucceeds(getDoc(wsDoc("legacyAssistant", "leads/L1")));
    await assertFails(getDoc(wsDoc("legacyAssistant", "invoices/I1")));
  });

  it("accountant sees finance but not leads", async () => {
    await assertSucceeds(getDoc(wsDoc("acct", "invoices/I1")));
    await assertSucceeds(updateDoc(wsDoc("acct", "wallets/W1"), { balance: 600 }));
    await assertFails(getDoc(wsDoc("acct", "leads/L1")));
  });

  it("assign-only users can change the assignee and nothing else", async () => {
    await assertSucceeds(updateDoc(wsDoc("assigner", "leads/L1"), { assignedTo: "T1", assignedAt: "now" }));
    await assertFails(updateDoc(wsDoc("assigner", "leads/L1"), { status: "Converted" }));
  });

  it("writes to unknown collections are denied", async () => {
    await assertFails(setDoc(wsDoc("admin", "settings/junk"), { a: 1 }));
  });

  it("settings: every member reads, only settings.manage writes", async () => {
    await assertSucceeds(getDoc(wsDoc("sales", "meta/settings")));
    await assertFails(setDoc(wsDoc("acct", "meta/settings"), { footer: "x" }));
    await assertSucceeds(setDoc(wsDoc("manager", "meta/settings"), { footer: "x" }));
  });
});

describe("My Portal (team member) scoping", () => {
  const own = (uid: string, col: string, field: string, val: string) =>
    getDocs(query(collection(db(uid), `users/${WS}/${col}`), where(field, "==", val)));

  it("reads only own assignments, queries, schedule and team record", async () => {
    await assertSucceeds(own("designer", "assignments", "memberId", "T1"));
    await assertFails(own("designer", "assignments", "memberId", "T2"));
    await assertFails(getDocs(collection(db("designer"), `users/${WS}/assignments`)));
    await assertFails(getDoc(wsDoc("designer", "assignments/A2")));
    await assertSucceeds(own("designer", "queries", "memberId", "T1"));
    await assertSucceeds(own("designer", "schedule", "assignedTo", "T1"));
    await assertSucceeds(getDoc(wsDoc("designer", "team/T1")));
    await assertFails(getDoc(wsDoc("designer", "team/T2")));
    await assertFails(getDoc(wsDoc("designer", "invoices/I1")));
    await assertFails(getDoc(wsDoc("designer", "leads/L1")));
  });

  it("updates status/messages on own assignment only", async () => {
    await assertSucceeds(updateDoc(wsDoc("designer", "assignments/A1"), { status: "In Progress" }));
    await assertFails(updateDoc(wsDoc("designer", "assignments/A1"), { rate: 99999 }));
    await assertFails(updateDoc(wsDoc("designer", "assignments/A2"), { status: "Completed" }));
  });

  it("raises queries for own record only", async () => {
    await assertSucceeds(setDoc(wsDoc("designer", "queries/Q2"),
      { id: "Q2", memberId: "T1", status: "Open", subject: "Leave", messages: [] }));
    await assertFails(setDoc(wsDoc("designer", "queries/Q3"),
      { id: "Q3", memberId: "T2", status: "Open", subject: "x", messages: [] }));
    await assertFails(updateDoc(wsDoc("designer", "queries/Q1"), { status: "Resolved" }));
  });
});

describe("WhatsApp", () => {
  const outbox = (over: Record<string, unknown> = {}) => ({
    id: "O1", accountId: "main", conversationId: "C1", text: "Salam", status: "queued",
    createdBy: "sales", createdByEmail: "s@dt.pk", createdAt: "2026-09-26T10:00:00Z", ...over,
  });

  it("inbox readers see conversations and messages; others do not", async () => {
    await assertSucceeds(getDoc(wsDoc("sales", "waConversations/C1")));
    await assertSucceeds(getDoc(wsDoc("sales", "waConversations/C1/messages/M1")));
    await assertFails(getDoc(wsDoc("acct", "waConversations/C1")));
    await assertFails(getDoc(wsDoc("acct", "waConversations/C1/messages/M1")));
  });

  it("messages and session keys cannot be written or read by any client", async () => {
    await assertFails(setDoc(wsDoc("admin", "waConversations/C1/messages/M2"), { text: "fake" }));
    await assertFails(getDoc(doc(db("admin"), "waSessions/main")));
    await assertFails(setDoc(doc(db("admin"), "waSessions/main"), { creds: "x" }));
  });

  it("replies go through a validated outbox", async () => {
    await assertSucceeds(setDoc(wsDoc("sales", "waOutbox/O1"), outbox()));
    await assertFails(setDoc(wsDoc("sales", "waOutbox/O2"), outbox({ id: "O2", status: "sent" })));
    await assertFails(setDoc(wsDoc("sales", "waOutbox/O3"), outbox({ id: "O3", createdBy: "admin" })));
    await assertFails(setDoc(wsDoc("sales", "waOutbox/O4"), outbox({ id: "O4", jid: "923009999999@s.whatsapp.net" })));
    await assertFails(setDoc(wsDoc("sales", "waOutbox/O5"), outbox({ id: "O5", text: "" })));
    await assertFails(setDoc(wsDoc("acct", "waOutbox/O6"), outbox({ id: "O6", createdBy: "acct" })));
    // attachments: own outbox folder only; caption may be empty
    const media = { path: `workspaces/${WS}/whatsapp-outbox/O7/menu.jpg`, mimetype: "image/jpeg", fileName: "menu.jpg", size: 1000 };
    await assertSucceeds(setDoc(wsDoc("sales", "waOutbox/O7"), outbox({ id: "O7", text: "", media })));
    await assertFails(setDoc(wsDoc("sales", "waOutbox/O8"), outbox({ id: "O8", text: "", media: { ...media, path: "workspaces/other/whatsapp-outbox/O8/x.jpg" } })));
    await assertFails(setDoc(wsDoc("sales", "waOutbox/O9"), outbox({ id: "O9", media: { ...media, path: `workspaces/${WS}/whatsapp/C1/photo.jpg` } })));
  });

  it("conversation triage fields are editable, message data is not", async () => {
    await assertSucceeds(updateDoc(wsDoc("sales", "waConversations/C1"), { assignedTo: "T1", tags: ["hot"] }));
    await assertFails(updateDoc(wsDoc("sales", "waConversations/C1"), { lastMessageText: "edited" }));
  });

  it("only whatsapp.manage can send connect commands; nobody fakes status", async () => {
    const cmd = { command: { action: "connect", requestedBy: "x", requestedAt: "now" } };
    await assertFails(updateDoc(wsDoc("leadmgr", "waAccounts/main"), cmd));
    await assertSucceeds(updateDoc(wsDoc("manager", "waAccounts/main"), cmd));
    await assertFails(updateDoc(wsDoc("manager", "waAccounts/main"), { status: "error" }));
  });
});

describe("public invoice verification", () => {
  const T = "0123456789abcdef0123456789abcdef";
  const summary = (ws = WS) => ({ token: T, workspaceUid: ws, number: "DT-INV-2026-0001", grandTotal: 1000, status: "Unpaid" });
  it("anyone can read one summary by token; nobody can list", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `invoiceVerify/${T}`), summary()); });
    await assertSucceeds(getDoc(doc(db(), `invoiceVerify/${T}`)));
    await assertFails(getDocs(collection(db(), "invoiceVerify")));
  });
  it("only invoice managers of the same workspace write summaries", async () => {
    await assertSucceeds(setDoc(doc(db("acct"), `invoiceVerify/${T}`), summary()));
    await assertFails(setDoc(doc(db("sales"), `invoiceVerify/${T}`), summary()));
    await assertFails(setDoc(doc(db("outsider"), `invoiceVerify/${T}`), summary()));
    await assertFails(setDoc(doc(db("acct"), `invoiceVerify/${T}`), summary("other")));
    await assertFails(setDoc(doc(db(), `invoiceVerify/${T}`), summary()));
  });
});

describe("notifications and audit log", () => {
  it("notifications are private to their recipient", async () => {
    await assertSucceeds(getDoc(wsDoc("sales", "notifications/N1")));
    await assertFails(getDoc(wsDoc("leadmgr", "notifications/N1")));
    await assertSucceeds(updateDoc(wsDoc("sales", "notifications/N1"), { read: true }));
    await assertFails(updateDoc(wsDoc("sales", "notifications/N1"), { userUid: "leadmgr" }));
  });

  it("audit log is append-only and readable with audit.view", async () => {
    await assertSucceeds(setDoc(wsDoc("sales", "auditLogs/AL2"), { id: "AL2", actorUid: "sales", action: "update" }));
    await assertFails(setDoc(wsDoc("sales", "auditLogs/AL3"), { id: "AL3", actorUid: "admin", action: "update" }));
    await assertFails(updateDoc(wsDoc("admin", "auditLogs/AL1"), { action: "tampered" }));
    await assertFails(deleteDoc(wsDoc("sales", "auditLogs/AL2")));
    await assertSucceeds(getDoc(wsDoc("admin", "auditLogs/AL1")));
    await assertFails(getDoc(wsDoc("sales", "auditLogs/AL1")));
  });
});

// firebase-tools sends the storage emulator's cross-service Firestore lookups
// through HTTPS_PROXY (it ignores NO_PROXY), so behind a proxy firestore.get()
// in storage.rules always sees "not found". Run without a proxy to verify.
describe("monthly closing & history protection", () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const f = ctx.firestore();
      await setDoc(doc(f, `users/${WS}/clients/C1`), { id: "C1", name: "Abdullah Medicare" });
      await setDoc(doc(f, `users/${WS}/invoices/OLD`), { id: "OLD", grandTotal: 500, archivedMonth: "2026-08" });
      await setDoc(doc(f, `users/${WS}/monthlyArchives/2026-08`), { id: "2026-08", month: "2026-08", status: "closed" });
      await setDoc(doc(f, `users/${WS}/projects/P1`), { id: "P1", title: "Done", status: "Complete" });
    });
  });

  it("clients are never deleted from the normal portal; only the administrator can", async () => {
    await assertFails(deleteDoc(wsDoc("manager", "clients/C1")));
    await assertSucceeds(updateDoc(wsDoc("manager", "clients/C1"), { phone: "0300" }));
    await assertSucceeds(deleteDoc(wsDoc("admin", "clients/C1")));
  });

  it("closed-month records are read-only for everyone but the administrator", async () => {
    await assertSucceeds(getDoc(wsDoc("acct", "invoices/OLD")));
    await assertFails(updateDoc(wsDoc("acct", "invoices/OLD"), { grandTotal: 1 }));
    await assertFails(deleteDoc(wsDoc("manager", "invoices/OLD")));
    await assertSucceeds(updateDoc(wsDoc("admin", "invoices/OLD"), { note: "fix" }));
    await assertSucceeds(deleteDoc(wsDoc("admin", "invoices/OLD")));
  });

  it("only the administrator reads or writes the archive", async () => {
    await assertFails(getDoc(wsDoc("manager", "monthlyArchives/2026-08")));
    await assertFails(setDoc(wsDoc("manager", "monthlyArchives/2026-09"), { month: "2026-09" }));
    await assertSucceeds(getDoc(wsDoc("admin", "monthlyArchives/2026-08")));
    await assertSucceeds(setDoc(wsDoc("admin", "monthlyArchives/2026-09"), { month: "2026-09", status: "closing" }));
  });

  it("closed accounting entries: only the administrator can change or delete them", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${WS}/accounting/ACL1`), { id: "ACL1", type: "OUT", amount: 500, date: "2026-09-01", archivedMonth: "day:2026-09-01" });
    });
    await assertFails(deleteDoc(wsDoc("manager", "accounting/ACL1")));
    await assertFails(updateDoc(wsDoc("manager", "accounting/ACL1"), { amount: 1 }));
    await assertSucceeds(updateDoc(wsDoc("admin", "accounting/ACL1"), { archivedMonth: "" }));
  });

  it("closing stamps records (admin); a manager cannot archive or un-archive", async () => {
    await assertSucceeds(updateDoc(wsDoc("admin", "projects/P1"), { archivedMonth: "2026-09" }));
    await assertFails(updateDoc(wsDoc("manager", "projects/P1"), { archivedMonth: "" }));
  });

  it("an administrator can link their own account to a team record, nothing else", async () => {
    await assertSucceeds(updateDoc(doc(db("admin"), "roles/admin"), { teamId: "T1", updatedAt: 1, updatedBy: "admin" }));
    await assertFails(updateDoc(doc(db("admin"), "roles/admin"), { role: "team_member" }));
    await assertFails(updateDoc(doc(db("manager"), "roles/manager"), { teamId: "T1", updatedAt: 1, updatedBy: "manager" }));
  });

  it("only the administrator can clear old audit entries; chat data stays protected", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${WS}/auditLogs/A1`), { actorUid: "admin", action: "x" });
      await setDoc(doc(ctx.firestore(), `users/${WS}/waConversations/923001234567`), { id: "923001234567" });
    });
    await assertFails(deleteDoc(wsDoc("manager", "auditLogs/A1")));
    await assertSucceeds(deleteDoc(wsDoc("admin", "auditLogs/A1")));
    await assertFails(deleteDoc(wsDoc("admin", "waConversations/923001234567")));
  });

  it("targets: finance managers write, dashboard users read", async () => {
    await assertSucceeds(setDoc(wsDoc("acct", "targets/2026-10"), { month: "2026-10", revenue: 500000 }));
    await assertSucceeds(getDoc(wsDoc("manager", "targets/2026-10")));
    await assertFails(setDoc(wsDoc("sales", "targets/2026-10"), { month: "2026-10", revenue: 1 }));
  });

  it("campaigns and opt-outs need the Message Center permission", async () => {
    await assertSucceeds(setDoc(wsDoc("leadmgr", "waCampaigns/X"), { id: "X", status: "draft" }));
    await assertFails(setDoc(wsDoc("acct", "waCampaigns/Y"), { id: "Y" }));
    await assertSucceeds(setDoc(wsDoc("leadmgr", "optOuts/923001234567"), { phone: "923001234567" }));
    await assertFails(getDocs(collection(db("acct"), `users/${WS}/optOuts`)));
  });

  it("the daily send counter is for campaign managers only", async () => {
    await assertSucceeds(setDoc(wsDoc("leadmgr", "waDailyCounts/2026-09-29"), { date: "2026-09-29", sent: 1 }));
    await assertFails(setDoc(wsDoc("acct", "waDailyCounts/2026-09-29"), { sent: 0 }));
  });

  it("campaign managers can delete campaigns; others cannot", async () => {
    await assertSucceeds(setDoc(wsDoc("leadmgr", "waCampaigns/D1"), { id: "D1", status: "completed" }));
    await assertFails(deleteDoc(wsDoc("acct", "waCampaigns/D1")));
    await assertSucceeds(deleteDoc(wsDoc("leadmgr", "waCampaigns/D1")));
  });
});

describe("storage (WhatsApp media)", () => {
  const path = `workspaces/${WS}/whatsapp/C1/photo.jpg`;
  it.skipIf(!!(process.env.HTTPS_PROXY || process.env.HTTP_PROXY))("inbox readers can download media; nobody uploads from the client", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), path), new Uint8Array([1, 2, 3]));
    });
    await assertSucceeds(getBytes(ref(env.authenticatedContext("sales").storage(), path)));
    await assertFails(getBytes(ref(env.authenticatedContext("acct").storage(), path)));
    await assertFails(uploadBytes(ref(env.authenticatedContext("admin").storage(), path), new Uint8Array([9])));
  });
});
