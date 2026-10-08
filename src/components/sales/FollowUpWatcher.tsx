import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { notify } from "@/lib/salesStore";
import { followUpIsDue, statusLabel } from "@/lib/salesPipeline";

/**
 * When a follow-up time arrives, the person handling the lead gets a bell +
 * browser notification (once per follow-up). Own leads for an assistant;
 * unassigned leads and own leads for the CEO / lead managers.
 */
export default function FollowUpWatcher() {
  const { workspaceUid, user, can, roleDoc } = useAuth();
  const { data } = useData();
  const ref = useRef(data.leads);
  ref.current = data.leads;
  const teamId = roleDoc?.teamId || "";
  const seesAll = can("leads.view");

  useEffect(() => {
    if (!workspaceUid || !user || !(seesAll || can("leads.own"))) return;
    const tick = () => {
      const now = new Date();
      for (const l of ref.current) {
        const mine = (teamId && l.assignedTo === teamId) || (seesAll && !l.assignedTo);
        if (!mine || !followUpIsDue(l, now)) continue;
        notify(workspaceUid, user.uid, [user.uid], `fu-${l.id}-${l.followUpDate}${l.followUpTime || ""}`, {
          type: "lead.followup",
          title: `Follow-up: ${l.name}`,
          body: [l.followUpNote, `${l.followUpDate}${l.followUpTime ? ` ${l.followUpTime}` : ""}`, statusLabel(l.status)].filter(Boolean).join(" • "),
          link: { tab: "sales", openLead: l.id },
        }).catch(() => undefined);
      }
    };
    tick();
    const t = window.setInterval(tick, 30000);
    return () => window.clearInterval(t);
  }, [workspaceUid, user, teamId, seesAll, can]);

  return null;
}
