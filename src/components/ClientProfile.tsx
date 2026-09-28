import React, { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { fileToBase64, fmtMoney, todayISO } from "@/lib/db";
import { invoiceView, paymentsOf, statusClass } from "@/lib/invoice";
import { isExpense, isIncome } from "@/lib/finance";
import { leadPhones, normalizePhone, formatLocalPhone } from "@/lib/phone";
import { serviceById } from "@/lib/catalog";
import { navigate } from "@/lib/navigation";
import WhatsAppComposer from "./WhatsAppComposer";

const rs = (n: number) => `Rs ${fmtMoney(Math.round(Number(n) || 0))}`;
const TABS = ["Overview", "Ledger", "Invoices", "Payments", "Projects & Tasks", "Communication", "Follow-ups", "Notes"] as const;
type Tab = (typeof TABS)[number];

interface LedgerRow { date: string; type: string; ref: string; debit: number; credit: number; balance: number; note: string }

/**
 * Client CRM profile: everything about one client in one place, including
 * closed months (archived invoices / projects are still read here).
 */
export default function ClientProfile({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const { data, updateItem } = useData();
  const { can } = useAuth();
  const client = data.clients.find((c: any) => c.id === clientId);
  const [tab, setTab] = useState<Tab>("Overview");
  const [notes, setNotes] = useState<string>(client?.notes ?? client?.ref ?? "");
  const [msg, setMsg] = useState("");
  const [wa, setWa] = useState(false);

  const d = useMemo(() => {
    if (!client) return null;
    const invoices = data.invoices.filter((i: any) => i.clientId === clientId).map((inv: any) => ({ inv, v: invoiceView(inv) }))
      .sort((a: any, b: any) => String(b.v.date).localeCompare(String(a.v.date)));
    const projects = data.projects.filter((p: any) => p.clientId === clientId);
    const projectIds = new Set(projects.map((p: any) => p.id));
    const phones = leadPhones({ phone: client.phone, whatsapp: client.whatsapp });
    const leads = data.leads.filter((l: any) => l.id === client.leadId || leadPhones(l).some((p) => phones.includes(p)));
    const payments = invoices.flatMap((x: any) => paymentsOf(x.inv).map((p) => ({ ...p, invoice: x.v.number })))
      .sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
    const linkedAcc = new Set(payments.map((p: any) => p.accountingId).filter(Boolean));
    // Income rows for this client that are not invoice payments (advances, other receipts).
    const otherIncome = data.accounting.filter((a: any) => isIncome(a) && a.clientId === clientId && !linkedAcc.has(a.id) && a.category !== "Invoice Paid");
    const expenses = data.accounting.filter((a: any) => isExpense(a) && (a.clientId === clientId || (a.projectId && projectIds.has(a.projectId))));
    const billed = invoices.reduce((s: number, x: any) => s + x.v.grandTotal, 0);
    const paid = invoices.reduce((s: number, x: any) => s + x.v.paid, 0);
    const outstanding = invoices.reduce((s: number, x: any) => s + x.v.due, 0);
    const received = paid + otherIncome.reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0);
    const cost = expenses.reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0);
    const services = Array.from(new Set(invoices.flatMap((x: any) => x.v.items.map((it: any) => (it.service && serviceById(data.settings, it.service)?.line) || x.inv.category)).filter(Boolean)));
    const schedule = data.schedule.filter((s: any) => s.clientId === clientId || leads.some((l: any) => l.id === s.leadId))
      .sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
    const khata = data.khata.filter((k: any) => k.clientId === clientId);

    // Ledger: invoices are debits, payments credits; running balance = what the client owes.
    const rows: Omit<LedgerRow, "balance">[] = [
      ...invoices.map((x: any) => ({ date: x.v.date, type: "Invoice", ref: x.v.number, debit: x.v.grandTotal, credit: 0, note: x.inv.category || "" })),
      ...payments.map((p: any) => ({ date: p.date, type: "Payment", ref: p.invoice, debit: 0, credit: Number(p.amount) || 0, note: `${p.method || ""}${p.reference ? ` • ref ${p.reference}` : ""}` })),
      ...khata.map((k: any) => ({ date: k.date, type: k.type === "LENA" ? "Khata (lena)" : "Khata (dena)", ref: k.party || "", debit: k.type === "LENA" ? Number(k.amount) || 0 : 0, credit: k.type === "LENA" ? Number(k.paid) || 0 : 0, note: k.note || "" })),
    ].sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.type === "Invoice" ? -1 : 1));
    let bal = 0;
    const ledger: LedgerRow[] = rows.map((r) => { bal += r.debit - r.credit; return { ...r, balance: Math.round(bal * 100) / 100 }; });

    const comms = [
      ...invoices.flatMap((x: any) => (x.inv.waLog || []).map((w: any) => ({ at: w.at, text: `WhatsApp: ${String(w.type).replace(/_/g, " ")} (${x.v.number}, ${w.lang})`, by: w.by }))),
      ...leads.flatMap((l: any) => (l.history || []).filter((h: any) => ["message", "reply", "captured", "note", "status", "converted"].includes(h.type)).map((h: any) => ({ at: h.at, text: h.text, by: h.by }))),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at)));

    return { invoices, projects, leads, payments, otherIncome, expenses, billed, paid, outstanding, received, cost, services, schedule, ledger, comms,
      first: invoices[invoices.length - 1]?.v.date, last: invoices[0]?.v.date };
  }, [client, clientId, data]);

  if (!client || !d) return null;
  const canEdit = can("clients.manage");
  const phone = normalizePhone(client.whatsapp || client.phone);

  const saveNotes = async () => {
    await updateItem("clients", { ...client, notes, updatedAt: new Date().toISOString() });
    setMsg("✓ Notes save");
  };
  const setLogo = async (file?: File) => {
    try {
      const logo = await fileToBase64(file, 200 * 1024);
      if (logo) await updateItem("clients", { ...client, logo, updatedAt: new Date().toISOString() });
    } catch (e) { setMsg((e as Error).message); }
  };
  const followUps = d.schedule.filter((s: any) => !["Done", "Cancel", "Dismissed"].includes(s.status));
  const leadFollow = d.leads.filter((l: any) => l.followUpDate && !["Converted", "Lost", "Invalid"].includes(l.status));

  return (
    <div className="dtModalBackdrop" onClick={onClose}>
      <div className="dtModal wide clientProfile" onClick={(e) => e.stopPropagation()}>
        <div className="dtModalHead">
          <div className="cpHead">
            <label className="cpLogo" title={canEdit ? "Logo lagayein" : ""}>
              {client.logo?.data ? <img src={client.logo.data} alt="" /> : <span>{String(client.name || "?").slice(0, 2).toUpperCase()}</span>}
              {canEdit && <input type="file" accept="image/*" hidden onChange={(e) => setLogo(e.target.files?.[0])} />}
            </label>
            <div>
              <b style={{ fontSize: 18 }}>{client.name}</b>
              <div className="small">{[client.business, client.category].filter(Boolean).join(" • ")}</div>
              <div className="small">{[client.phone && `📞 ${client.phone}`, client.whatsapp && client.whatsapp !== client.phone && `WA ${client.whatsapp}`, client.email, client.address].filter(Boolean).join(" • ")}</div>
            </div>
          </div>
          <div className="rowActions">
            {phone && <button className="btnSmall" onClick={() => setWa(true)}>🟢 WhatsApp</button>}
            <button className="btnSmall" onClick={() => { onClose(); navigate({ tab: "invoices" }); }}>+ Invoice</button>
            <button className="btnSmall" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="segmented historyTabs">{TABS.map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}</div>

        <div className="historyBody">
          {tab === "Overview" && (
            <>
              <div className="moneyStrip">
                <div><span>Billed</span><b>{rs(d.billed)}</b></div>
                <div><span>Received</span><b>{rs(d.received)}</b></div>
                <div><span>Outstanding</span><b className={d.outstanding > 0 ? "neg" : "pos"}>{rs(d.outstanding)}</b></div>
                <div><span>Profit generated</span><b className={d.received - d.cost < 0 ? "neg" : "pos"}>{rs(d.received - d.cost)}</b><em>received − linked costs {rs(d.cost)}</em></div>
                <div><span>Invoices</span><b>{d.invoices.length}</b><em>{d.first ? `${d.first} → ${d.last}` : "—"}</em></div>
                <div><span>Projects</span><b>{d.projects.length}</b></div>
              </div>
              <div className="lpRow" style={{ marginTop: 10 }}><span>Services</span><b>{d.services.join(", ") || (Array.isArray(client.services) ? client.services.join(", ") : client.services) || "—"}</b></div>
              <div className="lpRow"><span>Leads / WhatsApp</span><b>{d.leads.map((l: any) => `${l.name} (${l.status})`).join(", ") || "—"}</b></div>
              <div className="lpRow"><span>Status</span><b>{client.status || "Active"}</b></div>
            </>
          )}

          {tab === "Ledger" && (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Ref</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th><th>Note</th></tr></thead>
                <tbody>
                  {d.ledger.map((r, i) => (
                    <tr key={i}><td>{r.date}</td><td>{r.type}</td><td>{r.ref}</td><td className="num">{r.debit ? rs(r.debit) : ""}</td><td className="num">{r.credit ? rs(r.credit) : ""}</td><td className="num"><b>{rs(r.balance)}</b></td><td className="small">{r.note}</td></tr>
                  ))}
                  {d.ledger.length === 0 && <tr><td colSpan={7} className="small">Koi entry nahi.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === "Invoices" && (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Invoice</th><th>Date</th><th>Service</th><th>Period</th><th className="num">Total</th><th className="num">Due</th><th>Status</th></tr></thead>
                <tbody>
                  {d.invoices.map(({ inv, v }: any) => (
                    <tr key={inv.id}><td>{v.number}{inv.archivedMonth ? <div className="small">🔒 {inv.archivedMonth}</div> : null}</td><td>{v.date}</td><td>{inv.category || "—"}</td><td className="small">{inv.endDate ? `${inv.startDate} → ${inv.endDate}` : "—"}</td><td className="num">{rs(v.grandTotal)}</td><td className="num">{rs(v.due)}</td><td><span className={`badge ${statusClass(v.status)}`}>{v.status}</span></td></tr>
                  ))}
                  {d.invoices.length === 0 && <tr><td colSpan={7} className="small">Koi invoice nahi.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === "Payments" && (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Date</th><th>Invoice</th><th className="num">Amount</th><th>Method</th><th>Account</th><th>Reference</th></tr></thead>
                <tbody>
                  {d.payments.map((p: any, i: number) => (
                    <tr key={i}><td>{p.date}</td><td>{p.invoice}</td><td className="num">{rs(p.amount)}</td><td>{p.method}</td><td>{data.wallets.find((w: any) => w.id === p.walletId)?.name || "—"}</td><td>{p.reference || "—"}</td></tr>
                  ))}
                  {d.otherIncome.map((a: any) => <tr key={a.id}><td>{a.date}</td><td>{a.category}</td><td className="num">{rs(a.amount)}</td><td>—</td><td>{data.wallets.find((w: any) => w.id === a.walletId)?.name || "—"}</td><td className="small">{a.desc}</td></tr>)}
                  {d.payments.length + d.otherIncome.length === 0 && <tr><td colSpan={6} className="small">Koi payment nahi.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === "Projects & Tasks" && (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Project</th><th>Service</th><th>Start → End</th><th className="num">Budget</th><th>Status</th></tr></thead>
                <tbody>
                  {d.projects.map((p: any) => <tr key={p.id}><td>{p.title}</td><td>{p.category || "—"}</td><td className="small">{String(p.start || "").slice(0, 10)} → {String(p.end || "").slice(0, 10)}</td><td className="num">{rs(p.budget)}</td><td><span className="badge">{p.status || "Running"}</span></td></tr>)}
                  {d.projects.length === 0 && <tr><td colSpan={5} className="small">Koi project nahi.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === "Communication" && (
            <ul className="lpTimeline">
              {d.comms.map((c, i) => <li key={i}><span className="lpIcon">💬</span><div><div>{c.text}</div><div className="small">{new Date(c.at).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}{c.by ? ` • ${c.by}` : ""}</div></div></li>)}
              {d.comms.length === 0 && <li className="small">Abhi koi record nahi (WhatsApp messages invoice / lead se bhejne par yahan aate hain).</li>}
            </ul>
          )}

          {tab === "Follow-ups" && (
            <>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Date</th><th>Type</th><th>Task</th><th>Status</th></tr></thead>
                  <tbody>
                    {d.schedule.map((s: any) => <tr key={s.id}><td>{s.date}{s.time ? ` ${s.time}` : ""}</td><td>{s.category}</td><td>{s.task}</td><td><span className={`badge ${s.status === "Done" ? "ok" : "warn"}`}>{s.status}</span></td></tr>)}
                    {d.schedule.length === 0 && <tr><td colSpan={4} className="small">Koi schedule / meeting nahi.</td></tr>}
                  </tbody>
                </table>
              </div>
              {leadFollow.length > 0 && <div className="small" style={{ marginTop: 6 }}>Lead follow-ups: {leadFollow.map((l: any) => `${l.name} (${l.followUpDate})`).join(", ")}</div>}
              <div className="small">Pending: {followUps.length} • aaj: {followUps.filter((s: any) => s.date === todayISO()).length}</div>
            </>
          )}

          {tab === "Notes" && (
            <>
              <textarea rows={8} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit} placeholder="Client ke baare mein notes, pasand / na-pasand, deal terms…" />
              {canEdit && <button className="btnSolid" style={{ marginTop: 8 }} onClick={saveNotes}>Save notes</button>}
              {msg && <span className="small" style={{ marginLeft: 8 }}>{msg}</span>}
            </>
          )}
        </div>

        {wa && (
          <WhatsAppComposer
            phone={client.whatsapp || client.phone || ""}
            types={d.outstanding > 0 ? ["payment_reminder", "overdue_reminder", "lead_followup"] : ["lead_followup", "renewal_reminder"]}
            vars={{ name: client.name, balance: fmtMoney(d.outstanding), invoice: d.invoices.find((x: any) => x.v.due > 0)?.v.number || "", service: d.services[0] || "" }}
            title={`WhatsApp — ${client.name}`}
            onClose={() => setWa(false)}
            onSent={() => setMsg(`✓ ${formatLocalPhone(phone)} par message khul gaya`)}
          />
        )}
      </div>
    </div>
  );
}
