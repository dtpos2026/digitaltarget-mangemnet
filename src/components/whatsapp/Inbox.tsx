import React, { useEffect, useMemo, useRef, useState } from "react";
import { getDownloadURL, ref } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { todayISO, uid } from "@/lib/db";
import { formatLocalPhone, waLink } from "@/lib/phone";
import { LEAD_STATUSES } from "@/lib/leads";
import {
  conversationName,
  durationLabel,
  formatPhone,
  queueMessage,
  timeLabel,
  updateConversation,
  useConversations,
  useMessages,
  useOutbox,
  WaAccount,
  WaConversation,
  WaMessage,
} from "./useWhatsApp";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "mine", label: "Assigned to me" },
  { id: "unassigned", label: "Unassigned" },
  { id: "new", label: "New leads" },
  { id: "followup", label: "Follow-up" },
] as const;

const urlCache = new Map<string, string>();

function MediaView({ m }: { m: WaMessage }) {
  const [url, setUrl] = useState(m.media?.path ? urlCache.get(m.media.path) || "" : "");
  useEffect(() => {
    const path = m.media?.path;
    if (!path || urlCache.has(path)) return;
    getDownloadURL(ref(storage, path))
      .then((u) => { urlCache.set(path, u); setUrl(u); })
      .catch(() => setUrl(""));
  }, [m.media?.path]);
  if (!m.media) return null;
  if (!url) {
    return <div className="waMediaStub">{m.media.kind === "document" ? "📄" : m.media.kind === "audio" ? "🎤" : "🖼"} {m.media.fileName || m.media.kind}{m.media.skipped ? ` (${m.media.skipped})` : ""}</div>;
  }
  switch (m.media.kind) {
    case "image":
    case "sticker":
      return <a href={url} target="_blank" rel="noreferrer"><img className="waMediaImg" src={url} alt={m.text || "image"} loading="lazy" /></a>;
    case "video":
      return <video className="waMediaImg" src={url} controls preload="metadata" />;
    case "audio":
      return <audio src={url} controls preload="none" />;
    default:
      return <a className="btnSmall" href={url} target="_blank" rel="noreferrer">📄 {m.media.fileName || "Document"}</a>;
  }
}

const TICKS: Record<string, string> = { pending: "🕓", sent: "✓", delivered: "✓✓", read: "✓✓", failed: "⚠" };

