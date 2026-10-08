import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { todayISO } from "@/lib/db";
import { formatLocalPhone, normalizePhone } from "@/lib/phone";
import {
  LEAD_SOURCES, SALES_STATUSES, TEMPERATURES, activeAssistants, assistantStats, dailySales, followUpDueAt, followUpIsDue, hasPendingFollowUp,
  isClosed, salesSettingsOf, sourceOf, statusLabel, takeBlocker, temperatureClass, temperatureOf,
} from "@/lib/salesPipeline";
import { takeLeadTx } from "@/lib/salesStore";
import { useCaptureStatus } from "./AutoCapture";
import LeadProfile from "@/components/LeadProfile";
import { useExtensionVersion } from "@/lib/waExtension";

type View = "pool" | "mine" | "all" | "followups" | "team" | "activity";
const ago = (iso?: string) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "abhi" : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} ghante` : `${Math.round(m / 1440)} din`;
};

/**
 * Daily sales desk for WhatsApp leads: today's numbers, the open pool with
 * TAKE LEAD, my leads, today's follow-ups and — for the CEO — every lead,
 * team performance and the activity log. Everything is live.
 */
export default function SalesTab({ openLead }: { openLead?: { id: string; n: number } | null }) {
  const { data } = useData();
  const { can, roleDoc, user, workspaceUid } = useAuth();
  const ceo = can("leads.view");
  const myTeamId = roleDoc?.teamId || "";
  const sales = salesSettingsOf(data.settings);
  const cap = useCaptureStatus();
  const ext = useExtensionVersion();
  const [view, setView] = useState<View>(ceo ? "all" : "pool");
  const [openId, setOpenId] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [f, setF] = useState({ q: "", who: "ALL", status: "ALL", temp: "ALL", source: "ALL" });
  useEffect(() => { if (openLead?.id) setOpenId(openLead.id); }, [openLead]);

  const today = todayISO();
  const leads = data.leads as any[];
  const byRecent = (a: any, b: any) => String(b.lastMessageAt || b.createdAt || "").localeCompare(String(a.lastMessageAt || a.createdAt || ""));
  const pool = useMemo(() => leads.filter((l) => !l.assignedTo && !isClosed(l) && (l.channel || l.source === "Meta Ads" || l.source === "WhatsApp Direct" || l.createdAt?.slice(0, 10) >= today)).sort(byRecent), [leads, today]);
  const mine = useMemo(() => leads.filter((l) => myTeamId && l.assignedTo === myTeamId).sort(byRecent), [leads, myTeamId]);
  const myScope = ceo ? leads : leads.filter((l) => l.assignedTo === myTeamId);
  const followups = useMemo(() => myScope.filter((l) => hasPendingFollowUp(l) && (l.followUpDate <= today)).sort((a, b) => followUpDueAt(a).localeCompare(followUpDueAt(b))), [myScope, today]);
  const day = useMemo(() => dailySales(myScope, today), [myScope, today]);
  const assistants = activeAssistants(sales);
  const stats = useMemo(() => assistantStats(leads, assistants), [leads, assistants]);

  const all = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return leads.filter((l) =>
      (f.who === "ALL" || (f.who === "POOL" ? !l.assignedTo : l.assignedTo === f.who)) &&
      (f.status === "ALL" || l.status === f.status) &&
      (f.temp === "ALL" || temperatureOf(l) === f.temp) &&
      (f.source === "ALL" || sourceOf(l) === f.source) &&
      (!q || `${l.name} ${l.phone} ${l.businessName || ""} ${l.business || ""} ${l.city || ""}`.toLowerCase().includes(q))
    ).sort(byRecent);
  }, [leads, f]);

  const activity = useMemo(() => {
    if (!ceo) return [];
    const rows: { at: string; by: string; text: string; lead: any; type: string }[] = [];
    for (const l of leads) for (const h of l.history || []) if (h.type !== "ai") rows.push({ at: h.at, by: h.by || "", text: h.text, lead: l, type: h.type });
    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
  }, [leads, ceo]);

  const take = async (l: any) => {
    if (!workspaceUid) return;
    setBusy(l.id); setMsg("");
    const name = data.team.find((t: any) => t.id === myTeamId)?.name || assistants.find((a) => a.teamId === myTeamId)?.name || roleDoc?.displayName || user?.email || "";
    try { await takeLeadTx(workspaceUid, l.id, { teamId: myTeamId, name, by: user?.email || "", uid: user?.uid }, sales); setMsg(`✓ ${l.name} aap ki lead`); setOpenId(l.id); }
    catch (e) { setMsg((e as Error).message); }
    setBusy("");
  };

  const Row = ({ l }: { l: any }) => {
    const t = temperatureOf(l);
    const why = can("leads.take") ? takeBlocker(l, myTeamId) : "x";
    const fuDue = followUpIsDue(l);
    return (
      <tr className={fuDue ? "lateRow" : ""}>
        <td>
          <button className="linkBtn leadName" onClick={() => setOpenId(l.id)}>{l.name}</button>{l.vip && <span className="badge vipBadge" style={{ marginLeft: 4 }}>⭐</span>}
          <div className="small">{formatLocalPhone(normalizePhone(l.whatsapp || l.phone)) || l.phone}{l.businessName || l.business ? ` • ${l.businessName || l.business}` : ""}{l.city ? ` • ${l.city}` : ""}</div>
          {l.lastMessageText && <div className="small salesSnippet">“{String(l.lastMessageText).slice(0, 90)}” • {ago(l.lastMessageAt)}</div>}
        </td>
        <td><span className={`badge ${temperatureClass(t)}`}>{t}</span></td>
        <td><span className="badge pri">{statusLabel(l.status)}</span>{l.aiHandoff && <div className="small">👤 handoff</div>}</td>
        <td className="small">{sourceOf(l)}{l.adInfo?.title ? <div>{String(l.adInfo.title).slice(0, 40)}</div> : null}</td>
        <td className="small">{l.assignedTo ? <>{l.assignedToName || "—"}{l.takenAt ? <div>✋ {ago(l.takenAt)}</div> : <div>(TAKE baqi)</div>}</> : <i>pool</i>}</td>
        <td className="small">{hasPendingFollowUp(l) ? <span className={fuDue ? "badge bad" : ""}>{l.followUpDate} {l.followUpTime || ""}</span> : l.followUpAuto && !l.followUpDone && !isClosed(l) ? <span title="AI ka mashwara — reminder ke liye follow-up set karein">AI: {l.followUpDate}</span> : "—"}{l.demoAt ? <div>📅 {String(l.demoAt).replace("T", " ")}</div> : null}</td>
        <td className="rowActions">
          {!why && <button className="btnSolid takeBtn" disabled={busy === l.id} onClick={() => take(l)}>{busy === l.id ? "…" : "✋ TAKE LEAD"}</button>}
          <button className="btnSmall" onClick={() => setOpenId(l.id)}>Open</button>
        </td>
      </tr>
    );
  };
  const Table = ({ rows, empty }: { rows: any[]; empty: string }) => (
    <div className="tablewrap" style={{ marginTop: 8 }}>
      <table>
        <thead><tr><th>Lead</th><th>Temp</th><th>Status</th><th>Source</th><th>Assistant</th><th>Follow-up / Demo</th><th /></tr></thead>
        <tbody>
          {rows.slice(0, 300).map((l) => <Row key={l.id} l={l} />)}
          {rows.length === 0 && <tr><td colSpan={7} className="small">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );

  const views: { id: View; label: string; show: boolean }[] = [
    { id: "pool", label: `🆕 Naye / Pool (${pool.length})`, show: true },
    { id: "mine", label: `👤 Meri leads (${mine.length})`, show: !!myTeamId },
    { id: "all", label: `📋 Sab leads (${leads.length})`, show: ceo },
    { id: "followups", label: `⏰ Aaj ke follow-ups (${followups.length})`, show: true },
    { id: "team", label: "📈 Team performance", show: ceo },
    { id: "activity", label: "📜 Activity", show: ceo },
  ];

  return (
    <>
      <section className="card">
        <div className="sectionHead">
          <div>
            <h2 style={{ margin: 0 }}>Sales — WhatsApp leads</h2>
            <div className="small">Live: naya WhatsApp message aate hi lead yahan aa jati hai (refresh ki zaroorat nahi). {ceo ? "Aap sab leads dekh rahe hain." : "Aap ko sirf apni aur pool ki leads dikhti hain."}</div>
          </div>
          <div className={`small captureState ${cap.on ? "on" : ""}`} title={cap.lastError || cap.last}>
            {cap.on ? "🟢 Auto-capture ON (is computer par)" : `⚪ Auto-capture off${cap.reason ? ` — ${cap.reason}` : ""}`}
            {cap.on && <div>nayi {cap.captured} • update {cap.updated} • skip {cap.skipped}</div>}
            {cap.lastError && <div className="warnText">{cap.lastError}</div>}
            {!ext && <div>Extension (Fast mode) wale computer par capture hota hai.</div>}
          </div>
        </div>
        <div className="moneyStrip salesKpis" style={{ marginTop: 10 }}>
          {([["New leads", day.newLeads], ["Contacted", day.contacted], ["HOT", day.hot], ["WARM", day.warm], ["COLD", day.cold], ["Demos scheduled", day.demosScheduled],
            ["Demos completed", day.demosCompleted], ["Quotations", day.quotations], ["Won", day.won], ["Lost", day.lost], ["Follow-ups pending", day.followUpsPending]] as const).map(([k, v]) => (
            <div key={k}><span>Aaj — {k}</span><b>{v}</b></div>
          ))}
        </div>
        <div className="segmented" style={{ marginTop: 10, flexWrap: "wrap" }}>
          {views.filter((v) => v.show).map((v) => <button key={v.id} className={view === v.id ? "on" : ""} onClick={() => setView(v.id)}>{v.label}</button>)}
        </div>
        {msg && <div className="small" style={{ marginTop: 6 }}><b>{msg}</b></div>}
      </section>

      <section className="card">
        {view === "pool" && <><b>Naye leads — jo pehle TAKE LEAD dabaye, lead us ki</b><Table rows={pool} empty="Pool khali hai." /></>}
        {view === "mine" && <Table rows={mine} empty="Abhi aap ke paas koi lead nahi — Pool se TAKE LEAD karein." />}
        {view === "all" && ceo && (
          <>
            <div className="mcPick">
              <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Naam, number, business, city…" />
              <select value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })} aria-label="Assistant">
                <option value="ALL">Sab assistants</option><option value="POOL">Pool (unassigned)</option>
                {assistants.map((a) => <option key={a.teamId} value={a.teamId}>{a.name}</option>)}
              </select>
              <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status">
                <option value="ALL">Sab status</option>{SALES_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <select value={f.temp} onChange={(e) => setF({ ...f, temp: e.target.value })} aria-label="Temperature">
                <option value="ALL">HOT / WARM / COLD</option>{TEMPERATURES.map((t) => <option key={t}>{t}</option>)}
              </select>
              <select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} aria-label="Source">
                <option value="ALL">Sab sources</option>{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <Table rows={all} empty="Koi lead nahi." />
          </>
        )}
        {view === "followups" && <><b>Aaj (aur pichle) follow-ups — waqt aane par notification aati hai</b><Table rows={followups} empty="Aaj koi follow-up nahi. 🎉" /></>}
        {view === "team" && ceo && (
          <>
            {assistants.length === 0 && <div className="small">Sales assistants set nahi — Settings → Sales team mein chunein.</div>}
            <div className="tablewrap">
              <table>
                <thead><tr><th>Assistant</th><th className="num">Assigned</th><th className="num">Contacted</th><th className="num">Demos</th><th className="num">Sales (WON)</th><th className="num">Conversion</th><th className="num">Open</th><th className="num">Aaj follow-ups</th></tr></thead>
                <tbody>
                  {stats.map((s) => (
                    <tr key={s.teamId}>
                      <td><button className="linkBtn" onClick={() => { setF({ ...f, who: s.teamId }); setView("all"); }}>{s.name}</button></td>
                      <td className="num">{s.assigned}</td><td className="num">{s.contacted}</td><td className="num">{s.demos}</td><td className="num"><b>{s.sales}</b></td>
                      <td className="num">{s.conversion}%</td><td className="num">{s.open}</td>
                      <td className="num">{leads.filter((l) => l.assignedTo === s.teamId && hasPendingFollowUp(l) && l.followUpDate <= today).length}</td>
                    </tr>
                  ))}
                  <tr><td><i>Pool (unassigned)</i></td><td className="num">{leads.filter((l) => !l.assignedTo && !isClosed(l)).length}</td><td colSpan={6} /></tr>
                </tbody>
              </table>
            </div>
            <div className="small" style={{ marginTop: 6 }}>Commission data: WON leads assistant-wise yahan se aage commission report mein jayega.</div>
          </>
        )}
        {view === "activity" && ceo && (
          <ul className="lpTimeline salesActivity">
            {activity.map((a, i) => (
              <li key={i}>
                <span className="lpIcon">•</span>
                <div>
                  <div><button className="linkBtn" onClick={() => setOpenId(a.lead.id)}>{a.lead.name}</button> — {a.text}</div>
                  <div className="small">{new Date(a.at).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}{a.by ? ` • ${a.by}` : ""}</div>
                </div>
              </li>
            ))}
            {activity.length === 0 && <li className="small">Abhi koi activity nahi.</li>}
          </ul>
        )}
      </section>

      {openId && <LeadProfile leadId={openId} onClose={() => setOpenId("")} />}
    </>
  );
}
