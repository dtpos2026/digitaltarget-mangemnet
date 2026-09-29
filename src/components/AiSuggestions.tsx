import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { fmtMoney, todayISO } from "@/lib/db";
import { invoiceView } from "@/lib/invoice";
import { analyzeBusiness } from "@/lib/insights";
import { analyzeModule } from "@/lib/moduleInsights";
import { useGrowthTasks, statusOf, isSnoozed } from "@/lib/growthTasks";
import { Campaign, needsAttention } from "@/lib/campaign";
import { navigate } from "@/lib/navigation";
import type { ModuleInsight } from "@/lib/moduleInsights";

const rs = (n: number) => `Rs ${fmtMoney(Math.round(Number(n) || 0))}`;
const CLOSED = ["Converted", "Lost", "Invalid"];

interface Suggestion { key: string; group: string; severity: ModuleInsight["severity"]; title: string; detail: string; action?: string; tab?: string }

/**
 * Everything the AI suggests to do next — urgent tasks, payment reminders,
 * client follow-ups, assignments, recommendations, WhatsApp safety — each with
 * Complete / Snooze / Dismiss. Lives in the AI Analysis tab.
 */
export default function AiSuggestions() {
  const { can, hasFullAccess, workspaceUid } = useAuth();
  const { data } = useData();
  const g = useGrowthTasks();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const today = todayISO();
  const canTask = hasFullAccess || can("settings.manage");

  useEffect(() => {
    if (!workspaceUid || !can("campaigns.manage")) return;
    getDocs(query(collection(db, "users", workspaceUid, "waCampaigns"), orderBy("createdAt", "desc"), limit(20)))
      .then((s) => setCampaigns(s.docs.map((d) => d.data() as Campaign))).catch(() => {});
  }, [workspaceUid, can]);

  const followUps = data.leads.filter((l: any) => l.followUpDate && l.followUpDate <= today && !CLOSED.includes(l.status));
  const overdue = data.invoices.map((inv: any) => ({ inv, v: invoiceView(inv) })).filter((x: any) => x.v.status === "Overdue");

  const suggestions = useMemo<Suggestion[]>(() => {
    const out: Suggestion[] = [];
    const openTasks = g.tasks.filter((t) => statusOf(t) === "open" && !isSnoozed(t) && t.due <= today);
    for (const t of openTasks.slice(0, 3)) out.push({ key: `task:${t.id}`, group: "Urgent task", severity: t.due < today ? "risk" : "warn", title: t.title, detail: `Growth task • due ${t.due}`, tab: "dash" });
    for (const x of overdue.slice(0, 4)) {
      const c = data.clients.find((cc: any) => cc.id === x.inv.clientId);
      out.push({ key: `pay:${x.inv.id}`, group: "Payment reminder", severity: "risk", title: `${c?.name || x.v.number}: ${rs(x.v.due)} overdue`, detail: `${x.v.number} • due ${x.inv.dueDate}`, action: "WhatsApp overdue reminder bhejein", tab: "invoices" });
    }
    for (const l of followUps.slice(0, 4)) out.push({ key: `fu:${l.id}:${l.followUpDate}`, group: "Client follow-up", severity: l.followUpDate < today ? "warn" : "info", title: `${l.name} — follow-up ${l.followUpDate < today ? "late" : "aaj"}`, detail: l.ai?.nextAction || l.serviceType || "", tab: "leads" });
    const assign = analyzeModule("assignments", data).insights.filter((i) => i.action).slice(0, 2);
    for (const i of assign) out.push({ key: `asg:${i.id}`, group: "Assignment", severity: i.severity, title: i.title, detail: i.action || "", tab: "assignments" });
    const biz = analyzeBusiness(data).insights.filter((i) => i.action && i.severity !== "good").slice(0, 3);
    for (const i of biz) out.push({ key: `biz:${i.id}`, group: "Recommendation", severity: i.severity, title: i.title, detail: i.action || "", tab: "budget" });
    for (const c of campaigns.filter(needsAttention)) out.push({ key: `cmp:${c.id}:${c.pausedReason}`, group: "WhatsApp safety", severity: "risk", title: `Campaign "${c.name}" ruk gayi`, detail: c.pausedReason || "", tab: "whatsapp" });
    return out.filter((s) => s.key.startsWith("task:") || !g.has("dashboard", { id: s.key }));
  }, [g, overdue, followUps, data, campaigns, today]);

  const act = (s: Suggestion, how: "done" | "dismissed" | { snoozeDays: number }) => {
    if (s.key.startsWith("task:")) {
      const id = s.key.slice(5);
      return how === "done" ? g.complete(id) : how === "dismissed" ? g.dismiss(id) : g.snooze(id, how.snoozeDays);
    }
    return g.resolve("dashboard", { id: s.key, severity: s.severity, title: s.title, detail: s.detail, action: s.action || s.detail }, how);
  };

  return (
    <section className="card overview">
      <div className="ovSugg">
        <div className="ovHead">✨ AI suggestions <span className="small">({suggestions.length})</span></div>
        {suggestions.length === 0 ? <div className="small">Abhi koi urgent kaam nahi. 🎉</div> : (
          <ul className="modList">
            {suggestions.map((s) => (
              <li key={s.key} className={`sev-${s.severity}`}>
                <span className="ovTag">{s.group}</span>
                <div>
                  <b>{s.title}</b>
                  {s.detail && <div className="small">{s.detail}</div>}
                </div>
                <div className="gtActions">
                  {s.tab && s.tab !== "dash" && <button className="btnSmall" onClick={() => navigate({ tab: s.tab! })} title="Kholein">→</button>}
                  {canTask && (
                    <>
                      <button className="btnSmall" onClick={() => act(s, "done")} title="Complete ✓">✓</button>
                      <select className="gtSnooze" value="" onChange={(e) => e.target.value && act(s, { snoozeDays: Number(e.target.value) })} aria-label="Snooze">
                        <option value="">⏰</option><option value="1">1 din</option><option value="3">3 din</option><option value="7">1 hafta</option>
                      </select>
                      <button className="btnSmall" onClick={() => act(s, "dismissed")} title="Dismiss — dobara nahi aayega" aria-label="Dismiss">✕</button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
