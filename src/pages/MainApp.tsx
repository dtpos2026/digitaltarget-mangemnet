import React, { useState, useMemo, useEffect } from "react";
import { useAuth, UserRole } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import Sidebar from "@/components/app/Sidebar";
import Topbar from "@/components/app/Topbar";
import DashboardTab from "@/components/tabs/DashboardTab";
import ClientsTab from "@/components/tabs/ClientsTab";
import ProjectsTab from "@/components/tabs/ProjectsTab";
import InvoicesTab from "@/components/tabs/InvoicesTab";
import AccountingTab from "@/components/tabs/AccountingTab";
import KhataTab from "@/components/tabs/KhataTab";
import AccountsTab from "@/components/tabs/AccountsTab";
import TeamTab from "@/components/tabs/TeamTab";
import ScheduleTab from "@/components/tabs/ScheduleTab";
import ReportsTab from "@/components/tabs/ReportsTab";
import LeadsTab from "@/components/tabs/LeadsTab";
import BudgetTab from "@/components/tabs/BudgetTab";
import SettingsTab from "@/components/tabs/SettingsTab";
import AssignmentsTab from "@/components/tabs/AssignmentsTab";
import MyPortalTab from "@/components/tabs/MyPortalTab";
import QueriesTab from "@/components/tabs/QueriesTab";

interface TabDef { id: string; label: string; countKey: string }

const ALL_TABS: TabDef[] = [
  { id: "dash", label: "Dashboard", countKey: "live" },
  { id: "clients", label: "Clients", countKey: "clients" },
  { id: "projects", label: "Projects", countKey: "projects" },
  { id: "assignments", label: "Assignments", countKey: "assignments" },
  { id: "invoices", label: "Invoices", countKey: "invoices" },
  { id: "accounting", label: "Accounting", countKey: "accounting" },
  { id: "khata", label: "Khata", countKey: "khata" },
  { id: "accounts", label: "Accounts", countKey: "wallets" },
  { id: "team", label: "Team", countKey: "team" },
  { id: "schedule", label: "Schedule", countKey: "schedule" },
  { id: "reports", label: "Reports", countKey: "reports" },
  { id: "leads", label: "Leads", countKey: "leads" },
  { id: "budget", label: "Budget", countKey: "budget" },
  { id: "queries", label: "Queries", countKey: "queries" },
  { id: "settings", label: "Settings", countKey: "settings" },
];

const MY_PORTAL: TabDef = { id: "myportal", label: "My Portal", countKey: "myportal" };

const ROLE_TABS: Record<UserRole, string[]> = {
  admin: ALL_TABS.map(t => t.id),
  manager: ALL_TABS.map(t => t.id).filter(id => id !== "settings").concat("settings"),
  accountant: ["dash", "invoices", "accounting", "khata", "accounts", "reports", "budget"],
  lead_manager: ["leads", "schedule", "queries"],
  assistant: ["leads", "schedule"],
  team_member: ["myportal"],
};

export default function MainApp() {
  const { role, isTeamMember } = useAuth();
  const { data, loading } = useData();
  const [darkMode, setDarkMode] = useState(false);

  const TABS: TabDef[] = useMemo(() => {
    const allowedIds = role ? ROLE_TABS[role] : ["myportal"];
    const pool = isTeamMember ? [MY_PORTAL] : [...ALL_TABS, MY_PORTAL];
    return pool.filter(t => allowedIds.includes(t.id));
  }, [role, isTeamMember]);

  const [activeTab, setActiveTab] = useState<string>(TABS[0]?.id || "dash");

  useEffect(() => {
    if (TABS.length && !TABS.find(t => t.id === activeTab)) {
      setActiveTab(TABS[0].id);
    }
  }, [TABS, activeTab]);

  const toggleTheme = () => {
    setDarkMode(!darkMode);
    document.body.classList.toggle("dark");
  };

  const getCount = (key: string) => {
    switch (key) {
      case "live": return "Live";
      case "clients": return data.clients.length;
      case "projects": return data.projects.length;
      case "assignments": return data.assignments.length;
      case "invoices": return data.invoices.length;
      case "accounting": return data.accounting.length;
      case "khata": return data.khata.length;
      case "wallets": return data.wallets.length;
      case "team": return data.team.length;
      case "schedule": return data.schedule.length;
      case "reports": return "PDF/CSV";
      case "leads": return data.leads.length;
      case "budget": return "📊";
      case "queries": return data.queries.filter((q: any) => (q.status || "Open") === "Open").length || data.queries.length;
      case "settings": return "Logo";
      case "myportal": return "👤";
      default: return 0;
    }
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="login-logo">DT</div>
        <p>Loading data...</p>
      </div>
    );
  }

  const renderTab = () => {
    const allowed = role ? ROLE_TABS[role] : [];
    if (!allowed.includes(activeTab)) {
      return <MyPortalTab />;
    }
    switch (activeTab) {
      case "dash": return <DashboardTab />;
      case "clients": return <ClientsTab />;
      case "projects": return <ProjectsTab />;
      case "assignments": return <AssignmentsTab />;
      case "invoices": return <InvoicesTab />;
      case "accounting": return <AccountingTab />;
      case "khata": return <KhataTab />;
      case "accounts": return <AccountsTab />;
      case "team": return <TeamTab />;
      case "schedule": return <ScheduleTab />;
      case "reports": return <ReportsTab />;
      case "leads": return <LeadsTab />;
      case "budget": return <BudgetTab />;
      case "queries": return <QueriesTab />;
      case "settings": return <SettingsTab />;
      case "myportal": return <MyPortalTab />;
      default: return <DashboardTab />;
    }
  };

  return (
    <div className={darkMode ? "dark" : ""}>
      <Topbar onToggleTheme={toggleTheme} />
      <div className="container">
        <Sidebar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} getCount={getCount} />
        <main className="grid">{renderTab()}</main>
      </div>
    </div>
  );
}
