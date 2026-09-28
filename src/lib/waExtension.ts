// Client for the "Digital Target WhatsApp Connector" Chrome extension
// (chrome-extension/). The extension shows WhatsApp Web inside the portal and
// reads chats from it, so no server is needed. The portal talks to it with
// window.postMessage through the extension's bridge script.
import { useEffect, useState } from "react";

export const EXTENSION_ZIP = "/downloads/dt-whatsapp-extension.zip";

export interface WaExtChat {
  id: string;
  name: string;
  pushname: string;
  phone: string; // international digits, "" when WhatsApp hides the number
  saved: boolean;
  isGroup: boolean;
  t: number; // last activity, ms
  unread: number;
  archived: boolean;
}
export interface WaExtMessage { id: string; fromMe: boolean; type: string; t: number; text: string; remote?: string; ack?: number }
export interface WaExtState {
  ready: boolean;
  authenticated: boolean;
  me: string;
  embedded?: boolean;
  /** "wpp" = fast library mode, "dom" = reads the WhatsApp screen, "loading" = not ready yet. */
  mode?: "wpp" | "dom" | "loading";
  diag?: { wpp: boolean; injected: boolean; wppReady: boolean; loader: string; qr: boolean; errors: string[] };
}

/** Real WhatsApp id ("…@c.us" / "…@lid"); screen-mode ids ("dom:Name") are not stored on leads. */
export const realJid = (id?: string) => (id && id.includes("@") ? id : undefined);
export const phoneFromJid = (jid?: string) => (jid && /@c\.us$|@s\.whatsapp\.net$/.test(jid) ? jid.split("@")[0].replace(/\D/g, "") : "");
export const isSkippedJid = (jid?: string) => !!jid && /@g\.us$|@newsletter$|@broadcast$/.test(jid);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- event payloads differ per event
type Listener = (event: string, data: any, embedded: boolean) => void;

let version: string | null =
  typeof document !== "undefined" ? document.documentElement.getAttribute("data-dt-wa-ext") : null;
const pending = new Map<string, (r: { ok: boolean; result?: unknown; error?: string }) => void>();
const listeners = new Set<Listener>();
const versionListeners = new Set<(v: string) => void>();
let seq = 0;

if (typeof window !== "undefined") {
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (e.source !== window || !d || typeof d !== "object") return;
    if (d.__dt === "hello") {
      version = String(d.version || "1");
      versionListeners.forEach((f) => f(version!));
    } else if (d.__dt === "res" && pending.has(d.id)) {
      pending.get(d.id)!(d);
      pending.delete(d.id);
    } else if (d.__dt === "evt") {
      listeners.forEach((f) => f(d.event, d.data, !!d.embedded));
    }
  });
  window.postMessage({ __dt: "ping" }, window.location.origin);
}

export const extensionVersion = () => version;

export function onExtensionEvent(fn: Listener) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Calls the extension. Rejects with a readable (Roman Urdu) message. */
export function extCall<T = unknown>(op: string, args?: Record<string, unknown>, timeoutMs = 60000): Promise<T> {
  if (!version) return Promise.reject(new Error("Digital Target WhatsApp extension install nahi hai"));
  return new Promise<T>((resolve, reject) => {
    const id = `p${Date.now()}_${++seq}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Extension ne jawab nahi diya")); }, timeoutMs);
    pending.set(id, (r) => {
      clearTimeout(timer);
      if (r.ok) resolve(r.result as T);
      else reject(new Error(r.error || "Extension error"));
    });
    window.postMessage({ __dt: "req", id, op, args }, window.location.origin);
  });
}

export const waExt = {
  state: () => extCall<WaExtState>("state", undefined, 8000),
  chats: (a: { sinceDays?: number; max?: number; onlyUnread?: boolean } = {}) => extCall<WaExtChat[]>("chats", a, 180000),
  messages: (chatId: string, count = 40) => extCall<WaExtMessage[]>("messages", { chatId, count }),
  active: () => extCall<(WaExtChat & { messages: WaExtMessage[] }) | null>("active"),
  open: (a: { phone?: string; chatId?: string; text?: string }) => extCall<boolean>("open", a),
  sendText: (a: { phone?: string; chatId?: string; text: string }) => extCall<{ id: string }>("sendText", a),
  sendFile: (a: { phone?: string; chatId?: string; dataUrl: string; filename: string; caption?: string }) =>
    extCall<{ id: string }>("sendFile", a, 120000),
  openWindow: () => extCall<{ reused: boolean }>("openWindow"),
};

/** The installed extension version, or null. Re-checks for a moment after mount. */
export function useExtensionVersion() {
  const [v, setV] = useState<string | null>(version);
  useEffect(() => {
    const f = (x: string) => setV(x);
    versionListeners.add(f);
    window.postMessage({ __dt: "ping" }, window.location.origin);
    return () => { versionListeners.delete(f); };
  }, []);
  return v;
}
