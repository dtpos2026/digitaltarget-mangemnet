import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { fmtMoney, todayISO } from "@/lib/db";
import { formatLocalPhone, normalizePhone } from "@/lib/phone";
import {
  LEAD_SOURCES, SALES_STATUSES, TEMPERATURES, activeAssistants, dailySales, followUpDueAt, followUpIsDue, hasPendingFollowUp,
  isClosed, salesSettingsOf, sourceOf, statusLabel, takeBlocker, temperatureClass, temperatureOf,
} from "@/lib/salesPipeline";
import { takeLeadTx } from "@/lib/salesStore";
import { businessById, servesUnit, unitOfLead, useBusinessUnit } from "@/lib/business";
import { Product } from "@/lib/products";
import { leadValue, wonValue } from "@/lib/leadValue";
import { Quotation } from "@/lib/quotation";
import { MemberStats, SalesTarget, memberStats, monthLabel, shiftMonth } from "@/lib/salesAnalytics";
import { useCaptureStatus } from "./AutoCapture";
import LeadProfile from "@/components/LeadProfile";
import { useExtensionVersion } from "@/lib/waExtension";
import { navigate } from "@/lib/navigation";
import BusinessSwitcher from "./BusinessSwitcher";
import QuotationModal from "./QuotationModal";
import SalesMemberProfile from "./SalesMemberProfile";

type View = "pool" | "mine" | "all" | "followups" | "quotations" | "me" | "team" | "activity";
const ago = (iso?: string) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "abhi" : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} ghante` : `${Math.round(m / 1440)} din`;
};
const fmtAt = (v: string) => new Date(v).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
const compact = (n: number) => (n >= 1e7 ? `${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(Math.round(n)));

type SortKey = keyof Pick<MemberStats, "name" | "leads" | "contacted" | "demos" | "quotationValue" | "won" | "revenue" | "conversion" | "pipeline" | "activities" | "followUpsOverdue">;

/**
 * Sales desk for WhatsApp leads, per business: today's numbers, the open pool
 * with TAKE LEAD, my leads, follow-ups, quotations and — for an assistant —
 * their own performance; for the CEO every lead, the team A–Z (open any
 * assistant) and the activity log. Everything is live.
 */
