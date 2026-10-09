// Firestore side of the sales flow: create-if-absent (one lead per WhatsApp
// number, safe when several computers capture the same message), TAKE LEAD
// (first one wins), round-robin assignment and notifications.
import { arrayUnion, doc, getDoc, runTransaction, setDoc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import { InboundConversation, IngestPlan, pickCaptureFields, planIngest, IngestContext, mergeChat } from "./leadIngest";
import { findLeadForChat } from "./leadCapture";
import { normalizePhone, formatLocalPhone } from "./phone";
import { formatQuoteNumber } from "./quotation";
import {
  SalesAssistant, SalesSettings, activeAssistants, assistantsForUnit, assignedLead, nextRoundRobin, statusLabel, takeBlocker, takenLead, temperatureOf,
} from "./salesPipeline";

const leadRef = (ws: string, id: string) => doc(db, "users", ws, "leads", id);
const indexRef = (ws: string, phone: string) => doc(db, "users", ws, "leadPhoneIndex", phone);

export interface NotifyInput { type: string; title: string; body: string; link: Record<string, unknown>; lead?: Record<string, unknown> }

/**
 * One notification per recipient. The id is fixed per event and person, so
 * two computers capturing the same message do not notify twice.
 */
export async function notify(ws: string, by: string, uids: string[], key: string, n: NotifyInput, o: { silent?: boolean } = {}) {
  const createdAt = new Date().toISOString();
  await Promise.all(Array.from(new Set(uids.filter(Boolean))).map(async (userUid) => {
    const id = `N-${key}-${userUid}`.replace(/[^\w-]/g, "_").slice(0, 140);
    try {
      const ref = doc(db, "users", ws, "notifications", id);
      // silent = listed in the bell without a pop-up / unread count
      await setDoc(ref, { id, userUid, ...n, read: !!o.silent, createdAt, createdBy: by });
    } catch { /* already sent by another computer, or no access */ }
  }));
}

/** Next assistant in turn (shared counter, transaction so two captures never pick the same slot twice). */
export async function roundRobinPick(ws: string, list: SalesAssistant[]): Promise<SalesAssistant | null> {
  if (!list.length) return null;
  const ref = doc(db, "users", ws, "salesState", "roundrobin");
  return runTransaction(db, async (tx) => {
    const cur = await tx.get(ref);
    const pick = nextRoundRobin(list, cur.exists() ? (cur.data().lastTeamId as string) : null);
    if (pick) tx.set(ref, { id: "roundrobin", lastTeamId: pick.teamId, at: new Date().toISOString() });
    return pick;
  });
}

export interface IngestResult { kind: "created" | "updated" | "skipped"; leadId?: string; reason?: string; lead?: any }

/**
 * Writes one captured conversation to the CRM.
 * `visibleLeads` = leads this user can read (all for the CEO, own + pool for an assistant).
 */
export async function ingestConversation(
  ws: string,
  conv: InboundConversation,
  o: { visibleLeads: any[]; canEditAll: boolean; uid: string; myTeamId?: string; sales: SalesSettings; ctx: IngestContext }
): Promise<IngestResult> {
  const phone = normalizePhone(conv.phone) || "";
  // 1) find the lead: phone index first (also covers leads this user cannot see), then loaded leads.
  let leadId: string | null = null;
  let staleId: string | null = null;
  if (phone) {
    try { const ix = await getDoc(indexRef(ws, phone)); if (ix.exists()) leadId = String(ix.data().leadId || "") || null; } catch { /* no index access */ }
  }
  const visible = (leadId && o.visibleLeads.find((l) => l.id === leadId))
    || findLeadForChat({ key: conv.jid || phone, jid: conv.jid, phone: phone || undefined, name: conv.name }, o.visibleLeads) || null;
  if (visible && phone && !leadId) setDoc(indexRef(ws, phone), { leadId: visible.id, phone }).catch(() => undefined);

  // 2) existing lead this user cannot read (another assistant's): add the messages only.
  if (!visible && leadId) {
    const entries = mergeChat([], conv.messages);
    if (!entries.length) return { kind: "skipped", reason: "Koi message nahi" };
    const lastIn = [...conv.messages].reverse().find((m) => !m.fromMe);
    try {
      await updateDoc(leadRef(ws, leadId), {
        chat: arrayUnion(...entries),
        ...(lastIn ? { lastMessageAt: new Date(lastIn.at).toISOString(), lastMessageText: lastIn.text.slice(0, 300), lastInboundAt: new Date(lastIn.at).toISOString() } : {}),
        updatedAt: new Date().toISOString(),
      });
      return { kind: "updated", leadId };
    } catch (e) {
      if ((e as { code?: string }).code !== "not-found") throw e;
      staleId = leadId; leadId = null; // index points to a deleted lead → create below
    }
  }

  // 3) known lead: re-read it inside a transaction so a capture never overwrites what the assistant just saved.
  if (visible) {
    const ref = leadRef(ws, visible.id);
    const res = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return null; // deleted meanwhile → treated as new below
      const p = planIngest(conv, { ...snap.data(), id: visible.id }, o.ctx);
      if (p.kind !== "update") return p;
      // The owner / CEO writes the whole lead; anyone else only the conversation fields (rules enforce the same).
      const mine = o.canEditAll || (!!p.lead.assignedTo && p.lead.assignedTo === o.myTeamId);
      if (mine) tx.set(ref, p.lead);
      else tx.update(ref, pickCaptureFields(p.lead));
      return p;
    });
    if (res && res.kind === "skip") return { kind: "skipped", reason: res.reason };
    if (res && res.kind === "update") {
      const next = res.lead;
      // Assistant handling the lead hears about the customer's new message.
      if (res.inbound && next.assignedTo) {
        const who = o.sales.assistants.find((a) => a.teamId === next.assignedTo);
        if (who?.uid && who.uid !== o.uid) {
          await notify(ws, o.uid, [who.uid], `msg-${next.id}-${Math.floor(Date.parse(next.lastInboundAt || "") / 60000)}`, {
            type: "lead.message", title: `Naya message — ${next.name}`, body: String(next.lastMessageText || "").slice(0, 120),
            link: { tab: "sales", openLead: next.id },
          });
        }
      }
      return { kind: "updated", leadId: next.id, lead: next };
    }
    if (phone) staleId = staleId || visible.id;
  }

  const plan: IngestPlan = planIngest(conv, null, o.ctx);
  if (plan.kind === "skip") return { kind: "skipped", reason: plan.reason };
  if (plan.kind !== "create") return { kind: "skipped", reason: "Lead nahi ban saki" };

  // 3) new lead: assignment first (round-robin), then create-if-absent in one transaction with the phone index.
  let lead = plan.lead;
  if (o.sales.mode === "roundrobin") {
    const pick = await roundRobinPick(ws, assistantsForUnit(o.sales, lead.unit)).catch(() => null);
    if (pick) lead = assignedLead(lead, pick, "auto", "roundrobin");
  }
  const created = await runTransaction(db, async (tx) => {
    if (phone) {
      const ix = await tx.get(indexRef(ws, phone));
      if (ix.exists() && ix.data().leadId && ix.data().leadId !== staleId) return { id: String(ix.data().leadId), created: false };
    }
    tx.set(leadRef(ws, lead.id), lead);
    if (phone) tx.set(indexRef(ws, phone), { leadId: lead.id, phone, createdAt: lead.createdAt });
    return { id: lead.id, created: true };
  });
  if (!created.created) return { kind: "updated", leadId: created.id, reason: "Doosre computer ne pehle bana di" };

  // 4) notify: the assigned assistant (or every active assistant in pool mode) + CEO / admins.
  const assistants = assistantsForUnit(o.sales, lead.unit);
  const target = lead.assignedTo ? assistants.filter((a) => a.teamId === lead.assignedTo) : o.sales.mode === "pool" ? assistants : [];
  const uids = [...target.map((a) => a.uid || ""), ...(o.sales.notifyUids || [])];
  const time = new Date(lead.createdAt).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" });
  const temp = temperatureOf(lead);
  await notify(ws, o.uid, uids, `lead-${lead.id}`, {
    type: "lead.new",
    title: "New WhatsApp Lead Received",
    body: [lead.name, lead.businessName || lead.business, formatLocalPhone(lead.phoneE164) || lead.phone, temp, lead.source, time].filter(Boolean).join(" • "),
    link: { tab: "sales", openLead: lead.id },
    lead: { id: lead.id, name: lead.name, business: lead.businessName || lead.business || "", phone: lead.phone || "", temperature: temp, source: lead.source, at: lead.createdAt, status: statusLabel(lead.status), assignedToName: lead.assignedToName || "" },
  });
  return { kind: "created", leadId: lead.id, lead };
}

