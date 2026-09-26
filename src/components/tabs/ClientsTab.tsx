import React, { useMemo, useState } from "react";
import { useData } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { uid, fmtMoney, nowText } from "@/lib/db";
import { writeSafeDocument } from "@/lib/safeHtml";
import { invoiceView, statusClass } from "@/lib/invoice";
import { leadPhones, normalizePhone, waLink } from "@/lib/phone";
import { navigate } from "@/lib/navigation";

interface ClientForm { name: string; business: string; phone: string; email: string; address: string; services: string; ref: string; status: string }
const EMPTY: ClientForm = { name: "", business: "", phone: "", email: "", address: "", services: "", ref: "", status: "Active" };

export default function ClientsTab() {
  const { data, addItem, updateItem, removeItem } = useData();
  const { can } = useAuth();
  const canManage = can("clients.manage");
  const [form, setForm] = useState<ClientForm>(EMPTY);
  const [editId, setEditId] = useState("");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [profileId, setProfileId] = useState("");

  const set = (k: keyof ClientForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  // Money and activity per client, used by the list and the profile.
  const stats = useMemo(() => {
    const m: Record<string, { billed: number; paid: number; due: number; invoices: number; projects: number; leads: number }> = {};
    const get = (id: string) => (m[id] ||= { billed: 0, paid: 0, due: 0, invoices: 0, projects: 0, leads: 0 });
    for (const inv of data.invoices) { const v = invoiceView(inv); const s = get(inv.clientId); s.billed += v.grandTotal; s.paid += v.paid; s.due += v.due; s.invoices++; }
    for (const p of data.projects) get(p.clientId).projects++;
    for (const c of data.clients) {
      const phones = leadPhones({ phone: c.phone, whatsapp: c.whatsapp });
      get(c.id).leads = data.leads.filter((l: any) => leadPhones(l).some((p) => phones.includes(p))).length;
    }
    return m;
  }, [data.invoices, data.projects, data.clients, data.leads]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.clients
      .filter((c: any) => (status === "ALL" || (c.status || "Active") === status) &&
        (!q || [c.name, c.business, c.phone, c.email].some((v) => String(v || "").toLowerCase().includes(q))))
      .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
  }, [data.clients, search, status]);

  const totals = Object.values(stats).reduce((t, s) => ({ billed: t.billed + s.billed, due: t.due + s.due }), { billed: 0, due: 0 });

  const startNew = () => { setForm(EMPTY); setEditId(""); setOpen(true); };
  const startEdit = (c: any) => {
    setForm({ name: c.name || "", business: c.business || "", phone: c.phone || "", email: c.email || "", address: c.address || "", services: c.services || "", ref: c.ref || "", status: c.status || "Active" });
    setEditId(c.id); setOpen(true); window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async () => {
    if (!form.name.trim()) { alert("Client ka naam likhein"); return; }
    const phoneN = normalizePhone(form.phone);
    const dup = phoneN && data.clients.find((c: any) => c.id !== editId && normalizePhone(c.phone) === phoneN);
    if (dup && !confirm(`Yeh number pehle se client "${dup.name}" ka hai. Phir bhi save karein?`)) return;
    const payload = { ...form, name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() };
    if (editId) {
      const old = data.clients.find((c: any) => c.id === editId);
      await updateItem("clients", { ...old, ...payload, updatedAt: new Date().toISOString() });
    } else {
      await addItem("clients", { id: uid("C"), ...payload, createdAt: new Date().toISOString() });
    }
    setOpen(false); setEditId(""); setForm(EMPTY);
  };

  const remove = async (c: any) => {
    const s = stats[c.id];
    if (!confirm(`${c.name} delete karein?${s?.invoices ? `\n\nIs client ki ${s.invoices} invoices hain — woh "client nahi mila" dikhayengi.` : ""}`)) return;
    await removeItem("clients", c.id);
    if (profileId === c.id) setProfileId("");
  };

  const exportList = () => {
    const rows = list.map((c: any) => { const s = stats[c.id]; return `<tr><td>${c.name}</td><td>${c.business || ""}</td><td>${c.phone || ""}</td><td>${c.status || ""}</td><td>Rs ${fmtMoney(s?.billed || 0)}</td><td>Rs ${fmtMoney(s?.due || 0)}</td></tr>`; }).join("");
    const w = window.open("", "_blank");
    if (!w) return;
    writeSafeDocument(w, `<html><head><title>Clients</title><style>body{font-family:Inter,Arial,sans-serif;padding:18px;color:#1F1633}h2{color:#3D096D;margin:0}table{width:100%;border-collapse:collapse;margin-top:12px}th{background:#3D096D;color:#fff;text-align:left;padding:8px;font-size:11px}td{border-bottom:1px solid #eee;padding:8px;font-size:12px}</style></head><body><h2>DIGITAL TARGET — Clients</h2><div style="font-size:12px;color:#666">Generated ${nowText()}</div><table><thead><tr><th>Name</th><th>Business</th><th>Phone</th><th>Status</th><th>Billed</th><th>Due</th></tr></thead><tbody>${rows || "<tr><td colspan=6>No clients</td></tr>"}</tbody></table></body></html>`);
    setTimeout(() => w.print(), 300);
  };

  const profile = data.clients.find((c: any) => c.id === profileId);
  const pInvoices = profile ? data.invoices.filter((i: any) => i.clientId === profile.id) : [];
  const pProjects = profile ? data.projects.filter((p: any) => p.clientId === profile.id) : [];
  const pLeads = profile ? data.leads.filter((l: any) => leadPhones(l).some((p) => leadPhones({ phone: profile.phone }).includes(p))) : [];

  return (
    <>
      <section className="card">
        <div className="sectionHead">
          <div>
            <h2 style={{ margin: 0 }}>Clients</h2>
            <div className="small">Har client ki invoices, payments, projects aur leads ek jagah.</div>
          </div>
          <div className="rowActions">
            <button className="btnSmall" onClick={exportList}>Export</button>
            {canManage && <button className="btnSolid" onClick={startNew}>+ New Client</button>}
          </div>
        </div>
        <div className="kpis kpis4" style={{ marginTop: 12 }}>
          <div className="kpi"><div className="t">Clients</div><div className="v">{data.clients.length}</div></div>
          <div className="kpi"><div className="t">Active</div><div className="v">{data.clients.filter((c: any) => (c.status || "Active") === "Active").length}</div></div>
          <div className="kpi"><div className="t">Total billed</div><div className="v">Rs {fmtMoney(totals.billed)}</div></div>
          <div className="kpi"><div className="t">Outstanding</div><div className="v">Rs {fmtMoney(totals.due)}</div></div>
        </div>
      </section>

      {open && canManage && (
        <section className="card">
          <div className="sectionHead">
            <h2 style={{ margin: 0 }}>{editId ? `Edit ${form.name}` : "New Client"}</h2>
            <button className="btnSmall" onClick={() => setOpen(false)}>✕ Close</button>
          </div>
          <div className="grid3" style={{ marginTop: 10 }}>
            <div><label>Client name *</label><input value={form.name} onChange={set("name")} placeholder="e.g. Ali Khan" /></div>
            <div><label>Business</label><input value={form.business} onChange={set("business")} placeholder="e.g. Karachi Biryani House" /></div>
            <div><label>Status</label><select value={form.status} onChange={set("status")}><option>Active</option><option>Inactive</option></select></div>
          </div>
          <div className="grid3" style={{ marginTop: 10 }}>
            <div><label>Phone / WhatsApp</label><input value={form.phone} onChange={set("phone")} placeholder="03xxxxxxxxx" inputMode="tel" /></div>
            <div><label>Email</label><input value={form.email} onChange={set("email")} placeholder="client@email.com" /></div>
            <div><label>Address / City</label><input value={form.address} onChange={set("address")} /></div>
          </div>
          <div className="grid2" style={{ marginTop: 10 }}>
            <div><label>Services</label><input value={form.services} onChange={set("services")} placeholder="Ads, Social media, Website…" /></div>
            <div><label>Notes / reference</label><input value={form.ref} onChange={set("ref")} /></div>
          </div>
          <button className="btnSolid" style={{ marginTop: 12 }} onClick={save}>{editId ? "Update Client" : "Save Client"}</button>
        </section>
      )}

      <section className="card">
        <div className="sectionHead">
          <input className="invSearch" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, business, phone…" />
          <div className="waFilters" style={{ marginTop: 0 }}>
            {["ALL", "Active", "Inactive"].map((f) => <button key={f} className={`waChip ${status === f ? "active" : ""}`} onClick={() => setStatus(f)}>{f === "ALL" ? "All" : f}</button>)}
          </div>
        </div>
        <div className="tablewrap" style={{ marginTop: 10 }}>
          <table>
            <thead><tr><th>Client</th><th>Phone</th><th className="num">Billed</th><th className="num">Due</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {list.map((c: any) => {
                const s = stats[c.id];
                return (
                  <tr key={c.id}>
                    <td><button className="linkBtn" style={{ fontSize: 14 }} onClick={() => setProfileId(c.id)}><b>{c.name}</b></button><div className="small">{c.business || c.ref || ""}</div></td>
                    <td>{c.phone || "—"}</td>
                    <td className="num">Rs {fmtMoney(s?.billed || 0)}</td>
                    <td className="num">{s?.due ? <b>Rs {fmtMoney(s.due)}</b> : "—"}</td>
                    <td><span className={`badge ${(c.status || "Active") === "Active" ? "ok" : "warn"}`}>{c.status || "Active"}</span></td>
                    <td className="rowActions">
                      <button className="btnSmall" onClick={() => setProfileId(c.id)}>Profile</button>
                      {waLink(c.phone) && <a className="btnSmall" href={waLink(c.phone)!} target="_blank" rel="noreferrer">WhatsApp</a>}
                      {canManage && <button className="btnSmall" onClick={() => startEdit(c)}>Edit</button>}
                      {canManage && <button className="btnSmall" onClick={() => remove(c)}>Delete</button>}
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && <tr><td colSpan={6} className="small">Koi client nahi.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {profile && (
        <div className="dtModalBackdrop" onClick={() => setProfileId("")}>
          <div className="dtModal wide" onClick={(e) => e.stopPropagation()}>
            <div className="dtModalHead">
              <div>
                <b style={{ fontSize: 18 }}>{profile.name}</b>
                <div className="small">{[profile.business, profile.phone, profile.email, profile.address].filter(Boolean).join(" • ")}</div>
                {profile.services && <div className="small">Services: {profile.services}</div>}
              </div>
              <button className="btnSmall" onClick={() => setProfileId("")}>✕</button>
            </div>
            <div className="kpis kpis4">
              <div className="kpi"><div className="t">Billed</div><div className="v">Rs {fmtMoney(stats[profile.id]?.billed || 0)}</div></div>
              <div className="kpi"><div className="t">Paid</div><div className="v">Rs {fmtMoney(stats[profile.id]?.paid || 0)}</div></div>
              <div className="kpi"><div className="t">Due</div><div className="v">Rs {fmtMoney(stats[profile.id]?.due || 0)}</div></div>
              <div className="kpi"><div className="t">Projects</div><div className="v">{pProjects.length}</div></div>
            </div>
            <h3 className="growthH">Invoices</h3>
            <div className="tablewrap">
              <table>
                <thead><tr><th>Invoice</th><th>Date</th><th className="num">Total</th><th className="num">Due</th><th>Status</th></tr></thead>
                <tbody>
                  {pInvoices.map((i: any) => { const v = invoiceView(i); return (
                    <tr key={i.id}><td>{v.number}</td><td>{v.date}</td><td className="num">Rs {fmtMoney(v.grandTotal)}</td><td className="num">Rs {fmtMoney(v.due)}</td><td><span className={`badge ${statusClass(v.status)}`}>{v.status}</span></td></tr>
                  ); })}
                  {pInvoices.length === 0 && <tr><td colSpan={5} className="small">Koi invoice nahi.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="grid2" style={{ marginTop: 6 }}>
              <div>
                <h3 className="growthH">Projects</h3>
                {pProjects.length ? pProjects.map((p: any) => <div key={p.id} className="small">• {p.title} — {p.status || "Running"}</div>) : <div className="small">—</div>}
              </div>
              <div>
                <h3 className="growthH">Leads / WhatsApp</h3>
                {pLeads.length ? pLeads.map((l: any) => (
                  <div key={l.id} className="small">
                    • {l.name} — {l.status} ({l.source || "—"})
                    {l.conversationId && can("whatsapp.view") && <button className="linkBtn" style={{ marginLeft: 6 }} onClick={() => { setProfileId(""); navigate({ tab: "whatsapp", conversationId: l.conversationId }); }}>Chat</button>}
                  </div>
                )) : <div className="small">—</div>}
              </div>
            </div>
            {profile.ref && <><h3 className="growthH">Notes</h3><div className="small" style={{ whiteSpace: "pre-wrap" }}>{profile.ref}</div></>}
          </div>
        </div>
      )}
    </>
  );
}
