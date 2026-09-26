import React, { useEffect, useMemo, useState } from "react";
import { collection, documentId, getDocs, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { todayISO } from "@/lib/db";
import { durationLabel, WaConversation } from "@/components/whatsapp/useWhatsApp";

// Chart colours validated (dataviz validator) against light #fcfcfb and dark #171124 surfaces.
const SERIES = { light: { received: "#5B21B6", sent: "#16A34A" }, dark: { received: "#8B5CF6", sent: "#16A34A" } };

const PIPELINE = ["All leads", "Contacted", "Interested", "Qualified", "Proposal", "Converted"];
// Older statuses map onto the pipeline stage they correspond to.
const STAGE_OF: Record<string, number> = {
  New: 0, Contacted: 1, "Follow-up": 1, Interested: 2, "Meeting Scheduled": 2, "Demo Given": 3, Qualified: 3,
  Proposal: 4, Negotiation: 4, Converted: 5,
};

type RangeKey = "today" | "yesterday" | "7d" | "month" | "30d" | "custom";
const RANGES: { id: RangeKey; label: string }[] = [
  { id: "today", label: "Today" }, { id: "yesterday", label: "Yesterday" }, { id: "7d", label: "Last 7 days" },
  { id: "month", label: "This month" }, { id: "30d", label: "Last 30 days" }, { id: "custom", label: "Custom" },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function rangeDates(r: RangeKey, from: string, to: string): [string, string] {
  const now = new Date();
  switch (r) {
    case "today": return [iso(now), iso(now)];
    case "yesterday": return [iso(addDays(now, -1)), iso(addDays(now, -1))];
    case "7d": return [iso(addDays(now, -6)), iso(now)];
    case "month": return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)];
    case "30d": return [iso(addDays(now, -29)), iso(now)];
    default: return [from || iso(now), to || iso(now)];
  }
}

function useDarkMode() {
  const [dark, setDark] = useState(() => document.body.classList.contains("dark"));
  useEffect(() => {
    const o = new MutationObserver(() => setDark(document.body.classList.contains("dark")));
    o.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => o.disconnect();
  }, []);
  return dark;
}

