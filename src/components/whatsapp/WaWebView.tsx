import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { uid, todayISO } from "@/lib/db";
import { classifyChat } from "@/lib/chatClassifier";
import { findLeadForChat, planCapture } from "@/lib/leadCapture";
import { mergeChat } from "@/lib/leadIngest";
import { analyzeLead, applyAnalysis } from "@/lib/leadAnalysis";
import { LEAD_STATUSES } from "@/lib/leads";
import { linesOf } from "@/lib/catalog";
import { formatLocalPhone, normalizePhone } from "@/lib/phone";
import {
  EXTENSION_ZIP, onExtensionEvent, realJid, useExtensionVersion, waExt, WaExtChat, WaExtMessage, WaExtState,
} from "@/lib/waExtension";
import { BrandMark } from "@/components/app/BrandMark";
import CaptureModal from "./CaptureModal";
import AiTrainingModal from "@/components/AiReplyTraining";
import { draftReply } from "@/lib/replyAssistant";
import { useCaptureBlocklist } from "@/lib/useCaptureBlocklist";
import LeadBriefCard from "@/components/LeadBriefCard";

const WA_URL = "https://web.whatsapp.com/";
const MODE_KEY = "dt.waWebMode";

const TEMPLATES: { label: string; text: string }[] = [
  { label: "Welcome", text: "Assalam o Alaikum {name}! Digital Target se rabta karne ka shukriya. Hum AI-based software, digital marketing aur social media management karte hain. Aap ko kis service mein madad chahiye?" },
  { label: "AI Software", text: "{name}, hum aap ke business ke liye AI-based custom software / POS / automation banate hain. Aap ka kaam kya hai aur kaun si cheezen automate karni hain? Hum free demo dikha sakte hain." },
  { label: "Digital Marketing", text: "{name}, hum Facebook, Instagram aur Google ads se aap ke business ki leads aur sales barhate hain. Aap ka monthly ad budget kitna hai aur target city kaun si hai?" },
  { label: "Social Media", text: "{name}, hamari monthly social media management mein post design, captions, reels aur page handling shamil hai. Kya main aap ko packages bhej doon?" },
  { label: "Follow-up", text: "{name}, bas follow-up kar raha hoon — kya aap ne hamari proposal dekh li? Koi sawal ho to batayein, hum madad ke liye haazir hain." },
  { label: "Meeting", text: "{name}, kya hum aaj ya kal ek chhoti si call / meeting rakh sakte hain? Aap ko kaun sa time munasib hai?" },
  { label: "Payment", text: "{name}, aap ki invoice ki payment pending hai. Barah-e-karam payment kar ke slip share kar dein. Shukriya!" },
];

type Active = (WaExtChat & { messages: WaExtMessage[] }) | null;

// WhatsApp currently refuses to run inside another site's frame, so the
// separate window is the default; "Portal ke andar" stays as an option.
function readMode(): "embed" | "window" {
  try { return localStorage.getItem(MODE_KEY) === "embed" ? "embed" : "window"; } catch { return "window"; }
}

/**
 * WhatsApp Web inside the portal (POS style): WhatsApp Web on the right,
 * a Digital Target panel on the left — link status, current chat → lead,
 * quick send and pending chats. Needs the Digital Target WhatsApp browser
 * extension; no server.
 */