/**
 * TAKE LEAD — a transaction: if someone else got it first, this one is refused.
 * The other assistants get a quiet note in the bell that the lead is taken.
 */
export async function takeLeadTx(ws: string, leadId: string, me: { teamId: string; name: string; by: string; uid?: string }, sales?: SalesSettings) {
  let next: any;
  try {
    next = await runTransaction(db, async (tx) => {
      const snap = await tx.get(leadRef(ws, leadId));
      if (!snap.exists()) throw new Error("Lead nahi mili");
      const cur = snap.data();
      const why = takeBlocker(cur, me.teamId);
      if (why) throw new Error(why);
      const n = takenLead(cur, me);
      tx.set(leadRef(ws, leadId), n);
      return n;
    });
  } catch (e) {
    // An assistant cannot read another assistant's lead: the take lost the race.
    if ((e as { code?: string }).code === "permission-denied") throw new Error("Ye lead pehle hi kisi aur assistant ne le li hai.");
    throw e;
  }
  if (sales && me.uid) {
    const others = activeAssistants(sales).filter((a) => a.teamId !== me.teamId).map((a) => a.uid || "");
    await notify(ws, me.uid, others, `taken-${leadId}`, {
      type: "lead.taken", title: `Lead le li gayi — ${next.name}`, body: `${me.name} ne TAKE LEAD kar li • ${new Date().toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}`,
      link: { tab: "sales" },
    }, { silent: true });
  }
  return next;
}

