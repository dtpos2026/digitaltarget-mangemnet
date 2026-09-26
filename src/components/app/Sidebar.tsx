import React from "react";
import {
  BarChart3, BookOpen, Briefcase, CalendarDays, ClipboardList, FileText, Gauge, HelpCircle, LogOut,
  MessageCircle, Settings, Target, User, Users, UsersRound, Wallet, Receipt, Activity, TrendingUp, type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { roleLabel } from "@/lib/permissions";
import { BrandLogo, BrandMark } from "./BrandMark";

export interface Tab {
  id: string;
  label: string;
  countKey: string;
}

const ICONS: Record<string, LucideIcon> = {
  dash: Gauge, myportal: User, whatsapp: MessageCircle, leads: Target, clients: UsersRound, performance: Activity,
  projects: Briefcase, assignments: ClipboardList, schedule: CalendarDays, queries: HelpCircle, team: Users,
  invoices: Receipt, accounting: BookOpen, khata: FileText, accounts: Wallet, budget: TrendingUp, reports: BarChart3,
  settings: Settings,
};

/** Sidebar sections (tabs the user cannot access are simply not listed). */
export const NAV_GROUPS: { title: string; ids: string[] }[] = [
  { title: "Overview", ids: ["dash", "myportal"] },
  { title: "CRM & Marketing", ids: ["whatsapp", "leads", "clients", "performance"] },
  { title: "Work", ids: ["projects", "assignments", "schedule", "queries", "team"] },
  { title: "Finance", ids: ["invoices", "accounting", "khata", "accounts", "budget", "reports"] },
  { title: "Administration", ids: ["settings"] },
];

interface Props {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  getCount: (key: string) => string | number | null;
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ tabs, activeTab, onTabChange, getCount, open, onClose }: Props) {
  const { user, roleDoc, logout } = useAuth();
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const name = roleDoc?.displayName || user?.email?.split("@")[0] || "User";

  return (
    <>
      <div className={`sideBackdrop ${open ? "open" : ""}`} onClick={onClose} />
      <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Main navigation">
        <div className="sideBrand">
          <BrandLogo size={30} subtitle="Management Portal" />
        </div>
        <nav className="sideNav">
          {NAV_GROUPS.map((g) => {
            const items = g.ids.map((id) => byId.get(id)).filter(Boolean) as Tab[];
            if (!items.length) return null;
            return (
              <div key={g.title} className="sideGroup">
                <div className="sideGroupTitle">{g.title}</div>
                {items.map((tab) => {
                  const Icon = ICONS[tab.id] || FileText;
                  const count = getCount(tab.countKey);
                  return (
                    <button
                      key={tab.id}
                      className={`navbtn ${activeTab === tab.id ? "active" : ""}`}
                      onClick={() => { onTabChange(tab.id); onClose(); }}
                      aria-current={activeTab === tab.id ? "page" : undefined}
                    >
                      <Icon size={18} strokeWidth={2} />
                      <span className="navLabel">{tab.label}</span>
                      {count !== null && count !== "" && <span className="count">{count}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="sideFoot">
          <div className="poweredBy">
            <BrandMark size={22} color="#fff" />
            <div>
              <span>POWERED BY</span>
              <b>Digital Target</b>
            </div>
          </div>
          <div className="sideUser">
            <div className="sideAvatar">{name.slice(0, 1).toUpperCase()}</div>
            <div className="sideUserInfo">
              <b>{name}</b>
              <span>{roleLabel(roleDoc?.role)}</span>
            </div>
            <button className="sideLogout" onClick={logout} title="Logout" aria-label="Logout"><LogOut size={18} /></button>
          </div>
        </div>
      </aside>
    </>
  );
}
