// Lead rows for Excel / PDF: every field the owner needs, including the AI
// analysis. One place so both exports always match.
import { Cell, Sheet } from "./xlsx";
import { LEAD_TYPE_LABEL } from "./leadAnalysis";

export const LEAD_COLUMNS = [
  "Name", "Phone", "WhatsApp", "Category", "Service", "Status", "Interest", "Interest %", "Lead type", "Source",
  "Potential value (Rs)", "Follow-up", "Next action", "Last message", "Meeting", "Added", "Labels", "Notes",
] as const;
export const LEAD_WIDTHS = [22, 16, 16, 20, 26, 14, 10, 10, 14, 12, 16, 12, 44, 44, 12, 12, 18, 50];

const levelName = (l?: string) => (l === "Hot" ? "High" : l === "Warm" ? "Medium" : l === "Cold" ? "Low" : "");

export function leadRow(l: any): Cell[] {
  const ai = l.ai || {};
  return [
    l.name || "", l.phone || "", l.whatsapp || "", ai.category || l.category || "", l.serviceType || ai.line || "", l.status || "",
    levelName(ai.level), typeof ai.interest === "number" ? ai.interest : "", LEAD_TYPE_LABEL[(l.leadType || ai.leadType) as keyof typeof LEAD_TYPE_LABEL] || "",
    l.source || "", ai.potentialValue || "", l.followUpDate || ai.followUp?.date || "", ai.nextAction || "", ai.lastMessage || "",
    l.meetingDate || "", String(l.date || l.createdAt || "").slice(0, 10), Array.isArray(l.waLabels) ? l.waLabels.join(", ") : "", String(l.notes || "").replace(/\s+/g, " ").slice(0, 300),
  ];
}

export function leadsSheets(leads: any[]): Sheet[] {
  const count = (f: (l: any) => boolean) => leads.filter(f).length;
  return [
    { name: "Leads", rows: [[...LEAD_COLUMNS], ...leads.map(leadRow)], widths: LEAD_WIDTHS },
    {
      name: "Summary",
      widths: [28, 14],
      rows: [
        ["Summary", "Count"],
        ["Total leads", leads.length],
        ["High interest", count((l) => l.ai?.level === "Hot")],
        ["Medium interest", count((l) => l.ai?.level === "Warm")],
        ["Low interest", count((l) => l.ai?.level === "Cold")],
        ["Ads leads", count((l) => (l.leadType || l.ai?.leadType) === "ads")],
        ["Converted", count((l) => l.status === "Converted")],
        ["Lost", count((l) => l.status === "Lost")],
      ],
    },
  ];
}
