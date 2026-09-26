import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useAuth } from "./AuthContext";
import {
  AppData,
  defaultData,
  loadAllData,
  saveItem,
  deleteItem,
  saveSettings,
  uid,
  ALL_COLLECTIONS,
  subscribeCollection,
} from "@/lib/db";

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
}

const DataContext = createContext<DataContextType | null>(null);

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be inside DataProvider");
  return ctx;
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { workspaceUid } = useAuth();
  const [data, setData] = useState<AppData>(defaultData);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!workspaceUid) return;
    setLoading(true);
    const d = await loadAllData(workspaceUid);
    setData(d);
    setLoading(false);
  }, [workspaceUid]);

  useEffect(() => {
    if (workspaceUid) {
      reload();
    } else {
      setData(defaultData);
      setLoading(false);
    }
  }, [workspaceUid, reload]);

  // Live subscriptions for assignments + queries (chat realtime)
  useEffect(() => {
    if (!workspaceUid) return;
    const unsubAssign = subscribeCollection(workspaceUid, "assignments", (items) => {
      setData((prev) => ({ ...prev, assignments: items }));
    });
    const unsubQ = subscribeCollection(workspaceUid, "queries", (items) => {
      setData((prev) => ({ ...prev, queries: items }));
    });
    return () => { unsubAssign(); unsubQ(); };
  }, [workspaceUid]);

  const addItem = async (col: string, item: any) => {
    if (!workspaceUid) return;
    const newItem = { ...item, id: item.id || uid() };
    await saveItem(workspaceUid, col, newItem);
    setData((prev) => ({ ...prev, [col]: [...(prev as any)[col], newItem] }));
  };

  const removeItem = async (col: string, id: string) => {
    if (!workspaceUid) return;
    await deleteItem(workspaceUid, col, id);
    setData((prev) => ({ ...prev, [col]: (prev as any)[col].filter((x: any) => x.id !== id) }));
  };

  const updateItem = async (col: string, item: any) => {
    if (!workspaceUid) return;
    await saveItem(workspaceUid, col, item);
    setData((prev) => ({ ...prev, [col]: (prev as any)[col].map((x: any) => (x.id === item.id ? item : x)) }));
  };

  const updateSettings = async (settings: any) => {
    if (!workspaceUid) return;
    await saveSettings(workspaceUid, settings);
    setData((prev) => ({ ...prev, settings }));
  };

  const restoreData = async (jsonData: any) => {
    if (!workspaceUid) return;
    if (jsonData.settings) {
      const mergedSettings = { ...defaultData.settings, ...jsonData.settings };
      await saveSettings(workspaceUid, mergedSettings);
    }
    for (const col of ALL_COLLECTIONS) {
      const items = jsonData[col];
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item.id) await saveItem(workspaceUid, col, item);
        }
      }
    }
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
      value={{ data, loading, addItem, removeItem, updateItem, updateSettings, reload, restoreData, resetData }}
    >
      {children}
    </DataContext.Provider>
  );
}
