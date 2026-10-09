import React, { useMemo, useState } from "react";
import { useData } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { fmtMoney } from "@/lib/db";
import { formatLocalPhone, normalizePhone, waLink } from "@/lib/phone";
import { LEAD_TYPE_LABEL, LeadAI, analyzeLead, applyAnalysis, conversationOf, levelClass } from "@/lib/leadAnalysis";
import { ACTIVITY_TYPES, HISTORY_FILTERS, LeadEvent, LeadEventType, OUTCOMES, filterHistory, withHistory } from "@/lib/leadHistory";
import { lineTemplateKey } from "@/lib/waTemplates";
import {
  LEAD_SOURCES, LEGACY_STATUSES, SALES_STATUSES, TEMPERATURES, Temperature, activeAssistants, assignedLead, followUpDone, isClosed,
  salesSettingsOf, sourceOf, statusLabel, takeBlocker, temperatureClass, temperatureOf, withDemo, withFollowUp, withStatus,
} from "@/lib/salesPipeline";
import { mutateLead, syncLeadSchedule, takeLeadTx } from "@/lib/salesStore";
import { businessById, businessesOf, unitOfLead } from "@/lib/business";
import { Product, activeProducts, productSaleValue, productsForLine } from "@/lib/products";
import { leadValue } from "@/lib/leadValue";
import { Quotation } from "@/lib/quotation";
import { extensionVersion, waExt } from "@/lib/waExtension";
import WhatsAppComposer from "./WhatsAppComposer";
import LeadBriefCard from "@/components/LeadBriefCard";
import QuotationModal from "@/components/sales/QuotationModal";
import ShareModal from "@/components/sales/ShareModal";
import { useActor } from "@/components/sales/useSalesBrand";

const EVENT_ICON: Record<string, string> = {
  created: "✚", captured: "💬", status: "↔", ai: "✨", message: "📤", reply: "📥", assigned: "👤", taken: "✋",
  followup: "⏰", followup_done: "✅", demo: "📅", quotation: "🧾", note: "📝", converted: "🏆", lost: "✖", optout: "⛔", handoff: "🤝",
  call: "📞", whatsapp: "💬", meeting: "🤝", visit: "🚗", email: "📧",
};
const fmtAt = (v: string | number) => new Date(v).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

/**
 * Lead workspace: the full captured WhatsApp conversation (latest customer
 * message highlighted), customer details, business, products and real value,
 * temperature, status, assignment, TAKE LEAD, follow-up, demo, quotations, and
 * the complete activity timeline (calls, WhatsApp, meetings, notes — who, when, result).
 */
