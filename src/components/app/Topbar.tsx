import React, { useEffect, useRef, useState } from "react";
import { Menu, MessageCircle, Moon, MoreVertical, Sun, Wifi, WifiOff } from "lucide-react";
import { serviceOnline, useAccounts } from "@/components/whatsapp/useWhatsApp";
import { openWhatsAppWeb } from "@/lib/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import NotificationBell from "./NotificationBell";

interface Props {
  onToggleTheme: () => void;
  dark: boolean;
  title: string;
  onMenu: () => void;
}

function useClock() {
  const fmt = () => {
    const d = new Date();
    return `${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} • ${d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`;
  };
  const [v, setV] = useState(fmt);
  useEffect(() => { const t = setInterval(() => setV(fmt()), 30_000); return () => clearInterval(t); }, []);
  return v;
}

function useOnline() {
  const [on, setOn] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return on;
}

export default function Topbar({ onToggleTheme, dark, title, onMenu }: Props) {
  const { hasFullAccess, can, workspaceUid } = useAuth();
  const [menu, setMenu] = useState(false);
  const clock = useClock();
  const online = useOnline();
  const showWa = can("whatsapp.view");
  const accounts = useAccounts(showWa ? workspaceUid : null);
  const acc = accounts?.[0];
  const WA_TEXT: Record<string, string> = {
    connected: "WhatsApp Connected", connecting: "WhatsApp connecting…", qr: "WhatsApp: scan QR",
    pairing: "WhatsApp: enter code", disconnected: "WhatsApp disconnected", logged_out: "WhatsApp logged out", error: "WhatsApp error",
  };
  const waText = !acc ? "WhatsApp not linked"
    : acc.status === "connected" && !serviceOnline(acc) ? "WhatsApp service offline"
    : WA_TEXT[acc.status] || `WhatsApp ${acc.status}`;
  const waCls = acc?.status === "connected" && serviceOnline(acc) ? "ok" : acc ? "warn" : "";
  const { data, restoreData, resetData } = useData();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBackup = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${data.settings.exportName || "DigitalTarget"}_backup.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleRestore = () => {
    fileInputRef.current?.click();
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const obj = JSON.parse(reader.result as string);
        await restoreData(obj);
      } catch (err) {
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(f);
    // Reset so same file can be selected again
    e.target.value = "";
  };

  const handleReset = async () => {
    const scope = prompt(
`Reset kis cheez ka karna hai?
1 = Sirf Accounting (default)
2 = Sirf Invoices
3 = Sirf Schedule
4 = Accounting + Invoices + Schedule
5 = FULL RESET (sab kuch)

Number likho:`, "1"
    );
    if (scope === null) return;
    const s = (scope || "1").trim();

    const periodRaw = prompt(
`Kitna data remove karna hai?
- ALL = sab delete
- 30d = last 30 days ka data delete
- 3m = last 3 months ka data delete

Example: ALL ya 30d ya 3m`, "ALL"
    );
    if (periodRaw === null) return;

    let cutoffDate: string | null = null;
    const pr = (periodRaw || "ALL").trim().toLowerCase();
    if (pr !== "all" && pr !== "a" && pr !== "0") {
      const m = pr.match(/^(\d+)\s*([dm])$/);
      if (!m) { alert("Period galat hai. Example: ALL / 30d / 3m"); return; }
      const n = parseInt(m[1], 10);
      const unit = m[2];
      const d = new Date();
      if (unit === "d") d.setDate(d.getDate() - n);
      else if (unit === "m") d.setMonth(d.getMonth() - n);
      cutoffDate = d.toISOString().slice(0, 10);
    }

    const msgs: Record<string, string> = {
      "1": "Sirf Accounting reset hoga",
      "2": "Sirf Invoices reset hongi",
      "3": "Sirf Schedule reset hogi",
      "4": "Accounting + Invoices + Schedule reset honge",
      "5": "FULL RESET (sab kuch) hoga",
    };

    if (!confirm(`${msgs[s] || msgs["1"]}\n\nConfirm?`)) return;

    await resetData(s, cutoffDate);
    alert("Reset complete ✅");
  };

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button className="iconBtn menuBtn" onClick={onMenu} aria-label="Open menu"><Menu size={20} /></button>
        <div className="pageTitle">
          <span className="pageBar" />
          <b>{title}</b>
        </div>
        <div className="statusChips">
          {showWa && (
            <span className={`chip ${waCls}`} title="WhatsApp connection">
              <MessageCircle size={13} /> {waText}
            </span>
          )}
          <span className={`chip ${online ? "ok" : "bad"}`}>{online ? <Wifi size={13} /> : <WifiOff size={13} />} {online ? "Online" : "Offline"}</span>
          <span className="chip clock">{clock}</span>
        </div>
        <div className="actions">
          {showWa && (
            <button className="iconBtn waWebBtn" onClick={openWhatsAppWeb} title="WhatsApp Web kholein" aria-label="Open WhatsApp Web">
              <MessageCircle size={18} />
            </button>
          )}
          <NotificationBell />
          <button className="iconBtn" onClick={onToggleTheme} aria-label="Toggle dark mode" title="Light / Dark">
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          {hasFullAccess && (
            <div className="menuWrap">
              <button className="iconBtn" onClick={() => setMenu(!menu)} aria-label="Data menu" title="Backup / Restore / Reset"><MoreVertical size={18} /></button>
              {menu && (
                <div className="dropMenu" onMouseLeave={() => setMenu(false)}>
                  <button onClick={() => { setMenu(false); handleBackup(); }}>⬇ Backup (JSON)</button>
                  <button onClick={() => { setMenu(false); handleRestore(); }}>⬆ Restore</button>
                  <button className="danger" onClick={() => { setMenu(false); handleReset(); }}>⚠ Reset data</button>
                </div>
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={onFileSelected}
          />
        </div>
      </div>
    </header>
  );
}