export default function Inbox({ ws, account, focusConversationId }: { ws: string; account: WaAccount | undefined; focusConversationId?: string | null }) {
  const { can, user, roleDoc } = useAuth();
  const { data, addItem, updateItem, logAudit } = useData();
  const [max, setMax] = useState(100);
  const { rows: convs, loading } = useConversations(ws, max);
  const [selectedId, setSelectedId] = useState<string | null>(focusConversationId || null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [search, setSearch] = useState("");
  const [msgMax, setMsgMax] = useState(60);
  const messages = useMessages(ws, selectedId, msgMax);
  const outbox = useOutbox(ws, selectedId);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastSeen = useRef<Map<string, number>>(new Map());

  const canReply = can("whatsapp.reply");
  const myTeamId = roleDoc?.teamId || "";
  const leadsById = useMemo(() => new Map(data.leads.map((l: any) => [l.id, l])), [data.leads]);
  const teamById = useMemo(() => new Map(data.team.map((t: any) => [t.id, t])), [data.team]);
  const today = todayISO();

  useEffect(() => { if (focusConversationId) setSelectedId(focusConversationId); }, [focusConversationId]);
  useEffect(() => { setMsgMax(60); setText(""); }, [selectedId]);

  const selected = convs.find((c) => c.id === selectedId) || null;
  const lead = selected?.leadId ? leadsById.get(selected.leadId) : null;

  // Mark as read when opened.
  useEffect(() => {
    if (selected && canReply && (selected.unreadCount || 0) > 0) {
      updateConversation(ws, selected.id, { unreadCount: 0 }).catch(() => undefined);
    }
  }, [selected?.id, selected?.unreadCount, canReply, ws]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [messages.length, outbox.length, selectedId]);

  // Browser notification for new customer messages while the tab is in the background.
  useEffect(() => {
    for (const c of convs) {
      const prev = lastSeen.current.get(c.id);
      const ts = c.lastMessageAt || 0;
      if (prev !== undefined && ts > prev && !c.lastMessageFromMe && document.hidden
        && typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(`WhatsApp: ${conversationName(c)}`, { body: (c.lastMessageText || "").slice(0, 120), tag: `wa-${c.id}` });
      }
      lastSeen.current.set(c.id, ts);
    }
  }, [convs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return convs.filter((c) => {
      if (c.archived && filter !== "all") return false;
      const l = c.leadId ? leadsById.get(c.leadId) : null;
      if (filter === "unread" && !(c.unreadCount || 0)) return false;
      if (filter === "mine" && (!myTeamId || c.assignedTo !== myTeamId)) return false;
      if (filter === "unassigned" && c.assignedTo) return false;
      if (filter === "new" && (!l || l.status !== "New")) return false;
      if (filter === "followup") {
        const due = (l?.followUpDate && l.followUpDate <= today) || (c.followUpDate && c.followUpDate <= today);
        if (!(l?.status === "Follow-up" || due)) return false;
      }
      if (!q) return true;
      return [conversationName(c), c.phone, c.lastMessageText, l?.name].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [convs, filter, search, leadsById, myTeamId, today]);

  const unreadTotal = convs.reduce((s, c) => s + (c.unreadCount || 0), 0);

  const send = async () => {
    const body = text.trim();
    if (!body || !selected || !account) return;
    if (account.status !== "connected") { alert("WhatsApp connected nahi hai. Pehle connect karein."); return; }
    setSending(true);
    try {
      await queueMessage(ws, selected.accountId || account.id, selected.id, body, { uid: user!.uid, email: user!.email });
      setText("");
      if (lead && can("leads.edit") && ["New", ""].includes(lead.status || "")) {
        await updateItem("leads", { ...lead, status: "Contacted", lastContactAt: new Date().toISOString() });
      }
    } catch (e) {
      alert("Message queue nahi hua: " + ((e as Error).message || e));
    }
    setSending(false);
  };

  const retry = async (body: string) => {
    if (!selected || !account) return;
    await queueMessage(ws, selected.accountId || account.id, selected.id, body, { uid: user!.uid, email: user!.email });
  };

  const createLead = async () => {
    if (!selected) return;
    const phone = selected.phone ? formatLocalPhone(selected.phone) : "";
    const id = uid("LD");
    await addItem("leads", {
      id, name: conversationName(selected), phone, whatsapp: phone, phoneE164: selected.phone || "",
      category: "Other", serviceType: "", software: "", plan: "Undecided", status: "New", source: "WhatsApp",
      referralBy: "", meetingDate: "", followUpDate: "", notes: selected.lastMessageText ? `WhatsApp: ${selected.lastMessageText}` : "",
      date: todayISO(), createdAt: new Date().toISOString(), conversationId: selected.id, waJid: selected.jid,
      assignedTo: selected.assignedTo || "",
    });
    await updateConversation(ws, selected.id, { leadId: id });
  };

  const assign = async (teamId: string) => {
    if (!selected) return;
    await updateConversation(ws, selected.id, { assignedTo: teamId, updatedBy: user?.uid });
    logAudit({ action: "whatsapp.assign", collection: "waConversations", entityId: selected.id, entityLabel: conversationName(selected), details: `assigned to ${teamById.get(teamId)?.name || teamId || "nobody"}` });
    if (lead && can(["leads.edit", "leads.assign"])) {
      await updateItem("leads", { ...lead, assignedTo: teamId, assignedToName: teamById.get(teamId)?.name || "", assignedAt: new Date().toISOString() });
    }
  };

  const setLeadField = async (patch: Record<string, unknown>) => {
    if (!lead) return;
    await updateItem("leads", { ...lead, ...patch, updatedAt: new Date().toISOString() });
  };

  const openList = !selected;

  return (
    <div className={`waInbox ${openList ? "showList" : "showChat"}`}>
      {/* ---------- conversation list ---------- */}
      <aside className="waList">
        <div className="waListHead">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, number, message…" aria-label="Search conversations" />
          <div className="waFilters">
            {FILTERS.map((f) => (
              <button key={f.id} className={`waChip ${filter === f.id ? "active" : ""}`} onClick={() => setFilter(f.id)}>
                {f.label}{f.id === "unread" && unreadTotal ? ` (${unreadTotal})` : ""}
              </button>
            ))}
          </div>
        </div>
        <div className="waListBody">
          {loading && <div className="small waEmpty">Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div className="small waEmpty">{convs.length ? "Is filter mein koi chat nahi." : "Abhi koi conversation nahi. WhatsApp connect hone ke baad chats yahan aayengi."}</div>
          )}
          {filtered.map((c) => {
            const l = c.leadId ? leadsById.get(c.leadId) : null;
            const assignee = c.assignedTo ? teamById.get(c.assignedTo)?.name : "";
            return (
              <button key={c.id} className={`waConv ${c.id === selectedId ? "active" : ""}`} onClick={() => setSelectedId(c.id)}>
                <div className="waAvatar">{conversationName(c).slice(0, 1).toUpperCase()}</div>
                <div className="waConvMain">
                  <div className="waConvTop">
                    <b className="waEllipsis">{conversationName(c)}</b>
                    <span className="waTime">{timeLabel(c.lastMessageAt)}</span>
                  </div>
                  <div className="waConvBottom">
                    <span className="waEllipsis small">{c.lastMessageFromMe ? "You: " : ""}{c.lastMessageText || ""}</span>
                    {(c.unreadCount || 0) > 0 && <span className="waUnread">{c.unreadCount}</span>}
                  </div>
                  <div className="waConvMeta">
                    {l && <span className={`badge ${l.status === "Converted" ? "ok" : l.status === "Lost" ? "bad" : "warn"}`}>{l.status}</span>}
                    {assignee && <span className="badge">👤 {assignee}</span>}
                    {(c.tags || []).slice(0, 2).map((t) => <span key={t} className="badge">#{t}</span>)}
                  </div>
                </div>
              </button>
            );
          })}
          {convs.length >= max && <button className="btnSmall waMore" onClick={() => setMax(max + 100)}>Load more chats</button>}
        </div>
      </aside>

      {/* ---------- chat ---------- */}
      <section className="waChat">
        {!selected ? (
          <div className="waEmpty big">Chat select karein</div>
        ) : (
          <>
            <div className="waChatHead">
              <button className="btnSmall waBack" onClick={() => setSelectedId(null)} aria-label="Back to chats">←</button>
              <div className="waAvatar">{conversationName(selected).slice(0, 1).toUpperCase()}</div>
              <div className="waChatTitle">
                <b className="waEllipsis">{conversationName(selected)}</b>
                <div className="small">{selected.phone ? formatPhone(selected.phone) : "Number hidden (privacy id)"}{selected.chatType === "group" ? " • Group" : ""}</div>
              </div>
              <button className="btnSmall" onClick={() => setShowPanel(!showPanel)}>{showPanel ? "Hide" : "Details"}</button>
            </div>

            <div className="waMessages">
              {messages.length >= msgMax && <button className="btnSmall waMore" onClick={() => setMsgMax(msgMax + 60)}>Load older messages</button>}
              {messages.map((m, i) => {
                const day = new Date(m.timestamp).toDateString();
                const showDay = i === 0 || new Date(messages[i - 1].timestamp).toDateString() !== day;
                const reactions = Object.values(m.reactions || {}).filter(Boolean);
                return (
                  <React.Fragment key={m.id}>
                    {showDay && <div className="waDay">{new Date(m.timestamp).toLocaleDateString()}</div>}
                    <div className={`waBubble ${m.fromMe ? "out" : "in"} ${m.deleted ? "deleted" : ""}`}>
                      {m.fromMe && m.source === "portal" && m.senderName && <div className="waBy">{m.senderName}</div>}
                      <MediaView m={m} />
                      {m.text && (!m.media || m.text !== m.media.fileName) && <div className="waText">{m.text}</div>}
                      <div className="waMsgMeta">
                        {m.deleted && <span>🚫 deleted • </span>}
                        {m.edited && <span>edited • </span>}
                        {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {m.fromMe && <span className={`waTick ${m.status}`}> {TICKS[m.status] || ""}</span>}
                      </div>
                      {reactions.length > 0 && <div className="waReactions">{reactions.join(" ")}</div>}
                    </div>
                  </React.Fragment>
                );
              })}
              {outbox.map((o) => (
                <div key={o.id} className={`waBubble out pending ${o.status}`}>
                  <div className="waText">{o.text}</div>
                  <div className="waMsgMeta">
                    {o.status === "failed" ? (
                      <>⚠ {o.error || "failed"} <button className="linkBtn" onClick={() => retry(o.text)}>Retry</button></>
                    ) : "🕓 sending…"}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {canReply ? (
              <div className="waComposer">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder={account?.status === "connected" ? "Message likhein… (Enter = send, Shift+Enter = new line)" : "WhatsApp connected nahi hai"}
                  maxLength={4096}
                  rows={1}
                />
                <button className="btnSolid" onClick={send} disabled={sending || !text.trim() || account?.status !== "connected"}>Send</button>
              </div>
            ) : (
              <div className="waComposer small">Aap ke paas reply ki permission nahi hai (view only).</div>
            )}
          </>
        )}
      </section>

      {/* ---------- customer / lead panel ---------- */}
      {selected && (
        <aside className={`waPanel ${showPanel ? "open" : ""}`}>
          <div className="waPanelSection">
            <div className="small">Customer</div>
            <b>{conversationName(selected)}</b>
            <div>{selected.phone ? formatPhone(selected.phone) : "—"}</div>
            {selected.phone && <a className="btnSmall" href={waLink(selected.phone) || "#"} target="_blank" rel="noreferrer">Open in WhatsApp</a>}
          </div>

          <div className="waPanelSection">
            <div className="small">Lead</div>
            {lead ? (
              <>
                <b>{lead.name}</b> <span className="small">({lead.id})</span>
                <label>Status</label>
                <select value={lead.status || "New"} disabled={!can("leads.edit")} onChange={(e) => setLeadField({ status: e.target.value })}>
                  {[...new Set([...LEAD_STATUSES, lead.status || "New"])].map((s) => <option key={s}>{s}</option>)}
                </select>
                <label>Follow-up date</label>
                <input type="date" value={lead.followUpDate || ""} disabled={!can("leads.edit")} onChange={(e) => setLeadField({ followUpDate: e.target.value })} />
                <div className="small">Source: {lead.source || "—"} • Added {lead.date || "—"}</div>
              </>
            ) : (
              <>
                <div className="small">Is chat ka koi lead nahi.</div>
                {can("leads.create") && selected.chatType === "user" && <button className="btnSmall" onClick={createLead}>+ Create Lead</button>}
              </>
            )}
          </div>

          <div className="waPanelSection">
            <label>Assigned to</label>
            <select value={selected.assignedTo || ""} disabled={!canReply} onChange={(e) => assign(e.target.value)}>
              <option value="">— Unassigned —</option>
              {data.team.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <label>Tags (comma separated)</label>
            <input
              defaultValue={(selected.tags || []).join(", ")}
              key={`tags-${selected.id}`}
              disabled={!canReply}
              onBlur={(e) => updateConversation(ws, selected.id, { tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10) })}
              placeholder="hot, ads, restaurant"
            />
            <label>Notes</label>
            <textarea
              defaultValue={selected.notes || ""}
              key={`notes-${selected.id}`}
              disabled={!canReply}
              onBlur={(e) => updateConversation(ws, selected.id, { notes: e.target.value.slice(0, 2000) })}
              placeholder="Customer requirement, budget…"
            />
          </div>

          <div className="waPanelSection">
            <div className="small">Interaction stats</div>
            <div className="waStats">
              <span>First message</span><b>{selected.firstInboundAt ? new Date(selected.firstInboundAt).toLocaleString() : "—"}</b>
              <span>First response time</span><b>{durationLabel(selected.firstResponseMs)}</b>
              <span>Messages in / out</span><b>{selected.inboundCount || 0} / {selected.outboundCount || 0}</b>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
