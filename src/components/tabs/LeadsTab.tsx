import React, { useState, useRef } from "react";
import { useData } from "@/contexts/DataContext";
import { uid, todayISO, fmtMoney } from "@/lib/db";
import { saveElementAsImage, printElementHTML } from "@/lib/exportUtils";
import { leadPhones, normalizePhone, waLink } from "@/lib/phone";
import { LEAD_STATUSES } from "@/lib/leads";
import { linesOf } from "@/lib/catalog";
import { navigate } from "@/lib/navigation";
import { extensionVersion } from "@/lib/waExtension";
import { useAuth } from "@/contexts/AuthContext";

export default function LeadsTab() {
  const { data, addItem, removeItem, updateItem } = useData();
  const { can } = useAuth();
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
      if (old) await updateItem("leads", { ...old, ...payload, date: old.date || todayISO(), updatedAt: new Date().toISOString() });
      alert("Lead updated ✅");
    } else {
      await addItem("leads", { id: uid("LD"), ...payload, date: todayISO(), createdAt: new Date().toISOString() });
    }
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
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Explicit status picker (the old "Status" button cycled through statuses,
  // so one extra click could mark a lead Converted or Lost).
  const changeStatus = async (l: any, next: string) => {
    if (next === l.status) return;
    await updateItem("leads", { ...l, status: next, updatedAt: new Date().toISOString() });
  };

  const convertToClient = async (l: any) => {
    if (data.clients.some(c => c.phone === l.phone && c.name === l.name)) { alert("Client already exists"); return; }
    await addItem("clients", { id: uid("C"), name: l.name, phone: l.phone, ref: "Lead: " + l.category + " - " + (l.serviceType || l.software), status: "Active" });
    await updateItem("leads", { ...l, status: "Converted" });
    alert("Lead converted to Client ✅");
  };

  const sendWhatsApp = (l: any) => {
    const msg = `Assalam o Alaikum ${l.name},\nDigital Target se baat ho rahi thi ${l.serviceType || l.software} ke baare mein.\nKya aap interested hain? Hum aapko demo de sakte hain.\nShukriya!`;
    const link = waLink(l.whatsapp || l.phone, msg);
    if (!link) { alert("Is lead ka phone number sahi nahi hai."); return; }
    window.open(link, "_blank");
  };

  const filtered = data.leads.filter(l => {
    if (filterCat !== "ALL" && l.category !== filterCat) return false;
    if (filterStatus !== "ALL" && l.status !== filterStatus) return false;
    if (filterService !== "ALL" && l.serviceType !== filterService) return false;
    return true;
  });

  const total = data.leads.length;
  const interested = data.leads.filter(l => ["Interested","Demo Given","Meeting Scheduled","Negotiation","Qualified","Proposal"].includes(l.status)).length;
  const converted = data.leads.filter(l => l.status === "Converted").length;
  const meetingsToday = data.leads.filter(l => l.meetingDate === todayISO()).length;

  const sectionRef = useRef<HTMLDivElement>(null);

  const exportLeadsPDF = () => {
    const logo = data.settings?.logo?.data || "";
    let rows = "";
    filtered.slice().reverse().forEach(l => {
      rows += `<tr>
        <td><b>${l.name}</b></td>
        <td>${l.phone||""}<div style="font-size:10px;color:#666">WA: ${l.whatsapp||l.phone||""}</div></td>
        <td>${l.category||""}</td>
        <td>${l.serviceType||l.software||""}</td>
        <td>${l.status}</td>
        <td>${l.source||""}${l.referralBy ? `<div style="font-size:10px;color:#666">By: ${l.referralBy}</div>` : ""}</td>
        <td>${l.meetingDate||"—"}</td>
        <td>${l.followUpDate||"—"}</td>
        <td>${l.date||""}</td>
      </tr>`;
    });
    const html = `
      <div style="padding:20px">
        <div style="display:flex;gap:14px;align-items:center;border-bottom:3px solid #111;padding-bottom:10px;margin-bottom:14px">
          ${logo ? `<img src="${logo}" style="max-height:60px;max-width:140px;object-fit:contain" />` : ""}
          <div>
            <h1 style="margin:0;font-size:24px;font-weight:900">DIGITAL TARGET</h1>
            <div style="font-size:13px;color:#444">📋 Lead Management Report</div>
            <div style="font-size:11px;color:#666">Generated: ${new Date().toLocaleString()}</div>
          </div>
        </div>
        <div style="display:flex;gap:12px;margin-bottom:16px">
          <div class="card" style="flex:1;text-align:center"><div style="font-size:11px;color:#888">Total</div><div style="font-size:22px;font-weight:900">${total}</div></div>
          <div class="card" style="flex:1;text-align:center"><div style="font-size:11px;color:#888">Active Pipeline</div><div style="font-size:22px;font-weight:900">${interested}</div></div>
          <div class="card" style="flex:1;text-align:center"><div style="font-size:11px;color:#888">Converted</div><div style="font-size:22px;font-weight:900">${converted}</div></div>
          <div class="card" style="flex:1;text-align:center"><div style="font-size:11px;color:#888">Meetings Today</div><div style="font-size:22px;font-weight:900">${meetingsToday}</div></div>
        </div>
        <table><thead><tr><th>Name</th><th>Phone</th><th>Category</th><th>Service</th><th>Status</th><th>Source</th><th>Meeting</th><th>Follow-up</th><th>Added</th></tr></thead><tbody>${rows}</tbody></table>
        <div style="margin-top:14px;font-size:11px;color:#666;text-align:center;border-top:1px solid #ccc;padding-top:8px">
          ${data.settings?.footer || "Digital Target — Business Management"}
        </div>
      </div>`;
    printElementHTML(html);
  };

  const exportLeadsImage = (fmt: "png"|"jpg") => {
    if (!sectionRef.current) return;
    saveElementAsImage(sectionRef.current, fmt, `Leads_Report_${todayISO()}`, { width: "1200px" });
  };

  return (
    <section className="card" ref={sectionRef}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>Lead Management {editId && <span className="badge warn">Editing</span>}</h2>
          <div className="small">Marketing leads, meetings, follow-ups aur referrals manage karein.</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btnSmall" onClick={exportLeadsPDF}>PDF</button>
          <button className="btnSmall" onClick={() => exportLeadsImage("png")}>PNG</button>
          <button className="btnSmall" onClick={() => exportLeadsImage("jpg")}>JPG</button>
        </div>
      </div>

      <div className="grid3" style={{ marginTop: 10 }}>
        <div className="kpi"><div className="t">Total Leads</div><div className="v">{total}</div></div>
        <div className="kpi"><div className="t">Active Pipeline</div><div className="v">{interested}</div></div>
        <div className="kpi"><div className="t">Converted</div><div className="v">{converted}</div></div>
      </div>

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
        <button className="btnDanger" onClick={clearForm}>{editId ? "Cancel Edit" : "Clear"}</button>
      </div>

      <hr />
      <div className="grid3">
        <div><label>Filter by Business Type</label>
          <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
            <option value="ALL">All Categories</option>
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div><label>Filter by Service</label>
          <select value={filterService} onChange={(e) => setFilterService(e.target.value)}>
            <option value="ALL">All Services</option>
            {serviceTypes.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div><label>Filter by Status</label>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="ALL">All Status</option>
            {statusOptions.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="tablewrap" style={{ marginTop: 10 }}>
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Category</th><th>Service</th><th>Status</th><th>Source</th><th>Meeting</th><th>Follow-up</th><th>Action</th></tr></thead>
          <tbody>
            {filtered.slice().reverse().map((l) => {
              const stClass = l.status === "Converted" ? "ok" : l.status === "Lost" ? "bad" : ["Interested","Demo Given","Meeting Scheduled","Negotiation","Qualified","Proposal"].includes(l.status) ? "warn" : "";
              return (
                <tr key={l.id}>
                  <td><b>{l.name}</b><div className="small">{(l.notes || "").slice(0, 50)}</div></td>
                  <td>{l.phone || ""}{l.whatsapp && l.whatsapp !== l.phone ? <div className="small">WA: {l.whatsapp}</div> : null}</td>
                  <td>{l.category || ""}</td>
                  <td>{l.serviceType || l.software || ""}</td>
                  <td>
                    <span className={`badge ${stClass}`}>{l.status}</span>
                    <select value={l.status} onChange={(e) => changeStatus(l, e.target.value)} style={{ marginTop: 4, minWidth: 110 }} aria-label="Change status">
                      {[...new Set([...statusOptions, l.status])].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>{l.source || ""}{l.referralBy ? <div className="small">By: {l.referralBy}</div> : null}</td>
                  <td>{l.meetingDate || "—"}</td>
                  <td>{l.followUpDate || "—"}</td>
                  <td className="rowActions">
                    <button className="btnSmall" onClick={() => handleEdit(l)}>Edit</button>
                    <button className="btnSmall" onClick={() => convertToClient(l)}>→ Client</button>
                    {l.conversationId && can("whatsapp.view")
                      ? <button className="btnSmall" onClick={() => navigate({ tab: "whatsapp", conversationId: l.conversationId })}>💬 Chat</button>
                      : can("whatsapp.view") && (normalizePhone(l.whatsapp || l.phone) || l.waJid) && extensionVersion()
                        ? <button className="btnSmall" onClick={() => navigate({ tab: "whatsapp", phone: normalizePhone(l.whatsapp || l.phone), chatId: l.waJid || undefined })}>💬 Chat</button>
                        : <button className="btnSmall" onClick={() => sendWhatsApp(l)}>WhatsApp</button>}
                    <button className="btnSmall" onClick={() => { if (confirm("Delete?")) removeItem("leads", l.id); }}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