export default function LeadProfile({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const { data, logAudit } = useData();
  const { can, user, roleDoc, workspaceUid } = useAuth();
  const actor = useActor();
  const lead = data.leads.find((l: any) => l.id === leadId);
  const [composer, setComposer] = useState(false);
  const [quote, setQuote] = useState<{ existing?: Quotation } | null>(null);
  const [share, setShare] = useState<Product | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [fu, setFu] = useState({ date: lead?.followUpDate || "", time: lead?.followUpTime || "", note: lead?.followUpNote || "" });
  const [demo, setDemo] = useState<string>(lead?.demoAt || "");
  const [act, setAct] = useState<{ type: LeadEventType; outcome: string; duration: string; note: string; at: string }>({ type: "call", outcome: "", duration: "", note: "", at: localNow() });
  const [hf, setHf] = useState("all");
  const ai: LeadAI | undefined = lead?.ai;
  const chat = useMemo(() => (lead ? conversationOf(lead) : []), [lead]);
  const sales = salesSettingsOf(data.settings);
  const products = data.products as Product[];
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
  const unit = unitOfLead(lead, data.settings, products);
  const biz = businessById(data.settings, unit);
  const value = leadValue(lead, products, data.settings);
  const line = lead.serviceType && lead.serviceType !== "Other" ? lead.serviceType : ai?.line;
  const suggested = productsForLine(products, line);
  const pickable = [...suggested, ...activeProducts(products, unit).filter((p) => !suggested.includes(p))].filter((p) => !(lead.products || []).some((x: any) => x.productId === p.id));
  const quotes = (data.quotations as Quotation[]).filter((q) => q.leadId === lead.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Every change is applied to the latest saved lead (see mutateLead), not to this screen's copy;
  // new history entries are stamped with who did it (admin / assistant).
  const save = async (change: (l: any) => any, okText: string): Promise<any | null> => {
    if (!workspaceUid) return null;
    setBusy("save"); setMsg("");
    try {
      const { next } = await mutateLead(workspaceUid, lead.id, (l) => {
        const old = new Set(Array.isArray(l.history) ? l.history : []);
        const n = { ...change(l), updatedBy: by };
        if (Array.isArray(n.history)) n.history = n.history.map((h: LeadEvent) => (old.has(h) || h.role ? h : { ...h, who: actor.who, role: actor.role }));
        return n;
      });
      setMsg(`✓ ${okText}`);
      logAudit({ action: "update", collection: "leads", entityId: lead.id, entityLabel: lead.name, details: okText });
      setBusy("");
      return next;
    } catch (e) { setMsg("Save nahi hua: " + (e as Error).message); setBusy(""); return null; }
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
    if (s === "Converted") {
      const amt = prompt("Sale kitne mein hui? (Rs)", String(value.amount || ""));
      if (amt === null) return;
      const n = Math.max(0, Number(String(amt).replace(/[^\d.]/g, "")) || 0);
      return save((l) => {
        const next = withStatus({ ...l, wonAmount: n }, s, by);
        next.history[next.history.length - 1].text += n ? ` • Rs ${fmtMoney(n)}` : "";
        return next;
      }, "WON");
    }
    return save((l) => withStatus(l, s, by), statusLabel(s));
  };
  const setTemp = (t: Temperature) => save((l) => withHistory({ ...l, temperature: t, temperatureManual: true, updatedAt: new Date().toISOString() }, { type: "status", text: `Temperature: ${temperatureOf(l)} → ${t} (manual)`, by }), `Temperature ${t}`);
  const saveFollowUp = async () => {
    if (!fu.date) { setMsg("Follow-up ki tareekh chunein"); return; }
    const next = await save((l) => withFollowUp(l, fu, by), "Follow-up set");
    if (next && workspaceUid) syncLeadSchedule(workspaceUid, next, "followup", by);
  };
  const markFollowUpDone = async () => {
    const next = await save((l) => followUpDone(l, by), "Follow-up mukammal");
    if (next && workspaceUid) syncLeadSchedule(workspaceUid, next, "followup", by);
  };
  const saveDemo = async () => {
    if (!demo) { setMsg("Demo ki tareekh / waqt chunein"); return; }
    const next = await save((l) => withDemo(l, demo, by), "Demo scheduled");
    if (next && workspaceUid) syncLeadSchedule(workspaceUid, next, "demo", by);
  };
  const logActivity = async () => {
    const t = ACTIVITY_TYPES.find((x) => x.type === act.type)!;
    const text = act.note.trim() || `${t.label}${act.outcome ? ` — ${act.outcome}` : ""}`;
    if (act.type === "note" && !act.note.trim()) { setMsg("Note likhein"); return; }
    const at = act.at ? new Date(act.at).toISOString() : new Date().toISOString();
    const contact = act.type !== "note";
    const ok = await save((l) => withHistory({
      ...l, updatedAt: new Date().toISOString(),
      ...(contact ? { lastContactAt: at > (l.lastContactAt || "") ? at : l.lastContactAt, firstContactAt: l.firstContactAt || at } : {}),
    }, { type: act.type, text, by, at, outcome: act.outcome || undefined, duration: Number(act.duration) || undefined }), `${t.label} log ho gaya`);
    if (ok) setAct({ type: act.type, outcome: "", duration: "", note: "", at: localNow() });
  };
  const call = () => {
    if (phone) window.open(`tel:+${phone}`);
    setAct({ ...act, type: "call", at: localNow() });
    document.querySelector(".actLogger")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const reanalyze = () => save((l) => applyAnalysis(l, analyzeLead(l, data.settings), { by }), "AI analysis update");
  const openWhatsApp = () => {
    if (extensionVersion()) waExt.open(lead.waJid ? { chatId: lead.waJid } : { phone }).catch((e) => setMsg(e.message));
    else { const l = waLink(phone); if (l) window.open(l, "_blank"); }
  };
  const addProduct = (id: string) => {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    save((l) => withHistory({ ...l, products: [...(l.products || []), { productId: p.id, name: p.name, qty: 1 }], updatedAt: new Date().toISOString() },
      { type: "note", text: `Product add: ${p.name} (Rs ${fmtMoney(productSaleValue(p))})`, by }), `${p.name} add`);
  };
  const patchProduct = (id: string, patch: Record<string, unknown>) =>
    save((l) => ({ ...l, products: (l.products || []).map((x: any) => (x.productId === id ? { ...x, ...patch } : x)), updatedAt: new Date().toISOString() }), "Products update");
  const removeProduct = (id: string) =>
    save((l) => withHistory({ ...l, products: (l.products || []).filter((x: any) => x.productId !== id), updatedAt: new Date().toISOString() },
      { type: "note", text: `Product hataya: ${products.find((p) => p.id === id)?.name || id}`, by }), "Product hataya");

  const history = filterHistory([...(lead.history || [])].reverse(), hf);
  const statusKeys = [...SALES_STATUSES.map((s) => s.key), ...LEGACY_STATUSES.filter((s) => s === lead.status)];
  const units = businessesOf(data.settings);

  return (
    <div className="dtModalBackdrop" onClick={onClose}>
      <div className="dtModal wide leadProfile" onClick={(e) => e.stopPropagation()}>
        <div className="dtModalHead">
          <div>
            <b style={{ fontSize: 18 }}>{lead.name}</b>{lead.vip && <span className="badge vipBadge" style={{ marginLeft: 6 }}>⭐ VIP</span>}
            <span className={`badge ${temperatureClass(temp)}`} style={{ marginLeft: 6 }}>{temp}</span>
            <span className="badge pri" style={{ marginLeft: 6 }}>{statusLabel(lead.status)}</span>
            {biz && <span className="badge bizBadge" style={{ marginLeft: 6, borderColor: biz.color, color: biz.color }}>{biz.icon} {biz.name}</span>}
            <div className="small">
              {formatLocalPhone(phone) || lead.phone || "No number"} • {sourceOf(lead)}{lead.adInfo?.title ? ` (${lead.adInfo.title})` : ""} • {lead.createdAt ? fmtAt(lead.createdAt) : lead.date || ""}
              {lead.leadType && <> • {LEAD_TYPE_LABEL[lead.leadType as keyof typeof LEAD_TYPE_LABEL]}</>}
            </div>
          </div>
          <div className="rowActions">
            {!blocker && <button className="btnSolid takeBtn" onClick={take} disabled={!!busy}>{busy === "take" ? "…" : "✋ TAKE LEAD"}</button>}
            {phone && canEdit && <button className="btnSmall" onClick={call}>📞 Call</button>}
            {phone && !lead.optOut && <button className="btnSmall" onClick={openWhatsApp}>🟢 WhatsApp kholein</button>}
            {phone && !lead.optOut && (can("whatsapp.view") || canEdit) && <button className="btnSmall" onClick={() => setComposer(true)}>✉ Template</button>}
            {canEdit && can("products.view") && <button className="btnSmall" onClick={() => setQuote({})}>🧾 Quotation</button>}
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

        <div className="valueStrip">
          <div><span>💰 Value</span><b>{value.amount ? `Rs ${fmtMoney(value.amount)}` : "—"}</b><em>{value.label}</em></div>
          {value.budget > 0 && <div><span>Customer ka budget</span><b>Rs {fmtMoney(value.budget)}</b><em>chat mein bataya</em></div>}
          {quotes[0] && <div><span>Aakhri quotation</span><b>{quotes[0].number}</b><em>Rs {fmtMoney(quotes[0].total)} • {fmtAt(quotes[0].createdAt)}</em></div>}
          {lead.status === "Converted" && lead.wonAmount ? <div><span>🏆 Sale</span><b>Rs {fmtMoney(lead.wonAmount)}</b><em>{lead.wonAt ? fmtAt(lead.wonAt) : ""}</em></div> : null}
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
              <div className="lpHead">📜 Activity & history ({(lead.history || []).length})</div>
              {canEdit && (
                <div className="actLogger">
                  <div className="segmented actTypes">
                    {ACTIVITY_TYPES.map((t) => <button key={t.type} className={act.type === t.type ? "on" : ""} onClick={() => setAct({ ...act, type: t.type })}>{t.icon} {t.label}</button>)}
                  </div>
                  <div className="lwRow">
                    {act.type !== "note" && (
                      <select value={act.outcome} onChange={(e) => setAct({ ...act, outcome: e.target.value })} aria-label="Outcome">
                        <option value="">Nateeja…</option>{OUTCOMES.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    )}
                    {["call", "meeting", "visit"].includes(act.type) && <input type="number" min={0} value={act.duration} onChange={(e) => setAct({ ...act, duration: e.target.value })} placeholder="Minute" aria-label="Duration" style={{ maxWidth: 90 }} />}
                    <input type="datetime-local" value={act.at} onChange={(e) => setAct({ ...act, at: e.target.value })} aria-label="Kab" />
                  </div>
                  <div className="lpNote">
                    <input value={act.note} onChange={(e) => setAct({ ...act, note: e.target.value })} placeholder={act.type === "note" ? "Note likhein…" : "Kya baat hui (optional)…"} onKeyDown={(e) => e.key === "Enter" && logActivity()} />
                    <button className="btnSmall" onClick={logActivity} disabled={!!busy}>Log karein</button>
                  </div>
                </div>
              )}
              <div className="histFilters">
                {HISTORY_FILTERS.map((f) => <button key={f.id} className={`chip ${hf === f.id ? "on" : ""}`} onClick={() => setHf(f.id)}>{f.label}</button>)}
              </div>
              {history.length === 0 ? <div className="small">Is filter mein koi activity nahi.</div> : (
                <ul className="lpTimeline">
                  {history.map((h: LeadEvent, i: number) => (
                    <li key={i} className={h.role === "admin" ? "byAdmin" : ""}>
                      <span className="lpIcon">{EVENT_ICON[h.type] || "•"}</span>
                      <div>
                        <div>{h.text}{h.outcome && <span className="badge" style={{ marginLeft: 6 }}>{h.outcome}</span>}{h.duration ? <span className="small"> • {h.duration} min</span> : null}</div>
                        <div className="small">{fmtAt(h.at)}{h.who || h.by ? ` • ${h.who || h.by}` : ""}{h.role === "admin" ? " • 🛡 Admin" : ""}</div>
                      </div>
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
              {units.length > 1 && (
                <div className="lpRow"><span>Business unit</span>
                  {canEdit ? (
                    <select value={lead.unit || ""} onChange={(e) => { const v = e.target.value; save((l) => withHistory({ ...l, unit: v }, { type: "note", text: `Business: ${businessById(data.settings, v)?.name || "auto"}`, by }), "Business update"); }} aria-label="Business unit">
                      <option value="">Auto{biz && !lead.unit ? ` (${biz.name})` : ""}</option>
                      {units.map((u) => <option key={u.id} value={u.id}>{u.icon} {u.name}</option>)}
                    </select>
                  ) : <b>{biz ? `${biz.icon} ${biz.name}` : "—"}</b>}
                </div>
              )}
              {lead.adInfo && <div className="small">Ad: {[lead.adInfo.title, lead.adInfo.sourceId && `id ${lead.adInfo.sourceId}`, lead.adInfo.sourceUrl].filter(Boolean).join(" • ") || "Meta ad se aaya"}</div>}
              {lead.optOut && <div className="badge bad" style={{ marginTop: 6 }}>⛔ Opt-out — message na karein</div>}
            </div>

            {can("products.view") && (
              <div className="lpCard">
                <div className="lpHead">📦 Products (value in se)</div>
                {(lead.products || []).length === 0 && <div className="small">Abhi koi product nahi chuna — value andaze se hai.{suggested.length ? ` Mashwara: ${suggested.map((p) => p.name).join(", ")}` : ""}</div>}
                {(lead.products || []).map((x: any) => {
                  const p = products.find((pp) => pp.id === x.productId);
                  return (
                    <div key={x.productId} className="leadProd">
                      <span>{p?.icon || "•"} {p?.name || x.name}</span>
                      {canEdit ? (
                        <>
                          <input type="number" min={1} value={x.qty || 1} onChange={(e) => patchProduct(x.productId, { qty: Math.max(1, Number(e.target.value) || 1) })} aria-label="Qty" />
                          <input type="number" value={x.price ?? (p ? productSaleValue(p) : 0)} onChange={(e) => patchProduct(x.productId, { price: Number(e.target.value) || 0 })} aria-label="Price" />
                          {p && <button className="iconBtn" title="WhatsApp share" onClick={() => setShare(p)}>📤</button>}
                          <button className="iconBtn" onClick={() => removeProduct(x.productId)} aria-label="Remove">✕</button>
                        </>
                      ) : <b>Rs {fmtMoney(x.price ?? (p ? productSaleValue(p) : 0))}{x.qty > 1 ? ` ×${x.qty}` : ""}</b>}
                    </div>
                  );
                })}
                {canEdit && pickable.length > 0 && (
                  <select value="" onChange={(e) => addProduct(e.target.value)} aria-label="Add product" style={{ marginTop: 6 }}>
                    <option value="">+ Product chunein…</option>
                    {pickable.map((p) => <option key={p.id} value={p.id}>{suggested.includes(p) ? "★ " : ""}{p.icon} {p.name} — Rs {fmtMoney(productSaleValue(p))}</option>)}
                  </select>
                )}
                {quotes.length > 0 && (
                  <div className="leadQuotes">
                    {quotes.map((q) => (
                      <button key={q.id} className="linkBtn" onClick={() => setQuote({ existing: q })}>🧾 {q.number} • Rs {fmtMoney(q.total)} • {fmtAt(q.createdAt)}</button>
                    ))}
                  </div>
                )}
              </div>
            )}

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
                    {lead.followUpDate && !lead.followUpDone && !lead.followUpAuto && <button className="btnSmall" disabled={!!busy} onClick={markFollowUpDone}>✅ Follow-up ho gaya</button>}
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
            onSent={(log) => { if (canEdit) save((l) => withHistory({ ...l, lastContactAt: log.at }, { type: "whatsapp", text: `WhatsApp (${log.lang}): ${log.text.slice(0, 160)}`, by }), "WhatsApp bheja"); }}
          />
        )}
        {quote && <QuotationModal leadId={lead.id} existing={quote.existing} onClose={() => setQuote(null)} />}
        {share && <ShareModal product={share} leadId={lead.id} onClose={() => setShare(null)} />}
      </div>
    </div>
  );
}
