import React, { useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useData } from "@/contexts/DataContext";
import { uid, todayISO } from "@/lib/db";
import { ChatLine } from "@/lib/chatClassifier";
import { CaptureChat, planCapture } from "@/lib/leadCapture";
import { formatLocalPhone } from "@/lib/phone";
import { waExt } from "@/lib/waExtension";
import { conversationName, updateConversation, WaConversation } from "./useWhatsApp";

interface Row { id: string; name: string; phone: string; line: string; status: string; action: "created" | "linked" | "updated" | "unchanged" | "error"; reason: string }

/** Where chats are read from: WhatsApp Web through the browser extension, or the server's copy. */
export type CaptureSource = { kind: "extension" } | { kind: "service"; ws: string };

/**
 * Reads every 1:1 WhatsApp chat and turns it into a lead: finds an existing
 * lead by number or creates one, and fills the service category and status
 * from the conversation.
 */
export default function CaptureModal({ source, onClose }: { source: CaptureSource; onClose: () => void }) {
  const { data, addItem, updateItem } = useData();
  const [updateExisting, setUpdateExisting] = useState(true);
  const [sinceDays, setSinceDays] = useState(90);
  const [skipSaved, setSkipSaved] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const ext = source.kind === "extension";

  const loadChats = async (): Promise<{ chat: CaptureChat; lines: () => Promise<ChatLine[]> }[]> => {
    if (source.kind === "extension") {
      const chats = await waExt.chats({ sinceDays: sinceDays || undefined });
      return chats
        .filter((c) => !(skipSaved && c.saved))
        .map((c) => ({
          chat: { key: c.id, jid: c.id, phone: c.phone || undefined, name: c.name || c.pushname || (c.phone ? formatLocalPhone(c.phone) : ""), firstAt: undefined },
          lines: async () => (await waExt.messages(c.id, 40)).filter((m) => m.type !== "call_log").map((m) => ({ text: m.text, fromMe: m.fromMe })),
        }));
    }
    const ws = source.ws;
    const snap = await getDocs(query(collection(db, "users", ws, "waConversations"), orderBy("lastMessageAt", "desc"), limit(2000)));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as WaConversation)
      .filter((c) => c.chatType === "user")
      .map((c) => ({
        chat: { key: c.id, jid: c.jid, phone: c.phone || undefined, name: conversationName(c), firstAt: c.firstInboundAt || undefined, conversationId: c.id, assignedTo: c.assignedTo || "", leadId: c.leadId || undefined },
        lines: async () => {
          const msgs = await getDocs(query(collection(db, "users", ws, "waConversations", c.id, "messages"), orderBy("timestamp", "desc"), limit(40)));
          return msgs.docs.map((d) => d.data()).reverse().filter((m: any) => m.kind !== "call").map((m: any) => ({ text: String(m.text || ""), fromMe: !!m.fromMe }));
        },
      }));
  };

  const run = async () => {
    setRunning(true); setRows([]); setDone(0); setError("");
    let items;
    try {
      items = await loadChats();
    } catch (e) {
      setError((e as Error).message); setRunning(false); return;
    }
    setTotal(items.length);
    const leads = [...data.leads];
    const out: Row[] = [];

    for (const { chat, lines } of items) {
      const phone = chat.phone ? formatLocalPhone(chat.phone) : "";
      try {
        const plan = planCapture(chat, await lines(), leads, { updateExisting, newId: () => uid("LD"), today: todayISO(), createdBy: "chat-capture" });
        const reason = plan.s.reason;
        if (plan.kind === "create") {
          await addItem("leads", plan.lead);
          leads.push(plan.lead);
          if (chat.conversationId && source.kind === "service") await updateConversation(source.ws, chat.conversationId, { leadId: plan.lead.id });
          out.push({ id: chat.key, name: chat.name, phone, line: plan.lead.serviceType, status: plan.lead.status, action: "created", reason });
        } else {
          const lead = plan.lead;
          if (plan.kind === "update") {
            const next = { ...lead, ...plan.patch, updatedAt: new Date().toISOString() };
            await updateItem("leads", next);
            leads[leads.indexOf(lead)] = next;
          }
          const linkNeeded = !!chat.conversationId && chat.leadId !== lead.id;
          if (linkNeeded && source.kind === "service") await updateConversation(source.ws, chat.conversationId!, { leadId: lead.id });
          const patch = plan.kind === "update" ? plan.patch : {};
          out.push({
            id: chat.key, name: chat.name, phone,
            line: (patch.serviceType as string) || lead.serviceType || plan.s.line || "Other",
            status: (patch.status as string) || lead.status,
            action: plan.kind === "update" ? "updated" : linkNeeded ? "linked" : "unchanged", reason,
          });
        }
      } catch (e) {
        out.push({ id: chat.key, name: chat.name, phone, line: "—", status: "—", action: "error", reason: (e as Error).message });
      }
      setDone((n) => n + 1);
      setRows([...out]);
    }
    setRunning(false);
  };

  const count = (a: Row["action"]) => rows.filter((r) => r.action === a).length;

  return (
    <div className="dtModalBackdrop" onClick={() => !running && onClose()}>
      <div className="dtModal wide" onClick={(e) => e.stopPropagation()}>
        <div className="dtModalHead">
          <div>
            <b style={{ fontSize: 17 }}>Capture leads from WhatsApp</b>
            <div className="small">Har chat parh kar lead banata hai — service category aur status chat se khud set hota hai.</div>
          </div>
          <button className="btnSmall" onClick={onClose} disabled={running}>✕</button>
        </div>

        {!running && rows.length === 0 && (
          <>
            <ol className="actionPlan">
              <li>Tamam 1-to-1 chats (groups nahi) parhi jayengi{ext ? " — seedha aap ke WhatsApp Web se" : ""}.</li>
              <li>Number pehle se kisi lead mein ho to wohi lead link hogi, warna nayi lead banegi (Source: WhatsApp).</li>
              <li>Chat ki baat-cheet se <b>service category</b> (Marketing, Software, Design…) aur <b>status</b> (New, Contacted, Interested, Follow-up, Converted, Lost) set hoga. Aakhri messages lead ke notes mein save honge.</li>
            </ol>
            {ext && (
              <div className="captureOpts">
                <label>Kitni purani chats
                  <select value={sinceDays} onChange={(e) => setSinceDays(Number(e.target.value))}>
                    <option value={30}>Pichle 30 din</option>
                    <option value={90}>Pichle 90 din</option>
                    <option value={365}>Pichla 1 saal</option>
                    <option value={0}>Sab chats</option>
                  </select>
                </label>
                <label className="permItem">
                  <input type="checkbox" checked={skipSaved} onChange={(e) => setSkipSaved(e.target.checked)} />
                  <span>Phone mein saved contacts (dost / family) chhor dein</span>
                </label>
              </div>
            )}
            <label className="permItem" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
              <span>Purani leads ka status bhi chat ke mutabiq aage barhayein</span>
            </label>
            {error && <div className="waErrText small" style={{ marginTop: 8 }}>{error}</div>}
            <button className="btnSolid" style={{ marginTop: 12 }} onClick={run}>Start capture</button>
          </>
        )}

        {(running || rows.length > 0) && (
          <>
            <div className="captureBar"><div style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} /></div>
            <div className="small" style={{ margin: "6px 0 10px" }}>
              {running ? (total ? `Chats parhi ja rahi hain… ${done} / ${total}` : "WhatsApp se chats li ja rahi hain…") : `Mukammal: ${total} chats`} •
              {" "}nayi {count("created")} • link {count("linked")} • update {count("updated")} • same {count("unchanged")}{count("error") ? ` • errors ${count("error")}` : ""}
            </div>
            <div className="tablewrap" style={{ maxHeight: "50vh" }}>
              <table>
                <thead><tr><th>Contact</th><th>Service</th><th>Status</th><th>Result</th><th>Why</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td><b>{r.name}</b><div className="small">{r.phone}</div></td>
                      <td>{r.line}</td>
                      <td><span className={`badge ${r.status === "Converted" ? "ok" : r.status === "Lost" ? "bad" : "warn"}`}>{r.status}</span></td>
                      <td><span className={`badge ${r.action === "created" ? "pri" : r.action === "error" ? "bad" : ""}`}>{r.action}</span></td>
                      <td className="small">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!running && <button className="btnSolid" style={{ marginTop: 12 }} onClick={onClose}>Done</button>}
          </>
        )}
      </div>
    </div>
  );
}
