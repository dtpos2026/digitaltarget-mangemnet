import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useAuth } from "./AuthContext";
import { setReportBranding } from "@/lib/exportUtils";
import {
  AppData,
  AuditEntry,
  defaultData,
  diffForAudit,
  entityLabel,
  loadAllData,
  ReadScope,
  saveItem,
  deleteItem,
  saveSettings,
  uid,
  ALL_COLLECTIONS,
  subscribeCollection,
  writeAudit,
} from "@/lib/db";
import { COLLECTION_READ, OWN_SCOPED } from "@/lib/permissions";

interface DataContextType {
  data: AppData;
  loading: boolean;
  addItem: (col: string, item: any) => Promise<void>;
  removeItem: (col: string, id: string) => Promise<void>;
  updateItem: (col: string, item: any) => Promise<void>;
  updateSettings: (settings: any) => Promise<void>;
  reload: () => Promise<void>;
  restoreData: (jsonData: any) => Promise<void>;
  resetData: (scope: string, cutoffDate: string | null) => Promise<void>;
  logAudit: (entry: AuditEntry) => void;
}

const DataContext = createContext<DataContextType | null>(null);

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be inside DataProvider");
  return ctx;
}

// Collections kept live with onSnapshot: chat-like data and leads (the
// WhatsApp service creates leads in the background).
const LIVE_COLLECTIONS = ["assignments", "queries", "leads"];

