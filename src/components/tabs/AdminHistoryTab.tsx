import React, { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query, setDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { fmtMoney } from "@/lib/db";
import { MonthSnapshot, buildMonthSnapshot, closingChecks } from "@/lib/closing";
import { closeMonth, deleteMonth, getArchive, listArchives, reopenMonth } from "@/lib/closingStore";
import { monthKey, monthLabel, shiftMonth } from "@/lib/finance";
import { printElementHTML } from "@/lib/exportUtils";
import { escapeHtml } from "@/lib/safeHtml";

const rs = (n: number) => `Rs ${fmtMoney(Math.round(Number(n) || 0))}`;
const SECTIONS = ["Accountability", "Invoices", "Income", "Expenses", "Clients", "Services", "Leads", "Projects & Tasks", "Team", "AI & Next month"] as const;
type Section = (typeof SECTIONS)[number];

/** Months with any activity that are not closed yet (newest first). */
function openMonths(data: any, closed: Set<string>) {
  const set = new Set<string>();
  const add = (d: unknown) => { const m = String(d || "").slice(0, 7); if (/^\d{4}-\d{2}$/.test(m)) set.add(m); };
  (data.accounting || []).forEach((a: any) => add(a.date));
  (data.invoices || []).forEach((i: any) => add(i.dateISO));
  set.add(monthKey());
  return Array.from(set).filter((m) => !closed.has(m) && m <= monthKey()).sort().reverse();
}

/**
 * Administrator History: close a month (snapshot + archive), browse every
 * closed month A–Z, re-open or permanently delete. Administrator only.
 */
export default function AdminHistoryTab() {
  const { can, workspaceUid, user } = useAuth();
  const { data, reload, removeItem } = useData();
  const [archives, setArchives] = useState<MonthSnapshot[] | null>(null);
  const [month, setMonth] = useState("");
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [open, setOpen] = useState<MonthSnapshot | null>(null);
  const [section, setSection] = useState<Section>("Accountability");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (!workspaceUid) return;
    try { setArchives(await listArchives(workspaceUid)); } catch (e) { setMsg("History load nahi hui: " + (e as Error).message); setArchives([]); }
  }, [workspaceUid]);
  useEffect(() => { load(); }, [load]);

  const closed = useMemo(() => new Set((archives || []).filter((a) => a.status === "closed").map((a) => a.month)), [archives]);
  const candidates = useMemo(() => openMonths(data, closed), [data, closed]);
  useEffect(() => { if (!month && candidates.length) setMonth(candidates.find((m) => m < monthKey()) || candidates[0]); }, [candidates, month]);
  const preview = useMemo(() => (month ? buildMonthSnapshot({ ...data, _closedMonths: Array.from(closed) }, month, { closedBy: user?.email || "" }) : null), [data, month, closed, user?.email]);
  const checks = useMemo(() => (month ? closingChecks({ ...data, _closedMonths: Array.from(closed) }, month) : []), [data, month, closed]);

  if (!can("history.manage")) {
    return <section className="card"><h2>Administrator History</h2><div className="small">Ye module sirf Administrator ke liye hai.</div></section>;
  }

  const doClose = async () => {
    if (!workspaceUid || !preview) return;
    if (!confirm(`Are you sure you want to close ${monthLabel(month)}? All historical financial and operational data will remain available in Administrator History.\n\n${preview.counts.archivedInvoices} paid invoices, ${preview.counts.archivedProjects} completed projects, ${preview.counts.archivedAssignments} tasks aur ${preview.counts.archivedSchedule} schedule items archive honge. Clients, accounts, outstanding balances, services, team aur settings waise hi rahenge.`)) return;
    setBusy("close"); setMsg("");
    try {
      // Campaign summaries go into the snapshot too.
      let campaigns: any[] = [];
      try { campaigns = (await getDocs(query(collection(db, "users", workspaceUid, "waCampaigns"), orderBy("createdAt", "desc"), limit(100)))).docs.map((d) => d.data()); } catch { /* no access */ }
      const snap = buildMonthSnapshot({ ...data, _closedMonths: Array.from(closed) }, month, { closedBy: user?.email || "", campaigns });
      await closeMonth(workspaceUid, snap, (d, t) => setProgress(`Archive… ${d}/${t}`));
      setProgress("");
      await reload({ silent: true });
      await load();
      setMsg(`✓ ${monthLabel(month)} close ho gaya. Neeche "AI & Next month" mein agle mahine ka plan dekhein.`);
      setOpen(await getArchive(workspaceUid, month));
      setSection("AI & Next month");
      setMonth("");
    } catch (e) {
      setMsg(`Closing mukammal nahi hui: ${(e as Error).message}. Data mehfooz hai — "Retry" dabayein.`);
      await load();
    } finally { setBusy(""); }
  };

  const retry = async (a: MonthSnapshot) => {
    if (!workspaceUid) return;
    setBusy(a.month);
    try { await closeMonth(workspaceUid, a, (d, t) => setProgress(`Archive… ${d}/${t}`)); setProgress(""); await reload({ silent: true }); await load(); setMsg(`✓ ${monthLabel(a.month)} close mukammal`); }
    catch (e) { setMsg("Retry fail: " + (e as Error).message); } finally { setBusy(""); }
  };

  const reopen = async (a: MonthSnapshot) => {
    if (!workspaceUid) return;
    if (!confirm(`${monthLabel(a.month)} dobara kholein? Archive kiye records active workspace mein wapas aa jayenge aur ye snapshot hat jayega (baad mein phir close kar sakte hain).`)) return;
    setBusy(a.month);
    try { await reopenMonth(workspaceUid, a.month); await reload({ silent: true }); await load(); setOpen(null); setMsg(`✓ ${monthLabel(a.month)} dobara khul gaya`); }
    catch (e) { setMsg("Reopen fail: " + (e as Error).message); } finally { setBusy(""); }
  };

  /** Permanent delete: the snapshot and every record archived under it. (Reopen is the non-destructive option.) */
  const remove = async (a: MonthSnapshot) => {
    if (!workspaceUid) return;
    const n = Object.values(a.archived || {}).reduce((s, ids) => s + (ids?.length || 0), 0);
    if (!confirm(`This action will permanently delete the selected historical data from the database. This cannot be undone.\n\n${monthLabel(a.month)}: snapshot + ${n} archived records (paid invoices, completed projects, tasks, schedule).\n\nRecords wapas active karne hain to "Reopen" use karein.`)) return;
    if (prompt(`Tasdeeq ke liye month likhein: ${a.month}`) !== a.month) { setMsg("Delete cancel — month match nahi hua"); return; }
    setBusy(a.month);
    try { await deleteMonth(workspaceUid, a.month, true); await reload({ silent: true }); await load(); setOpen(null); setMsg(`${monthLabel(a.month)} permanently delete ho gaya`); }
    catch (e) { setMsg("Delete fail: " + (e as Error).message); } finally { setBusy(""); }
  };

  const applyTarget = async (a: MonthSnapshot) => {
    if (!workspaceUid) return;
    const n = a.ai.nextMonth;
    const existing = data.targets.find((t: any) => t.month === n.month || t.id === n.month);
    if (existing?.revenue && !confirm(`${monthLabel(n.month)} ka target pehle se Rs ${fmtMoney(existing.revenue)} set hai. Naye se replace karein?`)) return;
    const input = prompt(`${monthLabel(n.month)} ka revenue target (AI suggestion: Rs ${fmtMoney(n.revenue)}). Apna number likh sakte hain:`, String(existing?.revenue || n.revenue || ""));
    if (input === null) return;
    const revenue = Math.max(0, Math.round(Number(String(input).replace(/[^\d.]/g, "")) || 0));
    if (!revenue) { setMsg("Target number sahi nahi"); return; }
    const scale = n.revenue ? revenue / n.revenue : 1;
    await setDoc(doc(db, "users", workspaceUid, "targets", n.month), {
      id: n.month, month: n.month, revenue, expenseLimit: n.expenseLimit, savingTarget: Math.max(0, revenue - n.expenseLimit),
      leadTarget: Math.ceil(n.leadTarget * scale), clientTarget: n.clientTarget,
      serviceMix: n.serviceMix.map((x: any) => ({ ...x, amount: Math.round(x.amount * scale), units: x.unitPrice ? Math.max(1, Math.ceil((x.amount * scale) / x.unitPrice)) : 0 })),
      approved: true, approvedAt: new Date().toISOString(), source: "ai", createdAt: new Date().toISOString(),
    });
    await reload({ silent: true });
    setMsg(`✓ ${monthLabel(n.month)} ka target Rs ${fmtMoney(revenue)} set — Budget & Growth mein edit kar sakte hain.`);
  };

  const exportMonth = (a: MonthSnapshot) => {
    const ac = a.accountability;
    const tr = (k: string, v: string) => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right"><b>${escapeHtml(v)}</b></td></tr>`;
    printElementHTML(`
      <h2>Accountability</h2>
      <table>${tr("Target", ac.target ? rs(ac.target) : "—")}${tr("Actual income", rs(ac.income))}${tr("Business expense", rs(ac.businessExpense))}${tr("Personal / misc expense", rs(ac.personalExpense))}${tr("Net saving", rs(ac.netSaving))}${tr("Saving margin", ac.savingMargin + "%")}${tr("Target achievement", ac.achievementPct === null ? "—" : ac.achievementPct + "%")}${tr("Outstanding (carried forward)", rs(ac.outstanding))}${tr("Marketing spend", rs(ac.marketingSpend))}</table>
      <h3>Services</h3><table><thead><tr><th>Service</th><th>Category</th><th>Revenue</th></tr></thead><tbody>${a.services.map((s) => `<tr><td>${escapeHtml(s.line)}</td><td>${escapeHtml(s.category)}</td><td>${rs(s.revenue)}</td></tr>`).join("") || "<tr><td colspan=3>—</td></tr>"}</tbody></table>
      <h3>Expenses by category</h3><table><thead><tr><th>Category</th><th>Type</th><th>Amount</th></tr></thead><tbody>${a.expenseByCategory.map((e) => `<tr><td>${escapeHtml(e.category)}</td><td>${e.scope === "personal" ? "Personal" : "Business"}</td><td>${rs(e.amount)}</td></tr>`).join("") || "<tr><td colspan=3>—</td></tr>"}</tbody></table>
      <h3>Leads</h3><table>${tr("New leads", String(a.leads.newInMonth))}${tr("Converted", String(a.leads.converted))}${tr("Conversion", a.leads.conversionPct + "%")}</table>
      <h3>AI recommendations</h3><ul>${a.ai.insights.filter((i) => i.action).map((i) => `<li><b>${escapeHtml(i.title)}</b> — ${escapeHtml(i.action || "")}</li>`).join("")}</ul>
    `, { title: `Monthly Closing — ${monthLabel(a.month)}`, subtitle: `Closed ${new Date(a.closedAt).toLocaleString("en-PK")} by ${a.closedBy}` });
  };

  const downloadJSON = (a: MonthSnapshot) => {
    const blob = new Blob([JSON.stringify(a, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `DigitalTarget_${a.month}_archive.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const deleteRecord = async (col: string, id: string, label: string) => {
    if (!confirm(`"${label}" database se hamesha ke liye delete karein? Ye wapas nahi hoga.`)) return;
    try { await removeItem(col, id); setMsg(`✓ ${label} delete ho gaya`); } catch { /* reported by DataContext */ }
  };
  const exists = (col: string, id: string) => (data as any)[col]?.some((x: any) => x.id === id);

  return (
    <>
      <section className="card">
        <div className="sectionHead">
          <div>
            <h2 style={{ margin: 0 }}>🗄 Administrator History &amp; Monthly Closing</h2>
            <div className="small">Har mahine ka mukammal snapshot. Closing sirf mukammal kaam archive karti hai — clients, accounts, baqaya raqam, services, team aur settings kabhi reset nahi hote.</div>
          </div>
        </div>
        {msg && <div className="small waWebNote" onClick={() => setMsg("")} style={{ marginTop: 8 }}>{msg}</div>}

        {/* ---- Close a month */}
        <div className="closeCard">
          <div className="closeHead">
            <b>Month close karein</b>
            <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
              {candidates.length === 0 && <option value="">Koi open mahina nahi</option>}
              {candidates.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
          {preview && (
            <>
              <div className="moneyStrip">
                <div><span>Income</span><b>{rs(preview.summary.income)}</b></div>
                <div><span>Business kharcha</span><b>{rs(preview.summary.businessExpense)}</b></div>
                <div><span>Personal / misc</span><b>{rs(preview.summary.personalExpense)}</b></div>
                <div><span>Net saving</span><b className={preview.summary.netSaving < 0 ? "neg" : "pos"}>{rs(preview.summary.netSaving)}</b><em>{preview.summary.savingMargin}% margin</em></div>
                <div><span>Target</span><b>{preview.accountability.target ? `${preview.accountability.achievementPct}%` : "—"}</b><em>{preview.accountability.target ? `of ${rs(preview.accountability.target)}` : "set nahi"}</em></div>
                <div><span>Carry forward</span><b>{rs(preview.outstanding.receivable)}</b><em>{preview.outstanding.invoices.length} unpaid invoices</em></div>
              </div>
              <div className="closeLists">
                <div>
                  <div className="lpHead">Archive honge</div>
                  <ul className="small">
                    <li>{preview.counts.archivedInvoices} paid invoices</li>
                    <li>{preview.counts.archivedProjects} completed projects</li>
                    <li>{preview.counts.archivedAssignments} completed tasks</li>
                    <li>{preview.counts.archivedSchedule} done schedule items</li>
                  </ul>
                </div>
                <div>
                  <div className="lpHead">Waise hi rahenge (reset nahi)</div>
                  <ul className="small">
                    <li>{data.clients.length} clients, {data.wallets.length} accounts (balances same)</li>
                    <li>Baqaya: {rs(preview.outstanding.receivable)} receivable, {rs(preview.outstanding.teamDues)} team dues</li>
                    <li>Services, team, settings, leads, accounting ledger</li>
                  </ul>
                </div>
                <div>
                  <div className="lpHead">Check</div>
                  <ul className="small">{checks.map((c, i) => <li key={i} className={c.level === "warn" ? "warnText" : ""}>{c.level === "warn" ? "⚠ " : ""}{c.text}</li>)}{checks.length === 0 && <li>Sab theek</li>}</ul>
                </div>
              </div>
              <button className="btnSolid" onClick={doClose} disabled={!!busy}>{busy === "close" ? progress || "Closing…" : `🔒 ${monthLabel(month)} close karein`}</button>
            </>
          )}
        </div>
      </section>

      {/* ---- Closed months */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Closed months</h2>
        {archives === null ? <div className="small">Loading…</div> : archives.length === 0 ? <div className="small">Abhi koi mahina close nahi hua.</div> : (
          <div className="archiveGrid">
            {archives.map((a) => (
              <div key={a.month} className={`archiveCard ${a.status}`}>
                <div className="archiveHead">
                  <b>{monthLabel(a.month)}</b>
                  <span className={`badge ${a.status === "closed" ? "ok" : "warn"}`}>{a.status === "closed" ? "Closed" : "Adhoori"}</span>
                </div>
                <div className="lpRow"><span>Income</span><b>{rs(a.accountability.income)}</b></div>
                <div className="lpRow"><span>Net saving</span><b>{rs(a.accountability.netSaving)}</b></div>
                <div className="lpRow"><span>Target</span><b>{a.accountability.achievementPct === null ? "—" : `${a.accountability.achievementPct}%`}</b></div>
                <div className="lpRow"><span>Outstanding</span><b>{rs(a.accountability.outstanding)}</b></div>
                <div className="small">{new Date(a.closedAt).toLocaleDateString("en-PK")} • {a.closedBy}</div>
                <div className="rowActions">
                  {a.status === "closing" && <button className="btnSolid" onClick={() => retry(a)} disabled={!!busy}>Retry</button>}
                  <button className="btnSmall" onClick={() => { setOpen(a); setSection("Accountability"); }}>Open</button>
                  <button className="btnSmall" onClick={() => exportMonth(a)}>Report</button>
                  <button className="btnSmall" onClick={() => downloadJSON(a)}>JSON</button>
                  <button className="btnSmall" onClick={() => reopen(a)} disabled={!!busy}>Reopen</button>
                  <button className="btnDanger" onClick={() => remove(a)} disabled={!!busy}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- Month detail */}
      {open && (
        <div className="dtModalBackdrop" onClick={() => setOpen(null)}>
          <div className="dtModal wide historyModal" onClick={(e) => e.stopPropagation()}>
            <div className="dtModalHead">
              <div><b style={{ fontSize: 18 }}>{monthLabel(open.month)}</b><div className="small">Closed {new Date(open.closedAt).toLocaleString("en-PK")} • {open.closedBy}</div></div>
              <div className="rowActions">
                <button className="btnSmall" onClick={() => exportMonth(open)}>Report</button>
                <button className="btnSmall" onClick={() => setOpen(null)}>✕</button>
              </div>
            </div>
            <div className="segmented historyTabs">{SECTIONS.map((s) => <button key={s} className={section === s ? "on" : ""} onClick={() => setSection(s)}>{s}</button>)}</div>
            <div className="historyBody">
              {section === "Accountability" && (
                <div className="moneyStrip">
                  <div><span>Target</span><b>{open.accountability.target ? rs(open.accountability.target) : "—"}</b></div>
                  <div><span>Actual income</span><b>{rs(open.accountability.income)}</b></div>
                  <div><span>Business expense</span><b>{rs(open.accountability.businessExpense)}</b></div>
                  <div><span>Personal expense</span><b>{rs(open.accountability.personalExpense)}</b></div>
                  <div><span>Net saving</span><b className={open.accountability.netSaving < 0 ? "neg" : "pos"}>{rs(open.accountability.netSaving)}</b><em>{open.accountability.savingMargin}% margin</em></div>
                  <div><span>Achievement</span><b>{open.accountability.achievementPct === null ? "—" : `${open.accountability.achievementPct}%`}</b></div>
                  <div><span>Outstanding</span><b>{rs(open.accountability.outstanding)}</b></div>
                  <div><span>Marketing spend</span><b>{rs(open.accountability.marketingSpend)}</b></div>
                  <div><span>Team dues</span><b>{rs(open.outstanding.teamDues)}</b></div>
                  {open.wallets.map((w) => <div key={w.id}><span>{w.name} (close par)</span><b>{rs(w.balance)}</b></div>)}
                </div>
              )}
              {section === "Invoices" && (
                <Table head={["Invoice", "Client", "Date", "Category", "Total", "Paid", "Due", "Status", ""]} rows={open.invoices.rows.map((i: any) => [
                  i.number, i.client, i.date, i.category, rs(i.total), rs(i.paid), rs(i.due), i.status,
                  exists("invoices", i.id) && open.archived.invoices.includes(i.id) ? <button key="d" className="btnSmall" onClick={() => deleteRecord("invoices", i.id, i.number)}>Delete</button> : "",
                ])} note={open.invoices.truncated ? "Pehli 1500 rows" : ""} />
              )}
              {section === "Income" && <Table head={["Date", "Category", "Client", "Amount", "Note"]} rows={open.income.rows.map((a: any) => [a.date, a.category, a.client, rs(a.amount), a.desc])} />}
              {section === "Expenses" && (
                <>
                  <Table head={["Category", "Type", "Amount"]} rows={open.expenseByCategory.map((e) => [e.category, e.scope === "personal" ? "Personal" : "Business", rs(e.amount)])} />
                  <Table head={["Date", "Category", "Type", "Amount", "Note"]} rows={open.expenses.rows.map((a: any) => [a.date, a.category, a.scope === "personal" ? "Personal" : "Business", rs(a.amount), a.desc])} />
                </>
              )}
              {section === "Clients" && <Table head={["Client", "Invoices", "Billed", "Received"]} rows={open.clients.map((c) => [c.name, String(c.invoices), rs(c.billed), rs(c.received)])} />}
              {section === "Services" && <Table head={["Service", "Category", "Invoices", "Revenue"]} rows={open.services.map((s) => [s.line, s.category, String(s.invoices), rs(s.revenue)])} />}
              {section === "Leads" && (
                <>
                  <div className="moneyStrip">
                    <div><span>New leads</span><b>{open.leads.newInMonth}</b></div>
                    <div><span>Converted</span><b>{open.leads.converted}</b></div>
                    <div><span>Lost</span><b>{open.leads.lost}</b></div>
                    <div><span>Conversion</span><b>{open.leads.conversionPct}%</b></div>
                  </div>
                  <div className="grid3" style={{ marginTop: 10 }}>
                    <Table head={["Status", "Leads"]} rows={Object.entries(open.leads.byStatus).map(([k, v]) => [k, String(v)])} />
                    <Table head={["Source", "Leads"]} rows={Object.entries(open.leads.bySource).map(([k, v]) => [k, String(v)])} />
                    <Table head={["Service", "Leads"]} rows={Object.entries(open.leads.byService).map(([k, v]) => [k, String(v)])} />
                  </div>
                  {open.campaigns?.length > 0 && <Table head={["Campaign", "Status", "Sent", "Replies"]} rows={open.campaigns.map((c: any) => [c.name, c.status, String(c.sent), String(c.replies)])} />}
                </>
              )}
              {section === "Projects & Tasks" && (
                <>
                  <Table head={["Completed project", "Client", "Budget", "End", ""]} rows={open.projects.completed.map((p: any) => [p.title, p.client, rs(p.budget), p.end,
                    exists("projects", p.id) && open.archived.projects.includes(p.id) ? <button key="d" className="btnSmall" onClick={() => deleteRecord("projects", p.id, p.title)}>Delete</button> : ""])} />
                  <Table head={["Task done", "Member", "Status", "Rate", ""]} rows={open.tasks.assignmentsDone.map((a: any) => [a.title, a.member, a.status, rs(a.rate),
                    exists("assignments", a.id) && open.archived.assignments.includes(a.id) ? <button key="d" className="btnSmall" onClick={() => deleteRecord("assignments", a.id, a.title)}>Delete</button> : ""])} />
                  <div className="small">Schedule: {open.tasks.scheduleDone} done • {open.tasks.schedulePending.length} pending (active workspace mein hi hain)</div>
                </>
              )}
              {section === "Team" && <Table head={["Member", "Role", "Tasks done", "Leads", "Converted"]} rows={open.team.map((t) => [t.name, t.role, String(t.tasksDone), String(t.leadsAssigned), String(t.leadsConverted)])} />}
              {section === "AI & Next month" && (
                <div className="grid2" style={{ alignItems: "start" }}>
                  <div>
                    <div className="lpHead">Is mahine ka AI analysis (health {open.ai.score}/100)</div>
                    <ul className="modList">
                      {open.ai.insights.map((i, k) => (
                        <li key={k} className={`sev-${i.severity}`}><span /><div><b>{i.title}</b>{i.action && <div className="modAction">→ {i.action}</div>}</div><span /></li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="lpHead">{monthLabel(open.ai.nextMonth.month)} — suggested plan</div>
                    <div className="moneyStrip">
                      <div><span>Revenue target</span><b>{rs(open.ai.nextMonth.revenue)}</b></div>
                      <div><span>Expense limit</span><b>{rs(open.ai.nextMonth.expenseLimit)}</b></div>
                      <div><span>Saving target</span><b>{rs(open.ai.nextMonth.savingTarget)}</b></div>
                      <div><span>Leads chahiye</span><b>{open.ai.nextMonth.leadTarget}</b></div>
                    </div>
                    <Table head={["Service", "Target", "Unit price", "Sales"]} rows={open.ai.nextMonth.serviceMix.slice(0, 12).map((x: any) => [x.line, rs(x.amount), x.unitPrice ? rs(x.unitPrice) : "—", String(x.units)])} />
                    <ul className="small">{open.ai.nextMonth.reasoning.map((r: string, k: number) => <li key={k}>{r}</li>)}</ul>
                    {can("finance.manage") && open.ai.nextMonth.month >= monthKey() && (
                      <button className="btnSolid" onClick={() => applyTarget(open)}>✓ {monthLabel(open.ai.nextMonth.month)} ka target set karein</button>
                    )}
                    {open.ai.nextMonth.month < monthKey() && <div className="small">Ye mahina guzar chuka: {monthLabel(shiftMonth(open.month, 1))}</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Table({ head, rows, note }: { head: string[]; rows: React.ReactNode[][]; note?: string }) {
  return (
    <div className="tablewrap" style={{ marginTop: 8 }}>
      <table>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={head.length} className="small">—</td></tr>}
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
        </tbody>
      </table>
      {note && <div className="small">{note}</div>}
    </div>
  );
}
