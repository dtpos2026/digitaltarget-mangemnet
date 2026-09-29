import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { todayISO, uid } from "@/lib/db";
import { formatLocalPhone } from "@/lib/phone";
import {
  ALL_CATEGORIES, Campaign, CampaignAlert, CategoryContent, DEFAULTS, MAX_DAILY_LIMIT, MIN_DELAY_SEC, Recipient, buildRecipients, campaignStats,
  categoryOfLead, clampDaily, clampDelay, clearable, contentFor, deleteBlocker, groupByCategory, nextQueued, safetyCheck, sentToday,
} from "@/lib/campaign";
import { MEDIA_ACCEPT, blobToDataUrl, checkMedia, deleteCampaignMedia, loadMedia, saveMedia } from "@/lib/campaignMedia";
import { categoriesOf } from "@/lib/catalog";
import { LANGS, OPT_OUT_RE, TEMPLATE_TYPES, TemplateLang } from "@/lib/waTemplates";
import { analyzeLead, applyAnalysis, conversationOf, withHistory } from "@/lib/leadAnalysis";
import { extensionVersion, waExt } from "@/lib/waExtension";

const STATUS_CLS: Record<string, string> = { queued: "", sending: "warn", sent: "pri", delivered: "ok", replied: "ok", failed: "bad", skipped: "" };
const clean = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/**
 * WhatsApp follow-up campaigns to the business's own leads, sent one by one
 * through the user's linked WhatsApp Web at a human pace. Every message is
 * previewed and approved first; opt-outs are never messaged.
 */
