import React, { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { uid, todayISO, fmtMoney, humanDuration, fileToBase64 } from "@/lib/db";
import { printElementHTML } from "@/lib/exportUtils";

function getCertificateTypeLabel(v: string) {
  const map: Record<string, string> = {
    experience: "Experience Certificate",
    employment: "Employment Certificate",
    internship: "Internship / Training Certificate",
    appreciation: "Appreciation Certificate",
    service: "Service / Association Letter",
  };
  return map[v] || map.experience;
}

function calcMemberAverageRating(memberId: string, teamLogs: any[]) {
  const ratings = teamLogs.filter(x => x.memberId === memberId && +x.rating > 0).map(x => +x.rating);
  if (!ratings.length) return 0;
  return +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1);
}

export default function TeamTab() {
  const { data, addItem, removeItem, updateItem } = useData();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [tStatus, setTStatus] = useState("Active");
  const [rate, setRate] = useState("");
  const [joined, setJoined] = useState(todayISO());
  const [rating, setRating] = useState("");
  const [work, setWork] = useState("");
  const [projectsDone, setProjectsDone] = useState("");
  const [notes, setNotes] = useState("");
  const [memberType, setMemberType] = useState("Employee");
  const [department, setDepartment] = useState("");
  const [certificateType, setCertificateType] = useState("experience");

  // Profile view
  const [selectedMember, setSelectedMember] = useState("");

  // Certificate controls
  const [teamCertType, setTeamCertType] = useState("experience");
  const [teamCertPurpose, setTeamCertPurpose] = useState("Professional record");
  const [teamCertStart, setTeamCertStart] = useState("");

  // Work log state
  const [taskMember, setTaskMember] = useState("");
  const [taskDate, setTaskDate] = useState(todayISO());
  const [taskTitle, setTaskTitle] = useState("");
  const [taskStatus, setTaskStatus] = useState("Assigned");
  const [taskAmount, setTaskAmount] = useState("");
  const [taskRating, setTaskRating] = useState("");
  const [taskProjectCount, setTaskProjectCount] = useState("");
  const [taskNotes, setTaskNotes] = useState("");

  // Payout state
  const [payMember, setPayMember] = useState("");
  const [payDate, setPayDate] = useState(todayISO());
  const [payAmount, setPayAmount] = useState("");
  const [payWallet, setPayWallet] = useState("");
  const [payNote, setPayNote] = useState("");

  const memberTypes = ["Employee", "Freelancer", "Intern", "Trainee", "Volunteer", "Agency Partner", "Contractor"];

  const handleAdd = async () => {
    if (!name.trim()) { alert("Name required"); return; }
    const existing = data.team.find(x => String(x.name).toLowerCase() === name.trim().toLowerCase());
    const payload: any = {
      name: name.trim(), role, status: tStatus, rate: +rate || 0,
      joined, rating: +rating || 0, work, projectsDone: +projectsDone || 0, notes,
      memberType, department, certificateType, lastActivity: todayISO(),
    };
    if (existing) {
      await updateItem("team", {
        ...existing,
        role: payload.role || existing.role,
        status: payload.status,
        rate: payload.rate,
        work: payload.work || existing.work,
        joined: payload.joined || existing.joined,
        rating: payload.rating || existing.rating || 0,
        projectsDone: payload.projectsDone || existing.projectsDone || 0,
        notes: payload.notes || existing.notes || "",
        memberType: payload.memberType || existing.memberType || "Employee",
        department: payload.department || existing.department || "",
        certificateType: payload.certificateType || existing.certificateType || "experience",
        lastActivity: todayISO(),
      });
    } else {
      await addItem("team", { id: uid("T"), paid: 0, ...payload });
    }
    setName(""); setRole(""); setRate(""); setWork(""); setProjectsDone(""); setNotes(""); setRating(""); setDepartment("");
  };

  const editTeam = (t: any) => {
    setName(t.name || "");
    setRole(t.role || "");
    setTStatus(t.status || "Active");
    setRate(String(t.rate || 0));
    setWork(t.work || "");
    setJoined(t.joined || todayISO());
    setRating(String(t.rating || 0));
    setProjectsDone(String(t.projectsDone || 0));
    setNotes(t.notes || "");
    setMemberType(t.memberType || "Employee");
    setDepartment(t.department || "");
    setCertificateType(t.certificateType || "experience");
  };

  const selectProfile = (id: string) => {
    setSelectedMember(id);
    setPayMember(id);
    setTaskMember(id);
    const t = data.team.find(x => x.id === id);
    if (t) {
      setTeamCertType(t.certificateType || "experience");
    }
  };

  const handleAddTask = async () => {
    if (!taskMember || !taskTitle.trim()) { alert("Select member & enter title"); return; }
    const t = data.team.find(x => x.id === taskMember);
    if (!t) return;
    const amt = +taskAmount || 0;
    const r = +taskRating || 0;
    const pc = +taskProjectCount || 0;

    await addItem("teamLogs", {
      id: uid("TL"), memberId: taskMember, date: taskDate, type: "WORK",
      title: taskTitle.trim(), status: taskStatus, amount: amt, rating: r, notes: taskNotes.trim(),
    });

    // Also create an assignment so it shows up in My Portal for the linked team member
    await addItem("assignments", {
      id: uid("AS"),
      memberId: taskMember,
      title: taskTitle.trim(),
      description: taskNotes.trim(),
      category: t.work || "Task",
      deadline: "",
      rate: amt,
      driveLink: "",
      terms: "",
      status: taskStatus,
      assignedBy: "Team Tab",
      assignedAt: new Date().toISOString(),
      messages: [],
    });

    const updates: any = { ...t, lastActivity: taskDate };
    if (taskTitle.trim()) updates.work = taskTitle.trim();
    if (amt > 0) updates.rate = (t.rate || 0) + amt;
    if (pc > 0) updates.projectsDone = (t.projectsDone || 0) + pc;
    const avg = calcMemberAverageRating(taskMember, [...data.teamLogs, { memberId: taskMember, rating: r }]);
    if (r > 0) updates.rating = avg || r;

    await updateItem("team", updates);
    setTaskTitle(""); setTaskAmount(""); setTaskRating(""); setTaskProjectCount(""); setTaskNotes("");
  };

  const handlePayout = async () => {
    if (!payMember) { alert("Select member"); return; }
    const amt = +payAmount || 0;
    if (amt <= 0) { alert("Amount required"); return; }
    if (!payWallet) { alert("Select account"); return; }

    const t = data.team.find(x => x.id === payMember);
    const w = data.wallets.find(x => x.id === payWallet);
    if (!t || !w) return;

    const payoutId = uid("PAY");
    await updateItem("team", { ...t, paid: (t.paid || 0) + amt, lastActivity: payDate });
    await updateItem("wallets", { ...w, balance: (w.balance || 0) - amt });
    await addItem("payouts", { id: payoutId, memberId: payMember, date: payDate, amount: amt, walletId: payWallet, note: payNote });
    await addItem("teamLogs", {
      id: uid("TL"), memberId: payMember, date: payDate, type: "PAYOUT",
      title: "Payout", status: "Paid", amount: amt, rating: 0, notes: payNote, payoutId,
    });
    await addItem("accounting", {
      id: uid("A"), date: payDate, type: "OUT", clientId: "", projectId: "",
      category: "Team Payout", walletId: payWallet, amount: amt,
      desc: `Team payout to ${t.name} (${payNote})`, receipt: null,
    });
    setPayAmount(""); setPayNote("");
  };

  const teamDue = (t: any) => Math.max(0, (t.rate || 0) - (t.paid || 0));
  const totalDue = data.team.reduce((s, t) => s + teamDue(t), 0);

  const selectedT = data.team.find(x => x.id === selectedMember);
  const memberLogs = selectedT ? data.teamLogs.filter(x => x.memberId === selectedT.id).slice().reverse().slice(0, 6) : [];
  const memberPayoutCount = selectedT ? data.payouts.filter(x => x.memberId === selectedT.id).length : 0;
  const avgRating = selectedT ? (calcMemberAverageRating(selectedT.id, data.teamLogs) || +(selectedT.rating || 0)) : 0;

  const printTeamSheet = () => {
    const rows = data.team.map(t => {
      const due = teamDue(t);
      return `<tr><td>${t.name || ""}</td><td>${t.role || ""}</td><td>${t.memberType || "Employee"}</td><td>${t.status || "Active"}</td><td>${fmtMoney(t.rate || 0)}</td><td>${fmtMoney(t.paid || 0)}</td><td>${fmtMoney(due)}</td><td>${t.rating || 0}</td></tr>`;
    }).join("");
    printElementHTML(`<div style="padding:14px">
      <h2 style="margin:0">DIGITAL TARGET</h2>
      <div style="font-weight:900;margin-top:4px">Team Report</div>
      <hr/>
      <table><thead><tr><th>Name</th><th>Role</th><th>Type</th><th>Status</th><th>Total</th><th>Paid</th><th>Due</th><th>Rating</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8">No team</td></tr>'}</tbody></table>
    </div>`);
  };

  const printCertificate = () => {
    if (!selectedT) { alert("Select member"); return; }
    const company = data.settings?.exportName || "DIGITAL TARGET";
    const certType = teamCertType || selectedT.certificateType || "experience";
    const certTypeLabel = getCertificateTypeLabel(certType);
    const purpose = teamCertPurpose?.trim() || "official record";
    const fromDate = teamCertStart || selectedT.joined || todayISO();
    const issueDate = todayISO();
    const experienceText = humanDuration(fromDate, issueDate);
    const authorizedName = data.settings?.authorizedName || "";
    const authorizedDesignation = data.settings?.authorizedDesignation || "Authorized Signatory";
    const memberTypeLabel = selectedT.memberType || "Employee";

    const introMap: Record<string, string> = {
      experience: `This is to certify that <b>${selectedT.name || ""}</b> has worked with <b>${company}</b> as a <b>${selectedT.role || memberTypeLabel || "Team Member"}</b>.`,
      employment: `This is to certify that <b>${selectedT.name || ""}</b> is / has been associated with <b>${company}</b> in the capacity of <b>${selectedT.role || memberTypeLabel || "Team Member"}</b>.`,
      internship: `This is to certify that <b>${selectedT.name || ""}</b> completed an <b>${memberTypeLabel}</b> / training engagement with <b>${company}</b> in the role of <b>${selectedT.role || "Trainee"}</b>.`,
      appreciation: `This certificate is proudly awarded to <b>${selectedT.name || ""}</b> in recognition of valuable contribution to <b>${company}</b> as <b>${selectedT.role || memberTypeLabel || "Team Member"}</b>.`,
      service: `This letter certifies the professional association of <b>${selectedT.name || ""}</b> with <b>${company}</b> as <b>${selectedT.role || memberTypeLabel || "Team Member"}</b>.`,
    };
    const bodyMap: Record<string, string> = {
      experience: `The member has been associated since <b>${fromDate}</b> and has gained approximately <b>${experienceText}</b> of experience with us. Their main domain has been <b>${selectedT.work || "assigned creative and operational work"}</b>, under <b>${selectedT.department || "General Operations"}</b>, with contribution across <b>${selectedT.projectsDone || 0} project(s)</b>.`,
      employment: `Our records show service from <b>${fromDate}</b>. During this period, the member worked in <b>${selectedT.department || "General Operations"}</b>, handled <b>${selectedT.work || "assigned duties"}</b>, and maintained a current status of <b>${selectedT.status || "Active"}</b>.`,
      internship: `During the learning period starting from <b>${fromDate}</b>, the trainee worked on <b>${selectedT.work || "practical assignments"}</b> in the <b>${selectedT.department || "training"}</b> domain. The trainee participated in <b>${selectedT.projectsDone || 0} project(s)</b> / tasks as part of skill development.`,
      appreciation: `The member has shown commitment, professionalism and contribution in <b>${selectedT.work || "assigned responsibilities"}</b>. We appreciate the support rendered from <b>${fromDate}</b> onward in the <b>${selectedT.department || "company operations"}</b> domain.`,
      service: `As per our available records, this association has remained active from <b>${fromDate}</b>. The member contributed in <b>${selectedT.work || "assigned work"}</b> and supported our <b>${selectedT.department || "operations"}</b> with professionalism.`,
    };
    const performanceLine = certType === "internship"
      ? `The overall evaluation recorded for this member is <b>${avgRating || 0} / 5</b>, reflecting the quality of learning, discipline and task completion.`
      : `The overall performance / feedback rating recorded for this member is <b>${avgRating || 0} / 5</b>.`;
    const purposeLine = certType === "appreciation"
      ? `This certificate is issued as a mark of appreciation and may be used for <b>${purpose}</b>.`
      : `This certificate is issued on request for <b>${purpose}</b>.`;

    const logoData = data.settings?.logo?.data || "";
    const logoBlock = logoData ? `<img src="${logoData}" alt="logo" style="height:60px;object-fit:contain"/>` : `<div style="font-weight:900;font-size:20px">${company}</div>`;
    printElementHTML(`
      <div style="padding:34px;border:4px solid #dbe4ff;min-height:900px;background:#fff;color:#111827">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>${logoBlock}</div>
          <div style="text-align:right"><div style="font-size:13px;font-weight:900">${company}</div><div style="font-size:12px;color:#64748b">${certTypeLabel}</div></div>
        </div>
        <div style="text-align:center;margin-top:28px">
          <div style="font-size:36px;font-weight:900;letter-spacing:2px">CERTIFICATE</div>
          <div style="margin-top:8px;font-size:18px">${certTypeLabel}</div>
        </div>
        <div style="margin-top:36px;font-size:18px;line-height:1.9">${introMap[certType] || introMap.experience}</div>
        <div style="margin-top:18px;font-size:18px;line-height:1.9">${bodyMap[certType] || bodyMap.experience}</div>
        <div style="margin-top:18px;font-size:18px;line-height:1.9">${performanceLine}</div>
        <div style="margin-top:18px;font-size:17px;line-height:1.8">${purposeLine}</div>
        <div style="margin-top:26px;padding:14px 16px;border:1px solid #dbe4ff;border-radius:12px;background:#f8fbff">
          <div><b>Member Type:</b> ${memberTypeLabel}</div>
          <div><b>Role:</b> ${selectedT.role || "-"}</div>
          <div><b>Department:</b> ${selectedT.department || "-"}</div>
          <div><b>Experience / Association:</b> ${experienceText}</div>
          <div><b>Projects / Tasks:</b> ${selectedT.projectsDone || 0}</div>
        </div>
        <div style="margin-top:70px;display:flex;justify-content:space-between;align-items:flex-end">
          <div><div><b>Issue Date:</b> ${issueDate}</div></div>
          <div style="text-align:center">
            <div style="height:55px"></div>
            <div style="border-top:1px solid #111827;padding-top:8px;min-width:250px">${authorizedName || "Authorized Signature"}</div>
            <div>${authorizedDesignation}</div>
            <div>${company}</div>
          </div>
        </div>
      </div>`);
  };

  const printProfile = () => {
    if (!selectedT) { alert("Select member"); return; }
    const logs = data.teamLogs.filter(x => x.memberId === selectedT.id).slice().reverse().slice(0, 10);
    const logsHTML = logs.map(l => `<tr><td>${l.date || ""}</td><td>${l.type || ""}</td><td>${l.title || l.notes || ""}</td><td>Rs ${fmtMoney(l.amount || 0)}</td><td>${l.status || ""}</td><td>${l.rating || 0}</td></tr>`).join("");
    const company = data.settings?.exportName || "DIGITAL TARGET";
    const logoData = data.settings?.logo?.data || "";
    const logoBlock = logoData ? `<img src="${logoData}" alt="logo" style="height:54px;object-fit:contain"/>` : "";
    const myAssigns = data.assignments.filter((a: any) => a.memberId === selectedT.id).slice(0, 10);
    const assignsHTML = myAssigns.map((a: any) => `<tr><td>${a.title || ""}</td><td>${a.category || ""}</td><td>${a.deadline ? new Date(a.deadline).toLocaleString() : "-"}</td><td>Rs ${fmtMoney(a.rate || 0)}</td><td>${a.status || ""}</td></tr>`).join("");
    const myPayouts = data.payouts.filter((p: any) => p.memberId === selectedT.id).slice(0, 10);
    const payoutsHTML = myPayouts.map((p: any) => `<tr><td>${p.date || ""}</td><td>Rs ${fmtMoney(p.amount || 0)}</td><td>${p.note || "-"}</td></tr>`).join("");
    printElementHTML(`<div style="padding:18px;font-family:system-ui,sans-serif;border:3px solid #6366f1;border-radius:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #111;padding-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px">${logoBlock}<div><div style="font-size:18px;font-weight:900">${company}</div><div style="font-size:12px;color:#666">Team Profile Card</div></div></div>
        <div style="text-align:right;font-size:12px"><b>Issued:</b> ${todayISO()}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div><b>Name:</b> ${selectedT.name || ""}</div>
        <div><b>Role:</b> ${selectedT.role || ""}</div>
        <div><b>Status:</b> ${selectedT.status || "Active"}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px">
        <div><b>Type:</b> ${selectedT.memberType || "Employee"}</div>
        <div><b>Dept:</b> ${selectedT.department || "-"}</div>
        <div><b>Rating:</b> ${avgRating || 0} / 5</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px">
        <div><b>Joined:</b> ${selectedT.joined || ""}</div>
        <div><b>Experience:</b> ${humanDuration(selectedT.joined || "", todayISO())}</div>
        <div><b>Projects:</b> ${selectedT.projectsDone || 0}</div>
      </div>
      <hr/>
      <h3>Assigned Tasks</h3>
      <table><thead><tr><th>Title</th><th>Category</th><th>Deadline</th><th>Rate</th><th>Status</th></tr></thead>
      <tbody>${assignsHTML || '<tr><td colspan="5">No assignments</td></tr>'}</tbody></table>
      <h3 style="margin-top:14px">Payout History</h3>
      <table><thead><tr><th>Date</th><th>Amount</th><th>Note</th></tr></thead>
      <tbody>${payoutsHTML || '<tr><td colspan="3">No payouts</td></tr>'}</tbody></table>
      <h3 style="margin-top:14px">Recent Work Logs</h3>
      <table><thead><tr><th>Date</th><th>Type</th><th>Title</th><th>Amount</th><th>Status</th><th>Rating</th></tr></thead>
      <tbody>${logsHTML || '<tr><td colspan="6">No logs</td></tr>'}</tbody></table>
    </div>`);
  };

  return (
    <section className="card">
      <h2>Team Management</h2>

      <div className="grid3">
        <div><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ali Raza" /></div>
        <div><label>Role</label><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Video Editor / Designer" /></div>
        <div><label>Status</label>
          <select value={tStatus} onChange={(e) => setTStatus(e.target.value)}>
            <option>Active</option><option>On Hold</option><option>Inactive</option>
          </select>
        </div>
      </div>
      <div className="grid3">
        <div><label>Total Payout / Khata</label><input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 5000" /></div>
        <div><label>Joined Since</label><input type="date" value={joined} onChange={(e) => setJoined(e.target.value)} /></div>
        <div><label>Rating</label><input type="number" min="0" max="5" step="0.1" value={rating} onChange={(e) => setRating(e.target.value)} placeholder="e.g. 4.8" /></div>
      </div>
      <div className="grid3">
        <div><label>Assigned Work / Main Skill</label><input value={work} onChange={(e) => setWork(e.target.value)} placeholder="e.g. Reel editing / Poster" /></div>
        <div><label>Projects Done</label><input type="number" min="0" value={projectsDone} onChange={(e) => setProjectsDone(e.target.value)} placeholder="e.g. 12" /></div>
        <div><label>Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Fast editor / remote" /></div>
      </div>
      <div className="grid3">
        <div><label>Member Type</label>
          <select value={memberType} onChange={(e) => setMemberType(e.target.value)}>
            {memberTypes.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div><label>Department / Domain</label><input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Media / Design / Marketing" /></div>
        <div><label>Certificate Default</label>
          <select value={certificateType} onChange={(e) => setCertificateType(e.target.value)}>
            <option value="experience">Experience Certificate</option>
            <option value="employment">Employment Certificate</option>
            <option value="internship">Internship / Training</option>
            <option value="appreciation">Appreciation Certificate</option>
            <option value="service">Service / Association Letter</option>
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btnSolid" onClick={handleAdd}>Save Team Member</button>
        <button className="btnSmall" onClick={printTeamSheet}>Export Team</button>
      </div>

      <hr />

      {/* Side-by-side: Team Table + Member Portal */}
      <div className="grid2">
        <div className="card" style={{ boxShadow: "none" }}>
          <h2 style={{ marginBottom: 6 }}>Saved Team Members</h2>
          <div className="kpi" style={{ marginBottom: 10 }}><div className="t">Total Due</div><div className="v">Rs {fmtMoney(totalDue)}</div></div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Name</th><th>Role / Type</th><th>Status</th><th>Total</th><th>Paid</th><th>Due</th><th>Rating</th><th>Action</th></tr></thead>
              <tbody>
                {data.team.map(t => {
                  const due = teamDue(t);
                  const r2 = calcMemberAverageRating(t.id, data.teamLogs) || +(t.rating || 0);
                  return (
                    <tr key={t.id}>
                      <td><b>{t.name}</b><div className="small">{t.work || ""}</div></td>
                      <td>{t.role || ""}<div className="small">{t.memberType || "Employee"}</div></td>
                      <td><span className={`badge ${(t.status || "Active") === "Active" ? "ok" : "warn"}`}>{t.status || "Active"}</span></td>
                      <td>{fmtMoney(t.rate || 0)}</td>
                      <td>{fmtMoney(t.paid || 0)}</td>
                      <td><b>{fmtMoney(due)}</b></td>
                      <td>{r2 || 0} / 5</td>
                      <td className="rowActions">
                        <button className="btnSmall" onClick={() => selectProfile(t.id)}>Open</button>
                        <button className="btnSmall" onClick={() => editTeam(t)}>Edit</button>
                        <button className="btnSmall" onClick={() => { if (confirm("Delete?")) removeItem("team", t.id); }}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ boxShadow: "none" }}>
          <h2 style={{ marginBottom: 6 }}>Member Portal</h2>
          <div className="grid2">
            <div><label>Select Member</label>
              <select value={selectedMember} onChange={(e) => selectProfile(e.target.value)}>
                <option value="">Select...</option>
                {data.team.map(t => <option key={t.id} value={t.id}>{t.name} ({t.role || "No role"})</option>)}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button className="btnSmall" onClick={printCertificate}>Print Certificate</button>
              <button className="btnSmall" onClick={printProfile}>Print Profile</button>
            </div>
          </div>
          <div className="grid3" style={{ marginTop: 10 }}>
            <div><label>Certificate Type</label>
              <select value={teamCertType} onChange={(e) => setTeamCertType(e.target.value)}>
                <option value="experience">Experience Certificate</option>
                <option value="employment">Employment Certificate</option>
                <option value="internship">Internship / Training</option>
                <option value="appreciation">Appreciation Certificate</option>
                <option value="service">Service / Association Letter</option>
              </select>
            </div>
            <div><label>Purpose / Issue For</label><input value={teamCertPurpose} onChange={(e) => setTeamCertPurpose(e.target.value)} placeholder="e.g. Job application / visa / learning record" /></div>
            <div><label>Manual Experience Start (optional)</label><input type="date" value={teamCertStart} onChange={(e) => setTeamCertStart(e.target.value)} /></div>
          </div>

          {selectedT && (
            <div className="card" style={{ boxShadow: "none", marginTop: 12 }}>
              <div className="grid3">
                <div><div className="small">Name</div><div><b>{selectedT.name || ""}</b></div></div>
                <div><div className="small">Role</div><div>{selectedT.role || ""}</div></div>
                <div><div className="small">Status</div><div><span className={`badge ${(selectedT.status || "Active") === "Active" ? "ok" : "warn"}`}>{selectedT.status || "Active"}</span></div></div>
              </div>
              <div className="grid3" style={{ marginTop: 10 }}>
                <div><div className="small">Member Type</div><div>{selectedT.memberType || "Employee"}</div></div>
                <div><div className="small">Department</div><div>{selectedT.department || "-"}</div></div>
                <div><div className="small">Certificate</div><div>{getCertificateTypeLabel(selectedT.certificateType || "experience")}</div></div>
              </div>
              <div className="grid3" style={{ marginTop: 10 }}>
                <div><div className="small">Joined</div><div>{selectedT.joined || ""}</div></div>
                <div><div className="small">Experience</div><div>{humanDuration(selectedT.joined || "", todayISO())}</div></div>
                <div><div className="small">Projects Done</div><div>{String(selectedT.projectsDone || 0)}</div></div>
              </div>
              <div className="grid3" style={{ marginTop: 10 }}>
                <div><div className="small">Average Rating</div><div>{avgRating || 0} / 5</div></div>
                <div><div className="small">Total Khata</div><div>{fmtMoney(selectedT.rate || 0)}</div></div>
                <div><div className="small">Paid / Due</div><div>{fmtMoney(selectedT.paid || 0)} / <b>{fmtMoney(teamDue(selectedT))}</b></div></div>
              </div>
              <div style={{ marginTop: 10 }}><div className="small">Main Skill / Work</div><div>{selectedT.work || "-"}</div></div>
              <div style={{ marginTop: 10 }}><div className="small">Notes</div><div>{selectedT.notes || "-"}</div></div>
              <div style={{ marginTop: 10 }}><div className="small">Last Activity</div><div>{selectedT.lastActivity || "-"}</div></div>
              <div style={{ marginTop: 12 }}>
                <div className="small">Recent Logs ({memberLogs.length}) | Payout Entries: {memberPayoutCount}</div>
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {memberLogs.length ? memberLogs.map(l => (
                    <div key={l.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
                      <b>{l.title || l.type || "Log"}</b>
                      <div className="small">{l.date || ""} · {l.status || ""}</div>
                      <div>{l.notes || "-"}</div>
                    </div>
                  )) : <div className="small">No work logs yet.</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <hr />
      {/* Work Log + Payout */}
      <div className="grid2">
        <div className="card" style={{ boxShadow: "none" }}>
          <h2 style={{ marginBottom: 6 }}>Assign Work / Add Progress</h2>
          <div className="grid2">
            <div><label>Member</label>
              <select value={taskMember} onChange={(e) => setTaskMember(e.target.value)}>
                <option value="">Select...</option>
                {data.team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div><label>Date</label><input type="date" value={taskDate} onChange={(e) => setTaskDate(e.target.value)} /></div>
          </div>
          <div className="grid2">
            <div><label>Project / Work Title</label><input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="e.g. 10 reels editing" /></div>
            <div><label>Task Status</label>
              <select value={taskStatus} onChange={(e) => setTaskStatus(e.target.value)}>
                <option>Assigned</option><option>In Progress</option><option>Completed</option><option>Revision</option>
              </select>
            </div>
          </div>
          <div className="grid3">
            <div><label>Task Amount</label><input type="number" value={taskAmount} onChange={(e) => setTaskAmount(e.target.value)} placeholder="0" /></div>
            <div><label>Rating</label><input type="number" min="0" max="5" step="0.1" value={taskRating} onChange={(e) => setTaskRating(e.target.value)} placeholder="0-5" /></div>
            <div><label>Projects Count Add</label><input type="number" min="0" value={taskProjectCount} onChange={(e) => setTaskProjectCount(e.target.value)} placeholder="e.g. 1" /></div>
          </div>
          <div><label>Notes</label><input value={taskNotes} onChange={(e) => setTaskNotes(e.target.value)} placeholder="brief details / delivery / feedback" /></div>
          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <button className="btnSolid" onClick={handleAddTask}>Save Work Log</button>
            <button className="btnDanger" onClick={() => { setTaskTitle(""); setTaskAmount(""); setTaskRating(""); setTaskProjectCount(""); setTaskNotes(""); }}>Clear</button>
          </div>
        </div>

        <div className="card" style={{ boxShadow: "none" }}>
          <h2 style={{ marginBottom: 6 }}>Team Payout</h2>
          <div className="grid2">
            <div><label>Member</label>
              <select value={payMember} onChange={(e) => { setPayMember(e.target.value); selectProfile(e.target.value); }}>
                <option value="">Select...</option>
                {data.team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div><label>Date</label><input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></div>
          </div>
          <div className="grid2">
            <div><label>Amount Paid</label><input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0" /></div>
            <div><label>Account</label>
              <select value={payWallet} onChange={(e) => setPayWallet(e.target.value)}>
                <option value="">Select...</option>
                {data.wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>
          <div><label>Notes</label><input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="optional" /></div>
          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <button className="btnSolid" onClick={handlePayout}>Save Payout</button>
            <button className="btnDanger" onClick={() => { setPayAmount(""); setPayNote(""); }}>Clear</button>
          </div>
        </div>
      </div>

      {/* Work Logs & Payout History Table */}
      <div className="card" style={{ boxShadow: "none", marginTop: 12 }}>
        <h2 style={{ marginBottom: 6 }}>Work Logs & Payout History</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Date</th><th>Member</th><th>Type</th><th>Title / Notes</th><th>Amount</th><th>Status</th><th>Rating</th><th>Action</th></tr></thead>
            <tbody>
              {data.teamLogs.slice().sort((a: any, b: any) => String(b.date || "").localeCompare(String(a.date || ""))).map((l: any) => {
                const t = data.team.find(x => x.id === l.memberId);
                return (
                  <tr key={l.id}>
                    <td>{l.date || ""}</td>
                    <td>{t?.name || ""}</td>
                    <td>{l.type || ""}</td>
                    <td><b>{l.title || ""}</b><div className="small">{l.notes || ""}</div></td>
                    <td>{fmtMoney(l.amount || 0)}</td>
                    <td>{l.status || ""}</td>
                    <td>{String(l.rating || 0)}</td>
                    <td className="rowActions">
                      <button className="btnSmall" onClick={() => { if (confirm("Delete?")) removeItem("teamLogs", l.id); }}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
