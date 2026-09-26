// Growth Tasks: action items the owner picks from the AI analysis. Stored in
// the workspace settings document (settings.growthTasks), so only users with
// Settings permission can change them.
import { useData } from "@/contexts/DataContext";
import { uid, todayISO } from "./db";
import type { ModuleInsight, ModuleKey } from "./moduleInsights";

export interface GrowthTask {
  id: string;
  sourceKey: string; // module:insightId — avoids adding the same open task twice
  module: ModuleKey;
  title: string;
  detail: string;
  severity: ModuleInsight["severity"];
  due: string;
  done: boolean;
  doneAt?: string;
  createdAt: string;
}

export const MODULE_LABEL: Record<ModuleKey, string> = {
  dashboard: "Business", leads: "Leads", whatsapp: "WhatsApp", clients: "Clients", projects: "Projects",
  assignments: "Assignments", invoices: "Invoices", finance: "Finance", team: "Team",
};

const addDays = (n: number) => {
  const d = new Date(todayISO());
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export function taskFromInsight(module: ModuleKey, i: ModuleInsight): GrowthTask {
  return {
    id: uid("GT"), sourceKey: `${module}:${i.id}`, module,
    title: i.action || i.title, detail: i.title, severity: i.severity,
    due: addDays(i.dueDays ?? 7), done: false, createdAt: new Date().toISOString(),
  };
}

export function useGrowthTasks() {
  const { data, updateSettings } = useData();
  const tasks: GrowthTask[] = Array.isArray(data.settings?.growthTasks) ? data.settings.growthTasks : [];
  const save = (next: GrowthTask[]) => updateSettings({ ...data.settings, growthTasks: next.slice(-300) });
  const openKeys = new Set(tasks.filter((t) => !t.done).map((t) => t.sourceKey));
  return {
    tasks,
    has: (module: ModuleKey, i: ModuleInsight) => openKeys.has(`${module}:${i.id}`),
    /** Adds tasks for the given insights (one save, skips ones already open). Returns how many were added. */
    add: (entries: { module: ModuleKey; insight: ModuleInsight }[]) => {
      const keys = new Set(openKeys);
      const fresh: GrowthTask[] = [];
      for (const { module, insight } of entries) {
        const k = `${module}:${insight.id}`;
        if (!insight.action || keys.has(k)) continue;
        keys.add(k);
        fresh.push(taskFromInsight(module, insight));
      }
      return fresh.length ? save([...tasks, ...fresh]).then(() => fresh.length) : Promise.resolve(0);
    },
    toggle: (id: string) => save(tasks.map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: !t.done ? new Date().toISOString() : undefined } : t))),
    remove: (id: string) => save(tasks.filter((t) => t.id !== id)),
    clearDone: () => save(tasks.filter((t) => !t.done)),
  };
}
