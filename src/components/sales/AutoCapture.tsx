import { useEffect, useRef, useSyncExternalStore } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { todayISO, uid } from "@/lib/db";
import { InboundConversation } from "@/lib/leadIngest";
import { ingestConversation } from "@/lib/salesStore";
import { salesSettingsOf } from "@/lib/salesPipeline";
import { isSkippedJid, onExtensionEvent, phoneFromJid, realJid, useExtensionVersion, waExt } from "@/lib/waExtension";

// ---- tiny status store (shown in the Sales tab)
export interface CaptureStatus { on: boolean; reason: string; captured: number; updated: number; skipped: number; last: string; lastError: string }
let status: CaptureStatus = { on: false, reason: "", captured: 0, updated: 0, skipped: 0, last: "", lastError: "" };
const subs = new Set<() => void>();
const setStatus = (p: Partial<CaptureStatus>) => { status = { ...status, ...p }; subs.forEach((f) => f()); };
export const useCaptureStatus = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => status, () => status);

/**
 * Real-time capture: every new WhatsApp message the extension sees (Fast
 * mode) creates or updates the lead at once — no button, no refresh. Runs in
 * every open portal tab that has the extension; several computers capturing
 * the same message are safe (one lead per number, see salesStore).
 */
export default function AutoCapture() {
  const version = useExtensionVersion();
  const { workspaceUid, user, can, roleDoc } = useAuth();
  const { data } = useData();
  const sales = salesSettingsOf(data.settings);
  const allowed = can("leads.create") || can("leads.own");
  const enabled = !!version && !!workspaceUid && !!user && allowed && sales.autoCapture;
  const ref = useRef({ data, sales, canEditAll: can("leads.edit"), teamId: roleDoc?.teamId || "", by: user?.email || "" });
  ref.current = { data, sales, canEditAll: can("leads.edit"), teamId: roleDoc?.teamId || "", by: user?.email || "" };
  const timers = useRef(new Map<string, number>());
  const busy = useRef(new Set<string>());

  useEffect(() => {
    setStatus({ on: enabled, reason: !version ? "Extension nahi" : !allowed ? "Permission nahi" : !sales.autoCapture ? "Settings mein band" : "" });
    if (!enabled) return;

    const run = async (chatId: string) => {
      if (busy.current.has(chatId)) { timers.current.set(chatId, window.setTimeout(() => run(chatId), 1500)); return; }
      busy.current.add(chatId);
      try {
        const [msgs, info] = await Promise.all([waExt.messages(chatId, 40), waExt.chatInfo(chatId).catch(() => null)]);
        const remote = msgs.find((m) => m.remote)?.remote || chatId;
        if (isSkippedJid(remote) || info?.isGroup) return;
        const phone = info?.phone || phoneFromJid(remote) || phoneFromJid(chatId);
        const conv: InboundConversation = {
          channel: "wa-web-extension",
          phone, name: info?.name || info?.pushname || "", jid: realJid(chatId),
          messages: msgs.filter((m) => m.type !== "call_log" && m.type !== "e2e_notification" && m.text).map((m) => ({ id: m.id, text: m.text, fromMe: m.fromMe, at: m.t || Date.now() })),
          ad: msgs.find((m) => m.adInfo)?.adInfo || (msgs.some((m) => m.ad) ? { sourceType: "ad" } : null),
          labels: info?.labels || [], saved: info?.saved, isBusiness: info?.isBusiness, archived: info?.archived,
        };
        const r = ref.current;
        const res = await ingestConversation(workspaceUid!, conv, {
          visibleLeads: r.data.leads, canEditAll: r.canEditAll, uid: user!.uid, myTeamId: r.teamId, sales: r.sales,
          ctx: { settings: r.data.settings, by: r.by, today: todayISO(), newId: () => uid("LD"), blocklist: r.data.settings?.captureBlocklist || [] },
        });
        setStatus({
          captured: status.captured + (res.kind === "created" ? 1 : 0), updated: status.updated + (res.kind === "updated" ? 1 : 0),
          skipped: status.skipped + (res.kind === "skipped" ? 1 : 0),
          last: `${new Date().toLocaleTimeString("en-PK")} • ${conv.name || phone} • ${res.kind === "created" ? "nayi lead" : res.kind === "updated" ? "update" : `skip (${res.reason})`}`,
          lastError: "",
        });
      } catch (e) {
        setStatus({ lastError: `${new Date().toLocaleTimeString("en-PK")} • ${(e as Error).message}` });
      } finally {
        busy.current.delete(chatId);
      }
    };

    const off = onExtensionEvent((event, d) => {
      if (event !== "message" || !d?.chatId) return; // Screen mode sends no chat id: use the Capture button there
      const chatId = String(d.chatId);
      if (isSkippedJid(chatId)) return;
      // Wait briefly so a burst of messages is read once.
      window.clearTimeout(timers.current.get(chatId));
      timers.current.set(chatId, window.setTimeout(() => run(chatId), 1200));
    });
    return () => { off(); timers.current.forEach((t) => window.clearTimeout(t)); timers.current.clear(); };
  }, [enabled, workspaceUid, user, version, allowed, sales.autoCapture]);

  return null;
}
