import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { normalizePhone } from "@/lib/phone";
import { onNavigate, openWhatsAppWeb } from "@/lib/navigation";
import ConnectModal from "./ConnectModal";
import CaptureModal from "./CaptureModal";
import Inbox from "./Inbox";
import WaWebView from "./WaWebView";
import MessageCenter from "./MessageCenter";
import ModuleInsights from "@/components/ModuleInsights";
import {
  createMainAccount,
  DEFAULT_WA_SETTINGS,
  formatPhone,
  MAIN_ACCOUNT_ID,
  saveAccountSettings,
  sendCommand,
  serviceOnline,
  useAccounts,
  WaSettings,
} from "./useWhatsApp";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  connected: { text: "Connected", cls: "ok" },
  connecting: { text: "Connecting…", cls: "warn" },
  qr: { text: "Waiting for QR scan", cls: "warn" },
  pairing: { text: "Waiting for pairing code", cls: "warn" },
  disconnected: { text: "Disconnected", cls: "bad" },
  logged_out: { text: "Logged out", cls: "bad" },
  error: { text: "Error", cls: "bad" },
};

const VIEW_KEY = "dt.waView";
type View = "web" | "inbox" | "campaign";

export default function WhatsAppTab({ focusConversationId, openPhone, openCampaign }: { focusConversationId?: string | null; openPhone?: { phone: string; chatId?: string; n: number } | null; openCampaign?: { ids: string[]; n: number } | null }) {
  const { workspaceUid, can, user } = useAuth();
  const { data, logAudit } = useData();
  const accounts = useAccounts(workspaceUid);
  const account = accounts?.find((a) => a.id === MAIN_ACCOUNT_ID) || accounts?.[0];
  const [showConnect, setShowConnect] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCapture, setShowCapture] = useState(false);
  const [focus, setFocus] = useState<string | null>(focusConversationId || null);
  const [settings, setSettings] = useState<WaSettings>(DEFAULT_WA_SETTINGS);
  const [expected, setExpected] = useState("");
  const canManage = can("whatsapp.manage");
  const [chosenView, setChosenView] = useState<View | null>(() => {
    try { const v = localStorage.getItem(VIEW_KEY); return v === "web" || v === "inbox" || v === "campaign" ? v : null; } catch { return null; }
  });
  // WhatsApp Web (browser extension, no server) is the default; the server
  // inbox is the default only where whatsapp-service has been set up.
  const view: View = chosenView || (account ? "inbox" : "web");
  const chooseView = (v: View) => {
    setChosenView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  };
  useEffect(() => { if (openPhone) setChosenView("web"); }, [openPhone]);
  useEffect(() => { if (focusConversationId) setChosenView("inbox"); }, [focusConversationId]);
  useEffect(() => { if (openCampaign) setChosenView("campaign"); }, [openCampaign]);

  useEffect(() => onNavigate((d) => { if (d.tab === "whatsapp" && d.conversationId) setFocus(d.conversationId); }), []);
  useEffect(() => { if (focusConversationId) setFocus(focusConversationId); }, [focusConversationId]);

  const command = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      if (!workspaceUid || !user) return;
      try {
        let acc = account;
        if (!acc) {
          await createMainAccount(workspaceUid, user.uid);
          acc = { id: MAIN_ACCOUNT_ID, status: "disconnected" };
        }
        await sendCommand(workspaceUid, acc.id, user.uid, action, extra);
        logAudit({ action: `whatsapp.${action}`, collection: "waAccounts", entityId: acc.id, details: extra.phone ? `phone ${extra.phone}` : "" });
      } catch (e) {
        alert("Command fail hua: " + ((e as Error).message || e));
      }
    },
    [workspaceUid, user, account, logAudit]
  );

  const connect = () => { setShowConnect(true); command("connect"); };

  const openSettings = () => {
    setSettings({ ...DEFAULT_WA_SETTINGS, ...(account?.settings || {}) });
    setExpected(account?.expectedPhone ? "0" + account.expectedPhone.slice(2) : "");
    setShowSettings(true);
  };

  const saveSettings = async () => {
    if (!workspaceUid || !account) return;
    try {
      await saveAccountSettings(workspaceUid, account.id, settings, normalizePhone(expected));
      logAudit({ action: "whatsapp.settings", collection: "waAccounts", entityId: account.id, details: JSON.stringify(settings) });
      setShowSettings(false);
    } catch (e) {
      alert("Save nahi hua: " + ((e as Error).message || e));
    }
  };

  if (!workspaceUid) return null;
  const st = STATUS_LABEL[account?.status || "disconnected"] || STATUS_LABEL.disconnected;
  const online = serviceOnline(account);

  const switcher = (
    <div className="segmented waViewSwitch" role="tablist">
      <button role="tab" aria-selected={view === "web"} className={view === "web" ? "on" : ""} onClick={() => chooseView("web")}>🟢 WhatsApp Web</button>
      {can("campaigns.manage") && <button role="tab" aria-selected={view === "campaign"} className={view === "campaign" ? "on" : ""} onClick={() => chooseView("campaign")}>📣 Message Center</button>}
      <button role="tab" aria-selected={view === "inbox"} className={view === "inbox" ? "on" : ""} onClick={() => chooseView("inbox")}>🗂 Server inbox</button>
    </div>
  );

  if (view === "campaign") {
    return (
      <section className="card waTab">
        <div className="waBar">
          <div className="waBarInfo"><h2 style={{ margin: 0 }}>WhatsApp Message Center</h2><div className="small">Leads ko un ki service ke mutabiq follow-up — approve kar ke, aaram se.</div></div>
          {switcher}
        </div>
        <MessageCenter preselect={openCampaign} />
      </section>
    );
  }

  if (view === "web") {
    return (
      <>
      <ModuleInsights module="whatsapp" limit={3} />
      <section className="card waTab">
        <div className="waBar">
          <div className="waBarInfo"><h2 style={{ margin: 0 }}>WhatsApp</h2></div>
          {switcher}
        </div>
        <WaWebView openPhone={openPhone} />
      </section>
      </>
    );
  }

  return (
    <>
    <ModuleInsights module="whatsapp" limit={3} />
    <section className="card waTab">
      <div className="waBar">
        <div className="waBarInfo">
          <h2 style={{ margin: 0 }}>WhatsApp Inbox</h2>
          <div className="small">Server (whatsapp-service) wala inbox — 24/7 capture ke liye.</div>
          <div className="waBarStatus">
            <span className={`badge ${st.cls}`}>{st.text}</span>
            {account?.me?.phone && <span className="small">{account.me.name ? `${account.me.name} • ` : ""}{formatPhone(account.me.phone)}</span>}
            {account && !online && <span className="badge bad" title="whatsapp-service heartbeat is older than 2 minutes">Service offline</span>}
            {account?.history?.status === "running" && <span className="small">Importing history… {account.history.messages || 0} messages</span>}
          </div>
          {account?.lastError && account.status !== "connected" && <div className="small waErrText">{account.lastError}</div>}
          {account?.numberMismatch && <div className="small waErrText">{account.lastError}</div>}
        </div>
        {switcher}
        <div className="waBarActions">
          {can(["leads.create"]) && can("whatsapp.reply") && (
            <button className="btnSolid" onClick={() => setShowCapture(true)} title="Tamam chats se leads banayein">⚡ Capture Leads</button>
          )}
          <button className="btnSmall waWebLink" onClick={() => openWhatsAppWeb(false)} title="Seedha WhatsApp Web (alag window)">🟢 WhatsApp Web</button>
        </div>
        {canManage && (
          <div className="waBarActions">
            {account?.status !== "connected" && <button className="btnSolid" onClick={connect}>Connect WhatsApp</button>}
            {(account?.status === "qr" || account?.status === "pairing" || account?.status === "connecting") && (
              <button className="btnSmall" onClick={() => setShowConnect(true)}>Show QR</button>
            )}
            {account?.status === "connected" && <button className="btnSmall" onClick={() => command("reconnect")}>Reconnect</button>}
            {account && account.status !== "disconnected" && account.status !== "logged_out" && (
              <button className="btnSmall" onClick={() => { if (confirm("WhatsApp connection band karein? (Session mehfooz rahega, dobara Connect par QR ki zarurat nahi)")) command("disconnect"); }}>Disconnect</button>
            )}
            {account && account.status !== "logged_out" && (
              <button className="btnDanger" onClick={() => { if (confirm("Is device ko WhatsApp se unlink (logout) karein? Dobara jorne ke liye QR scan karna hoga. Purani chats portal mein rahengi.")) command("logout"); }}>Unlink</button>
            )}
            {account && <button className="btnSmall" onClick={openSettings}>⚙ Settings</button>}
          </div>
        )}
      </div>

      {!account && !canManage && (
        <div className="small" style={{ marginTop: 10 }}>WhatsApp abhi connect nahi hua. Admin se connect karne ko kahein.</div>
      )}

      <Inbox ws={workspaceUid} account={account} focusConversationId={focus} />

      {showCapture && workspaceUid && <CaptureModal source={{ kind: "service", ws: workspaceUid }} onClose={() => setShowCapture(false)} />}

      {showConnect && (
        <ConnectModal
          account={account}
          onClose={() => setShowConnect(false)}
          onConnect={() => command("connect")}
          onPairCode={(phone) => {
            const n = normalizePhone(phone);
            if (!n) { alert("Sahi phone number likhein, e.g. 03451873354"); return; }
            command("pair_code", { phone: n });
          }}
        />
      )}

      {showSettings && account && (
        <div className="dtModalBackdrop" onClick={() => setShowSettings(false)}>
          <div className="dtModal" onClick={(e) => e.stopPropagation()}>
            <div className="dtModalHead">
              <b>WhatsApp Settings</b>
              <button className="btnSmall" onClick={() => setShowSettings(false)}>✕</button>
            </div>
            <label>Business WhatsApp number (expected)</label>
            <input value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="03451873354" inputMode="tel" />
            {([
              ["autoCreateLeads", "Naye number ka message aane par automatically Lead banayein"],
              ["leadsFromHistory", "Purani (imported) chats se bhi Leads banayein"],
              ["notifyOnNewLead", "Naye WhatsApp lead par notification bhejein"],
              ["ignoreGroups", "Group chats ignore karein (save na karein)"],
              ["downloadMedia", "Images / documents / voice notes save karein"],
              ["syncFullHistory", "Connect karte waqt poori chat history import karein"],
            ] as [keyof WaSettings, string][]).map(([k, label]) => (
              <label key={k} className="permItem">
                <input type="checkbox" checked={!!settings[k]} onChange={(e) => setSettings({ ...settings, [k]: e.target.checked })} />
                <span>{label}</span>
              </label>
            ))}
            <label>Naye leads kis ko assign hon</label>
            <select value={settings.defaultAssignee} onChange={(e) => setSettings({ ...settings, defaultAssignee: e.target.value })}>
              <option value="">— Unassigned —</option>
              {data.team.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <div className="small" style={{ marginTop: 6 }}>History import ki setting agle Connect / Reconnect par lagu hogi.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btnSolid" onClick={saveSettings}>Save</button>
              <button className="btnSmall" onClick={() => setShowSettings(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
    </>
  );
}