function reportWriteError(action: string, col: string, e: unknown) {
  const code = (e as { code?: string })?.code;
  const msg = code === "permission-denied"
    ? `Aap ko is kaam (${action} ${col}) ki permission nahi hai.`
    : `Save nahi ho saka (${action} ${col}): ${(e as Error)?.message || e}`;
  alert(msg);
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { workspaceUid, perms, roleDoc, user } = useAuth();
  const [data, setData] = useState<AppData>(defaultData);
  const [loading, setLoading] = useState(true);
  const dataRef = useRef(data);
  dataRef.current = data;

  const scope: ReadScope = useMemo(
    () => ({
      canRead: (col: string) => (COLLECTION_READ[col] || []).some((p) => perms.has(p)),
      teamId: perms.has("myportal.view") ? roleDoc?.teamId : undefined,
      ownScoped: OWN_SCOPED,
    }),
    [perms, roleDoc?.teamId]
  );

  const reload = useCallback(async () => {
    if (!workspaceUid) return;
    setLoading(true);
    const d = await loadAllData(workspaceUid, scope);
    setData(d);
    setLoading(false);
  }, [workspaceUid, scope]);

  useEffect(() => {
    if (workspaceUid) {
      reload();
    } else {
      setData(defaultData);
      setLoading(false);
    }
  }, [workspaceUid, reload]);

  useEffect(() => {
    if (!workspaceUid) return;
    const unsubs = LIVE_COLLECTIONS.map((col) =>
      subscribeCollection(workspaceUid, col, scope, (items) => {
        setData((prev) => ({ ...prev, [col]: items }));
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [workspaceUid, scope]);

  // Company details / logo for the letterhead on every printed / exported report.
  useEffect(() => setReportBranding(data.settings), [data.settings]);

  const logAudit = useCallback(
    (entry: AuditEntry) => {
      if (!workspaceUid || !user) return;
      writeAudit(workspaceUid, { uid: user.uid, email: user.email }, entry);
    },
    [workspaceUid, user]
  );

  const addItem = async (col: string, item: any) => {
    if (!workspaceUid) return;
    const newItem = { ...item, id: item.id || uid() };
    try {
      await saveItem(workspaceUid, col, newItem);
    } catch (e) {
      reportWriteError("create", col, e);
      throw e;
    }
    setData((prev) => ({ ...prev, [col]: [...((prev as any)[col] || []), newItem] }));
    logAudit({ action: "create", collection: col, entityId: newItem.id, entityLabel: entityLabel(newItem) });
  };

  const removeItem = async (col: string, id: string) => {
    if (!workspaceUid) return;
    const before = ((dataRef.current as any)[col] || []).find((x: any) => x.id === id);
    try {
      await deleteItem(workspaceUid, col, id);
    } catch (e) {
      reportWriteError("delete", col, e);
      throw e;
    }
    setData((prev) => ({ ...prev, [col]: ((prev as any)[col] || []).filter((x: any) => x.id !== id) }));
    logAudit({ action: "delete", collection: col, entityId: id, entityLabel: entityLabel(before) });
  };

  const updateItem = async (col: string, item: any) => {
    if (!workspaceUid) return;
    const before = ((dataRef.current as any)[col] || []).find((x: any) => x.id === item.id);
    try {
      await saveItem(workspaceUid, col, item);
    } catch (e) {
      reportWriteError("update", col, e);
      throw e;
    }
    setData((prev) => ({ ...prev, [col]: ((prev as any)[col] || []).map((x: any) => (x.id === item.id ? item : x)) }));
    const changes = diffForAudit(before, item);
    if (Object.keys(changes).length) {
      logAudit({ action: "update", collection: col, entityId: item.id, entityLabel: entityLabel(item), changes });
    }
  };

  const updateSettings = async (settings: any) => {
    if (!workspaceUid) return;
    try {
      await saveSettings(workspaceUid, settings);
    } catch (e) {
      reportWriteError("update", "settings", e);
      throw e;
    }
    setData((prev) => ({ ...prev, settings }));
    logAudit({ action: "update", collection: "settings", entityId: "settings", changes: diffForAudit(dataRef.current.settings, settings) });
  };

  const restoreData = async (jsonData: any) => {
    if (!workspaceUid) return;
    if (jsonData.settings) {
      const mergedSettings = { ...defaultData.settings, ...jsonData.settings };
      await saveSettings(workspaceUid, mergedSettings);
    }
    let count = 0;
    for (const col of ALL_COLLECTIONS) {
      const items = jsonData[col];
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item.id) { await saveItem(workspaceUid, col, item); count++; }
        }
      }
    }
    logAudit({ action: "restore", collection: "*", entityId: "backup", details: `${count} records restored from JSON backup` });
    await reload();
    alert("Restored ✅");
  };

  const resetData = async (scope: string, cutoffDate: string | null) => {
    if (!workspaceUid) return;

    const shouldDelete = (item: any) => {
      if (!cutoffDate) return true;
      const d = item.dateISO || item.date || "";
      if (!d) return true;
      return d >= cutoffDate;
    };

    logAudit({ action: "reset", collection: "*", entityId: `scope-${scope}`, details: `Reset scope ${scope}, cutoff ${cutoffDate || "ALL"}` });

    const collections: string[] = [];
    if (scope === "1" || scope === "4") collections.push("accounting", "payouts");
    if (scope === "2" || scope === "4") collections.push("invoices");
    if (scope === "3" || scope === "4") collections.push("schedule");
    if (scope === "5") {
      for (const col of ALL_COLLECTIONS) {
        const items = (data as any)[col] || [];
        for (const item of items) {
          if (item.id) await deleteItem(workspaceUid, col, item.id);
        }
      }
      await saveSettings(workspaceUid, defaultData.settings);
      await reload();
      return;
    }

    for (const col of collections) {
      const items = ((data as any)[col] || []).filter((item: any) => shouldDelete(item));
      for (const item of items) {
        if (item.id) await deleteItem(workspaceUid, col, item.id);
      }
    }

    if (scope === "2" || scope === "4") {
      const remainingInvIds = new Set(
        ((data as any).invoices || [])
          .filter((inv: any) => !shouldDelete(inv))
          .map((inv: any) => inv.id)
      );
      const khataToDelete = (data.khata || []).filter(
        (k: any) => k.linkedInvoiceId && !remainingInvIds.has(k.linkedInvoiceId)
      );
      for (const k of khataToDelete) {
        if (k.id) await deleteItem(workspaceUid, "khata", k.id);
      }
    }

    await reload();
  };

  return (
    <DataContext.Provider
      value={{ data, loading, addItem, removeItem, updateItem, updateSettings, reload, restoreData, resetData, logAudit }}
    >
      {children}
    </DataContext.Provider>
  );
}
