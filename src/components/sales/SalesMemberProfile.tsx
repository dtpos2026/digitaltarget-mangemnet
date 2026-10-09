import React, { useEffect, useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { fmtMoney, todayISO } from "@/lib/db";
import { formatLocalPhone, normalizePhone } from "@/lib/phone";
import { Product } from "@/lib/products";
import { Quotation } from "@/lib/quotation";
import { SalesTarget, activityByDay, activityFeed, memberStats, monthLabel, shiftMonth, targetId } from "@/lib/salesAnalytics";
import { isClosed, statusLabel, temperatureClass, temperatureOf } from "@/lib/salesPipeline";
import { leadValue } from "@/lib/leadValue";
import { resizeImageFile } from "@/lib/imageResize";
import { businessById, unitOfLead, useBusinessUnit } from "@/lib/business";
import LeadProfile from "@/components/LeadProfile";
import QuotationModal from "./QuotationModal";
import BusinessSwitcher from "./BusinessSwitcher";

type View = "overview" | "leads" | "chats" | "activities" | "sales" | "targets" | "schedule" | "profile";
const fmtAt = (v: string) => new Date(v).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
const compact = (n: number) => (n >= 1e7 ? `${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(Math.round(n)));

function Meter({ label, done, goal, fmt = (n: number) => String(n) }: { label: string; done: number; goal?: number; fmt?: (n: number) => string }) {
  const p = goal ? Math.min(100, Math.round((done / goal) * 100)) : 0;
  return (
    <div className="meterRow">
      <div className="meterHead"><span>{label}</span><b>{fmt(done)}{goal ? ` / ${fmt(goal)}` : ""}</b>{goal ? <em>{Math.round((done / goal) * 100)}%</em> : <em>target nahi</em>}</div>
      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={label}><div style={{ width: `${p}%` }} /></div>
    </div>
  );
}

/**
 * One salesperson, A–Z: KPIs and target for the month, leads, chats,
 * activities, sales and quotations, schedule and the profile shown on
 * quotation cards. The CEO opens anyone's; an assistant sees only their own.
 */
export default function SalesMemberProfile({ teamId, onClose }: { teamId: string; onClose?: () => void }) {
  const { data, addItem, updateItem } = useData();
  const { can, roleDoc, workspaceUid } = useAuth();
  const unitFilter = useBusinessUnit();
  const self = roleDoc?.teamId === teamId;
  const admin = can("leads.view");
  const canTarget = can("team.manage") || can("settings.manage") || can("leads.assign");
  const member = data.team.find((t: any) => t.id === teamId);
  const name = member?.name || "Assistant";
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [view, setView] = useState<View>("overview");
  const [open, setOpen] = useState("");
  const [quote, setQuote] = useState<Quotation | null>(null);
  const products = data.products as Product[];
  const inUnit = (l: any) => !unitFilter || unitOfLead(l, data.settings, products) === unitFilter;
  const leads = useMemo(() => (data.leads as any[]).filter((l) => l.assignedTo === teamId && inUnit(l)), [data.leads, teamId, unitFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  const quotations = (data.quotations as Quotation[]).filter((q) => q.teamId === teamId && (!unitFilter || q.unit === unitFilter));
  const targets = data.salesTargets as SalesTarget[];
  const st = memberStats(teamId, name, leads, quotations, products, data.settings, month, targets);
  const days = activityByDay(leads, teamId, 14);
  const maxDay = Math.max(1, ...days.map((d) => d.count));
  const feed = activityFeed(leads, teamId);
  const schedule = (data.schedule as any[]).filter((s) => s.assignedTo === teamId && s.status !== "Dismissed").sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

  // target form
  const t = st.target;
  const [tf, setTf] = useState({ revenue: t?.revenue || 0, deals: t?.deals || 0, demos: t?.demos || 0 });
  useEffect(() => { setTf({ revenue: t?.revenue || 0, deals: t?.deals || 0, demos: t?.demos || 0 }); }, [month, t?.revenue, t?.deals, t?.demos]);
  const [tmsg, setTmsg] = useState("");
  const saveTarget = async () => {
    const id = targetId(month, teamId);
    const rec: SalesTarget = { id, month, teamId, revenue: Number(tf.revenue) || 0, deals: Number(tf.deals) || 0, demos: Number(tf.demos) || 0 };
    if (targets.some((x) => x.id === id)) await updateItem("salesTargets", rec); else await addItem("salesTargets", rec);
    setTmsg(`✓ ${monthLabel(month)} ka target save`);
  };
  // profile form (shown on quotation cards)
  const [pf, setPf] = useState({ phone: member?.phone || member?.whatsapp || "", designation: member?.designation || member?.role || "", email: member?.email || "", photo: member?.photo || "" });
  const [pmsg, setPmsg] = useState("");
  const saveProfile = async () => {
    const patch = { phone: pf.phone.trim(), designation: pf.designation.trim(), email: pf.email.trim(), photo: pf.photo, updatedAt: new Date().toISOString() };
    try {
      if (self && !can("team.manage") && workspaceUid) await updateDoc(doc(db, "users", workspaceUid, "team", teamId), patch);
      else await updateItem("team", { ...member, ...patch });
      setPmsg("✓ Profile save");
    } catch (e) { setPmsg("Save nahi hua: " + (e as Error).message); }
  };

  const views: { id: View; label: string }[] = [
    { id: "overview", label: "📊 Overview" }, { id: "leads", label: `🎯 Leads (${leads.length})` }, { id: "chats", label: "💬 Chats" },
    { id: "activities", label: "📜 Activities" }, { id: "sales", label: `🏆 Sales & quotations` }, { id: "targets", label: "🎯 Target" },
    { id: "schedule", label: `📅 Schedule (${schedule.filter((s) => s.status !== "Done").length})` }, { id: "profile", label: "👤 Profile" },
  ];
  const tiles: [string, string, string?][] = [
    ["Leads (is mahine)", String(st.leads)], ["Contacted", String(st.contacted)], ["Demos", String(st.demos)],
    ["Quotations", String(st.quotations), st.quotationValue ? `Rs ${compact(st.quotationValue)}` : ""],
    ["Sales (WON)", String(st.won)], ["Conversion", `${st.conversion}%`, `close rate ${st.closeRate}%`],
    ["Pipeline (open)", `Rs ${compact(st.pipeline)}`, `${st.open} open leads`],
    ["Follow-ups", String(st.followUpsToday), st.followUpsOverdue ? `${st.followUpsOverdue} late` : "on time"],
    ["Activities", String(st.activities), "calls, WhatsApp, meetings"],
    ["TAKE time (avg)", st.avgTakeMins === null ? "—" : st.avgTakeMins < 60 ? `${st.avgTakeMins} min` : `${Math.round(st.avgTakeMins / 60)} ghante`],
  ];

  const body = (
    <div className="memberProfile">
      <div className="mpHead">
        <div className="mpAvatar">{pf.photo ? <img src={pf.photo} alt="" /> : <span>{name.split(/\s+/).map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}</span>}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b className="mpName">{name}</b>
          <div className="small">{[pf.designation || member?.role, pf.phone, pf.email].filter(Boolean).join(" • ")}</div>
        </div>
        <div className="mpMonth">
          <button className="btnSmall" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Pichla mahina">◀</button>
          <b>{monthLabel(month)}</b>
          <button className="btnSmall" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Agla mahina" disabled={month >= todayISO().slice(0, 7)}>▶</button>
        </div>
        {onClose && <button className="btnSmall" onClick={onClose}>✕</button>}
      </div>
      <BusinessSwitcher />
      <div className="segmented" style={{ flexWrap: "wrap", margin: "8px 0" }}>
        {views.map((v) => <button key={v.id} className={view === v.id ? "on" : ""} onClick={() => setView(v.id)}>{v.label}</button>)}
      </div>

      {view === "overview" && (
        <>
          <div className="mpHero"><span>Revenue — {monthLabel(month)}</span><b>Rs {fmtMoney(st.revenue)}</b></div>
          <div className="statTiles">
            {tiles.map(([k, v, d]) => <div key={k} className="statTile"><span>{k}</span><b>{v}</b>{d ? <em>{d}</em> : null}</div>)}
          </div>
          <div className="mpGrid">
            <div className="lpCard">
              <div className="lpHead">🎯 Target — {monthLabel(month)}</div>
              <Meter label="Revenue" done={st.revenue} goal={t?.revenue} fmt={(n) => `Rs ${compact(n)}`} />
              <Meter label="Deals (WON)" done={st.won} goal={t?.deals} />
              <Meter label="Demos" done={st.demos} goal={t?.demos} />
              {!t && <div className="small">{canTarget ? "Target tab se is mahine ka target set karein." : "Admin ne abhi target set nahi kiya."}</div>}
            </div>
            <div className="lpCard">
              <div className="lpHead">Activities — pichle 14 din</div>
              <div className="actBars" role="img" aria-label="Activities per day, last 14 days">
                {days.map((d) => (
                  <div key={d.day} className="actBar" title={`${d.day}: ${d.count} activities`}>
                    <div className="actFill" style={{ height: `${Math.round((d.count / maxDay) * 100)}%` }} />
                    <span>{d.day.slice(8)}</span>
                  </div>
                ))}
              </div>
              <div className="small">Calls, WhatsApp, meetings, follow-ups, demos, quotations jo is ki leads par hue.</div>
            </div>
          </div>
        </>
      )}

      {view === "leads" && (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Lead</th><th>Business</th><th>Temp</th><th>Status</th><th className="num">Value</th><th>Follow-up</th></tr></thead>
            <tbody>
              {leads.slice().sort((a, b) => String(b.lastMessageAt || b.updatedAt || "").localeCompare(String(a.lastMessageAt || a.updatedAt || ""))).map((l) => {
                const v = leadValue(l, products, data.settings);
                const biz = businessById(data.settings, unitOfLead(l, data.settings, products));
                return (
                  <tr key={l.id}>
                    <td><button className="linkBtn leadName" onClick={() => setOpen(l.id)}>{l.name}</button><div className="small">{formatLocalPhone(normalizePhone(l.whatsapp || l.phone)) || l.phone}</div></td>
                    <td className="small">{biz ? `${biz.icon} ${biz.name}` : "—"}</td>
                    <td><span className={`badge ${temperatureClass(temperatureOf(l))}`}>{temperatureOf(l)}</span></td>
                    <td><span className="badge pri">{statusLabel(l.status)}</span></td>
                    <td className="num">{v.amount ? `Rs ${fmtMoney(v.amount)}` : "—"}<div className="small">{v.basis === "estimate" ? "andaza" : v.basis === "none" ? "" : v.label}</div></td>
                    <td className="small">{l.followUpDate && !l.followUpDone && !l.followUpAuto ? `${l.followUpDate} ${l.followUpTime || ""}` : "—"}</td>
                  </tr>
                );
              })}
              {leads.length === 0 && <tr><td colSpan={6} className="small">Koi lead nahi.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {view === "chats" && (
        <div className="chatList">
          {leads.filter((l) => (l.chat || []).length).sort((a, b) => String(b.lastMessageAt || "").localeCompare(String(a.lastMessageAt || ""))).map((l) => {
            const last = (l.chat || [])[(l.chat || []).length - 1];
            return (
              <button key={l.id} className="chatRow" onClick={() => setOpen(l.id)}>
                <b>{l.name}</b>{!isClosed(l) && l.lastInboundAt && (!l.lastContactAt || l.lastInboundAt > l.lastContactAt) && <span className="badge warn" style={{ marginLeft: 6 }}>jawab baqi</span>}
                <span className="small">{last?.fromMe ? "Aap: " : ""}{String(last?.text || "").slice(0, 120)}</span>
                <span className="small">{l.lastMessageAt ? fmtAt(l.lastMessageAt) : ""} • {(l.chat || []).length} messages</span>
              </button>
            );
          })}
          {!leads.some((l) => (l.chat || []).length) && <div className="small">Abhi koi WhatsApp chat capture nahi hui.</div>}
        </div>
      )}

      {view === "activities" && (
        <ul className="lpTimeline salesActivity">
          {feed.map((r, i) => (
            <li key={i} className={r.ev.role === "admin" ? "byAdmin" : ""}>
              <span className="lpIcon">•</span>
              <div>
                <div><button className="linkBtn" onClick={() => setOpen(r.lead.id)}>{r.lead.name}</button> — {r.ev.text}{r.ev.outcome && <span className="badge" style={{ marginLeft: 6 }}>{r.ev.outcome}</span>}</div>
                <div className="small">{fmtAt(r.at)}{r.ev.who || r.ev.by ? ` • ${r.ev.who || r.ev.by}` : ""}{r.ev.role === "admin" ? " • 🛡 Admin" : ""}</div>
              </div>
            </li>
          ))}
          {feed.length === 0 && <li className="small">Abhi koi activity nahi.</li>}
        </ul>
      )}

      {view === "sales" && (
        <>
          <div className="lpHead">🏆 WON leads</div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Lead</th><th>Kab</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {leads.filter((l) => l.status === "Converted").sort((a, b) => String(b.wonAt || "").localeCompare(String(a.wonAt || ""))).map((l) => (
                  <tr key={l.id}><td><button className="linkBtn" onClick={() => setOpen(l.id)}>{l.name}</button></td><td className="small">{l.wonAt ? fmtAt(l.wonAt) : "—"}</td><td className="num">Rs {fmtMoney(Number(l.wonAmount) || leadValue({ ...l, status: "" }, products, data.settings).amount)}</td></tr>
                ))}
                {!leads.some((l) => l.status === "Converted") && <tr><td colSpan={3} className="small">Abhi koi sale nahi.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="lpHead" style={{ marginTop: 10 }}>🧾 Quotations</div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Number</th><th>Customer</th><th>Products</th><th className="num">Total</th><th>Kab</th><th /></tr></thead>
              <tbody>
                {quotations.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((q) => (
                  <tr key={q.id}>
                    <td><b>{q.number}</b></td><td>{q.customer.name}</td><td className="small">{q.items.map((i) => i.name).join(", ")}</td>
                    <td className="num">Rs {fmtMoney(q.total)}</td><td className="small">{fmtAt(q.createdAt)}</td>
                    <td><button className="btnSmall" onClick={() => setQuote(q)}>Card</button></td>
                  </tr>
                ))}
                {quotations.length === 0 && <tr><td colSpan={6} className="small">Abhi koi quotation nahi.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === "targets" && (
        <div className="lpCard">
          <div className="lpHead">🎯 {monthLabel(month)} ka target</div>
          {canTarget ? (
            <>
              <div className="grid3">
                <label>Revenue (Rs)<input type="number" value={tf.revenue || ""} onChange={(e) => setTf({ ...tf, revenue: Number(e.target.value) })} /></label>
                <label>Deals (WON)<input type="number" value={tf.deals || ""} onChange={(e) => setTf({ ...tf, deals: Number(e.target.value) })} /></label>
                <label>Demos<input type="number" value={tf.demos || ""} onChange={(e) => setTf({ ...tf, demos: Number(e.target.value) })} /></label>
              </div>
              <div className="rowActions"><button className="btnSolid" onClick={saveTarget}>Target save karein</button>{tmsg && <b className="small">{tmsg}</b>}</div>
            </>
          ) : <div className="small">Target admin set karta hai.</div>}
          <Meter label="Revenue" done={st.revenue} goal={t?.revenue} fmt={(n) => `Rs ${compact(n)}`} />
          <Meter label="Deals (WON)" done={st.won} goal={t?.deals} />
          <Meter label="Demos" done={st.demos} goal={t?.demos} />
        </div>
      )}

      {view === "schedule" && (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Date</th><th>Kaam</th><th>Status</th></tr></thead>
            <tbody>
              {schedule.map((s) => (
                <tr key={s.id} className={s.status !== "Done" && s.date < todayISO() ? "lateRow" : ""}>
                  <td>{s.date}<div className="small">{s.time || ""}</div></td>
                  <td>{s.leadId ? <button className="linkBtn" onClick={() => setOpen(s.leadId)}>{s.task}</button> : s.task}<div className="small">{s.notes || s.category}</div></td>
                  <td><span className={`badge ${s.status === "Done" ? "ok" : "warn"}`}>{s.status}</span></td>
                </tr>
              ))}
              {schedule.length === 0 && <tr><td colSpan={3} className="small">Schedule khali hai.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {view === "profile" && (
        <div className="lpCard">
          <div className="lpHead">👤 Sales profile — quotation card par yehi dikhta hai</div>
          {(self || can("team.manage")) ? (
            <>
              <div className="grid3">
                <label>Designation<input value={pf.designation} onChange={(e) => setPf({ ...pf, designation: e.target.value })} placeholder="Sales Executive" /></label>
                <label>Phone / WhatsApp<input value={pf.phone} onChange={(e) => setPf({ ...pf, phone: e.target.value })} /></label>
                <label>Email<input value={pf.email} onChange={(e) => setPf({ ...pf, email: e.target.value })} /></label>
              </div>
              <div className="rowActions">
                <label className="btnSmall" style={{ cursor: "pointer" }}>Photo upload<input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { setPf({ ...pf, photo: await resizeImageFile(f, 240, "image/jpeg") }); } catch (er) { setPmsg((er as Error).message); } } }} /></label>
                {pf.photo && <button className="linkBtn" onClick={() => setPf({ ...pf, photo: "" })}>Photo hatayein</button>}
                <button className="btnSolid" onClick={saveProfile}>Save</button>
                {pmsg && <b className="small">{pmsg}</b>}
              </div>
            </>
          ) : <div className="small">{[pf.designation, pf.phone, pf.email].filter(Boolean).join(" • ") || "Profile nahi bani."}</div>}
        </div>
      )}

      {open && <LeadProfile leadId={open} onClose={() => setOpen("")} />}
      {quote && <QuotationModal existing={quote} onClose={() => setQuote(null)} />}
    </div>
  );

  if (!admin && !self) return null; // an assistant never opens someone else's numbers
  return onClose ? (
    <div className="dtModalBackdrop" onClick={onClose}>
      <div className="dtModal wide" onClick={(e) => e.stopPropagation()}>{body}</div>
    </div>
  ) : <section className="card">{body}</section>;
}
