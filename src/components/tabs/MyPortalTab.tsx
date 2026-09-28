import React, { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { fmtMoney, todayISO, uid } from "@/lib/db";
import { activeOnly } from "@/lib/closing";

const STATUS_OPTIONS = ["Assigned", "In Progress", "Submitted", "Revision", "Completed"];

export default function MyPortalTab() {
  const { data, updateItem, addItem } = useData();
  const { roleDoc, user } = useAuth();
  const teamId = roleDoc?.teamId || "";

  const me = useMemo(() => data.team.find(t => t.id === teamId), [data.team, teamId]);
  const myAssignments = activeOnly(data.assignments)
    .filter((a: any) => a.memberId === teamId)
    .sort((a: any, b: any) => String(b.assignedAt || "").localeCompare(String(a.assignedAt || "")));
  const myLogs = data.teamLogs.filter((l: any) => l.memberId === teamId);
  const myPayouts = data.payouts.filter((p: any) => p.memberId === teamId);
  const mySchedule = activeOnly(data.schedule).filter((s: any) => s.assignedTo === teamId);
  const myQueries = data.queries
    .filter((q: any) => q.memberId === teamId)
    .sort((a: any, b: any) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  const totalEarned = (me?.rate || 0);
  const totalPaid = (me?.paid || 0);
  const totalDue = Math.max(0, totalEarned - totalPaid);
  const avgRating = (() => {
    const r = myLogs.filter((x: any) => +x.rating > 0).map((x: any) => +x.rating);
    if (!r.length) return me?.rating || 0;
    return +(r.reduce((a, b) => a + b, 0) / r.length).toFixed(1);
  })();

  // Per-task chat
  const [activeChat, setActiveChat] = useState<string>("");
  const [msg, setMsg] = useState("");

  const sendMsg = async (a: any) => {
    if (!msg.trim()) return;
    const next = {
      ...a,
      messages: [...(a.messages || []), {
        id: uid("M"), from: "member", fromEmail: user?.email || "", text: msg.trim(), at: new Date().toISOString(),
      }],
    };
    await updateItem("assignments", next);
    setMsg("");
  };

  const updateStatus = async (a: any, s: string) => {
    await updateItem("assignments", { ...a, status: s });
  };

  // New ownership query
  const [qSubject, setQSubject] = useState("");
  const [qBody, setQBody] = useState("");
  const sendQuery = async () => {
    if (!qSubject.trim() || !qBody.trim()) { alert("Subject + message likhein"); return; }
    await addItem("queries", {
      id: uid("Q"),
      memberId: teamId,
      memberEmail: user?.email || "",
      subject: qSubject.trim(),
      status: "Open",
      createdAt: new Date().toISOString(),
      messages: [{ id: uid("M"), from: "member", fromEmail: user?.email || "", text: qBody.trim(), at: new Date().toISOString() }],
    });
    setQSubject(""); setQBody("");
    alert("Query bhej di gayi ✅");
  };

  const replyQuery = async (q: any, text: string) => {
    if (!text.trim()) return;
    const next = {
      ...q,
      messages: [...(q.messages || []), {
        id: uid("M"), from: "member", fromEmail: user?.email || "", text: text.trim(), at: new Date().toISOString(),
      }],
    };
    await updateItem("queries", next);
  };

  if (!teamId || !me) {
    return (
      <section className="card">
        <h2>My Portal</h2>
        <div style={{ padding: 20, textAlign: "center" }}>
          <p>Aap ka account abhi tak kisi <b>Team Member record</b> se link nahi hua.</p>
          <p className="small" style={{ marginTop: 6 }}>Apne admin/manager se kahein ke woh Settings → User Management se aap ko link karein.</p>
        </div>
      </section>
    );
  }

  return (
    <>
      {/* Profile Header */}
      <section className="card">
        <h2>Welcome, {me.name}</h2>
        <div className="kpis" style={{ marginTop: 8 }}>
          <div className="kpi"><div className="t">Average Rating</div><div className="v">⭐ {avgRating} / 5</div></div>
          <div className="kpi"><div className="t">Projects Done</div><div className="v">{me.projectsDone || 0}</div></div>
          <div className="kpi"><div className="t">Active Tasks</div><div className="v">{myAssignments.filter((a: any) => !["Completed", "Cancelled"].includes(a.status)).length}</div></div>
          <div className="kpi"><div className="t">Total Earned</div><div className="v">Rs {fmtMoney(totalEarned)}</div></div>
          <div className="kpi"><div className="t">Paid</div><div className="v">Rs {fmtMoney(totalPaid)}</div></div>
          <div className="kpi"><div className="t">Due</div><div className="v">Rs {fmtMoney(totalDue)}</div></div>
        </div>
        <div className="grid3" style={{ marginTop: 12 }}>
          <div><div className="small">Role</div><div><b>{me.role || "—"}</b></div></div>
          <div><div className="small">Department</div><div>{me.department || "—"}</div></div>
          <div><div className="small">Status</div><div><span className={`badge ${me.status === "Active" ? "ok" : "warn"}`}>{me.status || "Active"}</span></div></div>
        </div>
      </section>

      {/* My Assignments */}
      <section className="card" style={{ marginTop: 14 }}>
        <h2>My Assigned Work ({myAssignments.length})</h2>
        {myAssignments.length === 0 && <div className="small">Abhi koi task assign nahi hai.</div>}
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {myAssignments.map((a: any) => {
            const isOpen = activeChat === a.id;
            const overdue = a.deadline && new Date(a.deadline) < new Date() && !["Completed", "Cancelled"].includes(a.status);
            return (
              <div key={a.id} className="subcard">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: 1 }}>
                    <div><b>{a.title}</b> <span className="badge pri" style={{ marginLeft: 6 }}>{a.category}</span>
                      {overdue && <span className="badge bad" style={{ marginLeft: 6 }}>OVERDUE</span>}
                    </div>
                    <div className="small" style={{ marginTop: 4 }}>
                      Deadline: {a.deadline ? new Date(a.deadline).toLocaleString() : "—"} • Rate: Rs {fmtMoney(a.rate || 0)}
                    </div>
                    {a.description && <div style={{ marginTop: 6, fontSize: 13, whiteSpace: "pre-wrap" }}>{a.description}</div>}
                    {a.driveLink && (
                      <div style={{ marginTop: 6 }}>
                        <a className="btnSmall" href={a.driveLink} target="_blank" rel="noreferrer">Open Drive / Content</a>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 160 }}>
                    <label>Update Status</label>
                    <select value={a.status || "Assigned"} onChange={(e) => updateStatus(a, e.target.value)}>
                      {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                    </select>
                    <button className="btnSmall" onClick={() => setActiveChat(isOpen ? "" : a.id)}>
                      💬 {isOpen ? "Close" : "Open"} Chat ({(a.messages || []).length})
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                    <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                      {(a.messages || []).length === 0 && <div className="small">Koi message nahi. Apni update yahan bhejein 👇</div>}
                      {(a.messages || []).map((m: any) => (
                        <div key={m.id} style={{
                          alignSelf: m.from === "member" ? "flex-end" : "flex-start",
                          background: m.from === "member" ? "rgba(99,102,241,.12)" : "rgba(16,185,129,.12)",
                          padding: "8px 12px", borderRadius: 12, maxWidth: "75%",
                        }}>
                          <div style={{ fontSize: 13 }}>{m.text}</div>
                          <div className="small" style={{ marginTop: 2 }}>{m.fromEmail || m.from} • {new Date(m.at).toLocaleString()}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Apna message likhein..." onKeyDown={(e) => { if (e.key === "Enter") sendMsg(a); }} />
                      <button className="btnSolid" onClick={() => sendMsg(a)}>Send</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* My Schedule */}
      <section className="card" style={{ marginTop: 14 }}>
        <h2>My Schedule ({mySchedule.length})</h2>
        {mySchedule.length === 0 && <div className="small">Koi schedule entry nahi.</div>}
        <div className="tablewrap" style={{ marginTop: 8 }}>
          <table>
            <thead><tr><th>Date</th><th>Title</th><th>Time</th><th>Status</th></tr></thead>
            <tbody>
              {mySchedule.map((s: any) => (
                <tr key={s.id}><td>{s.date || s.dateISO || "—"}</td><td>{s.title || s.task || "—"}</td><td>{s.time || "—"}</td><td>{s.status || "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* My Payouts */}
      <section className="card" style={{ marginTop: 14 }}>
        <h2>My Payouts ({myPayouts.length})</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Date</th><th>Amount</th><th>Note</th></tr></thead>
            <tbody>
              {myPayouts.length === 0 && <tr><td colSpan={3}>Koi payout history nahi.</td></tr>}
              {myPayouts.map((p: any) => (
                <tr key={p.id}><td>{p.date}</td><td>Rs {fmtMoney(p.amount)}</td><td>{p.note || "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* My Work Logs */}
      <section className="card" style={{ marginTop: 14 }}>
        <h2>My Work History ({myLogs.length})</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Title</th><th>Amount</th><th>Status</th><th>Rating</th></tr></thead>
            <tbody>
              {myLogs.length === 0 && <tr><td colSpan={6}>Koi work log nahi.</td></tr>}
              {myLogs.slice().reverse().map((l: any) => (
                <tr key={l.id}><td>{l.date}</td><td>{l.type}</td><td>{l.title || l.notes || "—"}</td><td>Rs {fmtMoney(l.amount || 0)}</td><td>{l.status || "—"}</td><td>{l.rating || 0}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Queries / Ownership module */}
      <section className="card" style={{ marginTop: 14 }}>
        <h2>Send Query to Management</h2>
        <div className="grid2">
          <div><label>Subject</label><input value={qSubject} onChange={(e) => setQSubject(e.target.value)} placeholder="e.g. Payment query / Leave request" /></div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btnSolid" onClick={sendQuery}>Send Query</button>
          </div>
        </div>
        <div><label>Message</label><textarea value={qBody} onChange={(e) => setQBody(e.target.value)} placeholder="Apna sawaal / message likhein..." /></div>

        <hr />
        <h3 style={{ margin: "8px 0" }}>My Queries ({myQueries.length})</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {myQueries.map((q: any) => (
            <QueryCard key={q.id} q={q} onReply={replyQuery} role="member" />
          ))}
          {myQueries.length === 0 && <div className="small">Koi query nahi.</div>}
        </div>
      </section>
    </>
  );
}

export function QueryCard({ q, onReply, onStatus, role }: { q: any; onReply: (q: any, t: string) => void; onStatus?: (q: any, s: string) => void; role: "member" | "mgmt" }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  return (
    <div className="subcard">
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <b>{q.subject}</b>
          <div className="small">From: {q.memberEmail} • {new Date(q.createdAt).toLocaleString()}</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {onStatus ? (
            <select value={q.status || "Open"} onChange={(e) => onStatus(q, e.target.value)}>
              <option>Open</option><option>In Progress</option><option>Resolved</option><option>Closed</option>
            </select>
          ) : (
            <span className={`badge ${q.status === "Resolved" || q.status === "Closed" ? "ok" : "warn"}`}>{q.status || "Open"}</span>
          )}
          <button className="btnSmall" onClick={() => setOpen(!open)}>💬 {open ? "Close" : "Open"} ({(q.messages || []).length})</button>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {(q.messages || []).map((m: any) => (
              <div key={m.id} style={{
                alignSelf: m.from === role ? "flex-end" : "flex-start",
                background: m.from === role ? "rgba(99,102,241,.12)" : "rgba(16,185,129,.12)",
                padding: "8px 12px", borderRadius: 12, maxWidth: "75%",
              }}>
                <div style={{ fontSize: 13 }}>{m.text}</div>
                <div className="small">{m.fromEmail || m.from} • {new Date(m.at).toLocaleString()}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply..." onKeyDown={(e) => { if (e.key === "Enter") { onReply(q, text); setText(""); } }} />
            <button className="btnSolid" onClick={() => { onReply(q, text); setText(""); }}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}
