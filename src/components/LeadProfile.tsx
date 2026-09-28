import React, { useMemo, useState } from "react";
import { useData } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { fmtMoney } from "@/lib/db";
import { formatLocalPhone, normalizePhone } from "@/lib/phone";
import { LEAD_TYPE_LABEL, LeadAI, analyzeLead, applyAnalysis, conversationOf, levelClass, withHistory } from "@/lib/leadAnalysis";
import { lineTemplateKey } from "@/lib/waTemplates";
import WhatsAppComposer from "./WhatsAppComposer";

const EVENT_ICON: Record<string, string> = {
  created: "✚", captured: "💬", status: "↔", ai: "✨", message: "📤", reply: "📥", assigned: "👤",
  followup: "⏰", note: "📝", converted: "🏆", optout: "⛔",
};

/** Everything about one lead: details, AI analysis, conversation, full history. */
export default function LeadProfile({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const { data, updateItem } = useData();
  const { can, user } = useAuth();
  const lead = data.leads.find((l: any) => l.id === leadId);
  const [composer, setComposer] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const ai: LeadAI | undefined = lead?.ai;
  const chat = useMemo(() => (lead ? conversationOf(lead) : []), [lead]);
  const team = data.team.find((t: any) => t.id === lead?.assignedTo);
  const client = lead?.clientId ? data.clients.find((c: any) => c.id === lead.clientId) : undefined;
  if (!lead) return null;
  const canEdit = can("leads.edit");

  const reanalyze = async () => {
    setBusy(true);
    try { await updateItem("leads", applyAnalysis(lead, analyzeLead(lead, data.settings), { by: user?.email || "" })); }
    finally { setBusy(false); }
  };
  const addNote = async () => {
    if (!note.trim()) return;
    await updateItem("leads", withHistory({ ...lead, updatedAt: new Date().toISOString() }, { type: "note", text: note.trim(), by: user?.email || "" }));
    setNote("");
  };
  const history = [...(lead.history || [])].reverse();
  const msgs = history.filter((h: any) => h.type === "message");
  const replies = history.filter((h: any) => h.type === "reply");

  return (
    <div className="dtModalBackdrop" onClick={onClose}>
      <div className="dtModal wide leadProfile" onClick={(e) => e.stopPropagation()}>
        <div className="dtModalHead">
          <div>
            <b style={{ fontSize: 18 }}>{lead.name}</b>
            <div className="small">
              {formatLocalPhone(normalizePhone(lead.whatsapp || lead.phone)) || lead.phone || "No number"} • {lead.source || "—"} • {lead.date || ""}
              {lead.leadType && <> • {LEAD_TYPE_LABEL[lead.leadType as keyof typeof LEAD_TYPE_LABEL]}</>}
            </div>
          </div>
          <div className="rowActions">
            {can("whatsapp.view") && normalizePhone(lead.whatsapp || lead.phone) && !lead.optOut && <button className="btnSmall" onClick={() => setComposer(true)}>🟢 WhatsApp</button>}
            {canEdit && <button className="btnSolid" onClick={reanalyze} disabled={busy}>{busy ? "…" : "✨ AI re-analyze"}</button>}
            <button className="btnSmall" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="lpGrid">
          <div className="lpCol">
            <div className="lpCard">
              <div className="lpHead">Lead</div>
              <div className="lpRow"><span>Status</span><b>{lead.status || "New"}</b></div>
              <div className="lpRow"><span>Service</span><b>{lead.serviceType || "—"}</b></div>
              <div className="lpRow"><span>Business</span><b>{lead.category || "—"}</b></div>
              <div className="lpRow"><span>Assigned</span><b>{team?.name || "Unassigned"}</b></div>
              <div className="lpRow"><span>Follow-up</span><b>{lead.followUpDate || "—"}</b></div>
              <div className="lpRow"><span>Meeting</span><b>{lead.meetingDate || "—"}</b></div>
              {client && <div className="lpRow"><span>Client</span><b>{client.name}</b></div>}
              {lead.optOut && <div className="badge bad" style={{ marginTop: 6 }}>⛔ Opt-out — message na karein</div>}
              <div className="lpRow"><span>Messages sent</span><b>{msgs.length}</b></div>
              <div className="lpRow"><span>Replies</span><b>{replies.length}</b></div>
            </div>

            <div className="lpCard lpAI">
              <div className="lpHead">✨ AI analysis {ai && <span className="small">({new Date(ai.analyzedAt).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })})</span>}</div>
              {!ai ? <div className="small">Abhi analysis nahi hua — "AI re-analyze" dabayein.</div> : (
                <>
                  <div className="lpInterest">
                    <div className="lpMeter"><div style={{ width: `${ai.interest}%` }} className={`lvl${ai.level}`} /></div>
                    <b>{ai.interest}%</b> <span className={`badge ${levelClass(ai.level)}`}>{ai.level}</span>
                  </div>
                  <div className="small">Interest ek <b>andaza</b> hai jo chat se nikla hai — conversion ki guarantee nahi.</div>
                  <div className="lpRow"><span>Requested service</span><b>{ai.line || "Pata nahi chala"}</b></div>
                  <div className="lpRow"><span>Suggested status</span><b>{ai.suggestedStatus}</b></div>
                  <div className="lpRow"><span>Potential value</span><b>{ai.potentialValue ? `Rs ${fmtMoney(ai.potentialValue)}` : "—"}</b></div>
                  {ai.potentialValue > 0 && <div className="small" style={{ textAlign: "right" }}>({ai.valueBasis})</div>}
                  <div className="lpRow"><span>Follow-up</span><b>{ai.followUp.required ? `Haan — ${ai.followUp.date}` : "Nahi"}</b></div>
                  <div className="small">{ai.followUp.reason}</div>
                  <div className="lpNext">→ {ai.nextAction}</div>
                </>
              )}
            </div>
          </div>

          <div className="lpCol">
            <div className="lpCard">
              <div className="lpHead">Conversation</div>
              {chat.length === 0 ? <div className="small">Koi chat save nahi.</div> : (
                <div className="lpChat">
                  {chat.slice(-30).map((c, i) => <div key={i} className={`lpBubble ${c.fromMe ? "me" : ""}`}>{c.text}</div>)}
                </div>
              )}
            </div>
            <div className="lpCard">
              <div className="lpHead">History</div>
              {canEdit && (
                <div className="lpNote">
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note / follow-up result likhein…" onKeyDown={(e) => e.key === "Enter" && addNote()} />
                  <button className="btnSmall" onClick={addNote}>Add</button>
                </div>
              )}
              {history.length === 0 ? <div className="small">Abhi koi history nahi.</div> : (
                <ul className="lpTimeline">
                  {history.map((h: any, i: number) => (
                    <li key={i}>
                      <span className="lpIcon">{EVENT_ICON[h.type] || "•"}</span>
                      <div><div>{h.text}</div><div className="small">{new Date(h.at).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}{h.by ? ` • ${h.by}` : ""}</div></div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {composer && (
          <WhatsAppComposer
            phone={lead.whatsapp || lead.phone || ""}
            types={[lineTemplateKey(lead.serviceType || ai?.line || ""), "lead_followup", "lead_welcome"].filter((t, i, a) => a.indexOf(t) === i)}
            vars={{ name: String(lead.name || "").split(" ")[0], service: lead.serviceType || ai?.line || "" }}
            title={`WhatsApp — ${lead.name}`}
            onClose={() => setComposer(false)}
            onSent={(log) => updateItem("leads", withHistory({ ...lead, lastContactAt: log.at }, { type: "message", text: `WhatsApp (${log.lang}): ${log.text.slice(0, 160)}`, by: user?.email || "" }))}
          />
        )}
      </div>
    </div>
  );
}
