import React, { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { fileToBase64 } from "@/lib/db";
import UserManagement from "@/components/UserManagement";

export default function SettingsTab() {
  const { data, updateSettings } = useData();
  const [phone, setPhone] = useState(data.settings.phone || "");
  const [exportName, setExportName] = useState(data.settings.exportName || "DigitalTarget");
  const [footer, setFooter] = useState(data.settings.footer || "");
  const [authorizedName, setAuthorizedName] = useState(data.settings.authorizedName || "");
  const [authorizedDesignation, setAuthorizedDesignation] = useState(data.settings.authorizedDesignation || "Authorized Signatory");

  const handleSave = async () => {
    const logoInput = document.getElementById("setLogo") as HTMLInputElement;
    const signInput = document.getElementById("setSign") as HTMLInputElement;
    const qrInput = document.getElementById("setBankQR") as HTMLInputElement;

    const newSettings = { ...data.settings, phone, exportName, footer, authorizedName, authorizedDesignation };

    if (logoInput?.files?.[0]) newSettings.logo = await fileToBase64(logoInput.files[0]);
    if (signInput?.files?.[0]) newSettings.signature = await fileToBase64(signInput.files[0]);
    if (qrInput?.files?.[0]) newSettings.bankQR = await fileToBase64(qrInput.files[0]);

    await updateSettings(newSettings);
    alert("Settings saved ✅");
  };

  return (
    <>
      <section className="card">
        <h2>Settings</h2>
        <div className="grid3">
          <div><label>Global Logo Upload</label><input id="setLogo" type="file" accept="image/*" />
            <div className="small">Logo appears on A4 + POS.</div>
          </div>
          <div><label>Default Signature Upload</label><input id="setSign" type="file" accept="image/*" />
            <div className="small">Used on invoices (auto).</div>
          </div>
          <div><label>Default Bank QR Upload</label><input id="setBankQR" type="file" accept="image/*" />
            <div className="small">Used on invoices (auto).</div>
          </div>
        </div>
        <div className="grid2" style={{ marginTop: 12 }}>
          <div><label>Business Phone (WhatsApp)</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="923001112233" />
            <div className="small">Used for WhatsApp messages.</div>
          </div>
          <div><label>Export Name</label><input value={exportName} onChange={(e) => setExportName(e.target.value)} placeholder="DigitalTarget" /></div>
        </div>
        <div className="grid2" style={{ marginTop: 12 }}>
          <div><label>Invoice Footer Text</label><input value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Digital Target | Phone: ..." /></div>
          <div><label>Preview</label><input value="Defaults are saved in cloud" disabled /></div>
        </div>
        <div className="grid2" style={{ marginTop: 12 }}>
          <div><label>Authorized Name</label><input value={authorizedName} onChange={(e) => setAuthorizedName(e.target.value)} placeholder="e.g. Bilal Ashraf" /></div>
          <div><label>Authorized Designation</label><input value={authorizedDesignation} onChange={(e) => setAuthorizedDesignation(e.target.value)} placeholder="e.g. Founder / Director" /></div>
        </div>

        {data.settings.logo?.data && (
          <div style={{ marginTop: 10 }}>
            <label>Current Logo</label>
            <img src={data.settings.logo.data} alt="logo" style={{ maxWidth: 100, maxHeight: 60, objectFit: "contain" }} />
          </div>
        )}
        {data.settings.signature?.data && (
          <div style={{ marginTop: 10 }}>
            <label>Current Signature</label>
            <img src={data.settings.signature.data} alt="signature" style={{ maxWidth: 100, maxHeight: 60, objectFit: "contain" }} />
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button className="btnSolid" onClick={handleSave}>Save Settings</button>
        </div>
        <hr />
        <div className="small">QR generation uses a CDN library. First time needs internet to load the QR script.</div>
      </section>

      <UserManagement />
    </>
  );
}