export default function SalesTab({ openLead }: { openLead?: { id: string; n: number } | null }) {
  const { data } = useData();
  const { can, roleDoc, user, workspaceUid } = useAuth();
  const ceo = can("leads.view");
  const myTeamId = roleDoc?.teamId || "";
  const sales = salesSettingsOf(data.settings);
  const cap = useCaptureStatus();
  const ext = useExtensionVersion();
  const unit = useBusinessUnit();
  const products = data.products as Product[];
  const [view, setView] = useState<View>(ceo ? "all" : "pool");
  const [openId, setOpenId] = useState("");
  const [member, setMember] = useState("");
  const [quote, setQuote] = useState<{ existing?: Quotation } | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [f, setF] = useState({ q: "", who: "ALL", status: "ALL", temp: "ALL", source: "ALL" });
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: "revenue", desc: true });
  useEffect(() => { if (openLead?.id) setOpenId(openLead.id); }, [openLead]);

  const today = todayISO();
  const myUnits = sales.assistants.find((a) => a.teamId === myTeamId)?.units;
  const unitOf = (l: any) => unitOfLead(l, data.settings, products);
  // Business filter (switcher) + an assistant's own businesses for the pool.
  const leads = useMemo(() => (data.leads as any[]).filter((l) => !unit || unitOf(l) === unit), [data.leads, unit, products, data.settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const byRecent = (a: any, b: any) => String(b.lastMessageAt || b.createdAt || "").localeCompare(String(a.lastMessageAt || a.createdAt || ""));
  const pool = useMemo(() => leads.filter((l) => !l.assignedTo && !isClosed(l) && (ceo || servesUnit(myUnits, unitOf(l)))
    && (l.channel || l.source === "Meta Ads" || l.source === "WhatsApp Direct" || l.createdAt?.slice(0, 10) >= today)).sort(byRecent), [leads, today, ceo, myUnits]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = useMemo(() => leads.filter((l) => myTeamId && l.assignedTo === myTeamId).sort(byRecent), [leads, myTeamId]);
  const myScope = ceo ? leads : leads.filter((l) => l.assignedTo === myTeamId);
  const followups = useMemo(() => myScope.filter((l) => hasPendingFollowUp(l) && (l.followUpDate <= today)).sort((a, b) => followUpDueAt(a).localeCompare(followUpDueAt(b))), [myScope, today]);
  const day = useMemo(() => dailySales(myScope, today), [myScope, today]);
  const todaySales = myScope.filter((l) => l.status === "Converted" && String(l.wonAt || "").slice(0, 10) === today).reduce((s, l) => s + wonValue(l, products, data.settings), 0);
  const pipeline = myScope.filter((l) => !isClosed(l)).reduce((s, l) => s + leadValue(l, products, data.settings).amount, 0);
  const assistants = activeAssistants(sales);
  const quotations = (data.quotations as Quotation[]).filter((q) => (ceo || q.teamId === myTeamId) && (!unit || q.unit === unit)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const team = useMemo(() => {
    if (!ceo) return [];
    const rows = assistants.map((a) => memberStats(a.teamId, a.name, leads, data.quotations as Quotation[], products, data.settings, month, data.salesTargets as SalesTarget[]));
    const dir = sort.desc ? -1 : 1;
    return rows.sort((a, b) => (sort.k === "name" ? a.name.localeCompare(b.name) * dir : ((a[sort.k] as number) - (b[sort.k] as number)) * dir));
  }, [ceo, assistants, leads, data.quotations, products, data.settings, month, data.salesTargets, sort]);

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
    const rows: { at: string; by: string; text: string; lead: any; type: string; role?: string; outcome?: string }[] = [];
    for (const l of leads) for (const h of l.history || []) if (h.type !== "ai") rows.push({ at: h.at, by: h.who || h.by || "", text: h.text, lead: l, type: h.type, role: h.role, outcome: h.outcome });
    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 250);
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
    const v = leadValue(l, products, data.settings);
    const biz = businessById(data.settings, unitOf(l));
    return (
      <tr className={fuDue ? "lateRow" : ""}>
        <td>
          <button className="linkBtn leadName" onClick={() => setOpenId(l.id)}>{l.name}</button>{l.vip && <span className="badge vipBadge" style={{ marginLeft: 4 }}>⭐</span>}
          <div className="small">{biz ? `${biz.icon} ` : ""}{formatLocalPhone(normalizePhone(l.whatsapp || l.phone)) || l.phone}{l.businessName || l.business ? ` • ${l.businessName || l.business}` : ""}{l.city ? ` • ${l.city}` : ""}</div>
          {l.lastMessageText && <div className="small salesSnippet">“{String(l.lastMessageText).slice(0, 90)}” • {ago(l.lastMessageAt)}</div>}
        </td>
        <td><span className={`badge ${temperatureClass(t)}`}>{t}</span></td>
        <td><span className="badge pri">{statusLabel(l.status)}</span>{l.aiHandoff && <div className="small">👤 handoff</div>}</td>
        <td className="num">{v.amount ? `Rs ${fmtMoney(v.amount)}` : "—"}<div className="small">{v.basis === "estimate" ? "andaza" : v.basis === "products" ? "products" : v.basis === "quotation" ? "quotation" : v.basis === "won" ? "sale" : ""}</div></td>
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
        <thead><tr><th>Lead</th><th>Temp</th><th>Status</th><th className="num">Value</th><th>Source</th><th>Assistant</th><th>Follow-up / Demo</th><th /></tr></thead>
        <tbody>
          {rows.slice(0, 300).map((l) => <Row key={l.id} l={l} />)}
          {rows.length === 0 && <tr><td colSpan={8} className="small">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
  const Th = ({ k, children, num = true }: { k: SortKey; children: React.ReactNode; num?: boolean }) => (
    <th className={num ? "num" : ""}>
      <button className="sortBtn" onClick={() => setSort({ k, desc: sort.k === k ? !sort.desc : true })} aria-sort={sort.k === k ? (sort.desc ? "descending" : "ascending") : "none"}>
        {children}{sort.k === k ? (sort.desc ? " ▼" : " ▲") : ""}
      </button>
    </th>
  );

  const views: { id: View; label: string; show: boolean }[] = [
    { id: "pool", label: `🆕 Naye / Pool (${pool.length})`, show: true },
    { id: "mine", label: `👤 Meri leads (${mine.length})`, show: !!myTeamId },
    { id: "all", label: `📋 Sab leads (${leads.length})`, show: ceo },
    { id: "followups", label: `⏰ Aaj ke follow-ups (${followups.length})`, show: true },
    { id: "quotations", label: `🧾 Quotations (${quotations.length})`, show: can("products.view") || ceo },
    { id: "me", label: "📈 Meri performance", show: !!myTeamId && (can("leads.own") || assistants.some((a) => a.teamId === myTeamId)) },
    { id: "team", label: "📊 Team A–Z", show: ceo },
    { id: "activity", label: "📜 Activity", show: ceo },
  ];

  return (
    <>
      <section className="card">
        <div className="sectionHead">
          <div>
            <h2 style={{ margin: 0 }}>Sales — WhatsApp leads</h2>
            <div className="small">Live: naya WhatsApp message aate hi lead yahan aa jati hai (refresh ki zaroorat nahi). {ceo ? "Aap sab leads aur poori team dekh rahe hain." : "Aap ko sirf apni aur pool ki leads, apni quotations aur apni performance dikhti hai."}</div>
          </div>
          <div className="rowActions">
            {can("products.view") && <button className="btnSolid" onClick={() => setQuote({})}>🧾 Nayi quotation</button>}
            {can("products.view") && <button className="btnSmall" onClick={() => navigate({ tab: "products" })}>📦 Products</button>}
            <div className={`small captureState ${cap.on ? "on" : ""}`} title={cap.lastError || cap.last}>
              {cap.on ? "🟢 Auto-capture ON (is computer par)" : `⚪ Auto-capture off${cap.reason ? ` — ${cap.reason}` : ""}`}
              {cap.on && <div>nayi {cap.captured} • update {cap.updated} • skip {cap.skipped}</div>}
              {cap.lastError && <div className="warnText">{cap.lastError}</div>}
              {!ext && <div>Extension (Fast mode) wale computer par capture hota hai.</div>}
            </div>
          </div>
        </div>
        <BusinessSwitcher />
        <div className="moneyStrip salesKpis" style={{ marginTop: 10 }}>
          {([["New leads", day.newLeads], ["Contacted", day.contacted], ["HOT", day.hot], ["WARM", day.warm], ["COLD", day.cold], ["Demos scheduled", day.demosScheduled],
            ["Demos completed", day.demosCompleted], ["Quotations", day.quotations], ["Won", day.won], ["Lost", day.lost], ["Follow-ups pending", day.followUpsPending]] as const).map(([k, v]) => (
            <div key={k}><span>Aaj — {k}</span><b>{v}</b></div>
          ))}
          <div><span>Aaj ki sale</span><b>Rs {compact(todaySales)}</b></div>
          <div><span>Pipeline (open value)</span><b>Rs {compact(pipeline)}</b></div>
        </div>
        <div className="segmented" style={{ marginTop: 10, flexWrap: "wrap" }}>
          {views.filter((v) => v.show).map((v) => <button key={v.id} className={view === v.id ? "on" : ""} onClick={() => setView(v.id)}>{v.label}</button>)}
        </div>
        {msg && <div className="small" style={{ marginTop: 6 }}><b>{msg}</b></div>}
      </section>

      {view === "me" ? <SalesMemberProfile teamId={myTeamId} /> : (
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
          {view === "quotations" && (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Number</th><th>Customer</th><th>Products</th><th className="num">Total</th>{ceo && <th>Assistant</th>}<th>Kab</th><th>Bheji</th><th /></tr></thead>
                <tbody>
                  {quotations.map((q) => (
                    <tr key={q.id}>
                      <td><b>{q.number}</b></td>
                      <td>{q.leadId ? <button className="linkBtn" onClick={() => setOpenId(q.leadId!)}>{q.customer.name}</button> : q.customer.name}<div className="small">{q.customer.business || ""}</div></td>
                      <td className="small">{q.items.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""}`).join(", ")}</td>
                      <td className="num">Rs {fmtMoney(q.total)}{q.discount ? <div className="small">− {fmtMoney(q.discount)}</div> : null}</td>
                      {ceo && <td className="small">{q.preparedBy?.name || "—"}</td>}
                      <td className="small">{fmtAt(q.createdAt)}</td>
                      <td className="small">{(q.sentVia || []).join(", ") || "—"}</td>
                      <td><button className="btnSmall" onClick={() => setQuote({ existing: q })}>Card / bhejein</button></td>
                    </tr>
                  ))}
                  {quotations.length === 0 && <tr><td colSpan={8} className="small">Abhi koi quotation nahi — "🧾 Nayi quotation" se banayein.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {view === "team" && ceo && (
            <>
              <div className="sectionHead">
                <b>Team performance A–Z — {monthLabel(month)}</b>
                <div className="mpMonth">
                  <button className="btnSmall" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Pichla mahina">◀</button>
                  <b>{monthLabel(month)}</b>
                  <button className="btnSmall" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= today.slice(0, 7)} aria-label="Agla mahina">▶</button>
                </div>
              </div>
              {assistants.length === 0 && <div className="small">Sales assistants set nahi — Settings → Sales team mein chunein.</div>}
              <div className="tablewrap">
                <table className="teamAZ">
                  <thead><tr>
                    <Th k="name" num={false}>Assistant</Th><Th k="leads">Leads</Th><Th k="contacted">Contacted</Th><Th k="demos">Demos</Th>
                    <Th k="quotationValue">Quotations</Th><Th k="won">Won</Th><Th k="revenue">Revenue</Th><Th k="conversion">Conversion</Th>
                    <Th k="pipeline">Pipeline</Th><Th k="followUpsOverdue">Follow-ups</Th><Th k="activities">Activities</Th><th className="num">Target</th>
                  </tr></thead>
                  <tbody>
                    {team.map((s) => (
                      <tr key={s.teamId}>
                        <td><button className="linkBtn" onClick={() => setMember(s.teamId)}><b>{s.name}</b></button><div className="small">{s.open} open • TAKE {s.avgTakeMins === null ? "—" : `${s.avgTakeMins} min`}</div></td>
                        <td className="num">{s.leads}</td><td className="num">{s.contacted}</td><td className="num">{s.demos}</td>
                        <td className="num">{s.quotations}<div className="small">Rs {compact(s.quotationValue)}</div></td>
                        <td className="num"><b>{s.won}</b></td><td className="num"><b>Rs {fmtMoney(s.revenue)}</b></td>
                        <td className="num">{s.conversion}%<div className="small">close {s.closeRate}%</div></td>
                        <td className="num">Rs {compact(s.pipeline)}</td>
                        <td className="num">{s.followUpsToday}{s.followUpsOverdue ? <div className="small warnText">{s.followUpsOverdue} late</div> : null}</td>
                        <td className="num">{s.activities}</td>
                        <td className="num">{s.targetPct.revenue === null ? "—" : `${s.targetPct.revenue}%`}<div className="small">{s.target ? `of Rs ${compact(s.target.revenue)}` : "set nahi"}</div></td>
                      </tr>
                    ))}
                    {team.length > 0 && (
                      <tr className="totalRow">
                        <td><b>Total</b></td>
                        {(["leads", "contacted", "demos"] as const).map((k) => <td key={k} className="num"><b>{team.reduce((s, x) => s + x[k], 0)}</b></td>)}
                        <td className="num"><b>{team.reduce((s, x) => s + x.quotations, 0)}</b></td>
                        <td className="num"><b>{team.reduce((s, x) => s + x.won, 0)}</b></td>
                        <td className="num"><b>Rs {fmtMoney(team.reduce((s, x) => s + x.revenue, 0))}</b></td>
                        <td /><td className="num"><b>Rs {compact(team.reduce((s, x) => s + x.pipeline, 0))}</b></td><td /><td className="num"><b>{team.reduce((s, x) => s + x.activities, 0)}</b></td><td />
                      </tr>
                    )}
                    <tr><td><i>Pool (unassigned)</i></td><td className="num">{leads.filter((l) => !l.assignedTo && !isClosed(l)).length}</td><td colSpan={10} /></tr>
                  </tbody>
                </table>
              </div>
              <div className="small" style={{ marginTop: 6 }}>Kisi assistant ke naam par click karein — us ki leads, chats, activities, sales, target, schedule aur profile alag khulti hai.</div>
            </>
          )}
          {view === "activity" && ceo && (
            <ul className="lpTimeline salesActivity">
              {activity.map((a, i) => (
                <li key={i} className={a.role === "admin" ? "byAdmin" : ""}>
                  <span className="lpIcon">•</span>
                  <div>
                    <div><button className="linkBtn" onClick={() => setOpenId(a.lead.id)}>{a.lead.name}</button> — {a.text}{a.outcome && <span className="badge" style={{ marginLeft: 6 }}>{a.outcome}</span>}</div>
                    <div className="small">{fmtAt(a.at)}{a.by ? ` • ${a.by}` : ""}{a.role === "admin" ? " • 🛡 Admin" : ""}</div>
                  </div>
                </li>
              ))}
              {activity.length === 0 && <li className="small">Abhi koi activity nahi.</li>}
            </ul>
          )}
        </section>
      )}

      {openId && <LeadProfile leadId={openId} onClose={() => setOpenId("")} />}
      {member && <SalesMemberProfile teamId={member} onClose={() => setMember("")} />}
      {quote && <QuotationModal existing={quote.existing} onClose={() => setQuote(null)} />}
    </>
  );
}
