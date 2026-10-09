import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { CardBrand, CardPerson } from "@/lib/salesCard";
import { activeAssistants, salesSettingsOf } from "@/lib/salesPipeline";

/** Company branding for cards / messages. */
export function brandOf(settings: any): CardBrand {
  return {
    companyName: settings?.companyName || settings?.exportName || "Digital Target",
    logo: settings?.logo?.data || "",
    phone: settings?.phone || "",
    website: settings?.companyWebsite || "",
    footer: settings?.footer || "",
  };
}

/** Sales profile of a team member (name, designation, phone, photo) for cards. */
export function personOf(team: any[], teamId: string, fallback: Partial<CardPerson> = {}): CardPerson {
  const t = team.find((x) => x.id === teamId);
  return {
    name: t?.name || fallback.name || "Sales Team",
    designation: t?.designation || t?.role || fallback.designation || "Sales Consultant",
    phone: t?.phone || t?.whatsapp || fallback.phone || "",
    email: t?.email || fallback.email || "",
    photo: t?.photo || fallback.photo || "",
  };
}

/**
 * Brand + the profiles this user may put on a card: an assistant only their
 * own; the CEO / admin any sales assistant or themselves.
 */
export function useSalesBrand() {
  const { data } = useData();
  const { roleDoc, user, can } = useAuth();
  const brand = brandOf(data.settings);
  const myTeamId = roleDoc?.teamId || "";
  const me = personOf(data.team, myTeamId, { name: roleDoc?.displayName || user?.email?.split("@")[0] || "", phone: data.settings?.phone || "", email: user?.email || "" });
  const sales = salesSettingsOf(data.settings);
  const profiles: { teamId: string; person: CardPerson }[] = can("leads.view")
    ? [
        { teamId: myTeamId, person: me },
        ...activeAssistants(sales).filter((a) => a.teamId !== myTeamId).map((a) => ({ teamId: a.teamId, person: personOf(data.team, a.teamId, { name: a.name }) })),
      ]
    : [{ teamId: myTeamId, person: me }];
  return { brand, me, myTeamId, profiles };
}

/** Who is acting, for history entries: email, display name and role (admin / assistant). */
export function useActor() {
  const { data } = useData();
  const { roleDoc, user, can } = useAuth();
  const t = data.team.find((x: any) => x.id === roleDoc?.teamId);
  return {
    by: user?.email || "",
    who: t?.name || roleDoc?.displayName || user?.email?.split("@")[0] || "",
    role: (can("leads.edit") ? "admin" : "assistant") as "admin" | "assistant",
  };
}