interface DayStats {
  day: string; inbound?: number; outbound?: number; portalSent?: number; calls?: number; missedCalls?: number;
  newLeads?: number; newConversations?: number; responses?: number; responseMsTotal?: number;
  byUser?: Record<string, { email?: string; sent?: number; responses?: number; responseMsTotal?: number }>;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const tsDay = (ts?: number) => (ts ? iso(new Date(ts)) : "");

export default function PerformanceTab() {
  const { workspaceUid, can } = useAuth();
  const { data } = useData();
  const dark = useDarkMode();
  const colors = dark ? SERIES.dark : SERIES.light;
  const [range, setRange] = useState<RangeKey>("7d");
  const [customFrom, setCustomFrom] = useState(iso(addDays(new Date(), -13)));
  const [customTo, setCustomTo] = useState(todayISO());
  const [from, to] = rangeDates(range, customFrom, customTo);
  const [stats, setStats] = useState<DayStats[]>([]);
  const [convs, setConvs] = useState<WaConversation[]>([]);
  const canWa = can("whatsapp.view");

  useEffect(() => {
    if (!workspaceUid || !canWa) return;
    getDocs(query(collection(db, "users", workspaceUid, "waStats"), where(documentId(), ">=", from), where(documentId(), "<=", to)))
      .then((s) => setStats(s.docs.map((d) => ({ day: d.id, ...d.data() }) as DayStats)))
      .catch((e) => { console.warn("waStats", e); setStats([]); });
  }, [workspaceUid, canWa, from, to]);

  useEffect(() => {
    if (!workspaceUid || !canWa) return;
    return onSnapshot(
      query(collection(db, "users", workspaceUid, "waConversations"), orderBy("lastMessageAt", "desc"), limit(1000)),
      (s) => setConvs(s.docs.map((d) => ({ id: d.id, ...d.data() }) as WaConversation)),
      (e) => console.warn("conversations", e)
    );
  }, [workspaceUid, canWa]);

  const inRange = (day?: string) => !!day && day >= from && day <= to;
  const leads = useMemo(() => (data.leads || []).filter((l: any) => inRange(l.date)), [data.leads, from, to]);

  // ---------- daily series ----------
  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = new Date(from); iso(d) <= to && out.length < 400; d = addDays(d, 1)) out.push(iso(d));
    return out;
  }, [from, to]);
  const byDay = new Map(stats.map((s) => [s.day, s]));
  const daily = days.map((d) => ({
    day: d.slice(5),
    Received: byDay.get(d)?.inbound || 0,
    Sent: byDay.get(d)?.outbound || 0,
  }));
  const sum = (k: keyof DayStats) => stats.reduce((n, s) => n + (Number(s[k]) || 0), 0);

  // ---------- conversations in range ----------
  const convIn = convs.filter((c) => inRange(tsDay(c.firstInboundAt)));
  const answered = convIn.filter((c) => c.firstResponseMs != null);
  const now = Date.now();
  const unanswered = convs.filter((c) => c.chatType === "user" && c.lastMessageFromMe === false && (c.lastMessageAt || 0) < now - 3600_000 && (c.lastMessageAt || 0) > now - 7 * 86400_000);
  const avgResponse = sum("responses") ? sum("responseMsTotal") / sum("responses") : undefined;

  // ---------- leads ----------
  const converted = leads.filter((l: any) => l.status === "Converted").length;
  const qualifiedPlus = leads.filter((l: any) => (STAGE_OF[l.status] ?? -1) >= 3).length;
  const funnel = PIPELINE.map((stage, i) => ({ stage, Leads: i === 0 ? leads.length : leads.filter((l: any) => (STAGE_OF[l.status] ?? -1) >= i).length }));
  const lost = leads.filter((l: any) => l.status === "Lost" || l.status === "Invalid").length;
  const sources = Object.entries(leads.reduce((m: Record<string, number>, l: any) => { const k = l.source || "Other"; m[k] = (m[k] || 0) + 1; return m; }, {}))
    .map(([source, n]) => ({ source, Leads: n as number }))
    .sort((a, b) => b.Leads - a.Leads);

  // ---------- team ----------
  const members = [...(data.team || []).map((t: any) => ({ id: t.id, name: t.name })), { id: "", name: "Unassigned" }];
  const teamRows = members.map((m) => {
    const ml = leads.filter((l: any) => (l.assignedTo || "") === m.id);
    const at = (i: number) => ml.filter((l: any) => (STAGE_OF[l.status] ?? -1) >= i).length;
    const mc = convs.filter((c) => (c.assignedTo || "") === m.id);
    const responded = mc.filter((c) => inRange(tsDay(c.firstInboundAt)) && c.firstResponseMs != null);
    return {
      ...m,
      assigned: ml.length, contacted: at(1), interested: at(2), qualified: at(3), converted: at(5),
      lost: ml.filter((l: any) => l.status === "Lost" || l.status === "Invalid").length,
      chats: mc.length,
      avgResp: responded.length ? responded.reduce((n, c) => n + (c.firstResponseMs || 0), 0) / responded.length : undefined,
      waiting: mc.filter((c) => unanswered.includes(c)).length,
    };
  }).filter((r) => r.assigned || r.chats || r.id);

  const userRows = Object.entries(
    stats.reduce((m: Record<string, { email: string; sent: number; responses: number; ms: number }>, s) => {
      for (const [uid, u] of Object.entries(s.byUser || {})) {
        const cur = m[uid] || { email: u.email || uid, sent: 0, responses: 0, ms: 0 };
        cur.sent += u.sent || 0; cur.responses += u.responses || 0; cur.ms += u.responseMsTotal || 0;
        if (u.email) cur.email = u.email;
        m[uid] = cur;
      }
      return m;
    }, {})
  ).map(([uid, v]) => ({ uid, ...v })).sort((a, b) => b.sent - a.sent);

  const exportCsv = () => {
    const head = ["Member", "Leads", "Contacted", "Interested", "Qualified", "Converted", "Lost", "Conversion %", "Chats", "Avg first response (min)", "Waiting > 1h"];
    const rows = teamRows.map((r) => [r.name, r.assigned, r.contacted, r.interested, r.qualified, r.converted, r.lost, pct(r.converted, r.assigned), r.chats, r.avgResp != null ? Math.round(r.avgResp / 60000) : "", r.waiting]);
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `team-performance_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const axis = dark ? "#a79fbd" : "#6b6280";
  const grid = dark ? "rgba(255,255,255,.08)" : "rgba(61,9,109,.08)";
  const tooltipStyle = { background: dark ? "#171124" : "#fff", border: `1px solid ${dark ? "#2a2140" : "#e9e4f2"}`, borderRadius: 10, fontSize: 12 };

  return (
    <>
      <section className="card">
        <div className="sectionHead">
          <div>
            <h2 style={{ margin: 0 }}>Performance</h2>
            <div className="small">WhatsApp chats, leads aur team ki performance — {from === to ? from : `${from} → ${to}`}</div>
          </div>
          <div className="waFilters" style={{ marginTop: 0, flexWrap: "wrap" }}>
            {RANGES.map((r) => <button key={r.id} className={`waChip ${range === r.id ? "active" : ""}`} onClick={() => setRange(r.id)}>{r.label}</button>)}
          </div>
        </div>
        {range === "custom" && (
          <div className="grid2" style={{ maxWidth: 420, marginTop: 10 }}>
            <div><label>From</label><input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></div>
            <div><label>To</label><input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></div>
          </div>
        )}
        <div className="kpis" style={{ marginTop: 12 }}>
          <div className="kpi"><div className="t">Messages received</div><div className="v">{sum("inbound")}</div></div>
          <div className="kpi"><div className="t">Replies sent</div><div className="v">{sum("outbound")}</div></div>
          <div className="kpi"><div className="t">Calls (missed)</div><div className="v">{sum("calls")} <small className="small">({sum("missedCalls")})</small></div></div>
          <div className="kpi"><div className="t">Avg first response</div><div className="v">{durationLabel(avgResponse)}</div></div>
          <div className="kpi"><div className="t">Response rate</div><div className="v">{pct(answered.length, convIn.length)}%</div></div>
          <div className="kpi"><div className="t">Waiting &gt; 1 hour</div><div className="v">{unanswered.length}</div></div>
        </div>
        <div className="kpis" style={{ marginTop: 12 }}>
          <div className="kpi"><div className="t">Leads (all sources)</div><div className="v">{leads.length}</div></div>
          <div className="kpi"><div className="t">WhatsApp leads</div><div className="v">{leads.filter((l: any) => l.source === "WhatsApp").length}</div></div>
          <div className="kpi"><div className="t">Qualified +</div><div className="v">{qualifiedPlus}</div></div>
          <div className="kpi"><div className="t">Converted</div><div className="v">{converted}</div></div>
          <div className="kpi"><div className="t">Conversion rate</div><div className="v">{pct(converted, leads.length)}%</div></div>
          <div className="kpi"><div className="t">Qualified → Converted</div><div className="v">{pct(converted, qualifiedPlus)}%</div></div>
        </div>
        {!canWa && <div className="small" style={{ marginTop: 8 }}>WhatsApp numbers ke liye "WhatsApp Access" permission chahiye.</div>}
      </section>

      <div className="grid2 perfCharts">
        <section className="card">
          <h2>WhatsApp messages per day</h2>
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={daily} barGap={2} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={grid} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: axis }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: axis }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: grid }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Received" fill={colors.received} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="Sent" fill={colors.sent} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card">
          <h2>Lead funnel</h2>
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={funnel} layout="vertical" margin={{ top: 4, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke={grid} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: axis }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="stage" width={80} tick={{ fontSize: 12, fill: axis }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: grid }} />
                <Bar dataKey="Leads" fill={colors.received} radius={[0, 4, 4, 0]} maxBarSize={24} label={{ position: "right", fontSize: 11, fill: axis }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="small">Lost / Invalid: {lost}. Har stage mein woh leads jo us stage tak pohanch chuki hain.</div>
        </section>
      </div>

      <section className="card">
        <div className="sectionHead">
          <h2 style={{ margin: 0 }}>Team performance</h2>
          <button className="btnSmall" onClick={exportCsv}>Export CSV</button>
        </div>
        <div className="tablewrap" style={{ marginTop: 10 }}>
          <table>
            <thead><tr>
              <th>Member</th><th className="num">Leads</th><th className="num">Contacted</th><th className="num">Interested</th><th className="num">Qualified</th>
              <th className="num">Converted</th><th className="num">Lost</th><th className="num">Conv. %</th><th className="num">Chats</th><th className="num">Avg 1st response</th><th className="num">Waiting &gt;1h</th>
            </tr></thead>
            <tbody>
              {teamRows.map((r) => (
                <tr key={r.id || "none"}>
                  <td><b>{r.name}</b></td>
                  <td className="num">{r.assigned}</td><td className="num">{r.contacted}</td><td className="num">{r.interested}</td><td className="num">{r.qualified}</td>
                  <td className="num"><b>{r.converted}</b></td><td className="num">{r.lost}</td>
                  <td className="num"><span className={`badge ${pct(r.converted, r.assigned) >= 20 ? "ok" : r.assigned ? "warn" : ""}`}>{pct(r.converted, r.assigned)}%</span></td>
                  <td className="num">{r.chats}</td><td className="num">{durationLabel(r.avgResp)}</td>
                  <td className="num">{r.waiting ? <span className="badge bad">{r.waiting}</span> : 0}</td>
                </tr>
              ))}
              {teamRows.length === 0 && <tr><td colSpan={11} className="small">Team records nahi. Team tab mein members add karein aur leads / chats assign karein.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="small" style={{ marginTop: 6 }}>Leads: selected dates mein bani leads, assigned member ke hisaab se. Chats aur "Waiting" tamam assigned conversations par.</div>
      </section>

      <div className="grid2 perfCharts">
        <section className="card">
          <h2>Replies by portal user</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>User</th><th className="num">Messages sent</th><th className="num">First replies</th><th className="num">Avg first response</th></tr></thead>
              <tbody>
                {userRows.map((u) => (
                  <tr key={u.uid}><td>{u.email}</td><td className="num">{u.sent}</td><td className="num">{u.responses}</td><td className="num">{durationLabel(u.responses ? u.ms / u.responses : undefined)}</td></tr>
                ))}
                {userRows.length === 0 && <tr><td colSpan={4} className="small">Is dauran portal se koi reply nahi gaya.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="small" style={{ marginTop: 6 }}>Phone se bheje gaye replies "Replies sent" mein shamil hain magar kisi user ke naam nahi.</div>
        </section>
        <section className="card">
          <h2>Leads by source</h2>
          <div style={{ height: Math.max(160, sources.length * 34) }}>
            <ResponsiveContainer>
              <BarChart data={sources} layout="vertical" margin={{ top: 4, right: 30, left: 10, bottom: 0 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="source" width={90} tick={{ fontSize: 12, fill: axis }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: grid }} />
                <Bar dataKey="Leads" fill={colors.received} radius={[0, 4, 4, 0]} maxBarSize={22} label={{ position: "right", fontSize: 11, fill: axis }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </>
  );
}
