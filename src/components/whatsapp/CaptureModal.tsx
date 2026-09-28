import React, { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { uid, todayISO } from "@/lib/db";
import { ChatLine } from "@/lib/chatClassifier";
import { CaptureChat, LeadLike, findLeadForChat, planCapture } from "@/lib/leadCapture";
import { analyzeLead, applyAnalysis, levelClass } from "@/lib/leadAnalysis";
import { withHistory } from "@/lib/leadHistory";
import { Assessment, CaptureFilter, ChatMeta, DEFAULT_FILTER, Level, assessChat, isBlocked, labelNames } from "@/lib/captureFilter";
import { categoriesOf } from "@/lib/catalog";
import { formatLocalPhone } from "@/lib/phone";
import { useCaptureBlocklist } from "@/lib/useCaptureBlocklist";
import { isSkippedJid, phoneFromJid, realJid, waExt } from "@/lib/waExtension";
import { conversationName, updateConversation, WaConversation } from "./useWhatsApp";

/** Where chats are read from: WhatsApp Web through the browser extension, or the server's copy. */
export type CaptureSource = { kind: "extension" } | { kind: "service"; ws: string };

type Action = "new" | "update" | "link" | "skip";
interface Item {
  chat: CaptureChat;
  meta: ChatMeta;
  lines: ChatLine[] | null; // null = not read (group, or excluded by metadata before reading)
  a: Assessment;
  match?: LeadLike;
  action: Action;
  linkId: string;
  picked: boolean;
  forced?: boolean; // owner overrode an exclusion
}
interface Result { name: string; phone: string; action: string; note: string; ok: boolean }

const FILTER_KEY = "dt.captureFilter";
const loadFilter = (): CaptureFilter => {
  try { return { ...DEFAULT_FILTER, ...JSON.parse(localStorage.getItem(FILTER_KEY) || "{}") }; } catch { return DEFAULT_FILTER; }
};

type Loaded = { chat: CaptureChat; meta: ChatMeta; lines: () => Promise<ChatLine[] | null> };

/**
 * Capture leads from WhatsApp in four steps: choose filters → scan (nothing
 * is saved) → review each chat (new lead / update / link to a lead / skip) →
 * save. Personal chats are never touched: groups, couriers, OTP / bank
 * messages, saved contacts (if you choose), chosen labels and your "never
 * capture" list are skipped before or after reading.
 */
export default function CaptureModal({ source, onClose }: { source: CaptureSource; onClose: () => void }) {
  const { data, addItem, updateItem } = useData();
  const { user } = useAuth();
  const block = useCaptureBlocklist();
  const [f, setF] = useState<CaptureFilter>(loadFilter);
  const [step, setStep] = useState<"filters" | "scan" | "review" | "save" | "done">("filters");
  const [items, setItems] = useState<Item[]>([]);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");
  const [showExcluded, setShowExcluded] = useState(false);
  const cache = useRef(new Map<string, ChatLine[] | null>());
  const ext = source.kind === "extension";
  const busy = step === "scan" || step === "save";
  const categories = categoriesOf(data.settings);
  const set = (p: Partial<CaptureFilter>) => setF((x) => ({ ...x, ...p }));
  useEffect(() => { try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch { /* ignore */ } }, [f]);

  const loadChats = async (): Promise<Loaded[]> => {
    if (source.kind === "extension") {
      const chats = await waExt.chats({ sinceDays: f.sinceDays || undefined });
      return chats.map((c) => {
        const chat: CaptureChat = { key: c.id, jid: realJid(c.id), phone: c.phone || undefined, name: c.name || c.pushname || (c.phone ? formatLocalPhone(c.phone) : "") };
        const meta: ChatMeta = { name: chat.name, phone: c.phone || undefined, saved: c.saved, archived: c.archived, isBusiness: c.isBusiness, labels: c.labels || [] };
        return {
          chat, meta,
          lines: async () => {
            const msgs = await waExt.messages(c.id, 40);
            // Screen mode: the number / WhatsApp id comes from the messages.
            const remote = msgs.find((m) => m.remote)?.remote;
            if (isSkippedJid(remote)) return null;
            if (!chat.jid && realJid(remote)) chat.jid = remote;
            if (!chat.phone) chat.phone = phoneFromJid(remote) || undefined;
            if (!chat.name && chat.phone) chat.name = formatLocalPhone(chat.phone);
            meta.name = chat.name; meta.phone = chat.phone;
            if (msgs.some((m) => m.ad)) meta.ad = true;
            return msgs.filter((m) => m.type !== "call_log").map((m) => ({ text: m.text, fromMe: m.fromMe }));
          },
        };
      });
    }
    const ws = source.ws;
    const snap = await getDocs(query(collection(db, "users", ws, "waConversations"), orderBy("lastMessageAt", "desc"), limit(2000)));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as WaConversation)
      .filter((c) => c.chatType === "user")
      .map((c) => {
        const chat: CaptureChat = { key: c.id, jid: c.jid, phone: c.phone || undefined, name: conversationName(c), firstAt: c.firstInboundAt || undefined, conversationId: c.id, assignedTo: c.assignedTo || "", leadId: c.leadId || undefined };
        return {
          chat, meta: { name: chat.name, phone: c.phone || undefined, saved: false, labels: [] } as ChatMeta,
          lines: async () => {
            const msgs = await getDocs(query(collection(db, "users", ws, "waConversations", c.id, "messages"), orderBy("timestamp", "desc"), limit(40)));
            return msgs.docs.map((d) => d.data()).reverse().filter((m: any) => m.kind !== "call").map((m: any) => ({ text: String(m.text || ""), fromMe: !!m.fromMe }));
          },
        };
      });
  };

  // ---------------------------------------------------------------- scan
  const scan = async () => {
    setStep("scan"); setItems([]); setDone(0); setError(""); setResults([]);
    let list: Loaded[];
    try { list = await loadChats(); } catch (e) { setError((e as Error).message); setStep("filters"); return; }
    setTotal(list.length);
    const out: Item[] = [];
    const leads = data.leads as LeadLike[];
    for (const { chat, meta, lines } of list) {
      let ls: ChatLine[] | null = null;
      // Metadata-only exclusions first: those chats are never opened or read.
      const pre = assessChat(meta, [], data.settings, { ...f, excludeNoBusiness: false, excludeServiceWords: false, group: "", source: "all", levels: { Hot: true, Warm: true, Cold: true } }, block.list);
      if (pre.excluded && !/Service samajh|Koi business/.test(pre.excluded)) {
        out.push({ chat, meta, lines: null, a: pre, action: "skip", linkId: "", picked: false });
        setDone((n) => n + 1);
        continue;
      }
      try {
        if (cache.current.has(chat.key)) ls = cache.current.get(chat.key)!;
        else { ls = await lines(); cache.current.set(chat.key, ls); }
      } catch { ls = null; }
      if (!ls) { setDone((n) => n + 1); continue; } // group / channel
      const a = assessChat(meta, ls, data.settings, f, block.list);
      const match = findLeadForChat(chat, leads);
      out.push({
        chat, meta, lines: ls, a, match,
        action: a.excluded ? "skip" : match ? (f.updateExisting ? "update" : "skip") : "new",
        linkId: "", picked: !a.excluded,
      });
      setDone((n) => n + 1);
      setItems([...out]);
    }
    setItems(out);
    setStep("review");
  };

  const candidates = useMemo(() => items.filter((i) => !i.a.excluded || i.forced), [items]);
  const excluded = useMemo(() => items.filter((i) => i.a.excluded && !i.forced), [items]);
  const picked = candidates.filter((i) => i.picked && i.action !== "skip");
  const patch = (key: string, p: Partial<Item>) => setItems((xs) => xs.map((i) => (i.chat.key === key ? { ...i, ...p } : i)));
  const setLevel = (levels: Level[]) => setItems((xs) => xs.map((i) => (i.a.excluded && !i.forced ? i : { ...i, picked: levels.includes(i.a.level) && i.action !== "skip" })));

  const neverCapture = async (i: Item) => {
    await block.add({ name: i.meta.name, phone: i.meta.phone });
    patch(i.chat.key, { picked: false, action: "skip", a: { ...i.a, excluded: "Aap ki 'kabhi capture na karein' list mein hai" }, forced: false });
  };

  // ---------------------------------------------------------------- save
  const save = async () => {
    setStep("save"); setDone(0); setTotal(picked.length);
    const out: Result[] = [];
    const leads = [...(data.leads as LeadLike[])];
    const by = user?.email || "chat-capture";
    for (const i of picked) {
      const phone = i.chat.phone ? formatLocalPhone(i.chat.phone) : "";
      const ls = i.lines || [];
      try {
        const extra = { waLabels: i.meta.labels || [], adsLead: i.a.kind === "ads" };
        if (i.action === "new") {
          const plan = planCapture(i.chat, ls, [], { updateExisting: false, newId: () => uid("LD"), today: todayISO(), createdBy: by });
          if (plan.kind !== "create") throw new Error("Lead nahi ban saki");
          let lead: LeadLike = { ...plan.lead, ...extra, source: i.a.kind === "ads" ? "Facebook" : "WhatsApp" };
          if (i.a.group) lead.category = i.a.group;
          lead = applyAnalysis(lead, analyzeLead(lead, data.settings), { moveStatus: false, by });
          await addItem("leads", lead);
          leads.push(lead);
          if (i.chat.conversationId && source.kind === "service") await updateConversation(source.ws, i.chat.conversationId, { leadId: lead.id });
          out.push({ name: i.chat.name, phone, action: "Nayi lead", note: `${lead.serviceType} • ${lead.status} • ${i.a.level}`, ok: true });
        } else {
          const target = i.action === "link" ? leads.find((l) => l.id === i.linkId) : i.match;
          if (!target) throw new Error("Lead chuni nahi gayi");
          const plan = planCapture(i.chat, ls, [target], { updateExisting: f.updateExisting, newId: () => uid("LD"), today: todayISO(), createdBy: by });
          const p = plan.kind === "update" ? plan.patch : {};
          // Linking to a lead with a different number: attach this chat's number / id.
          const linkPatch: Record<string, unknown> = {};
          if (i.action === "link") {
            if (i.chat.jid && !target.waJid) linkPatch.waJid = i.chat.jid;
            if (i.chat.phone && !target.whatsapp) { linkPatch.whatsapp = formatLocalPhone(i.chat.phone); linkPatch.phoneE164 = i.chat.phone; }
          }
          let merged: LeadLike = { ...target, ...p, ...linkPatch, ...extra, chat: ls.slice(-20), updatedAt: new Date().toISOString() };
          if (i.action === "link") merged = withHistory(merged, { type: "captured", text: `WhatsApp chat (${i.chat.name}) is lead se jori gayi`, by });
          merged = applyAnalysis(merged, analyzeLead(merged, data.settings), { moveStatus: f.updateExisting, by });
          await updateItem("leads", merged);
          leads[leads.findIndex((l) => l.id === target.id)] = merged;
          if (i.chat.conversationId && source.kind === "service") await updateConversation(source.ws, i.chat.conversationId, { leadId: target.id });
          out.push({ name: i.chat.name, phone, action: i.action === "link" ? "Lead se jori" : "Update", note: `${target.name} • ${merged.status}`, ok: true });
        }
      } catch (e) {
        out.push({ name: i.chat.name, phone, action: "Error", note: (e as Error).message, ok: false });
      }
      setDone((n) => n + 1);
    }
    setResults(out);
    setStep("done");
  };

  const allLabels = useMemo(() => labelNames(items.map((i) => i.meta)), [items]);
  const toggleList = (key: "excludeLabels" | "onlyLabels", label: string) =>
    set({ [key]: f[key].includes(label) ? f[key].filter((x) => x !== label) : [...f[key], label] } as Partial<CaptureFilter>);

  const counts = {
    ads: candidates.filter((i) => i.a.kind === "ads").length,
    hot: candidates.filter((i) => i.a.level === "Hot").length,
    warm: candidates.filter((i) => i.a.level === "Warm").length,
    cold: candidates.filter((i) => i.a.level === "Cold").length,
  };

  return (
    <div className="dtModalBackdrop" onClick={() => !busy && onClose()}>
      <div className="dtModal wide capModal" onClick={(e) => e.stopPropagation()}>
        <div className="dtModalHead">
          <div>
            <b style={{ fontSize: 17 }}>Capture leads from WhatsApp</b>
            <div className="small">Pehle filter chunein → scan (kuch save nahi hota) → aap review karein → phir save. Personal chats ko haath nahi lagta.</div>
          </div>
          <button className="btnSmall" onClick={onClose} disabled={busy}>✕</button>
        </div>

        {step === "filters" && (
          <>
            <div className="capGrid">
              <div className="capBox">
                <b>1. Kaun si leads chahiye?</b>
                <label>Lead ka source
                  <select value={f.source} onChange={(e) => set({ source: e.target.value as CaptureFilter["source"] })}>
                    <option value="all">Sab (Ads + organic)</option>
                    <option value="ads">Sirf Facebook / Instagram Ads se aayi</option>
                    <option value="organic">Sirf organic / referral</option>
                  </select>
                </label>
                <label>Service category
                  <select value={f.group} onChange={(e) => set({ group: e.target.value })}>
                    <option value="">Sab categories</option>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <div className="small" style={{ marginTop: 8 }}>Interest level (chat + WhatsApp label se)</div>
                <div className="capLevels">
                  {(["Hot", "Warm", "Cold"] as Level[]).map((l) => (
                    <label key={l} className="permItem">
                      <input type="checkbox" checked={f.levels[l]} onChange={(e) => set({ levels: { ...f.levels, [l]: e.target.checked } })} />
                      <span>{l === "Hot" ? "High (Hot)" : l === "Warm" ? "Medium (Warm)" : "Low (Cold)"}</span>
                    </label>
                  ))}
                </div>
                {ext && (
                  <label>Kitni purani chats
                    <select value={f.sinceDays} onChange={(e) => set({ sinceDays: Number(e.target.value) })}>
                      <option value={7}>Pichle 7 din</option><option value={30}>Pichle 30 din</option>
                      <option value={90}>Pichle 90 din</option><option value={365}>Pichla 1 saal</option><option value={0}>Sab chats</option>
                    </select>
                  </label>
                )}
              </div>

              <div className="capBox">
                <b>2. Kya exclude karna hai? (personal data na aaye)</b>
                <label className="permItem"><input type="checkbox" checked disabled /><span>Groups aur channels — hamesha exclude</span></label>
                <label className="permItem"><input type="checkbox" checked={f.excludeServiceWords} onChange={(e) => set({ excludeServiceWords: e.target.checked })} /><span>Courier, OTP, bank, bill, delivery wale messages</span></label>
                <label className="permItem"><input type="checkbox" checked={f.excludeNoBusiness} onChange={(e) => set({ excludeNoBusiness: e.target.checked })} /><span>Jin chats mein koi business / service baat nahi (personal)</span></label>
                <label className="permItem"><input type="checkbox" checked={f.excludeSaved} onChange={(e) => set({ excludeSaved: e.target.checked })} /><span>Phone mein saved contacts (family / dost) — inhe khola hi nahi jata</span></label>
                <label className="permItem"><input type="checkbox" checked={f.excludeBusinessAccounts} onChange={(e) => set({ excludeBusinessAccounts: e.target.checked })} /><span>WhatsApp Business accounts (company / courier)</span></label>
                <label className="permItem"><input type="checkbox" checked={f.excludeArchived} onChange={(e) => set({ excludeArchived: e.target.checked })} /><span>Archived chats</span></label>
                <div className="small" style={{ marginTop: 8 }}>
                  "Kabhi capture na karein" list: <b>{block.list.length}</b> number/naam
                  {block.list.length > 0 && (
                    <details><summary className="small">dekhein / hatayein</summary>
                      {block.list.map((b) => (
                        <div key={b.key} className="small">{b.name || b.phone} {b.phone && b.name ? `(${b.phone})` : ""} <button className="linkBtn" onClick={() => block.remove(b.key)}>hatayein</button></div>
                      ))}
                    </details>
                  )}
                </div>
              </div>
            </div>

            {ext && (
              <div className="capBox" style={{ marginTop: 10 }}>
                <b>3. WhatsApp Labels (sirf WhatsApp Business mein)</b>
                <div className="small">Labels scan ke baad nazar aate hain. "Hot / High / Interested" jaisa label lagane se lead ka interest level wohi ho jata hai. Labels ke naam neeche likh kar filter karein (comma se alag):</div>
                <div className="capGrid">
                  <label>Sirf in labels wali chats<input value={f.onlyLabels.join(", ")} onChange={(e) => set({ onlyLabels: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="e.g. Client, Hot lead" /></label>
                  <label>In labels wali chats exclude<input value={f.excludeLabels.join(", ")} onChange={(e) => set({ excludeLabels: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="e.g. Family, Courier" /></label>
                </div>
              </div>
            )}

            <label className="permItem" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={f.updateExisting} onChange={(e) => set({ updateExisting: e.target.checked })} />
              <span>Purani leads ka status bhi chat ke mutabiq aage barhayein</span>
            </label>
            {ext && <div className="small" style={{ marginTop: 6 }}>Screen mode mein har chat baari baari khulti hai (chat "read" ho jati hai) — sirf woh chats khulti hain jo exclude nahi hui.</div>}
            {error && <div className="waErrText small" style={{ marginTop: 8 }}>{error}</div>}
            <button className="btnSolid" style={{ marginTop: 12 }} onClick={scan}>🔍 Scan karein (abhi kuch save nahi hoga)</button>
          </>
        )}

        {(step === "scan" || step === "save") && (
          <>
            <div className="captureBar"><div style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} /></div>
            <div className="small" style={{ margin: "6px 0 10px" }}>
              {step === "scan" ? (total ? `Chats parhi ja rahi hain… ${done} / ${total}` : "WhatsApp se chats li ja rahi hain…") : `Save ho rahi hain… ${done} / ${total}`}
            </div>
          </>
        )}

        {step === "review" && (
          <>
            <div className="capSummary">
              <span className="badge pri">{candidates.length} leads mili</span>
              <span className="badge bad">{counts.hot} High</span>
              <span className="badge warn">{counts.warm} Medium</span>
              <span className="badge">{counts.cold} Low</span>
              <span className="badge ok">{counts.ads} Ads</span>
              <button className="linkBtn" onClick={() => setShowExcluded((v) => !v)}>{excluded.length} chats exclude hui {showExcluded ? "▲" : "▼"}</button>
            </div>
            <div className="rowActions" style={{ margin: "8px 0" }}>
              <button className="btnSmall" onClick={() => setLevel(["Hot", "Warm", "Cold"])}>Sab select</button>
              <button className="btnSmall" onClick={() => setLevel([])}>Clear</button>
              <button className="btnSmall" onClick={() => setLevel(["Hot"])}>Sirf High</button>
              <button className="btnSmall" onClick={() => setLevel(["Hot", "Warm"])}>High + Medium</button>
              <button className="btnSmall" onClick={() => setStep("filters")}>← Filters badlein</button>
            </div>

            <div className="tablewrap" style={{ maxHeight: "46vh" }}>
              <table>
                <thead><tr><th></th><th>Contact</th><th>Type</th><th>Service</th><th>Interest</th><th>Status</th><th>Kya karein</th><th></th></tr></thead>
                <tbody>
                  {candidates.map((i) => (
                    <tr key={i.chat.key} className={i.action === "skip" ? "capSkip" : ""}>
                      <td><input type="checkbox" checked={i.picked && i.action !== "skip"} disabled={i.action === "skip"} onChange={(e) => patch(i.chat.key, { picked: e.target.checked })} aria-label="Select" /></td>
                      <td><b>{i.chat.name || "Unknown"}</b><div className="small">{i.chat.phone ? formatLocalPhone(i.chat.phone) : "Number chhupa hua"}</div>
                        {(i.meta.labels || []).map((l) => <span key={l} className="badge" style={{ marginRight: 4 }}>{l}</span>)}
                        {i.forced && <div className="small">⚠ aap ne shamil kiya</div>}
                      </td>
                      <td><span className={`badge ${i.a.kind === "ads" ? "ok" : ""}`}>{i.a.kind === "ads" ? "Ads lead" : "Organic"}</span><div className="small">{i.meta.saved ? "Saved contact" : "Unsaved number"}</div></td>
                      <td>{i.a.line || "—"}<div className="small">{i.a.group}</div></td>
                      <td><span className={`badge ${levelClass(i.a.level)}`}>{i.a.level === "Hot" ? "High" : i.a.level === "Warm" ? "Medium" : "Low"}</span><div className="small">{i.a.levelBy === "label" ? "label se" : `${i.a.interest}% (andaza)`}</div></td>
                      <td><span className="badge warn">{i.a.status}</span></td>
                      <td>
                        {i.match ? (
                          <select value={i.action} onChange={(e) => patch(i.chat.key, { action: e.target.value as Action, picked: e.target.value !== "skip" })}>
                            <option value="update">Lead "{i.match.name}" update</option>
                            <option value="skip">Chhor dein</option>
                          </select>
                        ) : (
                          <>
                            <select value={i.action} onChange={(e) => patch(i.chat.key, { action: e.target.value as Action, picked: e.target.value !== "skip" })}>
                              <option value="new">Nayi lead banayein</option>
                              <option value="link">Purani lead se jorein…</option>
                              <option value="skip">Chhor dein</option>
                            </select>
                            {i.action === "link" && (
                              <select value={i.linkId} onChange={(e) => patch(i.chat.key, { linkId: e.target.value })} style={{ marginTop: 4 }}>
                                <option value="">— Lead chunein —</option>
                                {data.leads.map((l: any) => <option key={l.id} value={l.id}>{l.name} {l.phone ? `• ${l.phone}` : ""}</option>)}
                              </select>
                            )}
                          </>
                        )}
                      </td>
                      <td><button className="btnSmall" title="Is number ko kabhi capture na karein" onClick={() => neverCapture(i)}>🚫</button></td>
                    </tr>
                  ))}
                  {candidates.length === 0 && <tr><td colSpan={8} className="small">Filters ke mutabiq koi lead nahi mili. "Filters badlein" dabayein.</td></tr>}
                </tbody>
              </table>
            </div>

            {showExcluded && (
              <div className="tablewrap" style={{ maxHeight: "26vh", marginTop: 8 }}>
                <table>
                  <thead><tr><th>Exclude hui chat</th><th>Wajah</th><th></th></tr></thead>
                  <tbody>
                    {excluded.map((i) => (
                      <tr key={i.chat.key}>
                        <td><b>{i.chat.name || "Unknown"}</b><div className="small">{i.chat.phone ? formatLocalPhone(i.chat.phone) : ""}</div></td>
                        <td className="small">{i.a.excluded}</td>
                        <td>{!isBlocked(i.meta, block.list) && <button className="btnSmall" onClick={() => patch(i.chat.key, { forced: true, picked: true, action: i.match ? "update" : "new" })}>Phir bhi shamil karein</button>}</td>
                      </tr>
                    ))}
                    {excluded.length === 0 && <tr><td colSpan={3} className="small">Kuch exclude nahi hua.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            {allLabels.length > 0 && <div className="small" style={{ marginTop: 6 }}>WhatsApp labels mile: {allLabels.join(", ")}</div>}
            <button className="btnSolid" style={{ marginTop: 12 }} disabled={picked.length === 0 || picked.some((i) => i.action === "link" && !i.linkId)} onClick={save}>
              ✓ {picked.length} leads save karein
            </button>
            {picked.some((i) => i.action === "link" && !i.linkId) && <span className="small" style={{ marginLeft: 8 }}>"Lead se jorein" wali rows mein lead chunein.</span>}
          </>
        )}

        {step === "done" && (
          <>
            <div className="capSummary">
              <span className="badge ok">{results.filter((r) => r.ok).length} save</span>
              {results.some((r) => !r.ok) && <span className="badge bad">{results.filter((r) => !r.ok).length} errors</span>}
            </div>
            <div className="tablewrap" style={{ maxHeight: "46vh", marginTop: 8 }}>
              <table>
                <thead><tr><th>Contact</th><th>Result</th><th>Detail</th></tr></thead>
                <tbody>{results.map((r, k) => <tr key={k}><td><b>{r.name}</b><div className="small">{r.phone}</div></td><td><span className={`badge ${r.ok ? "pri" : "bad"}`}>{r.action}</span></td><td className="small">{r.note}</td></tr>)}</tbody>
              </table>
            </div>
            <button className="btnSolid" style={{ marginTop: 12 }} onClick={onClose}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}