export default function MessageCenter({ preselect }: { preselect?: { ids: string[]; n: number } | null }) {
  const { workspaceUid, user, can } = useAuth();
  const { data, updateItem } = useData();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [optOuts, setOptOuts] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  // Draft
  const [leadIds, setLeadIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [lang, setLang] = useState<TemplateLang>("ur");
  const [mode, setMode] = useState<"auto" | "fixed">("auto");
  const [templateKey, setTemplateKey] = useState("lead_followup");
  const [delaySec, setDelaySec] = useState(DEFAULTS.delaySec);
  const [dailyLimit, setDailyLimit] = useState(DEFAULTS.dailyLimit);
  const [startAt, setStartAt] = useState("");
  const [consent, setConsent] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [pick, setPick] = useState({ status: "ALL", service: "ALL", category: "ALL", days: "15" });
  // Message / link / media per service category ("*" = every category).
  const [content, setContent] = useState<Record<string, CategoryContent>>({});
  const [catTab, setCatTab] = useState<string>(ALL_CATEGORIES);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const running = useRef<{ id: string; nextAt: number; busy: boolean } | null>(null);
  const campaignsRef = useRef<Campaign[]>([]);
  campaignsRef.current = campaigns;

  const col = useCallback(() => collection(db, "users", workspaceUid!, "waCampaigns"), [workspaceUid]);
  const save = useCallback(async (c: Campaign) => {
    const next = clean({ ...c, updatedAt: new Date().toISOString() });
    await setDoc(doc(col(), c.id), next);
    setCampaigns((prev) => prev.map((x) => (x.id === c.id ? next : x)));
    return next;
  }, [col]);

  // Campaigns (live) and the opt-out list.
  useEffect(() => {
    if (!workspaceUid) return;
    const unsub = onSnapshot(query(col(), orderBy("createdAt", "desc"), limit(30)), (snap) => setCampaigns(snap.docs.map((d) => d.data() as Campaign)), () => {});
    getDocs(collection(db, "users", workspaceUid, "optOuts")).then((s) => setOptOuts(new Set(s.docs.map((d) => d.id)))).catch(() => {});
    return unsub;
  }, [workspaceUid, col]);

  // Leads handed over from the Leads tab.
  useEffect(() => {
    if (preselect?.ids?.length) { setLeadIds(preselect.ids); setActiveId(null); setName(`Follow-up ${todayISO()}`); }
  }, [preselect]);

  const leadsById = useMemo(() => new Map(data.leads.map((l: any) => [l.id, l])), [data.leads]);
  const draftLeads = leadIds.map((id) => leadsById.get(id)).filter(Boolean);
  const recipients = useMemo(() => buildRecipients(draftLeads, optOuts, data.settings, { lang, templateMode: mode, templateKey, content })
    .map((r) => (edits[r.leadId] ? { ...r, text: edits[r.leadId] } : r)), [draftLeads, optOuts, data.settings, lang, mode, templateKey, edits, content]);
  const groups = useMemo(() => groupByCategory(recipients), [recipients]);
  const allCategories = useMemo(() => categoriesOf(data.settings), [data.settings]);
  const queued = recipients.filter((r) => r.status === "queued").length;
  const used = sentToday(campaigns);

  const addFromFilter = () => {
    const since = new Date(Date.now() - Number(pick.days) * 864e5).toISOString().slice(0, 10);
    const ids = data.leads.filter((l: any) =>
      (pick.status === "ALL" || l.status === pick.status) && (pick.service === "ALL" || (l.serviceType || l.ai?.line) === pick.service)
      && (pick.category === "ALL" || categoryOfLead(l) === pick.category)
      && String(l.date || l.createdAt || "").slice(0, 10) >= since).map((l: any) => l.id);
    setLeadIds(Array.from(new Set([...leadIds, ...ids])));
  };

  const setCat = (cat: string, patch: Partial<CategoryContent>) => setContent((p) => ({ ...p, [cat]: { ...(p[cat] || {}), ...patch } }));
  const pickMedia = async (cat: string, f?: File | null) => {
    if (!f) return;
    const bad = checkMedia(f);
    if (bad) { setNote(bad); return; }
    const ref = await saveMedia(`draft:${cat}`, f);
    setCat(cat, { media: ref });
    if (f.type.startsWith("image/")) setPreviews((p) => ({ ...p, [cat]: URL.createObjectURL(f) }));
    else setPreviews((p) => { const { [cat]: _x, ...rest } = p; return rest; });
    setEdits({});
  };
  const dropMedia = (cat: string) => {
    setContent((p) => { const c = { ...(p[cat] || {}) }; delete c.media; return { ...p, [cat]: c }; });
    setPreviews((p) => { const { [cat]: _x, ...rest } = p; return rest; });
  };

  // ---------------------------------------------------------------- runner
  const alertAndPause = useCallback(async (c: Campaign, alert: CampaignAlert) => {
    running.current = null;
    await save({ ...c, status: "paused", pausedReason: alert.text, alerts: [...(c.alerts || []), alert].slice(-20) });
    setNote(alert.text);
  }, [save]);

  const tick = useCallback(async () => {
    const r = running.current;
    if (!r || r.busy || Date.now() < r.nextAt) return;
    const c = campaignsRef.current.find((x) => x.id === r.id);
    if (!c || c.status !== "running") { running.current = null; return; }
    if (c.startAt && Date.now() < new Date(c.startAt).getTime()) return;
    r.busy = true;
    try {
      const check = safetyCheck(c, sentToday(campaignsRef.current));
      if (check.pause && check.alert) return void (await alertAndPause(c, check.alert));
      let mode_ = "";
      try {
        const st = extensionVersion() ? await waExt.state() : null;
        if (!st?.authenticated) throw new Error("WhatsApp link nahi");
        mode_ = st.mode || "";
      } catch {
        return void (await alertAndPause(c, { at: new Date().toISOString(), type: "provider", text: "WhatsApp Web / extension connected nahi — campaign ruk gayi. WhatsApp link kar ke Resume karein." }));
      }
      const idx = nextQueued(c);
      if (idx < 0) { running.current = null; await save({ ...c, status: "completed", finishedAt: new Date().toISOString() }); setNote("✓ Campaign mukammal"); return; }
      const rec = c.recipients[idx];
      const lead = leadsById.get(rec.leadId);
      // Re-check opt-out right before sending (a reply may have arrived meanwhile).
      if (!lead || lead.optOut || optOuts.has(rec.phone)) {
        const recipients_ = c.recipients.map((x, i) => (i === idx ? { ...x, status: "skipped" as const, reason: "Opt-out / lead nahi mili" } : x));
        await save({ ...c, recipients: recipients_, heartbeatAt: new Date().toISOString() });
        return;
      }
      let dataUrl = "";
      if (rec.media) {
        if (mode_ === "dom") return void (await alertAndPause(c, { at: new Date().toISOString(), type: "provider", text: "Screen mode mein photo / video portal se nahi ja sakti — link use karein ya extension ka Fast mode chalayein." }));
        const blob = await loadMedia(rec.media.key);
        if (!blob) return void (await alertAndPause(c, { at: new Date().toISOString(), type: "unusual", text: `File "${rec.media.name}" is browser mein nahi mili (dusra computer ya browser data saaf hua). Isi computer par resume karein ya nayi campaign banayein.` }));
        dataUrl = await blobToDataUrl(blob);
      }
      let result: Recipient;
      try {
        if (rec.media) await waExt.sendFile({ phone: rec.phone, dataUrl, filename: rec.media.name, caption: rec.text });
        else await waExt.sendText({ phone: rec.phone, text: rec.text });
        result = { ...rec, status: "sent", sentAt: new Date().toISOString(), reason: "" };
      } catch (e) {
        result = { ...rec, status: "failed", reason: String((e as Error).message || e).slice(0, 120), sentAt: new Date().toISOString() };
      }
      let next: Campaign = { ...c, recipients: c.recipients.map((x, i) => (i === idx ? result : x)), heartbeatAt: new Date().toISOString() };
      next = await save(next);
      if (result.status === "sent") {
        await updateItem("leads", withHistory({ ...lead, lastContactAt: result.sentAt }, { type: "message", text: `Campaign "${c.name}": ${rec.text.slice(0, 140)}`, by: user?.email || "" }));
      }
      const after = safetyCheck(next, sentToday(campaignsRef.current.map((x) => (x.id === next.id ? next : x))));
      if (after.pause && after.alert) return void (await alertAndPause(next, after.alert));
      // Screen mode reloads WhatsApp for each send: keep at least a minute between messages.
      r.nextAt = Date.now() + Math.max(clampDelay(c.delaySec), mode_ === "dom" ? 60 : 0) * 1000;
    } finally {
      if (running.current) running.current.busy = false;
    }
  }, [alertAndPause, leadsById, optOuts, save, updateItem, user?.email]);

  useEffect(() => {
    const t = window.setInterval(() => { tick().catch(() => {}); }, 1000);
    return () => window.clearInterval(t);
  }, [tick]);

  // ---------------------------------------------------------------- actions
  const start = async () => {
    if (!workspaceUid) return;
    if (!consent) { setNote("Pehle consent confirm karein."); return; }
    if (!queued) { setNote("Bhejne ke liye koi valid lead nahi."); return; }
    if (!extensionVersion()) { setNote("Digital Target WhatsApp extension install / link karein."); return; }
    if (!confirm(`${queued} messages bhejne hain — har ${clampDelay(delaySec)} second baad ek, aaj ki limit ${clampDaily(dailyLimit)}.\n\nMessages approve hain? Start karein?`)) return;
    const id = uid("CMP");
    // Move the picked files under this campaign's own keys and use those in the saved content / recipients.
    const finalContent: Record<string, CategoryContent> = {};
    for (const [cat, cc] of Object.entries(content)) {
      const next: CategoryContent = { ...cc };
      if (cc.media) {
        const blob = await loadMedia(cc.media.key);
        if (!blob) { setNote(`"${cc.media.name}" file nahi mili — dobara select karein.`); return; }
        next.media = await saveMedia(`${id}:${cat}`, new File([blob], cc.media.name, { type: cc.media.type }));
      }
      finalContent[cat] = next;
    }
    const finalRecipients = buildRecipients(draftLeads, optOuts, data.settings, { lang, templateMode: mode, templateKey, content: finalContent })
      .map((r) => (edits[r.leadId] ? { ...r, text: edits[r.leadId] } : r));
    const c: Campaign = {
      id, name: name.trim() || `Campaign ${todayISO()}`, status: "running", lang, templateMode: mode, templateKey, content: finalContent,
      delaySec: clampDelay(delaySec), dailyLimit: clampDaily(dailyLimit), startAt: startAt ? new Date(startAt).toISOString() : "",
      consent: true, recipients: finalRecipients, alerts: [], createdAt: new Date().toISOString(), createdBy: user?.email || "", startedAt: new Date().toISOString(),
    };
    await setDoc(doc(col(), c.id), clean(c));
    setCampaigns((p) => [c, ...p]);
    running.current = { id: c.id, nextAt: Date.now(), busy: false };
    setActiveId(c.id); setLeadIds([]); setEdits({}); setConsent(false); setContent({}); setPreviews({}); setCatTab(ALL_CATEGORIES); setNote("▶ Campaign shuru — ye tab khula rakhein.");
  };
  const pause = async (c: Campaign) => { if (running.current?.id === c.id) running.current = null; await save({ ...c, status: "paused", pausedReason: "User ne pause kiya" }); };
  const resume = async (c: Campaign) => {
    if (running.current && running.current.id !== c.id) { setNote("Ek waqt mein ek campaign chalti hai — pehle doosri pause karein."); return; }
    await save({ ...c, status: "running", pausedReason: "" });
    running.current = { id: c.id, nextAt: Date.now(), busy: false };
  };
  const stop = async (c: Campaign) => {
    if (!confirm("Campaign band karein? Baqi queued messages nahi jayenge.")) return;
    if (running.current?.id === c.id) running.current = null;
    await save({ ...c, status: "stopped", finishedAt: new Date().toISOString(), recipients: c.recipients.map((r) => (r.status === "queued" ? { ...r, status: "skipped" as const, reason: "Campaign stop" } : r)) });
  };

  const removeCampaign = async (c: Campaign) => {
    const why = deleteBlocker(c);
    if (why) { setNote(why); return; }
    if (!confirm(`"${c.name}" campaign hamesha ke liye delete karein?\n\nIs ki recipients list, status aur replies ka record database se hat jayega (wapas nahi aayega).\nLeads, unki history aur opt-out list safe rehti hain.`)) return;
    try {
      await deleteDoc(doc(col(), c.id));
      await deleteCampaignMedia(c.id);
      setCampaigns((p) => p.filter((x) => x.id !== c.id));
      if (activeId === c.id) setActiveId(null);
      setNote("✓ Campaign delete ho gayi");
    } catch (e) { setNote("Delete nahi hui: " + (e as Error).message); }
  };
  const clearFinished = async () => {
    const list = clearable(campaigns);
    if (!list.length) return;
    if (!confirm(`${list.length} mukammal / band campaigns delete karein?\n\n${list.slice(0, 8).map((c) => "• " + c.name).join("\n")}${list.length > 8 ? "\n…" : ""}\n\nUn ka record database se hat jayega (wapas nahi aayega). Leads aur opt-out list safe rehti hain.`)) return;
    const gone = new Set<string>();
    for (const c of list) {
      try { await deleteDoc(doc(col(), c.id)); await deleteCampaignMedia(c.id); gone.add(c.id); } catch { /* keep going */ }
    }
    setCampaigns((p) => p.filter((x) => !gone.has(x.id)));
    if (activeId && gone.has(activeId)) setActiveId(null);
    setNote(`✓ ${gone.size} campaigns delete ho gayi${gone.size < list.length ? ` (${list.length - gone.size} nahi hui)` : ""}`);
  };

  /** Reads WhatsApp for replies / delivery ticks, re-analyses the lead, records opt-outs. */
  const checkReplies = useCallback(async (c: Campaign, silent = false) => {
    if (!extensionVersion() || !workspaceUid) return;
    let st;
    try { st = await waExt.state(); } catch { return; }
    if (!st?.authenticated) { if (!silent) setNote("WhatsApp link nahi — replies check nahi ho sakte."); return; }
    let unread: Set<string> | null = null;
    if (st.mode === "dom") {
      try { unread = new Set((await waExt.chats({ onlyUnread: true })).map((x) => x.phone).filter(Boolean)); } catch { unread = new Set(); }
    }
    let changed = false;
    const recipients = [...c.recipients];
    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      if (!["sent", "delivered"].includes(r.status) || !r.sentAt) continue;
      const sentMs = new Date(r.sentAt).getTime();
      let reply = "";
      let delivered = false;
      if (unread) {
        if (unread.has(r.phone)) reply = "(naya reply — WhatsApp mein dekhein)";
      } else {
        try {
          const msgs = await waExt.messages(`${r.phone}@c.us`, 15);
          const theirs = msgs.filter((m) => !m.fromMe && m.t >= sentMs - 60000);
          if (theirs.length) reply = theirs.map((m) => m.text).join("\n").slice(0, 500);
          delivered = msgs.some((m) => m.fromMe && m.t >= sentMs - 120000 && (m.ack || 0) >= 2);
        } catch { continue; }
      }
      if (reply) {
        const optOut = OPT_OUT_RE.test(reply);
        recipients[i] = { ...r, status: "replied", repliedAt: new Date().toISOString(), replyText: reply, optOut };
        changed = true;
        const lead = leadsById.get(r.leadId);
        if (lead) {
          const chat = [...conversationOf(lead), { text: r.text, fromMe: true }, { text: reply, fromMe: false }].slice(-30);
          let next: any = withHistory({ ...lead, chat, lastMessageAt: new Date().toISOString() }, { type: optOut ? "optout" : "reply", text: `Reply: ${reply.slice(0, 160)}` });
          if (optOut) {
            next = { ...next, optOut: true };
            await setDoc(doc(db, "users", workspaceUid, "optOuts", r.phone), { phone: r.phone, leadId: lead.id, at: new Date().toISOString(), source: `campaign:${c.id}`, text: reply.slice(0, 200) });
            setOptOuts((p) => new Set([...p, r.phone]));
          }
          // AI re-analysis with the reply in the conversation.
          next = applyAnalysis(next, analyzeLead(next, data.settings), { by: "campaign" });
          await updateItem("leads", next);
        }
      } else if (delivered && r.status === "sent") {
        recipients[i] = { ...r, status: "delivered", deliveredAt: new Date().toISOString() };
        changed = true;
      }
    }
    if (changed) {
      let next: Campaign = { ...c, recipients };
      const check = safetyCheck(next, 0);
      if (check.alert?.type === "opt_out" && next.status === "running") {
        next = { ...next, status: "paused", pausedReason: check.alert.text, alerts: [...(next.alerts || []), check.alert] };
        if (running.current?.id === c.id) running.current = null;
      }
      await save(next);
    }
    if (!silent) setNote(changed ? "✓ Replies update ho gaye" : "Koi naya reply nahi");
  }, [data.settings, leadsById, save, updateItem, workspaceUid]);

  // Auto reply-check every 2 minutes for the open campaign.
  const active = campaigns.find((c) => c.id === activeId) || null;
  useEffect(() => {
    if (!active || !["running", "paused", "completed"].includes(active.status)) return;
    const t = window.setInterval(() => { checkReplies(active, true).catch(() => {}); }, 120000);
    return () => window.clearInterval(t);
  }, [active, checkReplies]);

  if (!can("campaigns.manage")) return <div className="small">Message Center ke liye "WhatsApp Message Center & Campaigns" permission chahiye.</div>;

  const stale = (c: Campaign) => c.status === "running" && running.current?.id !== c.id;

  return (
    <div className="mcWrap">
      <section className="mcDraft">
        <div className="mcHead"><b>📣 Naya follow-up campaign</b><span className="small">Aaj bheje: {used}</span></div>
        <div className="mcSafety small">
          Sirf apne leads (jinhon ne khud rabta kiya) ko, insaani raftaar se. Opt-out kabhi message nahi hote. Kam az kam {MIN_DELAY_SEC}s delay, rozana max {MAX_DAILY_LIMIT}.
        </div>
        <label>Campaign name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Meta Ads follow-up — October" />

        <label>Leads ({leadIds.length})</label>
        <div className="mcPick">
          <select value={pick.status} onChange={(e) => setPick({ ...pick, status: e.target.value })} aria-label="Status">
            <option value="ALL">Sab status</option>
            {["New", "Contacted", "Interested", "Follow-up", "Proposal"].map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={pick.service} onChange={(e) => setPick({ ...pick, service: e.target.value })} aria-label="Service">
            <option value="ALL">Sab services</option>
            {Array.from(new Set(data.leads.map((l: any) => l.serviceType || l.ai?.line).filter(Boolean))).map((s: any) => <option key={s}>{s}</option>)}
          </select>
          <select value={pick.category} onChange={(e) => setPick({ ...pick, category: e.target.value })} aria-label="Category">
            <option value="ALL">Sab categories</option>
            {allCategories.map((c) => <option key={c}>{c}</option>)}
            <option value="Other">Other</option>
          </select>
          <select value={pick.days} onChange={(e) => setPick({ ...pick, days: e.target.value })} aria-label="Days">
            {["3", "7", "15", "30", "90"].map((d) => <option key={d} value={d}>Pichle {d} din</option>)}
          </select>
          <button className="btnSmall" onClick={addFromFilter}>+ Add</button>
          {leadIds.length > 0 && <button className="btnSmall" onClick={() => { setLeadIds([]); setEdits({}); }}>Clear</button>}
        </div>

        <div className="grid2" style={{ gap: 8 }}>
          <div><label>Template</label>
            <select value={mode === "auto" ? "__auto" : templateKey} onChange={(e) => { if (e.target.value === "__auto") setMode("auto"); else { setMode("fixed"); setTemplateKey(e.target.value); } setEdits({}); }}>
              <option value="__auto">🤖 Auto — har lead ki service ke mutabiq</option>
              {TEMPLATE_TYPES.filter((t) => t.group === "lead").map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div><label>Language</label>
            <div className="segmented">{LANGS.map((l) => <button key={l.id} className={lang === l.id ? "on" : ""} onClick={() => { setLang(l.id); setEdits({}); }}>{l.label}</button>)}</div>
          </div>
          <div><label>Delay (seconds, min {MIN_DELAY_SEC})</label><input type="number" min={MIN_DELAY_SEC} value={delaySec} onChange={(e) => setDelaySec(+e.target.value)} onBlur={() => setDelaySec(clampDelay(delaySec))} /></div>
          <div><label>Daily limit (max {MAX_DAILY_LIMIT})</label><input type="number" min={1} max={MAX_DAILY_LIMIT} value={dailyLimit} onChange={(e) => setDailyLimit(+e.target.value)} onBlur={() => setDailyLimit(clampDaily(dailyLimit))} /></div>
          <div><label>Schedule (optional)</label><input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></div>
        </div>

        {groups.length > 0 && (
          <div className="mcContent">
            <label>Category-wise message, link aur photo / video</label>
            <div className="small">Har lead ko us ki apni category ka message milta hai (khali chhorein to us ki service ka automatic message). Har category ke liye alag text, link aur photo / video laga sakte hain.</div>
            <div className="segmented mcCatTabs">
              {[{ category: ALL_CATEGORIES, total: recipients.length, queued: queued }, ...groups].map((g) => (
                <button key={g.category} className={catTab === g.category ? "on" : ""} onClick={() => setCatTab(g.category)}>
                  {g.category === ALL_CATEGORIES ? "Sab" : g.category} ({g.total})
                  {g.category !== ALL_CATEGORIES && (content[g.category]?.media || content[g.category]?.text || content[g.category]?.link) ? " ✎" : ""}
                </button>
              ))}
            </div>
            {(() => {
              const cur = content[catTab] || {};
              const inherited = catTab !== ALL_CATEGORIES ? contentFor(content, catTab) : cur;
              const media = cur.media;
              return (
                <div className="mcCatBody">
                  <label>Message {catTab === ALL_CATEGORIES ? "(sab categories ke liye)" : `(${catTab})`} — khali = automatic</label>
                  <textarea rows={4} value={cur.text || ""} dir={lang === "ur" ? "rtl" : "ltr"} placeholder="Assalam o Alaikum {name}! {service} ke baare mein…   ({name} {service} {company} khud bhar jate hain)" onChange={(e) => { setCat(catTab, { text: e.target.value }); setEdits({}); }} />
                  <label>Link (website, YouTube, Google Drive…)</label>
                  <input value={cur.link || ""} placeholder={inherited.link && catTab !== ALL_CATEGORIES ? `Sab wala: ${inherited.link}` : "https://…"} onChange={(e) => { setCat(catTab, { link: e.target.value.trim() }); setEdits({}); }} />
                  <label>Photo / video / PDF (max 16 MB)</label>
                  {media ? (
                    <div className="mcMedia">
                      {previews[catTab] && <img src={previews[catTab]} alt="" />}
                      <div><b>{media.kind === "image" ? "🖼" : media.kind === "video" ? "🎬" : "📄"} {media.name}</b><div className="small">{(media.size / 1024 / 1024).toFixed(2)} MB • message is ke saath caption ban kar jayega</div></div>
                      <button className="btnSmall" onClick={() => dropMedia(catTab)}>✕ Hatayein</button>
                    </div>
                  ) : (
                    <>
                      <input type="file" accept={MEDIA_ACCEPT} onChange={(e) => { pickMedia(catTab, e.target.files?.[0]); e.target.value = ""; }} />
                      {catTab !== ALL_CATEGORIES && inherited.media && <div className="small">Is category ki apni file nahi — "Sab" wali file jayegi: {inherited.media.name}</div>}
                    </>
                  )}
                  <div className="small">Photo / video ke liye extension ka Fast mode chahiye; badi video ke bajaye uska link dein. File isi computer ke browser mein rehti hai — campaign isi computer se chalayein.</div>
                </div>
              );
            })()}
          </div>
        )}

        {recipients.length > 0 && (
          <div className="mcPreview">
            <div className="small"><b>{queued}</b> bhejne ke liye • {recipients.length - queued} skip • message par click kar ke edit karein</div>
            {recipients.map((r) => (
              <details key={r.leadId} className={`mcRec ${r.status}`}>
                <summary>
                  <b>{r.name}</b> <span className="small">{formatLocalPhone(r.phone) || "—"}</span>
                  <span className={`badge ${r.status === "skipped" ? "bad" : ""}`}>{r.status === "skipped" ? `Skip: ${r.reason}` : `${r.category || "Other"}${r.line ? ` • ${r.line}` : ""}`}</span>
                  {r.media && r.status !== "skipped" && <span className="badge ok">{r.media.kind === "image" ? "🖼" : r.media.kind === "video" ? "🎬" : "📄"} {r.media.name.slice(0, 18)}</span>}
                </summary>
                {r.status !== "skipped" && (
                  <textarea rows={6} value={r.text} dir={lang === "ur" ? "rtl" : "ltr"} className={lang === "ur" ? "urduText" : ""} onChange={(e) => setEdits({ ...edits, [r.leadId]: e.target.value })} />
                )}
              </details>
            ))}
          </div>
        )}

        <label className="permItem mcConsent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>Main tasdeeq karta hoon ke ye log khud hum se rabta kar chuke hain (inquiry / customer) aur message band karne ka nahi kaha. Messages mein ne dekh kar approve kiye hain.</span>
        </label>
        <button className="btnSolid" onClick={start} disabled={!queued || !consent}>✓ Approve &amp; Start ({queued})</button>
        {note && <div className="small waWebNote" onClick={() => setNote("")}>{note}</div>}
      </section>

      <section className="mcList">
        <div className="mcHead">
          <b>Campaigns</b>
          {clearable(campaigns).length > 0 && <button className="btnSmall" onClick={clearFinished} title="Mukammal / band campaigns database se hata dein">🧹 Complete wali delete ({clearable(campaigns).length})</button>}
        </div>
        {campaigns.length === 0 && <div className="small">Abhi koi campaign nahi.</div>}
        {campaigns.map((c) => {
          const s = campaignStats(c, data.leads);
          return (
            <button key={c.id} className={`mcItem ${activeId === c.id ? "on" : ""}`} onClick={() => setActiveId(c.id)}>
              <div><b>{c.name}</b><div className="small">{new Date(c.createdAt).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}</div></div>
              <div className="small">{s.sent}/{s.selected - s.skipped} sent • {s.replies} replies</div>
              <span className={`badge ${c.status === "running" && !stale(c) ? "ok" : c.status === "paused" || stale(c) ? "warn" : c.status === "completed" ? "pri" : ""}`}>{stale(c) ? "interrupted" : c.status}</span>
            </button>
          );
        })}

        {active && (() => {
          const s = campaignStats(active, data.leads);
          return (
            <div className="mcDetail">
              <div className="mcHead">
                <b>{active.name}</b>
                <div className="rowActions">
                  {(active.status === "paused" || stale(active)) && <button className="btnSolid" onClick={() => resume(active)}>▶ Resume</button>}
                  {active.status === "running" && !stale(active) && <button className="btnSmall" onClick={() => pause(active)}>⏸ Pause</button>}
                  {["running", "paused"].includes(active.status) && <button className="btnDanger" onClick={() => stop(active)}>■ Stop</button>}
                  <button className="btnSmall" onClick={() => checkReplies(active)}>↻ Replies check</button>
                  <button className="btnDanger" onClick={() => removeCampaign(active)} title={deleteBlocker(active) || "Campaign database se delete karein"}>🗑 Delete</button>
                </div>
              </div>
              {active.pausedReason && active.status === "paused" && <div className="mcAlert">⚠ {active.pausedReason}</div>}
              {stale(active) && <div className="mcAlert">Campaign is tab mein nahi chal rahi (page band hua tha). Resume dabayein.</div>}
              <div className="mcStats">
                {([["Selected", s.selected], ["Sent", s.sent], ["Delivered", s.delivered], ["Failed", s.failed], ["Skipped", s.skipped], ["Replies", s.replies], ["Interested", s.interested], ["Converted", s.converted], ["Response", `${s.responseRatio}%`]] as const).map(([k, v]) => (
                  <div key={k}><span>{k}</span><b>{v}</b></div>
                ))}
              </div>
              {(() => {
                const cats = groupByCategory(active.recipients);
                const withMedia = active.recipients.filter((r) => r.media).length;
                return <div className="small">Categories: {cats.map((g) => `${g.category} (${g.total})`).join(" • ")}{withMedia ? ` • ${withMedia} messages ke saath photo / video` : ""}</div>;
              })()}
              <div className="small">Delay {active.delaySec}s • daily limit {active.dailyLimit} • {LANGS.find((l) => l.id === active.lang)?.label}{active.startAt ? ` • start ${new Date(active.startAt).toLocaleString()}` : ""}</div>
              {(active.alerts || []).length > 0 && (
                <div className="mcAlerts">{active.alerts.slice(-5).reverse().map((a, i) => <div key={i} className="small">⚠ {new Date(a.at).toLocaleTimeString()} — {a.text}</div>)}</div>
              )}
              <div className="tablewrap" style={{ maxHeight: 360 }}>
                <table>
                  <thead><tr><th>Lead</th><th>Category</th><th>Status</th><th>Sent</th><th>Reply</th></tr></thead>
                  <tbody>
                    {active.recipients.map((r) => (
                      <tr key={r.leadId}>
                        <td><b>{r.name}</b><div className="small">{formatLocalPhone(r.phone)}</div></td>
                        <td className="small">{r.category || "—"}{r.media ? ` • ${r.media.kind === "image" ? "🖼" : r.media.kind === "video" ? "🎬" : "📄"}` : ""}</td>
                        <td><span className={`badge ${STATUS_CLS[r.status] || ""}`}>{r.status}</span>{r.reason ? <div className="small">{r.reason}</div> : null}{r.optOut ? <div className="badge bad">opt-out</div> : null}</td>
                        <td className="small">{r.sentAt ? new Date(r.sentAt).toLocaleTimeString() : "—"}</td>
                        <td className="small">{r.replyText ? r.replyText.slice(0, 80) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </section>
    </div>
  );
}
