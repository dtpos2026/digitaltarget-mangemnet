import React, { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { fileToBase64 } from "@/lib/db";
import UserManagement from "@/components/UserManagement";
import AuditLog from "@/components/AuditLog";
import ServiceCatalog from "@/components/ServiceCatalog";
import { DEFAULT_INVOICE_PREFIX, DEFAULT_TERMS } from "@/lib/invoice";
import { useAuth } from "@/contexts/AuthContext";

export default function SettingsTab() {
  const { data, updateSettings } = useData();
  const { can } = useAuth();
  const [phone, setPhone] = useState(data.settings.phone || "");
  const [exportName, setExportName] = useState(data.settings.exportName || "DigitalTarget");
  const [footer, setFooter] = useState(data.settings.footer || "");
  const [authorizedName, setAuthorizedName] = useState(data.settings.authorizedName || "");
  const [authorizedDesignation, setAuthorizedDesignation] = useState(data.settings.authorizedDesignation || "Authorized Signatory");
  const [inv, setInv] = useState({
    companyName: data.settings.companyName || "Digital Target",
    companyAddress: data.settings.companyAddress || "",
    companyEmail: data.settings.companyEmail || "",
    companyWebsite: data.settings.companyWebsite || "",
    taxNumber: data.settings.taxNumber || "",
    invoicePrefix: data.settings.invoicePrefix || DEFAULT_INVOICE_PREFIX,
    defaultTaxRate: data.settings.defaultTaxRate ?? 0,
    invoiceTerms: data.settings.invoiceTerms ?? DEFAULT_TERMS,
    bankDetails: data.settings.bankDetails || "",
  });
  const setI = (k: keyof typeof inv) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setInv({ ...inv, [k]: e.target.value });

  const handleSave = async () => {
    const logoInput = document.getElementById("setLogo") as HTMLInputElement;
    const signInput = document.getElementById("setSign") as HTMLInputElement;
    const qrInput = document.getElementById("setBankQR") as HTMLInputElement;

    const newSettings = { ...data.settings, phone, exportName, footer, authorizedName, authorizedDesignation, ...inv, defaultTaxRate: Number(inv.defaultTaxRate) || 0 };

    if (logoInput?.files?.[0]) newSettings.logo = await fileToBase64(logoInput.files[0]);
    if (signInput?.files?.[0]) newSettings.signature = await fileToBase64(signInput.files[0]);
    if (qrInput?.files?.[0]) newSettings.bankQR = await fileToBase64(qrInput.files[0]);

    await updateSettings(newSettings);
    alert("Settings saved ✅");
  };

  return (
    <>
      {can("settings.manage") && (
      <section className="card">
        <h2>Settings</h2>
        <div className="grid3">
          <div><label>Global Logo Upload</label><input id="setLogo" type="file" accept="image/*" />
            <div className="small">Khali chhorein to Digital Target ka brand logo lagta hai.</div>
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

        <h3 style={{ margin: "18px 0 8px" }}>Company &amp; Invoice details</h3>
        <div className="grid3">
          <div><label>Company name</label><input value={inv.companyName} onChange={setI("companyName")} /></div>
          <div><label>Email</label><input value={inv.companyEmail} onChange={setI("companyEmail")} placeholder="info@digitaltarget.pk" /></div>
          <div><label>Website</label><input value={inv.companyWebsite} onChange={setI("companyWebsite")} placeholder="www.digitaltarget.pk" /></div>
        </div>
        <div className="grid3" style={{ marginTop: 10 }}>
          <div><label>Address</label><input value={inv.companyAddress} onChange={setI("companyAddress")} placeholder="Office address, city" /></div>
          <div><label>NTN / Tax no.</label><input value={inv.taxNumber} onChange={setI("taxNumber")} /></div>
          <div className="grid2" style={{ gap: 8 }}>
            <div><label>Invoice prefix</label><input value={inv.invoicePrefix} onChange={setI("invoicePrefix")} /></div>
            <div><label>Default tax %</label><input type="number" min="0" value={inv.defaultTaxRate} onChange={setI("defaultTaxRate")} /></div>
          </div>
        </div>
        <div className="grid2" style={{ marginTop: 10 }}>
          <div><label>Bank / payment details (invoice par)</label><textarea value={inv.bankDetails} onChange={setI("bankDetails")} placeholder={"Bank: Meezan Bank\nTitle: Digital Target\nIBAN: PK00 MEZN 0000 0000 0000\nJazzCash: 0345-1873354"} /></div>
          <div><label>Default terms &amp; conditions</label><textarea value={inv.invoiceTerms} onChange={setI("invoiceTerms")} /></div>
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
      </section>
      )}

      <ServiceCatalog />
      <UserManagement />
      <AuditLog />
    </>
  );
}
