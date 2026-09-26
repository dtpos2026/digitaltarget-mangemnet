import React, { useState, useRef } from "react";
import { useData } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { uid, todayISO, fmtMoney } from "@/lib/db";
import { saveElementAsImage } from "@/lib/exportUtils";

const STATUS_OPTIONS = ["Assigned", "In Progress", "Submitted", "Revision", "Completed", "Cancelled"];

export default function AssignmentsTab() {
  const { data, addItem, updateItem, removeItem } = useData();
  const { user, roleDoc } = useAuth();

  const [memberId, setMemberId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Video Editing");
  const [deadline, setDeadline] = useState("");
  const [rate, setRate] = useState("");
  const [driveLink, setDriveLink] = useState("");
  const [terms, setTerms] = useState(
    "1) Work confidential rahega.\n2) Deadline strictly follow ho.\n3) Payment task approval ke baad release hogi."
  );
  const [filterMember, setFilterMember] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const formRef = useRef<HTMLDivElement>(null);
  const [previewAssignment, setPreviewAssignment] = useState<any | null>(null);

  const categories = ["Video Editing", "Graphic Design", "Content Writing", "Reels Editing", "Photo Editing", "Animation", "Other"];

  const handleAdd = async () => {
    if (!memberId) { alert("Member select karein"); return; }
    if (!title.trim()) { alert("Title likhein"); return; }
    const a = {
      id: uid("AS"),
      memberId,
      title: title.trim(),
      description: description.trim(),
      category,
      deadline: deadline || "",
      rate: +rate || 0,
      driveLink: driveLink.trim(),
      terms: terms.trim(),
      status: "Assigned",
      assignedBy: roleDoc?.email || user?.email || "",
      assignedAt: new Date().toISOString(),
      messages: [],
    };
    await addItem("assignments", a);
    setTitle(""); setDescription(""); setRate(""); setDriveLink(""); setDeadline("");
    alert("Assignment save ho gayi ✅");
  };

  const updateStatus = async (a: any, s: string) => {
    await updateItem("assignments", { ...a, status: s });
  };

  const printPNG = async (a: any) => {
    setPreviewAssignment(a);
    setTimeout(async () => {
      if (!formRef.current) return;
      const member = data.team.find(t => t.id === a.memberId);
      await saveElementAsImage(
        formRef.current,
        "png",
        `Assignment_${(member?.name || "Member").replace(/\s/g, "_")}_${a.id}`,
        { scale: 2 }
      );
      setPreviewAssignment(null);
    }, 300);
  };

  const filtered = data.assignments
    .filter((a: any) => !filterMember || a.memberId === filterMember)
    .filter((a: any) => !filterStatus || a.status === filterStatus)
    .sort((a: any, b: any) => String(b.assignedAt || "").localeCompare(String(a.assignedAt || "")));

  const settings = data.settings || {};
  const company = settings.exportName || "DIGITAL TARGET";

  return (
    <>
      <section className="card">
        <h2>Assign Work to Team Member</h2>
        <div className="grid3">
          <div>
            <label>Team Member</label>
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">Select...</option>
              {data.team.map(t => <option key={t.id} value={t.id}>{t.name} ({t.role || "—"})</option>)}
            </select>
          </div>
          <div><label>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div><label>Deadline</label><input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></div>
        </div>
        <div className="grid2">
          <div><label>Task Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 10 Reels Edit for Brand X" /></div>
          <div><label>Rate / Amount (Rs)</label><input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" /></div>
        </div>
        <div><label>Description / Brief</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detail likhein: kya banana hai, kis style mein, ratio, music..." /></div>
        <div><label>Drive / Content Link</label><input value={driveLink} onChange={(e) => setDriveLink(e.target.value)} placeholder="https://drive.google.com/... ya YouTube link" /></div>
        <div><label>Terms & Conditions</label><textarea value={terms} onChange={(e) => setTerms(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <button className="btnSolid" onClick={handleAdd}>+ Save Assignment</button>
        </div>
      </section>

      <section className="card" style={{ marginTop: 14 }}>
        <h2>All Assignments</h2>
        <div className="grid3">
          <div><label>Filter Member</label>
            <select value={filterMember} onChange={(e) => setFilterMember(e.target.value)}>
              <option value="">All</option>
              {data.team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div><label>Filter Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All</option>
              {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <div className="kpi" style={{ flex: 1 }}><div className="t">Total</div><div className="v">{filtered.length}</div></div>
          </div>
        </div>
        <div className="tablewrap" style={{ marginTop: 10 }}>
          <table>
            <thead><tr><th>Member</th><th>Title</th><th>Category</th><th>Deadline</th><th>Rate</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {filtered.map((a: any) => {
                const m = data.team.find(t => t.id === a.memberId);
                return (
                  <tr key={a.id}>
                    <td><b>{m?.name || "—"}</b></td>
                    <td>{a.title}<div className="small">{a.description?.slice(0, 60)}</div></td>
                    <td>{a.category}</td>
                    <td>{a.deadline ? new Date(a.deadline).toLocaleString() : "—"}</td>
                    <td>{fmtMoney(a.rate || 0)}</td>
                    <td>
                      <select value={a.status || "Assigned"} onChange={(e) => updateStatus(a, e.target.value)}>
                        {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="rowActions">
                      <button className="btnSmall" onClick={() => printPNG(a)}>PNG Form</button>
                      {a.driveLink && <a className="btnSmall" href={a.driveLink} target="_blank" rel="noreferrer">Open link</a>}
                      <button className="btnSmall" onClick={() => { if (confirm("Delete?")) removeItem("assignments", a.id); }}>Delete</button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={7}>Koi assignment nahi.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Hidden render area for PNG export */}
      <div style={{ position: "fixed", left: -10000, top: 0 }}>
        {previewAssignment && (() => {
          const a = previewAssignment;
          const m = data.team.find(t => t.id === a.memberId);
          return (
            <div ref={formRef} style={{
              width: 794, padding: 36, background: "#fff", color: "#111",
              fontFamily: "Inter, system-ui, sans-serif", border: "6px solid #6366f1",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "3px solid #111", paddingBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {settings.logo?.data && <img src={settings.logo.data} alt="logo" style={{ width: 70, height: 70, objectFit: "contain" }} />}
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: 1 }}>{company}</div>
                    <div style={{ fontSize: 12, color: "#555" }}>Work Assignment Form</div>
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: 12 }}>
                  <div><b>Assignment ID:</b> {a.id}</div>
                  <div><b>Date:</b> {new Date(a.assignedAt || Date.now()).toLocaleString()}</div>
                </div>
              </div>

              <h2 style={{ textAlign: "center", margin: "16px 0", fontSize: 22, letterSpacing: 2 }}>WORK ASSIGNMENT</h2>

              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                <tbody>
                  <tr><td style={tdL}><b>Member Name</b></td><td style={tdR}>{m?.name || "—"}</td></tr>
                  <tr><td style={tdL}><b>Role / Type</b></td><td style={tdR}>{m?.role || "—"} / {m?.memberType || "Employee"}</td></tr>
                  <tr><td style={tdL}><b>Category</b></td><td style={tdR}>{a.category}</td></tr>
                  <tr><td style={tdL}><b>Task Title</b></td><td style={tdR}><b>{a.title}</b></td></tr>
                  <tr><td style={tdL}><b>Description</b></td><td style={{ ...tdR, whiteSpace: "pre-wrap" }}>{a.description || "—"}</td></tr>
                  <tr><td style={tdL}><b>Deadline</b></td><td style={tdR}>{a.deadline ? new Date(a.deadline).toLocaleString() : "—"}</td></tr>
                  <tr><td style={tdL}><b>Rate / Amount</b></td><td style={tdR}>Rs {fmtMoney(a.rate || 0)}</td></tr>
                  <tr><td style={tdL}><b>Drive / Content Link</b></td><td style={tdR}><span style={{ wordBreak: "break-all" }}>{a.driveLink || "—"}</span></td></tr>
                  <tr><td style={tdL}><b>Assigned By</b></td><td style={tdR}>{a.assignedBy || "—"}</td></tr>
                </tbody>
              </table>

              <div style={{ marginTop: 16, padding: 12, border: "1px solid #999", borderRadius: 8, background: "#fafafa" }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Terms & Conditions</div>
                <div style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{a.terms}</div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 50 }}>
                <div style={{ textAlign: "center", width: "40%" }}>
                  <div style={{ borderTop: "1px solid #111", paddingTop: 6 }}>{m?.name || "Team Member"}</div>
                  <div style={{ fontSize: 11, color: "#555" }}>Member Signature</div>
                </div>
                <div style={{ textAlign: "center", width: "40%" }}>
                  {settings.signature?.data && <img src={settings.signature.data} alt="sig" style={{ height: 40, marginBottom: 4 }} />}
                  <div style={{ borderTop: "1px solid #111", paddingTop: 6 }}>{settings.authorizedName || "Authorized Signatory"}</div>
                  <div style={{ fontSize: 11, color: "#555" }}>{settings.authorizedDesignation || "Authorized"} • {company}</div>
                </div>
              </div>

              <div style={{ marginTop: 18, textAlign: "center", fontSize: 11, color: "#666" }}>
                {settings.footer || `${company} — Generated by Digital Target Business Management`}
              </div>
            </div>
          );
        })()}
      </div>
    </>
  );
}

const tdL: React.CSSProperties = { padding: 8, border: "1px solid #ccc", width: "30%", background: "#f3f4f6", verticalAlign: "top" };
const tdR: React.CSSProperties = { padding: 8, border: "1px solid #ccc", verticalAlign: "top" };
