import React, { useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useData } from "@/contexts/DataContext";
import { uid, todayISO } from "@/lib/db";
import { classifyChat } from "@/lib/chatClassifier";
import { formatLocalPhone, leadPhones } from "@/lib/phone";
import { conversationName, updateConversation, WaConversation } from "./useWhatsApp";

// Pipeline order; a capture only moves a lead forward (or to Lost / Converted).
const ORDER = ["New", "Contacted", "Interested", "Follow-up", "Qualified", "Proposal", "Negotiation", "Converted"];
const shouldMove = (from: string, to: string) =>
  from !== to && !["Converted", "Lost", "Invalid"].includes(from) &&
  (to === "Lost" || to === "Converted" || ORDER.indexOf(to) > ORDER.indexOf(from));

interface Row { id: string; name: string; phone: string; line: string; status: string; action: "created" | "linked" | "updated" | "unchanged" | "error"; reason: string }

/**
 * Reads every 1:1 WhatsApp chat already captured by the service and turns it
 * into a lead: finds an existing lead by number or creates one, and fills the
 * service category and status from the conversation.
 */
export default function CaptureModal({ ws, onClose }: { ws: string; onClose: () => void }) {
  const { data, addItem, updateItem } = useData();
  const [updateExisting, setUpdateExisting] = useState(true);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);

  const run = async () => {
    setRunning(true); setRows([]); setDone(0);
    const convSnap = await getDocs(query(collection(db, "users", ws, "waConversations"), orderBy("lastMessageAt", "desc"), limit(2000)));
    const convs = convSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as WaConversation).filter((c) => c.chatType === "user");
    setTotal(convs.length);
    const leads = [...data.leads];
    const out: Row[] = [];

    for (const c of convs) {
      const name = conversationName(c);
      const phone = c.phone ? formatLocalPhone(c.phone) : "";
      try {
        const msgs = await getDocs(query(collection(db, "users", ws, "waConversations", c.id, "messages"), orderBy("timestamp", "desc"), limit(40)));
        const lines = msgs.docs.map((d) => d.data()).reverse().filter((m: any) => m.kind !== "call").map((m: any) => ({ text: String(m.text || ""), fromMe: !!m.fromMe }));
        const s = classifyChat(lines);
        const line = s.line || "Other";
        const existing = c.leadId ? leads.find((l) => l.id === c.leadId)
          : c.phone ? leads.find((l) => leadPhones(l).includes(c.phone!)) : undefined;

        if (existing) {
          const patch: Record<string, unknown> = {};
          if (updateExisting && shouldMove(existing.status || "New", s.status)) patch.status = s.status;
          if (!existing.serviceType && s.line) patch.serviceType = s.line;
          if (!existing.conversationId) patch.conversationId = c.id;
          if (Object.keys(patch).length) await updateItem("leads", { ...existing, ...patch, updatedAt: new Date().toISOString() });
          if (c.leadId !== existing.id) await updateConversation(ws, c.id, { leadId: existing.id });
          out.push({ id: c.id, name, phone, line: (patch.serviceType as string) || existing.serviceType || line, status: (patch.status as string) || existing.status,
            action: Object.keys(patch).length ? "updated" : c.leadId ? "unchanged" : "linked", reason: s.reason });
        } else {
          const lastTheirs = [...lines].reverse().find((l) => !l.fromMe)?.text || "";
          const lead = {
            id: uid("LD"), name, phone, whatsapp: phone, phoneE164: c.phone || "",
            category: "Other", serviceType: line, software: "", plan: "Undecided", status: s.status, source: "WhatsApp",
            referralBy: "", meetingDate: "", followUpDate: "", notes: lastTheirs ? `WhatsApp: ${lastTheirs.slice(0, 300)}` : "",
            date: c.firstInboundAt ? new Date(c.firstInboundAt).toISOString().slice(0, 10) : todayISO(),
            createdAt: new Date().toISOString(), createdBy: "chat-capture", conversationId: c.id, waJid: c.jid, assignedTo: c.assignedTo || "",
          };
          await addItem("leads", lead);
          leads.push(lead);
          await updateConversation(ws, c.id, { leadId: lead.id });
          out.push({ id: c.id, name, phone, line, status: s.status, action: "created", reason: s.reason });
        }
      } catch (e) {
        out.push({ id: c.id, name, phone, line: "—", status: "—", action: "error", reason: (e as Error).message });
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
              <li>Tamam 1-to-1 chats (groups nahi) parhi jayengi.</li>
              <li>Number pehle se kisi lead mein ho to wohi lead link hogi, warna nayi lead banegi (Source: WhatsApp).</li>
              <li>Chat ki baat-cheet se <b>service category</b> (Marketing, Software, Design…) aur <b>status</b> (New, Contacted, Interested, Follow-up, Converted, Lost) set hoga.</li>
            </ol>
            <label className="permItem" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
              <span>Purani leads ka status bhi chat ke mutabiq aage barhayein</span>
            </label>
            <button className="btnSolid" style={{ marginTop: 12 }} onClick={run}>Start capture</button>
          </>
        )}

        {(running || rows.length > 0) && (
          <>
            <div className="captureBar"><div style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} /></div>
            <div className="small" style={{ margin: "6px 0 10px" }}>
              {running ? `Chats parhi ja rahi hain… ${done} / ${total}` : `Mukammal: ${total} chats`} •
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
