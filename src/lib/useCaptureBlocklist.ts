import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { BlockEntry, blockEntry } from "./captureFilter";

const KEY = "dt.captureBlocklist";
const read = (): BlockEntry[] => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };

/**
 * Numbers / names that must never become leads (family, couriers, personal).
 * Saved in workspace settings when the user may edit settings, otherwise in
 * this browser only — capture always honours both.
 */
export function useCaptureBlocklist() {
  const { data, updateSettings } = useData();
  const { can } = useAuth();
  const [local, setLocal] = useState<BlockEntry[]>(read);
  const shared: BlockEntry[] = Array.isArray(data.settings?.captureBlocklist) ? data.settings.captureBlocklist : [];
  const list = useMemo(() => {
    const seen = new Set<string>();
    return [...shared, ...local].filter((b) => (seen.has(b.key) ? false : (seen.add(b.key), true)));
  }, [shared, local]);

  const add = useCallback(async (meta: { name?: string; phone?: string }) => {
    const e = blockEntry(meta);
    if (!e.key || list.some((b) => b.key === e.key)) return;
    if (can("settings.manage")) await updateSettings({ ...data.settings, captureBlocklist: [...shared, e] });
    else { const next = [...local, e]; setLocal(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ } }
  }, [list, can, updateSettings, data.settings, shared, local]);

  const remove = useCallback(async (key: string) => {
    if (shared.some((b) => b.key === key) && can("settings.manage")) await updateSettings({ ...data.settings, captureBlocklist: shared.filter((b) => b.key !== key) });
    const next = local.filter((b) => b.key !== key);
    setLocal(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, [can, updateSettings, data.settings, shared, local]);

  return { list, add, remove };
}
