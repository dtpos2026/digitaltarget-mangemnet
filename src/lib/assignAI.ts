// Who should do a task: yourself, the designer, video editor, developer,
// manager or lead manager — from the task type, each member's open work,
// the deadline and this month's money. Rule-based; the suggestion always
// says why, and the user decides.
import { inMonth, monthKey, summarize } from "./finance";

export type RoleKind = "designer" | "video" | "developer" | "manager" | "leads" | "other";

export const ROLE_LABEL: Record<RoleKind, string> = {
  designer: "Designer", video: "Video Editor", developer: "Developer", manager: "Manager", leads: "Lead Manager", other: "Team member",
};

export function roleKind(role: string): RoleKind {
  const r = String(role || "").toLowerCase();
  if (/design|graphic/.test(r)) return "designer";
  if (/video|edit|reel/.test(r)) return "video";
  if (/develop|program|software|web|app/.test(r)) return "developer";
  if (/lead|sales|support/.test(r)) return "leads";
  if (/manag/.test(r)) return "manager";
  return "other";
}

/** Which role a task needs, from its category / title. */
export function taskKind(text: string): RoleKind {
  const t = String(text || "").toLowerCase();
  if (/video|reel|edit|shoot|youtube|animation/.test(t)) return "video";
  if (/design|logo|post|poster|flyer|banner|brand|thumbnail|menu card/.test(t)) return "designer";
  if (/software|website|web |app|pos|develop|code|bug|hosting|domain/.test(t)) return "developer";
  if (/lead|follow|call|whatsapp|client response|sales/.test(t)) return "leads";
  if (/plan|meeting|report|campaign|ads|manage/.test(t)) return "manager";
  return "other";
}

const OPEN = (s: string) => !/complete|done|approved|cancel|delivered/i.test(s || "");

export interface AssignSuggestion {
  who: "self" | "member";
  memberId: string;
  memberName: string;
  role: RoleKind;
  reason: string;
  /** Other options with a one-line reason each. */
  alternatives: { memberId: string; memberName: string; reason: string }[];
}

/**
 * Suggests an owner for a task.
 * `cost` = what paying a team member for it would cost (the assignment rate).
 */
export function suggestAssignee(
  data: any,
  task: { title: string; category?: string; deadline?: string; cost?: number },
  today = new Date()
): AssignSuggestion {
  const need = taskKind(`${task.category || ""} ${task.title || ""}`);
  const team = (data.team || []).filter((t: any) => (t.status || "Active") !== "Inactive");
  const load = (id: string) => (data.assignments || []).filter((a: any) => a.memberId === id && OPEN(a.status) && !a.archivedMonth).length;
  const lateFor = (id: string) => (data.assignments || []).filter((a: any) => a.memberId === id && OPEN(a.status) && a.deadline && String(a.deadline).slice(0, 10) < today.toISOString().slice(0, 10)).length;
  const month = summarize(inMonth(data.accounting || [], monthKey(today)), data.settings);
  const daysLeft = task.deadline ? Math.ceil((new Date(String(task.deadline).slice(0, 16)).getTime() - today.getTime()) / 864e5) : 99;
  const cost = Number(task.cost) || 0;

  const ranked = team
    .map((t: any) => {
      const kind = roleKind(t.role);
      const l = load(t.id);
      const late = lateFor(t.id);
      let score = kind === need ? 100 : kind === "manager" ? 30 : kind === "other" ? 20 : 0;
      score -= l * 12 + late * 20;
      const why = [
        kind === need ? `${ROLE_LABEL[kind]} hai` : `${ROLE_LABEL[kind]} (kaam ki qisam alag)`,
        l ? `${l} kaam khule hain` : "abhi free hai",
        late ? `${late} late` : "",
      ].filter(Boolean).join(", ");
      return { t, kind, score, why, l };
    })
    .sort((a: any, b: any) => b.score - a.score);

  const best = ranked[0];
  const tightMoney = month.income > 0 ? month.netSaving < 0 || (cost > 0 && cost > Math.max(0, month.netSaving) * 0.3) : cost > 0;

  // Money is tight and the task is not urgent → do it yourself for now.
  if (tightMoney && cost > 0 && daysLeft > 2 && (!best || best.kind !== need || best.l >= 2)) {
    return {
      who: "self", memberId: "", memberName: "Aap khud", role: need,
      reason: `Is mahine net saving Rs ${Math.round(month.netSaving).toLocaleString("en-PK")} hai aur is kaam ka kharcha Rs ${cost.toLocaleString("en-PK")} — budget kam hai, abhi ye kaam khud manage kar sakte hain.`,
      alternatives: ranked.slice(0, 2).map((r: any) => ({ memberId: r.t.id, memberName: r.t.name, reason: r.why })),
    };
  }
  if (!best || best.score <= 0) {
    return {
      who: "self", memberId: "", memberName: "Aap khud", role: need,
      reason: `Team mein ${ROLE_LABEL[need]} available nahi (ya sab busy hain) — ya khud karein ya freelancer / outsource karein.`,
      alternatives: ranked.slice(0, 2).map((r: any) => ({ memberId: r.t.id, memberName: r.t.name, reason: r.why })),
    };
  }
  const urgency = daysLeft <= 2 ? ` Deadline ${daysLeft <= 0 ? "aaj / guzar chuki" : `${daysLeft} din`} hai, is liye kam load wala member behtar hai.` : "";
  return {
    who: "member", memberId: best.t.id, memberName: best.t.name, role: best.kind,
    reason: `Current workload aur kaam ki qisam ke mutabiq ${best.t.name} (${best.why}) ko dena munasib hai.${urgency}`,
    alternatives: ranked.slice(1, 3).map((r: any) => ({ memberId: r.t.id, memberName: r.t.name, reason: r.why })),
  };
}
