// AI suggestions → the owner's action list ("Growth Tasks").
//
// One store for every AI suggestion the user acts on (module insights,
// dashboard suggestions, schedule / assignment ideas). Each item can be
// completed, edited, snoozed or dismissed:
//  - dismissed suggestions never come back (their sourceKey is remembered);
//  - completed ones stay in history (and are not re-suggested for 7 days);
//  - snoozed ones hide until the snooze date.
// Stored in settings.growthTasks (only users with Settings permission edit).
import { useData } from "@/contexts/DataContext";
import { uid, todayISO } from "./db";
import type { ModuleInsight, ModuleKey } from "./moduleInsights";

export type TaskStatus = "open" | "done" | "dismissed";

export interface GrowthTask {
  id: string;
  sourceKey: string; // module:insightId — identifies the suggestion
  module: ModuleKey;
  title: string;
  detail: string;
  severity: ModuleInsight["severity"];
  due: string;
  /** Kept for older saved tasks; `status` is the source of truth. */
  done: boolean;
  status?: TaskStatus;
  doneAt?: string;
  dismissedAt?: string;
  snoozeUntil?: string;
  edited?: boolean;
  createdAt: string;
}

export const MODULE_LABEL: Record<ModuleKey, string> = {
  dashboard: "Business", leads: "Leads", whatsapp: "WhatsApp", clients: "Clients", projects: "Projects",
  assignments: "Assignments", invoices: "Invoices", finance: "Finance", team: "Team",
};

const addDays = (n: number, from = todayISO()) => {
  const d = new Date(`${from}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export const statusOf = (t: GrowthTask): TaskStatus => t.status || (t.done ? "done" : "open");
export const isSnoozed = (t: GrowthTask, today = todayISO()) => !!t.snoozeUntil && t.snoozeUntil > today;

export function taskFromInsight(module: ModuleKey, i: ModuleInsight): GrowthTask {
  return {
    id: uid("GT"), sourceKey: `${module}:${i.id}`, module,
    title: i.action || i.title, detail: i.title, severity: i.severity,
    due: addDays(i.dueDays ?? 7), done: false, status: "open", createdAt: new Date().toISOString(),
  };
}

/** Keys that must not be suggested again right now. */
export function blockedKeys(tasks: GrowthTask[], today = todayISO()) {
  const recent = addDays(-7, today);
  const out = new Set<string>();
  for (const t of tasks) {
    const st = statusOf(t);
    if (st === "open" || st === "dismissed") out.add(t.sourceKey);
    else if (st === "done" && String(t.doneAt || "").slice(0, 10) >= recent) out.add(t.sourceKey);
  }
  return out;
}

export function useGrowthTasks() {
  const { data, updateSettings } = useData();
  const tasks: GrowthTask[] = Array.isArray(data.settings?.growthTasks) ? data.settings.growthTasks : [];
  // Keep history bounded: newest 300 (dismissed keys stay so they never return).
  const save = (next: GrowthTask[]) => updateSettings({ ...data.settings, growthTasks: next.slice(-300) });
  const blocked = blockedKeys(tasks);
  const keyOf = (module: string, id: string) => `${module}:${id}`;
  const patch = (id: string, p: Partial<GrowthTask>) => save(tasks.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const dismissedKeys = new Set(tasks.filter((t) => statusOf(t) === "dismissed").map((t) => t.sourceKey));

  return {
    tasks,
    /** Suggestion already has an open task (or was dismissed / just done). */
    has: (module: ModuleKey | string, i: { id: string }) => blocked.has(keyOf(module, i.id)),
    isDismissed: (module: ModuleKey | string, i: { id: string }) => dismissedKeys.has(keyOf(module, i.id)),
    /** Adds tasks for the given insights (one save; skips blocked ones). Returns how many were added. */
    add: (entries: { module: ModuleKey; insight: ModuleInsight }[]) => {
      const keys = new Set(blocked);
      const fresh: GrowthTask[] = [];
      for (const { module, insight } of entries) {
        const k = keyOf(module, insight.id);
        if (!insight.action || keys.has(k)) continue;
        keys.add(k);
        fresh.push(taskFromInsight(module, insight));
      }
      return fresh.length ? save([...tasks, ...fresh]).then(() => fresh.length) : Promise.resolve(0);
    },
    /** Dismiss a suggestion that is not a task yet (so it never shows again). */
    dismissSuggestion: (module: ModuleKey, insight: ModuleInsight) => {
      const t = { ...taskFromInsight(module, insight), status: "dismissed" as const, dismissedAt: new Date().toISOString() };
      return save([...tasks.filter((x) => x.sourceKey !== t.sourceKey || statusOf(x) !== "open"), t]);
    },
    /**
     * Acts on a suggestion in one save: done (history, not re-suggested for
     * 7 days), dismissed (never again) or snoozed for N days.
     */
    resolve: (module: ModuleKey, insight: ModuleInsight, how: "done" | "dismissed" | { snoozeDays: number }) => {
      const t = taskFromInsight(module, insight);
      const now = new Date().toISOString();
      const next: GrowthTask = how === "done" ? { ...t, status: "done", done: true, doneAt: now }
        : how === "dismissed" ? { ...t, status: "dismissed", dismissedAt: now }
        : { ...t, snoozeUntil: addDays(how.snoozeDays), due: addDays(how.snoozeDays) };
      return save([...tasks.filter((x) => x.sourceKey !== t.sourceKey || statusOf(x) !== "open"), next]);
    },
    complete: (id: string) => patch(id, { status: "done", done: true, doneAt: new Date().toISOString(), snoozeUntil: "" }),
    reopen: (id: string) => patch(id, { status: "open", done: false, doneAt: "", dismissedAt: "" }),
    dismiss: (id: string) => patch(id, { status: "dismissed", done: false, dismissedAt: new Date().toISOString() }),
    snooze: (id: string, days: number) => patch(id, { snoozeUntil: addDays(days), due: addDays(days) }),
    edit: (id: string, p: { title?: string; due?: string }) => patch(id, { ...p, edited: true }),
    /** Older API kept for existing screens. */
    toggle: (id: string) => {
      const t = tasks.find((x) => x.id === id);
      return t && statusOf(t) === "done"
        ? patch(id, { status: "open", done: false, doneAt: "" })
        : patch(id, { status: "done", done: true, doneAt: new Date().toISOString() });
    },
    remove: (id: string) => save(tasks.filter((t) => t.id !== id)),
    /** Clears completed history (dismissed keys are kept so they never return). */
    clearDone: () => save(tasks.filter((t) => statusOf(t) !== "done")),
  };
}
