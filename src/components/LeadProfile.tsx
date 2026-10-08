import React, { useMemo, useState } from "react";
import { useData } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { fmtMoney } from "@/lib/db";
import { formatLocalPhone, normalizePhone, waLink } from "@/lib/phone";
import { LEAD_TYPE_LABEL, LeadAI, analyzeLead, applyAnalysis, conversationOf, levelClass, withHistory } from "@/lib/leadAnalysis";
import { lineTemplateKey } from "@/lib/waTemplates";
import {
  LEAD_SOURCES, LEGACY_STATUSES, SALES_STATUSES, TEMPERATURES, Temperature, activeAssistants, assignedLead, followUpDone, isClosed,
  salesSettingsOf, sourceOf, statusLabel, takeBlocker, temperatureClass, temperatureOf, withDemo, withFollowUp, withStatus,
} from "@/lib/salesPipeline";
import { mutateLead, takeLeadTx } from "@/lib/salesStore";
import { extensionVersion, waExt } from "@/lib/waExtension";
import WhatsAppComposer from "./WhatsAppComposer";
import LeadBriefCard from "@/components/LeadBriefCard";

const EVENT_ICON: Record<string, string> = {
  created: "✚", captured: "💬", status: "↔", ai: "✨", message: "📤", reply: "📥", assigned: "👤", taken: "✋",
  followup: "⏰", followup_done: "✅", demo: "📅", quotation: "🧾", note: "📝", converted: "🏆", lost: "✖", optout: "⛔", handoff: "🤝",
};
const fmtAt = (v: string | number) => new Date(v).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

/**
 * Lead workspace: the full captured WhatsApp conversation (latest customer
 * message highlighted), customer details, temperature, status, assignment,
 * TAKE LEAD, follow-up, demo, notes and the complete activity log.
 */
