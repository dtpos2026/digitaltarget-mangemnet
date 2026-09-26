import React, { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import { useData } from "@/contexts/DataContext";
import { analyzeBusiness, type Severity } from "@/lib/insights";
import { fmtMoney } from "@/lib/db";

// Palette validated with the dataviz validator (light #fcfcfb / dark #171124).
const SERIES = { light: { income: "#16A34A", expense: "#5B21B6" }, dark: { income: "#16A34A", expense: "#8B5CF6" } };
const SEV: Record<Severity, { label: string; Icon: typeof Info }> = {
  risk: { label: "Risk", Icon: ShieldAlert },
  warn: { label: "Attention", Icon: AlertTriangle },
  good: { label: "Good", Icon: CheckCircle2 },
  info: { label: "Info", Icon: Info },
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function useDark() {
  const [dark, setDark] = useState(() => document.body.classList.contains("dark"));
  useEffect(() => {
    const o = new MutationObserver(() => setDark(document.body.classList.contains("dark")));
    o.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => o.disconnect();
  }, []);
  return dark;
}

/** Automatic growth analysis from the portal's own data (no external AI service). */
export default function GrowthAnalysis() {
  const { data } = useData();
  const dark = useDark();
  const a = useMemo(() => analyzeBusiness(data), [data]);
  const colors = dark ? SERIES.dark : SERIES.light;
  const chart = a.months.map((m) => ({ month: MONTHS[+m.month.slice(5) - 1], Income: m.income, Expense: m.expense }));
  const actions = a.insights.filter((i) => i.action);
  const scoreCls = a.score >= 70 ? "ok" : a.score >= 45 ? "warn" : "bad";
  const axis = dark ? "#a79fbd" : "#6b6280";
  const grid = dark ? "rgba(255,255,255,.08)" : "rgba(61,9,109,.08)";

  return (
    <section className="card growth">
      <div className="sectionHead">
        <div>
          <h2 style={{ margin: 0 }}>Growth Analysis</h2>
          <div className="small">Aap ke accounting, invoices, leads, clients aur team data ka khud-kaar jaiza — har baar data badalne par update hota hai.</div>
        </div>
      </div>

      <div className="growthTop">
        <div className={`healthScore ${scoreCls}`} style={{ ["--p" as string]: a.score }}>
          <div><b>{a.score}</b><span>Business health</span></div>
        </div>
        <div className="kpis kpis4 growthKpis">
          <div className="kpi"><div className="t">Is mahine income</div><div className="v">Rs {fmtMoney(a.thisMonth.income)}</div></div>
          <div className="kpi"><div className="t">Forecast (3-mah avg)</div><div className="v">Rs {fmtMoney(a.forecastIncome)}</div></div>
          <div className="kpi"><div className="t">Agle mahine target (+15%)</div><div className="v">Rs {fmtMoney(a.growthTarget)}</div></div>
          <div className="kpi"><div className="t">Leads chahiye</div><div className="v">{a.leadsNeeded ?? "—"}</div></div>
        </div>
      </div>

      <div className="grid2 growthGrid">
        <div>
          <h3 className="growthH">Income vs Expense (6 mahine)</h3>
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={chart} barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={grid} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: axis }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: axis }} tickLine={false} axisLine={false} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                <Tooltip formatter={(v: number) => `Rs ${fmtMoney(v)}`} contentStyle={{ background: dark ? "#171124" : "#fff", border: `1px solid ${dark ? "#2a2140" : "#e9e4f2"}`, borderRadius: 10, fontSize: 12 }} cursor={{ fill: grid }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Income" fill={colors.income} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="Expense" fill={colors.expense} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <h3 className="growthH">Action plan</h3>
          {actions.length === 0 ? <div className="small">Abhi koi fori kaam nahi — sab theek chal raha hai.</div> : (
            <ol className="actionPlan">
              {actions.slice(0, 6).map((i) => <li key={i.id}><b>{i.area}:</b> {i.action}</li>)}
            </ol>
          )}
        </div>
      </div>

      <h3 className="growthH">Insights</h3>
      <div className="insightGrid">
        {a.insights.map((i) => {
          const { label, Icon } = SEV[i.severity];
          return (
            <div key={i.id} className={`insight ${i.severity}`}>
              <div className="insightHead"><Icon size={16} /><span className="insightTag">{label} • {i.area}</span></div>
              <b>{i.title}</b>
              <div className="small">{i.detail}</div>
            </div>
          );
        })}
      </div>
      <div className="small" style={{ marginTop: 8 }}>Yeh jaiza aap ke portal ke data par qawaid (rules) se banta hai; data bahar kahin nahi bheja jata.</div>
    </section>
  );
}