/**
 * Change a lead from its latest saved copy (transaction): the assistant's
 * click and a message captured on another computer at the same moment both
 * survive, and two quick clicks never undo each other.
 */
export async function mutateLead(ws: string, leadId: string, fn: (l: any) => any) {
  return runTransaction(db, async (tx) => {
    const ref = leadRef(ws, leadId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Lead nahi mili");
    const before = { ...snap.data(), id: leadId };
    const next = fn(before);
    tx.set(ref, next);
    return { before, next };
  });
}

/** Next quotation number for this year (QT-2026-0001…): a shared counter in a transaction. */
export async function nextQuoteNumber(ws: string, now = new Date()): Promise<string> {
  const ref = doc(db, "users", ws, "salesState", "quoteCounter");
  const year = now.getFullYear();
  return runTransaction(db, async (tx) => {
    const cur = await tx.get(ref);
    const d = cur.exists() ? cur.data() : null;
    const n = d && d.year === year ? Number(d.n || 0) + 1 : 1;
    tx.set(ref, { id: "quoteCounter", year, n, at: now.toISOString() });
    return formatQuoteNumber(year, n);
  });
}

/**
 * A lead's follow-up / demo also sits in the handling assistant's schedule
 * (one item per lead and kind, updated when it moves; marked Done when done).
 */
export async function syncLeadSchedule(ws: string, lead: any, kind: "followup" | "demo", by: string) {
  const owner = lead.assignedTo || "";
  const id = `S-${kind}-${lead.id}-${owner || "pool"}`.replace(/[^\w-]/g, "_");
  const ref = doc(db, "users", ws, "schedule", id);
  const done = kind === "followup" ? !!lead.followUpDone || !lead.followUpDate : !lead.demoAt;
  const [date, time] = kind === "followup" ? [lead.followUpDate || "", lead.followUpTime || ""] : String(lead.demoAt || "").split("T");
  try {
    if (done) {
      const cur = await getDoc(ref);
      if (cur.exists()) await updateDoc(ref, { status: "Done", doneAt: new Date().toISOString(), assignedTo: owner });
      return;
    }
    await setDoc(ref, {
      id, leadId: lead.id, assignedTo: owner, date: date || "", time: (time || "").slice(0, 5),
      category: kind === "demo" ? "Meeting" : "Follow-up", priority: kind === "demo" ? "High" : "Medium", status: "Pending",
      task: `${kind === "demo" ? "Demo" : "Follow-up"} — ${lead.name}${lead.businessName || lead.business ? ` (${lead.businessName || lead.business})` : ""}`,
      notes: kind === "followup" ? lead.followUpNote || "" : "", clientId: "", projectId: "", payFollow: "", location: "",
      source: "lead", createdBy: by, updatedAt: new Date().toISOString(),
    });
  } catch { /* the lead change is saved; the calendar entry is a convenience */ }
}