export default function LeadProfile({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const { data, logAudit } = useData();
  const { can, user, roleDoc, workspaceUid } = useAuth();
  const lead = data.leads.find((l: any) => l.id === leadId);
  const [composer, setComposer] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [fu, setFu] = useState({ date: lead?.followUpDate || "", time: lead?.followUpTime || "", note: lead?.followUpNote || "" });
  const [demo, setDemo] = useState<string>(lead?.demoAt || "");
  const ai: LeadAI | undefined = lead?.ai;
  const chat = useMemo(() => (lead ? conversationOf(lead) : []), [lead]);
  const sales = salesSettingsOf(data.settings);
  if (!lead) {
    // e.g. opened from a notification after another assistant took it (assistants only see own + pool leads)
    return (
      <div className="dtModalBackdrop" onClick={onClose}>
        <div className="dtModal" onClick={(e) => e.stopPropagation()}>
          <div className="dtModalHead"><b>Lead dastiyab nahi</b><button className="btnSmall" onClick={onClose}>Band karein</button></div>
          <div className="small leadGone">Ye lead ab aap ki list mein nahi — shayad kisi aur assistant ne TAKE LEAD kar li, ya admin ne kisi aur ko de di.</div>
        </div>
      </div>
    );
  }

  const myTeamId = roleDoc?.teamId || "";
  const myName = data.team.find((t: any) => t.id === myTeamId)?.name || sales.assistants.find((a) => a.teamId === myTeamId)?.name || roleDoc?.displayName || user?.email || "";
  const by = user?.email || "";
  const canEdit = can("leads.edit") || (can("leads.own") && !!myTeamId && lead.assignedTo === myTeamId);
  const canAssign = can("leads.edit") || can("leads.assign");
  const blocker = can("leads.take") ? takeBlocker(lead, myTeamId) : "TAKE LEAD ki permission nahi";
  const temp: Temperature = temperatureOf(lead);
  const lastInIdx = (() => { for (let i = chat.length - 1; i >= 0; i--) if (!chat[i].fromMe) return i; return -1; })();
  const phone = normalizePhone(lead.whatsapp || lead.phone || lead.phoneE164);

  // Every change is applied to the latest saved lead (see mutateLead), not to this screen's copy.
  const save = async (change: (l: any) => any, okText: string) => {
    if (!workspaceUid) return;
    setBusy("save"); setMsg("");
    try {
      await mutateLead(workspaceUid, lead.id, (l) => ({ ...change(l), updatedBy: by }));
      setMsg(`✓ ${okText}`);
      logAudit({ action: "update", collection: "leads", entityId: lead.id, entityLabel: lead.name, details: okText });
    } catch (e) { setMsg("Save nahi hua: " + (e as Error).message); }
    setBusy("");
  };
  const take = async () => {
    if (!workspaceUid) return;
    setBusy("take"); setMsg("");
    try {
      await takeLeadTx(workspaceUid, lead.id, { teamId: myTeamId, name: myName, by, uid: user?.uid }, sales);
      logAudit({ action: "lead.take", collection: "leads", entityId: lead.id, entityLabel: lead.name, details: `taken by ${myName}; AI handoff` });
      setMsg("✓ Lead aap ki — AI handoff ho gaya, ab aap reply karein");
    } catch (e) { setMsg((e as Error).message); }
    setBusy("");
  };
  const assign = (teamId: string) => {
    const a = activeAssistants(sales).find((x) => x.teamId === teamId);
    return save((l) => assignedLead(l, a ? { teamId: a.teamId, name: a.name } : null, by), a ? `${a.name} ko assign` : "Pool mein wapas");
  };
  const setStatus = (s: string) => {
    if (s === "Lost") {
      const why = prompt("Lead LOST — wajah likhein (optional):", "");
      if (why === null) return;
      return save((l) => withHistory(withStatus({ ...l, lostReason: why || "" }, s, by), { type: "lost", text: `Lost${why ? `: ${why}` : ""}`, by }), statusLabel(s));
    }
    return save((l) => withStatus(l, s, by), statusLabel(s));
  };
  const setTemp = (t: Temperature) => save((l) => withHistory({ ...l, temperature: t, temperatureManual: true, updatedAt: new Date().toISOString() }, { type: "status", text: `Temperature: ${temperatureOf(l)} → ${t} (manual)`, by }), `Temperature ${t}`);
  const saveFollowUp = () => {
    if (!fu.date) { setMsg("Follow-up ki tareekh chunein"); return; }
    return save((l) => withFollowUp(l, fu, by), "Follow-up set");
  };
  const saveDemo = () => {
    if (!demo) { setMsg("Demo ki tareekh / waqt chunein"); return; }
    return save((l) => withDemo(l, demo, by), "Demo scheduled");
  };
  const addNote = () => {
    if (!note.trim()) return;
    const text = note.trim();
    save((l) => withHistory({ ...l, updatedAt: new Date().toISOString() }, { type: "note", text, by }), "Note add").then(() => setNote(""));
  };
  const reanalyze = () => save((l) => applyAnalysis(l, analyzeLead(l, data.settings), { by }), "AI analysis update");
  const openWhatsApp = () => {
    if (extensionVersion()) waExt.open(lead.waJid ? { chatId: lead.waJid } : { phone }).catch((e) => setMsg(e.message));
    else { const l = waLink(phone); if (l) window.open(l, "_blank"); }
  };

  const history = [...(lead.history || [])].reverse();
  const statusKeys = [...SALES_STATUSES.map((s) => s.key), ...LEGACY_STATUSES.filter((s) => s === lead.status)];

  return (
    <div className="dtModalBackdrop" onClick={onClose}>
      <div className="dtModal wide leadProfile" onClick={(e) => e.stopPropagation()}>
        <div className="dtModalHead">
          <div>
            <b style={{ fontSize: 18 }}>{lead.name}</b>{lead.vip && <span className="badge vipBadge" style={{ marginLeft: 6 }}>⭐ VIP</span>}
            <span className={`badge ${temperatureClass(temp)}`} style={{ marginLeft: 6 }}>{temp}</span>
            <span className="badge pri" style={{ marginLeft: 6 }}>{statusLabel(lead.status)}</span>
            <div className="small">
              {formatLocalPhone(phone) || lead.phone || "No number"} • {sourceOf(lead)}{lead.adInfo?.title ? ` (${lead.adInfo.title})` : ""} • {lead.createdAt ? fmtAt(lead.createdAt) : lead.date || ""}
              {lead.leadType && <> • {LEAD_TYPE_LABEL[lead.leadType as keyof typeof LEAD_TYPE_LABEL]}</>}
            </div>
          </div>
          <div className="rowActions">
            {!blocker && <button className="btnSolid takeBtn" onClick={take} disabled={!!busy}>{busy === "take" ? "…" : "✋ TAKE LEAD"}</button>}
            {phone && !lead.optOut && <button className="btnSmall" onClick={openWhatsApp}>🟢 WhatsApp kholein</button>}
            {phone && !lead.optOut && (can("whatsapp.view") || canEdit) && <button className="btnSmall" onClick={() => setComposer(true)}>✉ Template</button>}
            {canEdit && <button className="btnSmall" onClick={reanalyze} disabled={!!busy}>✨ AI re-analyze</button>}
            <button className="btnSmall" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className={`handoffBar ${lead.aiHandoff ? "human" : "ai"}`}>
          {lead.assignedTo
            ? lead.takenAt
              ? <>👤 <b>{lead.takenByName || lead.assignedToName}</b> handle kar raha hai (TAKE {fmtAt(lead.takenAt)}) — AI handoff: AI replies / campaigns is chat ke liye band.</>
              : <>👤 Assigned: <b>{lead.assignedToName}</b> {lead.assignedAt ? `(${fmtAt(lead.assignedAt)})` : ""} — abhi TAKE nahi kiya.</>
            : <>🤖 Abhi kisi ke paas nahi (pool). {blocker ? "" : "TAKE LEAD dabayein."}</>}
          {msg && <b style={{ marginLeft: 8 }}>{msg}</b>}
        </div>

        <div className="lpGrid">
          <div className="lpCol">
            <div className="lpCard">
              <div className="lpHead">💬 Conversation ({chat.length})</div>
              {chat.length === 0 ? <div className="small">Koi chat capture nahi hui.</div> : (
                <div className="lpChat lwChat">
                  {chat.map((c: any, i) => (
                    <div key={i} className={`lpBubble ${c.fromMe ? "me" : ""} ${i === lastInIdx ? "latest" : ""}`}>
                      {i === lastInIdx && <div className="small"><b>Customer ka aakhri message</b></div>}
                      {c.text}
                      {c.at ? <div className="lwTime">{fmtAt(c.at)}</div> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="lpCard">
              <div className="lpHead">📜 Activity log</div>
              {canEdit && (
                <div className="lpNote">
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note likhein (call ka nateeja, requirement…)" onKeyDown={(e) => e.key === "Enter" && addNote()} />
                  <button className="btnSmall" onClick={addNote}>Add</button>
                </div>
              )}
              {history.length === 0 ? <div className="small">Abhi koi activity nahi.</div> : (
                <ul className="lpTimeline">
                  {history.map((h: any, i: number) => (
                    <li key={i}>
                      <span className="lpIcon">{EVENT_ICON[h.type] || "•"}</span>
                      <div><div>{h.text}</div><div className="small">{fmtAt(h.at)}{h.by ? ` • ${h.by}` : ""}</div></div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="lpCol">
            <div className="lpCard">
              <div className="lpHead">Customer</div>
              <div className="lpRow"><span>Business</span><b>{lead.businessName || lead.business || "—"}</b></div>
              <div className="lpRow"><span>City</span><b>{lead.city || "—"}</b></div>
              <div className="lpRow"><span>Requirement</span><b style={{ textAlign: "right" }}>{lead.serviceType || ai?.line || "—"}</b></div>
              {lead.requirement && <div className="small">{lead.requirement}</div>}
              <div className="lpRow"><span>Source</span>
                {canEdit ? (
                  <select value={LEAD_SOURCES.includes(lead.source) ? lead.source : sourceOf(lead)} onChange={(e) => { const v = e.target.value; save((l) => ({ ...l, source: v }), "Source update"); }}>
                    {[...new Set([...LEAD_SOURCES, sourceOf(lead)])].map((s) => <option key={s}>{s}</option>)}
                  </select>
                ) : <b>{sourceOf(lead)}</b>}
              </div>
              {lead.adInfo && <div className="small">Ad: {[lead.adInfo.title, lead.adInfo.sourceId && `id ${lead.adInfo.sourceId}`, lead.adInfo.sourceUrl].filter(Boolean).join(" • ") || "Meta ad se aaya"}</div>}
              {lead.optOut && <div className="badge bad" style={{ marginTop: 6 }}>⛔ Opt-out — message na karein</div>}
            </div>

            <div className="lpCard">
              <div className="lpHead">Status &amp; temperature</div>
              <div className="lwRow">
                <label>Status
                  <select value={lead.status || "New"} disabled={!canEdit || !!busy} onChange={(e) => setStatus(e.target.value)}>
                    {statusKeys.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                  </select>
                </label>
                <label>Temperature {lead.temperatureManual ? "(manual)" : "(AI)"}
                  <select value={temp} disabled={!canEdit || !!busy} onChange={(e) => setTemp(e.target.value as Temperature)}>
                    {TEMPERATURES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
              </div>
              {canEdit && !isClosed(lead) && (
                <div className="rowActions" style={{ marginTop: 6 }}>
                  <button className="btnSmall" disabled={!!busy} onClick={() => setStatus("Contacted")}>📞 Contacting</button>
                  <button className="btnSmall" disabled={!!busy} onClick={() => save((l) => withHistory(withStatus(l, "Proposal", by), { type: "quotation", text: "Quotation bheji", by }), "QUOTATION")}>🧾 Quotation bheji</button>
                  <button className="btnSmall" disabled={!!busy} onClick={() => setStatus("Demo Given")}>✅ Demo ho gaya</button>
                  <button className="btnSolid" disabled={!!busy} onClick={() => setStatus("Converted")}>🏆 WON</button>
                  <button className="btnDanger" disabled={!!busy} onClick={() => setStatus("Lost")}>LOST</button>
                </div>
              )}
              {canAssign && (
                <label style={{ marginTop: 8, display: "block" }}>Assign / reassign
                  <select value={lead.assignedTo || ""} onChange={(e) => assign(e.target.value)} disabled={!!busy}>
                    <option value="">— Pool (koi bhi TAKE kare) —</option>
                    {activeAssistants(sales).map((a) => <option key={a.teamId} value={a.teamId}>{a.name}</option>)}
                    {lead.assignedTo && !activeAssistants(sales).some((a) => a.teamId === lead.assignedTo) && <option value={lead.assignedTo}>{lead.assignedToName || lead.assignedTo}</option>}
                  </select>
                </label>
              )}
              {!canAssign && blocker && lead.assignedTo !== myTeamId && <div className="small">{blocker}</div>}
            </div>

            <div className="lpCard">
              <div className="lpHead">⏰ Follow-up {lead.followUpDate && !lead.followUpDone && !lead.followUpAuto ? <span className="badge warn">{lead.followUpDate} {lead.followUpTime || ""}</span> : lead.followUpDone ? <span className="badge ok">done</span> : null}</div>
              {lead.followUpAuto && !lead.followUpDone && <div className="small">AI ka mashwara: {lead.followUpDate} — waqt aur note ke sath set karein to reminder aayega.</div>}
              {lead.followUpNote && <div className="small">{lead.followUpNote}</div>}
              {canEdit && (
                <>
                  <div className="lwRow">
                    <input type="date" value={fu.date} onChange={(e) => setFu({ ...fu, date: e.target.value })} aria-label="Follow-up date" />
                    <input type="time" value={fu.time} onChange={(e) => setFu({ ...fu, time: e.target.value })} aria-label="Follow-up time" />
                  </div>
                  <input value={fu.note} onChange={(e) => setFu({ ...fu, note: e.target.value })} placeholder="Follow-up note (kya baat karni hai)" />
                  <div className="rowActions" style={{ marginTop: 6 }}>
                    <button className="btnSmall" onClick={saveFollowUp} disabled={!!busy}>Follow-up set karein</button>
                    {lead.followUpDate && !lead.followUpDone && !lead.followUpAuto && <button className="btnSmall" disabled={!!busy} onClick={() => save((l) => followUpDone(l, by), "Follow-up mukammal")}>✅ Follow-up ho gaya</button>}
                  </div>
                </>
              )}
            </div>

            <div className="lpCard">
              <div className="lpHead">📅 Demo {lead.demoAt ? <span className="badge pri">{String(lead.demoAt).replace("T", " ")}</span> : null}</div>
              {canEdit && (
                <div className="lwRow">
                  <input type="datetime-local" value={demo} onChange={(e) => setDemo(e.target.value)} aria-label="Demo date" />
                  <button className="btnSmall" onClick={saveDemo} disabled={!!busy}>Demo schedule</button>
                </div>
              )}
            </div>

            <div className="lpCard lpAI">
              <div className="lpHead">✨ AI analysis {ai && <span className="small">({fmtAt(ai.analyzedAt)})</span>}</div>
              {!ai ? <div className="small">Abhi analysis nahi hua.</div> : (
                <>
                  <div className="lpInterest">
                    <div className="lpMeter"><div style={{ width: `${ai.interest}%` }} className={`lvl${ai.level}`} /></div>
                    <b>{ai.interest}%</b> <span className={`badge ${levelClass(ai.level)}`}>{ai.level}</span>
                  </div>
                  <LeadBriefCard brief={ai.brief} />
                  <div className="lpRow"><span>Potential value</span><b>{ai.potentialValue ? `Rs ${fmtMoney(ai.potentialValue)}` : "—"}</b></div>
                  <div className="lpNext">→ {ai.nextAction}</div>
                </>
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
            onSent={(log) => { if (canEdit) save((l) => withHistory({ ...l, lastContactAt: log.at }, { type: "message", text: `WhatsApp (${log.lang}): ${log.text.slice(0, 160)}`, by }), "WhatsApp bheja"); }}
          />
        )}
      </div>
    </div>
  );
}
