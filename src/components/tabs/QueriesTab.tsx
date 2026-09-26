import React, { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { uid } from "@/lib/db";
import { QueryCard } from "./MyPortalTab";

export default function QueriesTab() {
  const { data, updateItem, removeItem } = useData();
  const { user } = useAuth();
  const [filter, setFilter] = useState("");

  const queries = data.queries
    .filter((q: any) => !filter || (q.status || "Open") === filter)
    .sort((a: any, b: any) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  const reply = async (q: any, text: string) => {
    if (!text.trim()) return;
    const next = {
      ...q,
      messages: [...(q.messages || []), {
        id: uid("M"), from: "mgmt", fromEmail: user?.email || "", text: text.trim(), at: new Date().toISOString(),
      }],
      status: q.status === "Open" ? "In Progress" : q.status,
    };
    await updateItem("queries", next);
  };

  const setStatus = async (q: any, s: string) => {
    await updateItem("queries", { ...q, status: s });
  };

  const counts = {
    open: data.queries.filter((q: any) => (q.status || "Open") === "Open").length,
    progress: data.queries.filter((q: any) => q.status === "In Progress").length,
    resolved: data.queries.filter((q: any) => q.status === "Resolved" || q.status === "Closed").length,
  };

  return (
    <section className="card">
      <h2>Team Queries / Ownership Inbox</h2>
      <div className="kpis" style={{ marginTop: 6 }}>
        <div className="kpi"><div className="t">Open</div><div className="v">{counts.open}</div></div>
        <div className="kpi"><div className="t">In Progress</div><div className="v">{counts.progress}</div></div>
        <div className="kpi"><div className="t">Resolved</div><div className="v">{counts.resolved}</div></div>
      </div>
      <div className="grid2" style={{ marginTop: 10 }}>
        <div><label>Filter</label>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All</option><option>Open</option><option>In Progress</option><option>Resolved</option><option>Closed</option>
          </select>
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {queries.map((q: any) => {
          const member = data.team.find(t => {
            const role = data.team; return false; // not used
          });
          return (
            <div key={q.id}>
              <QueryCard q={q} onReply={reply} onStatus={setStatus} role="mgmt" />
              <div style={{ marginTop: 4, textAlign: "right" }}>
                <button className="btnSmall" onClick={() => { if (confirm("Delete query?")) removeItem("queries", q.id); }}>Delete</button>
              </div>
            </div>
          );
        })}
        {queries.length === 0 && <div className="small">Koi query nahi.</div>}
      </div>
    </section>
  );
}
