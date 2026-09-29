// AI analysis lives in one place: the "AI Analysis" tab. Other pages stay
// clean unless the owner switches "show AI on every page" on (off by default,
// remembered in this browser).
import { useSyncExternalStore } from "react";

const KEY = "dt.inlineAI";
const listeners = new Set<() => void>();
const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
let value = read();

export function setInlineAI(on: boolean) {
  value = on;
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private mode */ }
  listeners.forEach((l) => l());
}

/** True when AI cards / hints should also show on the normal pages. */
export function useInlineAI(): boolean {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => value, () => false);
}
