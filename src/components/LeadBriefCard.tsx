import React from "react";
import type { LeadBrief } from "@/lib/leadAgent";

const STAGE_CLS: Record<string, string> = { "Ready to buy": "ok", "Comparing price": "warn", Exploring: "pri", "New inquiry": "", Customer: "ok", "Not interested": "bad" };

/** The lead agent's brief: summary, stage, VIP, objections and next steps. */
export default function LeadBriefCard({ brief, compact = false }: { brief?: LeadBrief | null; compact?: boolean }) {
  if (!brief) return null;
  return (
    <div className={`leadBrief ${brief.vip ? "vip" : ""}`}>
      <div className="leadBriefTags">
        {brief.vip && <span className="badge vipBadge" title={brief.vipReasons.join(" • ")}>⭐ VIP</span>}
        <span className={`badge ${brief.priority === "P1" ? "bad" : brief.priority === "P2" ? "warn" : ""}`}>{brief.priority}</span>
        <span className={`badge ${STAGE_CLS[brief.stage] || ""}`}>{brief.stage}</span>
        {brief.urgency === "urgent" && <span className="badge bad">Jaldi</span>}
        {brief.sentiment === "negative" && <span className="badge bad">Naraz</span>}
      </div>
      <div className="leadBriefSum">🤖 {brief.summary}</div>
      {!compact && (
        <>
          {brief.vip && <div className="small">VIP kyun: {brief.vipReasons.join(" • ")}</div>}
          {brief.objections.length > 0 && <div className="small">Rukawat: {brief.objections.join(" • ")}</div>}
          {brief.actions.length > 0 && <ol className="leadBriefActions">{brief.actions.map((a, i) => <li key={i}>{a}</li>)}</ol>}
          {brief.evidence.length > 0 && <div className="small leadBriefEv">Chat se: {brief.evidence.join(" • ")}</div>}
        </>
      )}
      {compact && brief.actions[0] && <div className="small">→ {brief.actions[0]}</div>}
    </div>
  );
}