export default function WaWebView({ openPhone }: { openPhone?: { phone: string; chatId?: string; n: number } | null }) {
  const version = useExtensionVersion();
  const { can, user } = useAuth();
  const { data, addItem, updateItem, logAudit } = useData();
  const [mode, setModeState] = useState(readMode);
  const [st, setSt] = useState<WaExtState | null>(null);
  const [frameSeen, setFrameSeen] = useState(false);
  const [slow, setSlow] = useState(false);
  const [active, setActive] = useState<Active>(null);
  const [pendingChats, setPendingChats] = useState<WaExtChat[]>([]);
  const [showCapture, setShowCapture] = useState(false);
  const [showTrain, setShowTrain] = useState(false);
  const block = useCaptureBlocklist();
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const timers = useRef<Record<string, number>>({});

  const canReply = can("whatsapp.reply");
  const canLead = can(["leads.create"]);
  const lines = linesOf(data.settings);

  const setMode = (m: "embed" | "window") => {
    setModeState(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
    if (m === "window") waExt.openWindow().catch((e) => setNote(e.message));
  };

  const debounce = (key: string, fn: () => void, ms: number) => {
    window.clearTimeout(timers.current[key]);
    timers.current[key] = window.setTimeout(fn, ms);
  };

  const refreshActive = useCallback(() => waExt.active().then(setActive).catch(() => {}), []);
  const refreshPending = useCallback(
    () => waExt.chats({ onlyUnread: true, max: 50 }).then((c) => setPendingChats(c.sort((a, b) => b.t - a.t))).catch(() => {}),
    []
  );

  // Events from WhatsApp Web (through the extension).
  useEffect(() => {
    if (!version) return;
    return onExtensionEvent((event, d, embedded) => {
      if (event === "agent" && embedded) setFrameSeen(true);
      if (event === "state") {
        if (embedded) setFrameSeen(true);
        setSt(d);
        if (d?.authenticated) { refreshPending(); refreshActive(); }
      }
      if (event === "frameError" && embedded) {
        // WhatsApp refuses to run inside another site → use the separate window.
        setModeState("window");
        try { localStorage.setItem(MODE_KEY, "window"); } catch { /* ignore */ }
        waExt.openWindow().catch(() => {});
        setNote("WhatsApp ne portal ke andar chalne se inkar kar diya (\"Sorry, something went wrong\"). Isliye alag window mein khol diya — left panel yahin kaam karta rahega.");
      }
      if (event === "active") debounce("active", refreshActive, 300);
      if (event === "message") {
        debounce("pending", refreshPending, 1500);
        if (active && d?.chatId === active.id) debounce("active", refreshActive, 800);
      }
      if (event === "panel" && d?.action === "captureAll") setShowCapture(true);
      if (event === "panel" && d?.action === "saveActive") refreshActive().then(() => setNote("WhatsApp window se: neeche 'Lead save karein' dabayein."));
    });
  }, [version, active, refreshActive, refreshPending]);

  // Poll state (covers a worker restart / missed events).
  useEffect(() => {
    if (!version) return;
    let stop = false;
    const tick = () => waExt.state().then((s) => { if (!stop) setSt(s); }).catch(() => { if (!stop) setSt(null); });
    tick();
    const id = window.setInterval(tick, 10000);
    return () => { stop = true; window.clearInterval(id); };
  }, [version]);

  useEffect(() => {
    if (st?.authenticated) { refreshPending(); refreshActive(); }
  }, [st?.authenticated, refreshPending, refreshActive]);

  // Embedded WhatsApp that never reports back → suggest the window mode.
  useEffect(() => {
    setSlow(false);
    if (!version || mode !== "embed" || frameSeen) return;
    const id = window.setTimeout(() => setSlow(true), 25000);
    return () => window.clearTimeout(id);
  }, [version, mode, frameSeen, frameKey]);

  // "Chat" from a lead → open that number in WhatsApp Web once it is linked.
  const openedFor = useRef(0);
  useEffect(() => {
    if (!openPhone || openedFor.current === openPhone.n) return;
    if (openPhone.phone) setPhone(formatLocalPhone(openPhone.phone));
    if (!st?.authenticated) return;
    openedFor.current = openPhone.n;
    waExt.open(openPhone.chatId ? { chatId: openPhone.chatId } : { phone: openPhone.phone }).catch((e) => setNote(e.message));
  }, [openPhone, st?.authenticated]);

  const activeJid = active ? realJid(active.id) || realJid(active.messages.find((m) => m.remote)?.remote) : undefined;
  const lead = active ? findLeadForChat({ key: active.id, jid: activeJid, phone: active.phone || undefined, name: active.name }, data.leads) : undefined;
  const suggestion = active && active.messages.length ? classifyChat(active.messages.filter((m) => m.type !== "call_log").map((m) => ({ text: m.text, fromMe: m.fromMe }))) : null;

  const chatLines = active ? active.messages.filter((m) => m.type !== "call_log").map((m) => ({ text: m.text, fromMe: m.fromMe })) : [];
  // Live agent brief of the open chat (Urdu / Roman Urdu / English).
  const liveBrief = active && chatLines.length
    ? analyzeLead({ ...(lead || {}), name: lead?.name || active.name || active.pushname, status: lead?.status || "New", source: lead?.source || "WhatsApp", chat: chatLines.slice(-30), date: lead?.date || todayISO() }, data.settings).brief
    : null;
  // AI handoff: once an assistant took the lead, no AI drafts for this chat.
  const handedOff = !!lead?.aiHandoff;
  const draft = active && chatLines.length && !handedOff
    ? draftReply(chatLines, { settings: data.settings, name: lead?.name || active.name || active.pushname, kb: data.settings?.aiKnowledge, company: data.settings?.companyName })
    : null;

  const saveActive = async () => {
    if (!active) return;
    setBusy("lead");
    try {
      const plan = planCapture(
        { key: active.id, jid: activeJid, phone: active.phone || undefined, name: active.name || active.pushname },
        active.messages.filter((m) => m.type !== "call_log").map((m) => ({ text: m.text, fromMe: m.fromMe })),
        data.leads,
        { updateExisting: true, newId: () => uid("LD"), today: todayISO(), createdBy: user?.uid || "whatsapp-web" }
      );
      // Keep message ids / times so the auto-captured conversation is extended, never cut to 20 lines.
      const msgs = active.messages.filter((m) => m.type !== "call_log" && m.text).map((m) => ({ id: m.id, text: m.text, fromMe: m.fromMe, at: m.t || 0 }));
      if (plan.kind === "create") {
        const base = { ...plan.lead, chat: mergeChat([], msgs), waSaved: !!active.saved };
        const lead = applyAnalysis(base, analyzeLead(base, data.settings), { moveStatus: false, by: user?.email || "" });
        await addItem("leads", lead);
        setNote(`✓ Nayi lead bani: ${lead.name} (${lead.serviceType} • ${lead.status} • ${lead.ai.level} ${lead.ai.interest}%)`);
      } else {
        const merged = { ...plan.lead, ...(plan.kind === "update" ? plan.patch : {}), chat: mergeChat(Array.isArray(plan.lead.chat) ? plan.lead.chat : [], msgs), updatedAt: new Date().toISOString() };
        await updateItem("leads", applyAnalysis(merged, analyzeLead(merged, data.settings), { by: user?.email || "" }));
        setNote(plan.kind === "update" ? "✓ Lead update ho gayi (AI analysis ke sath)" : "✓ AI analysis update ho gaya");
      }
    } catch (e) { setNote("Save nahi hua: " + (e as Error).message); }
    setBusy("");
  };

  const patchLead = async (patch: Record<string, unknown>) => {
    if (!lead) return;
    try { await updateItem("leads", { ...lead, ...patch, updatedAt: new Date().toISOString() }); }
    catch (e) { setNote("Update nahi hua: " + (e as Error).message); }
  };

  const target = () => {
    const n = normalizePhone(phone);
    if (!n) throw new Error("Sahi number likhein, e.g. 03001234567");
    return n;
  };
  const fill = (text: string) => {
    const n = normalizePhone(phone);
    const who = n && active?.phone === n ? active.name
      : (n && data.leads.find((l: any) => normalizePhone(l.phone) === n || normalizePhone(l.whatsapp) === n)?.name) || "";
    const first = String(who || "").trim().split(/\s+/)[0] || "";
    return text.replace(/\{name\}/g, first).replace(/ +([!,?])/g, "$1").replace(/^, */, "").replace(/ {2,}/g, " ").trim().replace(/^./, (c) => c.toUpperCase());
  };

  const openChat = async () => {
    try { setBusy("open"); await waExt.open({ phone: target(), text: msg || undefined }); setNote("Chat khul gayi — message WhatsApp mein likha hai, check kar ke Send dabayein."); }
    catch (e) { setNote((e as Error).message); }
    setBusy("");
  };

  const send = async () => {
    try {
      const n = target();
      if (!msg.trim() && !file) throw new Error("Message ya file dein");
      setBusy("send");
      if (file) {
        if (file.size > 16 * 1024 * 1024) throw new Error("File 16 MB se bari hai");
        const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
        await waExt.sendFile({ phone: n, dataUrl, filename: file.name, caption: msg });
      } else {
        await waExt.sendText({ phone: n, text: msg });
      }
      logAudit({ action: "whatsapp.send", collection: "whatsapp", entityId: n, details: file ? `file ${file.name}` : "text" });
      setNote("✓ Bhej diya");
      setMsg(""); setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) { setNote((e as Error).message); }
    setBusy("");
  };

  if (!version) return <SetupCard />;

  const linked = !!st?.authenticated;
  const modeLabel = st?.mode === "wpp" ? "Fast mode" : st?.mode === "dom" ? "Screen mode" : "";
  const statusText = !st ? (mode === "window" ? "WhatsApp window kholein (neeche button)" : "WhatsApp Web khul raha hai…")
    : !st.ready ? (st.diag?.qr ? "QR scan karein" : "WhatsApp Web load ho raha hai…")
    : linked ? `Linked${st.me ? " • " + formatLocalPhone(st.me) : ""}${modeLabel ? " • " + modeLabel : ""}` : "QR scan karein";

  return (
    <div className="waWeb">
      <aside className="waWebSide">
        <div className="waWebBrand">
          <BrandMark size={26} />
          <div><b>WhatsApp Web</b><div className="small">Digital Target • v{version}</div></div>
          <span className={`badge ${linked ? "ok" : "warn"}`}>{linked ? "Linked" : "Not linked"}</span>
        </div>
        <div className="small waWebStatus">{statusText}</div>
        {st?.mode === "dom" && <div className="small waWebHint">Screen mode: WhatsApp window mein chats baari baari khol kar parhi jati hain. Pictures WhatsApp mein 📎 se bhejein.</div>}
        {st && !st.ready && st.diag && (
          <div className="small waWebHint">Check: library {st.diag.wpp ? (st.diag.wppReady ? "ready" : st.diag.injected ? "injected" : "loaded") : "missing"}{st.diag.errors.length ? ` • ${st.diag.errors[0]}` : ""}</div>
        )}
        {!linked && (
          <ol className="waWebSteps">
            <li>Phone par WhatsApp kholein</li>
            <li><b>Settings → Linked devices → Link a device</b></li>
            <li>Right side wala QR scan karein — session save rahega</li>
          </ol>
        )}

        {canLead && (
          <button className="btnSolid waWebCapture" disabled={!linked} onClick={() => setShowCapture(true)}>⚡ Capture all chats → leads</button>
        )}

        <div className="waWebCard">
          <div className="waWebCardHead">Current chat</div>
          {!active ? <div className="small">WhatsApp mein koi chat kholein.</div> : (
            <>
              <b>{active.name || active.pushname || "Unknown"}</b>
              <div className="small">{active.phone ? formatLocalPhone(active.phone) : "Number chhupa hua hai"}</div>
              {lead ? (
                <div className="waWebLead">
                  <div className="waWebRow">
                    <select value={lead.status} onChange={(e) => patchLead({ status: e.target.value })} aria-label="Lead status" disabled={!can("leads.edit")}>
                      {[...new Set([...LEAD_STATUSES, lead.status])].map((s) => <option key={s}>{s}</option>)}
                    </select>
                    <select value={lead.serviceType || ""} onChange={(e) => patchLead({ serviceType: e.target.value })} aria-label="Service" disabled={!can("leads.edit")}>
                      <option value="">— Service —</option>
                      {[...new Set([...lines, lead.serviceType].filter(Boolean))].map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="waWebRow">
                    <label className="small">Follow-up</label>
                    <input type="date" value={lead.followUpDate || ""} onChange={(e) => patchLead({ followUpDate: e.target.value })} disabled={!can("leads.edit")} />
                  </div>
                </div>
              ) : <div className="small">Abhi lead nahi hai.</div>}
              {liveBrief ? <LeadBriefCard brief={liveBrief} /> : suggestion && (
                <div className="aiSuggest small"><span>✨ Chat se andaza</span><div><b>{suggestion.line || "—"}</b> • <b>{suggestion.status}</b></div><div>{suggestion.reason}</div></div>
              )}
              {(canLead || can("leads.edit")) && (
                <button className="btnSmall" disabled={busy === "lead"} onClick={saveActive}>{lead ? "↻ Chat se lead update karein" : "＋ Lead save karein"}</button>
              )}
              {handedOff && <div className="aiSuggest small">👤 <b>{lead?.takenByName || lead?.assignedToName}</b> ye chat handle kar raha hai — AI reply band (handoff).</div>}
              {draft && (
                <div className="aiSuggest small">
                  <span>🤖 AI reply draft • {draft.source === "trained" ? "aap ka sikhaya hua" : draft.source === "catalog" ? "catalog se" : draft.source === "default" ? "aam jawab" : "—"}</span>
                  {draft.text ? <div className="aiDraftText">{draft.text}</div> : null}
                  <div>{draft.reason}</div>
                  {draft.text && canReply && (
                    <div className="waWebRow">
                      <button className="btnSmall" onClick={() => waExt.open({ chatId: active.id, text: draft.text }).then(() => setNote("Draft WhatsApp chat mein likh diya — check kar ke Send aap dabayein.")).catch((e) => setNote(e.message))}>WhatsApp mein likhein</button>
                      <button className="btnSmall" onClick={() => { if (active.phone) setPhone(formatLocalPhone(active.phone)); setMsg(draft.text); }}>Quick send mein</button>
                    </div>
                  )}
                  <button className="linkBtn" onClick={() => setShowTrain(true)}>📚 AI ko train karein</button>
                </div>
              )}
              {(active.phone || active.name) && (
                <button className="linkBtn small" title="Family / courier / personal — capture is ko kabhi nahi chhuega"
                  onClick={() => block.add({ name: active.name || active.pushname, phone: active.phone }).then(() => setNote("✓ Ye chat ab kabhi capture nahi hogi (personal list)"))}>
                  🚫 Kabhi capture na karein
                </button>
              )}
            </>
          )}
        </div>

        {canReply && (
          <div className="waWebCard">
            <div className="waWebCardHead">Quick send</div>
            <label>Customer number</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03001234567" inputMode="tel" />
            <label>Message</label>
            <select value="" onChange={(e) => { const t = TEMPLATES.find((x) => x.label === e.target.value); if (t) setMsg(fill(t.text)); }} aria-label="Template">
              <option value="">Template chunein (auto-fill)…</option>
              {TEMPLATES.map((t) => <option key={t.label}>{t.label}</option>)}
            </select>
            <textarea rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message likhein…" />
            <div className="waWebRow">
              <button className="btnSmall" onClick={() => fileRef.current?.click()}>📎 {file ? file.name.slice(0, 18) : "Picture / file"}</button>
              {file && <button className="btnSmall" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}>✕</button>}
              <input ref={fileRef} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>
            <div className="waWebRow">
              <button className="btnSmall" disabled={!linked || !!busy} onClick={openChat} title="Chat khol kar message WhatsApp mein likh deta hai">Chat kholein</button>
              <button className="btnSolid" disabled={!linked || !!busy} onClick={send}>{busy === "send" ? "Sending…" : "Send"}</button>
            </div>
            {active?.phone && <button className="linkBtn small" onClick={() => setPhone(formatLocalPhone(active.phone))}>Current chat ka number use karein</button>}
          </div>
        )}

        <div className="waWebCard">
          <div className="waWebCardHead">Pending ({pendingChats.length})</div>
          {pendingChats.length === 0 ? <div className="small">Koi unread chat nahi 🎉</div> : (
            <ul className="waWebPending">
              {pendingChats.slice(0, 15).map((c) => (
                <li key={c.id}>
                  <button onClick={() => waExt.open({ chatId: c.id }).catch((e) => setNote(e.message))}>
                    <b>{c.name || (c.phone ? formatLocalPhone(c.phone) : "Unknown")}</b>
                    <span className="badge warn">{c.unread}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {note && <div className="small waWebNote" onClick={() => setNote("")}>{note}</div>}
      </aside>

      <section className="waWebMain">
        <div className="waWebToolbar">
          <div className="segmented">
            <button className={mode === "window" ? "on" : ""} onClick={() => setMode("window")}>Alag window (behtar)</button>
            <button className={mode === "embed" ? "on" : ""} onClick={() => setMode("embed")}>Portal ke andar (beta)</button>
          </div>
          {mode === "embed" && <button className="btnSmall" onClick={() => { setFrameSeen(false); setFrameKey((k) => k + 1); }}>↻ Reload</button>}
        </div>
        {mode === "embed" && <div className="waWebWarn">WhatsApp aksar dusri site ke andar chalne se rok deta hai. Agar "Sorry, something went wrong" aaye to khud alag window mein chala jayega — ya "Alag window" dabayein.</div>}
        {mode === "embed" ? (
          <div className="waWebFrameWrap">
            <iframe
              key={frameKey}
              className="waWebFrame"
              src={WA_URL}
              title="WhatsApp Web"
              allow="clipboard-read; clipboard-write; microphone; camera; autoplay; notifications; fullscreen"
            />
            {slow && (
              <div className="waWebSlow">
                WhatsApp Web portal ke andar load nahi hua?
                <button className="btnSolid" onClick={() => setMode("window")}>Alag window mein kholein</button>
              </div>
            )}
          </div>
        ) : (
          <div className="waWebWindowCard">
            <BrandMark size={44} />
            <h3>WhatsApp Web alag window mein khula hai</h3>
            <p className="small">Left panel yahin kaam karta rahega — lead save, capture, quick send aur pending sab.</p>
            <button className="btnSolid" onClick={() => waExt.openWindow().catch((e) => setNote(e.message))}>WhatsApp window dikhayein</button>
          </div>
        )}
      </section>

      {showTrain && <AiTrainingModal lines={chatLines} onClose={() => setShowTrain(false)} />}
      {showCapture && <CaptureModal source={{ kind: "extension" }} onClose={() => setShowCapture(false)} />}
    </div>
  );
}

function SetupCard() {
  const browser = /Edg\//.test(navigator.userAgent) ? "edge" : "chrome";
  return (
    <div className="waSetup">
      <div className="waSetupHead">
        <BrandMark size={40} />
        <div>
          <h3>WhatsApp Web ko portal mein chalayein</h3>
          <div className="small">Ek dafa ka setup (2 minute). Koi server nahi — sirf ek chhota browser extension.</div>
        </div>
      </div>
      <ol className="waSetupSteps">
        <li><a className="btnSolid" href={EXTENSION_ZIP} download>⬇ Extension download karein</a> aur ZIP ko <b>extract</b> karein (Right click → Extract All).</li>
        <li>Chrome / Edge mein address bar par likhein <code>{browser}://extensions</code> aur Enter dabayein.</li>
        <li>Upar right par <b>Developer mode</b> ON karein.</li>
        <li><b>Load unpacked</b> dabayein aur extract kiya hua <b>dt-whatsapp-extension</b> folder chunein.</li>
        <li>Ye page <b>reload</b> karein. WhatsApp Web yahin khulega — phone se QR scan karein (Settings → Linked devices → Link a device).</li>
      </ol>
      <div className="small">
        Har team member jo WhatsApp dekhega apne computer par ye extension ek dafa install kare. Calls phone par hi aati hain.
        {" "}Bina extension ke: <a href={WA_URL} target="_blank" rel="noreferrer">WhatsApp Web alag tab mein</a>.
      </div>
    </div>
  );
}
