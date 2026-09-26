import React, { useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import NotificationBell from "./NotificationBell";

interface Props {
  onToggleTheme: () => void;
}

export default function Topbar({ onToggleTheme }: Props) {
  const { logout, hasFullAccess } = useAuth();
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
    <div className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <div className="logo">
            {data.settings.logo?.data ? (
              <img src={data.settings.logo.data} alt="logo" />
            ) : (
              <span style={{ fontWeight: 900 }}>DT</span>
            )}
          </div>
          <div className="title">
            <b>Digital Target Business Management</b>
            <span>Management Portal</span>
          </div>
        </div>
        <div className="actions">
          <NotificationBell />
          <button className="btnSmall" onClick={onToggleTheme}>Light/Dark</button>
          {hasFullAccess && <button className="btnSmall" onClick={handleBackup}>Backup</button>}
          {hasFullAccess && <button className="btnSmall" onClick={handleRestore}>Restore</button>}
          {hasFullAccess && <button className="btnSmall" onClick={handleReset}>Reset</button>}
          <button className="btnSmall" onClick={logout}>Logout</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={onFileSelected}
          />
        </div>
      </div>
    </div>
  );
}
