import React, { useMemo, useState, useRef } from "react";
import { useData } from "@/contexts/DataContext";
import { uid, todayISO, fmtMoney } from "@/lib/db";
import { saveReportImage, printElementHTML } from "@/lib/exportUtils";
import { leadPhones, normalizePhone, waLink } from "@/lib/phone";
import { LEAD_STATUSES } from "@/lib/leads";
import { linesOf } from "@/lib/catalog";
import { navigate } from "@/lib/navigation";
import { extensionVersion } from "@/lib/waExtension";
import { LEAD_TYPE_LABEL, LeadType, analyzeLead, applyAnalysis, levelClass, withHistory } from "@/lib/leadAnalysis";
import LeadProfile from "@/components/LeadProfile";
import { useAuth } from "@/contexts/AuthContext";
import ModuleInsights from "@/components/ModuleInsights";
import { downloadXlsx } from "@/lib/xlsx";
import { leadsSheets } from "@/lib/leadExport";

export default function LeadsTab() {
  const { data, addItem, removeItem, updateItem } = useData();
  const { can, user } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [category, setCategory] = useState("Restaurant");
  const [serviceType, setServiceType] = useState("Digital Marketing");
  const [software, setSoftware] = useState("POS Software");
  const [plan, setPlan] = useState("Undecided");
  const [status, setStatus] = useState("New");
  const [source, setSource] = useState("WhatsApp");
  const [referralBy, setReferralBy] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [notes, setNotes] = useState("");
  const [filterCat, setFilterCat] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterService, setFilterService] = useState("ALL");
  const [editId, setEditId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [range, setRange] = useState<"all" | "3" | "7" | "15" | "month" | "custom">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filterType, setFilterType] = useState<"ALL" | LeadType>("ALL");
  const [filterLevel, setFilterLevel] = useState("ALL");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [profileId, setProfileId] = useState<string | null>(null);
  const [aiRun, setAiRun] = useState<{ done: number; total: number } | null>(null);
  const [shown, setShown] = useState(100);

  const categories = ["Restaurant","Doctor/Clinic","School/Academy","Mechanic/Workshop","Retail/Shop","Salon/Beauty","Gym/Fitness","Real Estate","E-commerce","Other"];
  // Service categories come from Settings → Services & Categories; older lead values stay selectable.
  const serviceTypes = Array.from(new Set([...linesOf(data.settings), ...data.leads.map((l: any) => l.serviceType).filter(Boolean)]));
  const softwareOptions = ["POS Software","Management Software","Automation Software","Billing/Invoicing","Custom Solution","None","Other"];
  const planOptions = ["Monthly","Yearly","Lifetime","One-time","Undecided"];
  const statusOptions = LEAD_STATUSES;
  const sourceOptions = ["WhatsApp","Facebook","Instagram","TikTok","Google","Referral","Walk-in","Website","Cold Call","Other"];

  const clearForm = () => {
    setEditId(null);
    setName(""); setPhone(""); setWhatsapp(""); setNotes(""); setReferralBy("");
    setMeetingDate(""); setFollowUpDate("");
    setStatus("New"); setPlan("Undecided");
  };

  const handleSave = async () => {
    if (!name.trim()) { alert("Lead name required"); return; }
    const payload = {
      name: name.trim(), phone, whatsapp: whatsapp || phone,
      phoneE164: normalizePhone(whatsapp || phone),
      category, serviceType, software, plan, status, source, referralBy: referralBy.trim(),
      meetingDate, followUpDate, notes,
    };
    // Duplicate check on phone / WhatsApp number (normalised, so 0345… and +92345… match).
    const numbers = leadPhones(payload);
    const dup = numbers.length
      ? data.leads.find(l => l.id !== editId && leadPhones(l).some(n => numbers.includes(n)))
      : null;
    if (dup && !confirm(`Yeh number pehle se lead "${dup.name}" (${dup.status || "New"}) mein mojood hai.\nPhir bhi save karein?`)) return;
    if (editId) {
      const old = data.leads.find(l => l.id === editId);
      // Keep the original creation date (it used to be overwritten on every edit).
      if (old) {
        let next: any = { ...old, ...payload, date: old.date || todayISO(), updatedAt: new Date().toISOString() };
        if (old.status !== payload.status) next = withHistory(next, { type: "status", text: `${old.status || "New"} → ${payload.status}`, by: user?.email || "" });
        await updateItem("leads", next);
      }
      alert("Lead updated ✅");
    } else {
      await addItem("leads", withHistory({ id: uid("LD"), ...payload, date: todayISO(), createdAt: new Date().toISOString() }, { type: "created", text: `Lead bani (${payload.source})`, by: user?.email || "" }));
    }
    setFormOpen(false);
    clearForm();
  };

  const handleEdit = (l: any) => {
    setEditId(l.id);
    setName(l.name || ""); setPhone(l.phone || ""); setWhatsapp(l.whatsapp || l.phone || "");
    setCategory(l.category || "Restaurant"); setServiceType(l.serviceType || "Digital Marketing");
    setSoftware(l.software || "POS Software"); setPlan(l.plan || "Undecided");
    setStatus(l.status || "New"); setSource(l.source || "WhatsApp");
    setReferralBy(l.referralBy || ""); setMeetingDate(l.meetingDate || "");
    setFollowUpDate(l.followUpDate || ""); setNotes(l.notes || "");
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Explicit status picker (the old "Status" button cycled through statuses,
  // so one extra click could mark a lead Converted or Lost).
  const changeStatus = async (l: any, next: string) => {
    if (next === l.status) return;
    await updateItem("leads", withHistory({ ...l, status: next, updatedAt: new Date().toISOString() }, { type: next === "Converted" ? "converted" : "status", text: `${l.status || "New"} → ${next}`, by: user?.email || "" }));
  };

  const convertToClient = async (l: any) => {
    if (data.clients.some(c => c.phone === l.phone && c.name === l.name)) { alert("Client already exists"); return; }
    const clientId = uid("C");
    await addItem("clients", { id: clientId, name: l.name, phone: l.phone, whatsapp: l.whatsapp || l.phone, ref: "Lead: " + l.category + " - " + (l.serviceType || l.software), status: "Active", leadId: l.id, services: l.serviceType ? [l.serviceType] : [], createdAt: new Date().toISOString() });
    await updateItem("leads", withHistory({ ...l, status: "Converted", clientId }, { type: "converted", text: "Client ban gaya", by: user?.email || "" }));
    alert("Lead converted to Client ✅");
  };

  const sendWhatsApp = (l: any) => {
    const msg = `Assalam o Alaikum ${l.name},\nDigital Target se baat ho rahi thi ${l.serviceType || l.software} ke baare mein.\nKya aap interested hain? Hum aapko demo de sakte hain.\nShukriya!`;
    const link = waLink(l.whatsapp || l.phone, msg);
    if (!link) { alert("Is lead ka phone number sahi nahi hai."); return; }
    window.open(link, "_blank");
  };

  // Date window for the list (lead date, else created time).
  const leadDay = (l: any) => String(l.date || l.createdAt || "").slice(0, 10);
  const window_ = useMemo(() => {
    const t = new Date(`${todayISO()}T12:00:00`);
    const back = (n: number) => new Date(t.getTime() - (n - 1) * 864e5).toISOString().slice(0, 10);
    if (range === "3" || range === "7" || range === "15") return { from: back(Number(range)), to: todayISO() };
    if (range === "month") return { from: todayISO().slice(0, 8) + "01", to: todayISO() };
    if (range === "custom") return { from: from || "0000", to: to || "9999" };
    return null;
  }, [range, from, to]);
  const filtered = data.leads.filter(l => {
    if (window_) { const d = leadDay(l); if (!d || d < window_.from || d > window_.to) return false; }
    if (filterCat !== "ALL" && l.category !== filterCat) return false;
    if (filterStatus !== "ALL" && l.status !== filterStatus) return false;
    if (filterService !== "ALL" && l.serviceType !== filterService) return false;
    if (filterType !== "ALL" && (l.leadType || l.ai?.leadType) !== filterType) return false;
    if (filterLevel !== "ALL" && l.ai?.level !== filterLevel) return false;
    if (q && !`${l.name} ${l.phone} ${l.whatsapp} ${l.notes || ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }).sort((a: any, b: any) => (leadDay(b) + (b.createdAt || "")).localeCompare(leadDay(a) + (a.createdAt || "")));

  // ---------- selection & bulk actions ----------
  const selectedLeads = filtered.filter((l: any) => selected.has(l.id));
  const allShownSelected = filtered.length > 0 && filtered.every((l: any) => selected.has(l.id));
  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectAll = () => setSelected(new Set(filtered.map((l: any) => l.id)));
  const clearSel = () => setSelected(new Set());

  const bulkDelete = async () => {
    const list = data.leads.filter((l: any) => selected.has(l.id));
    if (!list.length) return;
    if (!confirm(`${list.length} leads hamesha ke liye delete karein?\n\n${list.slice(0, 8).map((l: any) => "• " + l.name).join("\n")}${list.length > 8 ? "\n…" : ""}\n\nYe wapas nahi ho sakta.`)) return;
    if (list.length >= 10 && prompt(`Tasdeeq ke liye ${list.length} likhein`) !== String(list.length)) return;
    for (const l of list) await removeItem("leads", l.id);
    clearSel();
  };

  /** AI analysis for the selected leads (or everything in the current filter). */
  const runAI = async (list: any[]) => {
    if (!list.length) return;
    setAiRun({ done: 0, total: list.length });
    let i = 0;
    for (const l of list) {
      try { await updateItem("leads", applyAnalysis(l, analyzeLead(l, data.settings), { by: user?.email || "" })); } catch { /* keep going */ }
      setAiRun({ done: ++i, total: list.length });
    }
    setTimeout(() => setAiRun(null), 2500);
  };

  const toCampaign = () => navigate({ tab: "whatsapp", view: "campaign", leadIds: selectedLeads.map((l: any) => l.id) });

  const total = data.leads.length;
  const interested = data.leads.filter(l => ["Interested","Demo Given","Meeting Scheduled","Negotiation","Qualified","Proposal"].includes(l.status)).length;
  const converted = data.leads.filter(l => l.status === "Converted").length;
  const meetingsToday = data.leads.filter(l => l.meetingDate === todayISO()).length;
  const followDue = data.leads.filter((l: any) => l.followUpDate && l.followUpDate <= todayISO() && !["Converted", "Lost", "Invalid"].includes(l.status)).length;
  const hot = data.leads.filter((l: any) => l.ai?.level === "Hot" && !["Converted", "Lost", "Invalid"].includes(l.status)).length;

  const sectionRef = useRef<HTMLDivElement>(null);

  // Exports use the selected leads when some are ticked, otherwise the current filter.
  const exportList = selectedLeads.length ? selectedLeads : filtered;
  const lvl = (l: any) => (l.ai?.level === "Hot" ? "High" : l.ai?.level === "Warm" ? "Medium" : l.ai?.level === "Cold" ? "Low" : "—");
  const buildLeadsHTML = () => {
    let rows = "";
    exportList.slice().reverse().forEach(l => {
      rows += `<tr>
        <td><b>${l.name}</b></td>
        <td>${l.phone||""}<div style="font-size:10px;color:#666">WA: ${l.whatsapp||l.phone||""}</div></td>
        <td>${l.category||""}</td>
        <td>${l.serviceType||l.software||""}</td>
        <td>${l.status}</td>
        <td>${lvl(l)}${typeof l.ai?.interest === "number" ? `<div style="font-size:10px;color:#666">${l.ai.interest}%</div>` : ""}</td>
        <td>${l.source||""}${l.referralBy ? `<div style="font-size:10px;color:#666">By: ${l.referralBy}</div>` : ""}</td>
        <td>${l.meetingDate||"—"}</td>
        <td>${l.followUpDate||"—"}${l.ai?.nextAction ? `<div style="font-size:10px;color:#666">${l.ai.nextAction}</div>` : ""}</td>
        <td>${l.date||""}</td>
      </tr>`;
    });
    const html = `
      <div style="padding:20px">
        <div style="display:flex;gap:12px;margin-bottom:16px">
          <div class="card" style="flex:1;text-align:center"><div style="font-size:11px;color:#888">Total</div><div style="font-size:22px;font-weight:900">${total}</div></div>
          <div class="card" style="flex:1;text-align:center"><div style="font-size:11px;color:#888">Active Pipeline</div><div style="font-size:22px;font-weight:900">${interested}</div></div>
          <div class="card" style="flex:1;text-align:center"><div style="font-size:11px;color:#888">Converted</div><div style="font-size:22px;font-weight:900">${converted}</div></div>
          <div class="card" style="flex:1;text-align:center"><div style="font-size:11px;color:#888">Meetings Today</div><div style="font-size:22px;font-weight:900">${meetingsToday}</div></div>
        </div>
        <table><thead><tr><th>Name</th><th>Phone</th><th>Category</th><th>Service</th><th>Status</th><th>Interest</th><th>Source</th><th>Meeting</th><th>Follow-up / Next action</th><th>Added</th></tr></thead><tbody>${rows}</tbody></table>
      </div>`;
    return html;
  };
  const leadsReport = { title: "Leads Report", subtitle: `${exportList.length} leads${selectedLeads.length ? " (selected)" : ""}`, landscape: true, filename: `Leads_Report_${todayISO()}` };
  const exportLeadsExcel = () => downloadXlsx(`Leads_${todayISO()}`, leadsSheets(exportList));
  const exportLeadsPDF = () => printElementHTML(buildLeadsHTML(), leadsReport);

  const exportLeadsImage = (fmt: "png"|"jpg") => {
    saveReportImage(buildLeadsHTML(), fmt, leadsReport);
  };

  return (
    <>
      <ModuleInsights module="leads" />
    <section className="card" ref={sectionRef}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>Lead Management {editId && <span className="badge warn">Editing</span>}</h2>
          <div className="small">Marketing leads, meetings, follow-ups aur referrals manage karein.</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btnSmall" onClick={exportLeadsExcel} title="Excel file (.xlsx) — selected leads, warna current filter">Excel</button>
          <button className="btnSmall" onClick={exportLeadsPDF} title="Branded PDF — selected leads, warna current filter">PDF</button>
          <button className="btnSmall" onClick={() => exportLeadsImage("png")}>PNG</button>
          <button className="btnSmall" onClick={() => exportLeadsImage("jpg")}>JPG</button>
        </div>
      </div>

      <div className="kpis kpis5" style={{ marginTop: 10 }}>
        <div className="kpi"><div className="t">Total Leads</div><div className="v">{total}</div></div>
        <div className="kpi"><div className="t">Active Pipeline</div><div className="v">{interested}</div></div>
        <div className="kpi"><div className="t">Hot (AI)</div><div className="v">{hot}</div></div>
        <div className="kpi"><div className="t">Follow-ups due</div><div className="v">{followDue}</div></div>
        <div className="kpi"><div className="t">Converted</div><div className="v">{converted}</div></div>
      </div>

      <div className="rowActions" style={{ marginTop: 10 }}>
        {can("leads.create") && <button className="btnSolid" onClick={() => { if (formOpen && !editId) setFormOpen(false); else { clearForm(); setFormOpen(true); } }}>{formOpen && !editId ? "✕ Form band karein" : "+ Add Lead"}</button>}
      </div>

      {formOpen && (<>
      <hr />
      <div className="grid3">
        <div><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ali Khan" /></div>
        <div><label>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xxxxxxxxx" /></div>
        <div><label>WhatsApp # (if different)</label><input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="auto = phone" /></div>
      </div>
      <div className="grid2">
        <div><label>Business Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div><label>Service Category</label>
          <select value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
            {serviceTypes.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="grid3">
        <div><label>Software (if applicable)</label>
          <select value={software} onChange={(e) => setSoftware(e.target.value)}>
            {softwareOptions.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div><label>Plan Type</label>
          <select value={plan} onChange={(e) => setPlan(e.target.value)}>
            {planOptions.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div><label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {statusOptions.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="grid3">
        <div><label>Source</label>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {sourceOptions.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div><label>Referred By (if any)</label>
          <input value={referralBy} onChange={(e) => setReferralBy(e.target.value)} placeholder="e.g. Mr. Ahmed" />
        </div>
        <div><label>Meeting Date</label>
          <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} />
        </div>
      </div>
      <div className="grid2">
        <div><label>Follow-up Date</label>
          <input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
        </div>
        <div><label>Confirmation Status</label>
          <input value={status === "Converted" ? "✅ Confirmed" : status === "Meeting Scheduled" ? "📅 Meeting set" : status === "Lost" ? "❌ Lost" : "⏳ In progress"} readOnly />
        </div>
      </div>
      <div><label>Notes / Follow-up Details</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="meeting notes, requirements, budget..." /></div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <button className="btnSolid" onClick={handleSave}>{editId ? "Update Lead" : "Add Lead"}</button>
        <button className="btnDanger" onClick={() => { clearForm(); setFormOpen(false); }}>{editId ? "Cancel Edit" : "Close"}</button>
      </div>
      </>)}

      <hr />
      <div className="leadFilters">
        <div className="segmented" role="tablist" aria-label="Date range">
          {([["all", "Sab"], ["3", "3 din"], ["7", "7 din"], ["15", "15 din"], ["month", "Is mahine"], ["custom", "Custom"]] as const).map(([k, l]) => (
            <button key={k} className={range === k ? "on" : ""} onClick={() => { setRange(k); setShown(100); }}>{l}</button>
          ))}
        </div>
        {range === "custom" && (
          <div className="rowActions">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <span className="small">→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </div>
        )}
        <input className="leadSearch" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Naam, number ya chat mein dhoondein…" />
      </div>
      <div className="leadFilterGrid">
        <select value={filterService} onChange={(e) => setFilterService(e.target.value)} aria-label="Service">
          <option value="ALL">Sab services</option>
          {serviceTypes.map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} aria-label="Status">
          <option value="ALL">Sab status</option>
          {statusOptions.map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value as typeof filterType)} aria-label="Lead type">
          <option value="ALL">Sab lead types</option>
          {(Object.keys(LEAD_TYPE_LABEL) as LeadType[]).map((k) => <option key={k} value={k}>{LEAD_TYPE_LABEL[k]}</option>)}
        </select>
        <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)} aria-label="Interest">
          <option value="ALL">Sab interest</option>
          <option>Hot</option><option>Warm</option><option>Cold</option>
        </select>
        <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} aria-label="Business type">
          <option value="ALL">Sab business types</option>
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      <div className="selBar">
        <label className="permItem" style={{ margin: 0 }}>
          <input type="checkbox" checked={allShownSelected} onChange={(e) => (e.target.checked ? selectAll() : clearSel())} aria-label="Select all" />
          <span>{selected.size ? `${selectedLeads.length} selected` : `Select all (${filtered.length})`}</span>
        </label>
        {selected.size > 0 && <button className="btnSmall" onClick={clearSel}>Clear selection</button>}
        {can("leads.edit") && <button className="btnSmall" onClick={() => runAI(selectedLeads.length ? selectedLeads : filtered)} disabled={!!aiRun}>✨ AI analyze {selectedLeads.length ? `(${selectedLeads.length})` : `sab (${filtered.length})`}</button>}
        {can("campaigns.manage") && selectedLeads.length > 0 && <button className="btnSolid" onClick={toCampaign}>📣 Message Center ({selectedLeads.length})</button>}
        {can("leads.delete") && selectedLeads.length > 0 && <button className="btnDanger" onClick={bulkDelete}>🗑 Delete ({selectedLeads.length})</button>}
        {aiRun && <span className="small">AI analysis… {aiRun.done}/{aiRun.total}</span>}
        <span className="small" style={{ marginLeft: "auto" }}>{filtered.length} leads dikh rahi hain</span>
      </div>

      <div className="tablewrap" style={{ marginTop: 6 }}>
        <table className="leadTable">
          <thead><tr><th style={{ width: 30 }} /><th>Lead</th><th>Service</th><th>Status</th><th>AI (estimate)</th><th>Follow-up</th><th>Source</th><th>Action</th></tr></thead>
          <tbody>
            {filtered.slice(0, shown).map((l) => {
              const stClass = l.status === "Converted" ? "ok" : l.status === "Lost" ? "bad" : ["Interested","Demo Given","Meeting Scheduled","Negotiation","Qualified","Proposal"].includes(l.status) ? "warn" : "";
              const type = (l.leadType || l.ai?.leadType) as LeadType | undefined;
              const late = l.followUpDate && l.followUpDate < todayISO() && !["Converted", "Lost", "Invalid"].includes(l.status);
              return (
                <tr key={l.id} className={selected.has(l.id) ? "sel" : ""}>
                  <td><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select ${l.name}`} /></td>
                  <td>
                    <button className="linkBtn leadName" onClick={() => setProfileId(l.id)}>{l.name}</button>
                    <div className="small">{l.phone || ""}{l.whatsapp && l.whatsapp !== l.phone ? ` • WA ${l.whatsapp}` : ""}</div>
                    <div className="leadTags">
                      {type && <span className={`badge ${type === "ads" ? "pri" : ""}`}>{LEAD_TYPE_LABEL[type]}</span>}
                      {l.optOut && <span className="badge bad">Opt-out</span>}
                    </div>
                  </td>
                  <td>{l.serviceType || l.software || <span className="small">—</span>}<div className="small">{l.category || ""}</div></td>
                  <td>
                    <span className={`badge ${stClass}`}>{l.status}</span>
                    <select value={l.status} onChange={(e) => changeStatus(l, e.target.value)} style={{ marginTop: 4, minWidth: 110 }} aria-label="Change status">
                      {[...new Set([...statusOptions, l.status])].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="leadAI">
                    {l.ai ? (
                      <>
                        <span className={`badge ${levelClass(l.ai.level)}`}>{l.ai.level} {l.ai.interest}%</span>
                        <div className="small">→ {l.ai.nextAction}</div>
                      </>
                    ) : <span className="small">—</span>}
                  </td>
                  <td>{l.followUpDate ? <span className={late ? "badge bad" : ""}>{l.followUpDate}</span> : "—"}{l.meetingDate ? <div className="small">Meeting {l.meetingDate}</div> : null}</td>
                  <td>{l.source || ""}<div className="small">{leadDay(l)}</div>{l.referralBy ? <div className="small">By: {l.referralBy}</div> : null}</td>
                  <td className="rowActions">
                    <button className="btnSmall" onClick={() => setProfileId(l.id)}>Profile</button>
                    <button className="btnSmall" onClick={() => handleEdit(l)}>Edit</button>
                    {l.status !== "Converted" && <button className="btnSmall" onClick={() => convertToClient(l)}>→ Client</button>}
                    {l.conversationId && can("whatsapp.view")
                      ? <button className="btnSmall" onClick={() => navigate({ tab: "whatsapp", conversationId: l.conversationId })}>💬 Chat</button>
                      : can("whatsapp.view") && (normalizePhone(l.whatsapp || l.phone) || l.waJid) && extensionVersion()
                        ? <button className="btnSmall" onClick={() => navigate({ tab: "whatsapp", phone: normalizePhone(l.whatsapp || l.phone), chatId: l.waJid || undefined })}>💬 Chat</button>
                        : <button className="btnSmall" onClick={() => sendWhatsApp(l)}>WhatsApp</button>}
                    {can("leads.delete") && <button className="btnSmall" onClick={() => { if (confirm(`"${l.name}" delete karein? Ye wapas nahi hoga.`)) removeItem("leads", l.id); }}>Delete</button>}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={8} className="small">Is filter mein koi lead nahi.</td></tr>}
          </tbody>
        </table>
      </div>
      {filtered.length > shown && <button className="btnSmall" style={{ marginTop: 8 }} onClick={() => setShown(shown + 200)}>Aur dikhayein ({filtered.length - shown} baqi)</button>}
      {profileId && <LeadProfile leadId={profileId} onClose={() => setProfileId(null)} />}
    </section>
    </>
  );
}
