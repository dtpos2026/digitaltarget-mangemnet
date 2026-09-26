import React, { useState, useRef, useEffect, useCallback } from "react";
import { useData } from "@/contexts/DataContext";
import { uid, fmtMoney, nowText, todayISO, fileToBase64 } from "@/lib/db";
import { saveElementAsImage } from "@/lib/exportUtils";
import QRCode from "qrcode";
import { useAuth } from "@/contexts/AuthContext";
import { normalizePhone } from "@/lib/phone";
import { writeSafeDocument } from "@/lib/safeHtml";

interface InvItem { desc: string; qty: number; price: number; total: number; }

export default function InvoicesTab() {
  const { data, addItem, removeItem, updateItem, updateSettings } = useData();
  const { can } = useAuth();
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [items, setItems] = useState<InvItem[]>([{ desc: "", qty: 1, price: 0, total: 0 }]);
  const [status, setStatus] = useState("Unpaid");
  const [paidAmount, setPaidAmount] = useState(0);
  const [paidWallet, setPaidWallet] = useState("");
  const [notes, setNotes] = useState("");
  // New: project dates + auto-create-project
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState("");
  const [autoCreateProject, setAutoCreateProject] = useState(true);
  const [projectTitle, setProjectTitle] = useState("");
  const [previewInv, setPreviewInv] = useState<any>(null);
  const [previewMode, setPreviewMode] = useState<"A4"|"POS">("A4");
  const [editId, setEditId] = useState<string>("");
  const printRef = useRef<HTMLDivElement>(null);
  // Auto receipt QR as a data URL <img>: a <canvas> loses its pixels when the
  // preview HTML is copied into the print window, so the printed QR was blank.
  const [autoQR, setAutoQR] = useState("");

  const updateItemRow = (idx: number, field: string, val: string) => {
    const newItems = [...items];
    (newItems[idx] as any)[field] = field === "desc" ? val : +val || 0;
    newItems[idx].total = newItems[idx].qty * newItems[idx].price;
    setItems(newItems);
  };

  const grandTotal = items.reduce((s, i) => s + i.total, 0);

  const handleCreate = async () => {
    if (!clientId) { alert("Select a client"); return; }
    if (items.every(i => !i.desc.trim())) { alert("Add at least 1 item"); return; }
    if ((status === "Paid" || status === "Partial") && paidAmount <= 0) { alert("Paid amount required for Partial/Paid."); return; }
    if ((status === "Paid" || status === "Partial") && !paidWallet) { alert("Select Paid Account (required when paid amount > 0)."); return; }

    // EDIT MODE: update existing invoice without creating new accounting/project entries
    if (editId) {
      const existing = data.invoices.find((x: any) => x.id === editId);
      if (existing) {
        const updated = {
          ...existing,
          clientId,
          projectId,
          items,
          grandTotal,
          status,
          paidAmount: status === "Paid" ? Math.max(paidAmount, grandTotal) : paidAmount,
          paidWalletId: paidWallet,
          notes,
          startDate,
          endDate,
        };
        await updateItem("invoices", updated);
        setEditId("");
        setItems([{ desc: "", qty: 1, price: 0, total: 0 }]);
        setStatus("Unpaid"); setPaidAmount(0); setPaidWallet(""); setNotes("");
        setProjectTitle(""); setEndDate(""); setClientId(""); setProjectId("");
        alert("Invoice update ho gayi ✅");
        return;
      }
    }

    const logoEl = document.getElementById("iLogo") as HTMLInputElement;
    const signEl = document.getElementById("iSign") as HTMLInputElement;
    const bankQREl = document.getElementById("iBankQR") as HTMLInputElement;

    const logoOverride = await fileToBase64(logoEl?.files?.[0]);
    const signUpload = await fileToBase64(signEl?.files?.[0]);
    const bankQRUpload = await fileToBase64(bankQREl?.files?.[0]);

    const sign = signUpload || data.settings.signature || null;
    const bankQR = bankQRUpload || data.settings.bankQR || null;

    // Save uploads as defaults for future invoices (settings live in meta/settings,
    // not a collection — updateItem("settings") used to crash the app here).
    if ((signUpload || bankQRUpload) && can("settings.manage")) {
      await updateSettings({
        ...data.settings,
        ...(signUpload ? { signature: signUpload } : {}),
        ...(bankQRUpload ? { bankQR: bankQRUpload } : {}),
      });
    }

    let finalProjectId = projectId;

    // Auto create project from invoice (if enabled and no existing project linked)
    if (autoCreateProject && !projectId) {
      const c = data.clients.find(x => x.id === clientId);
      const autoTitle =
        projectTitle.trim() ||
        `${c?.name || "Project"} - ${items[0]?.desc || todayISO()}`.slice(0, 80);
      const newProj = {
        id: uid("P"),
        clientId,
        title: autoTitle,
        category: "Auto from Invoice",
        start: startDate ? startDate + "T09:00" : todayISO() + "T09:00",
        end: endDate ? endDate + "T18:00" : "",
        status: "Running",
        budget: grandTotal,
        notes: `Auto-created from invoice`,
      };
      await addItem("projects", newProj);
      finalProjectId = newProj.id;
    }

    const inv = {
      id: uid("INV"), clientId, projectId: finalProjectId, items, grandTotal,
      status, paidAmount: status === "Paid" ? Math.max(paidAmount, grandTotal) : paidAmount,
      paidWalletId: paidWallet, notes, dateTime: nowText(), dateISO: todayISO(),
      startDate, endDate,
      logoOverride, sign, bankQR,
    };

    await addItem("invoices", inv);

    if (status === "Paid" || (status === "Partial" && paidAmount > 0)) {
      const amt = status === "Paid" ? grandTotal : paidAmount;
      await addItem("accounting", {
        id: uid("A"), date: todayISO(), type: "IN", clientId, projectId: finalProjectId,
        category: "Invoice Paid", walletId: paidWallet, amount: amt,
        desc: `Auto from invoice ${inv.id}`, receipt: null,
      });
      const w = data.wallets.find(x => x.id === paidWallet);
      if (w) await updateItem("wallets", { ...w, balance: (w.balance || 0) + amt });
    }

    // Clear form
    setItems([{ desc: "", qty: 1, price: 0, total: 0 }]);
    setStatus("Unpaid"); setPaidAmount(0); setPaidWallet(""); setNotes("");
    setProjectTitle(""); setEndDate("");
    if (logoEl) logoEl.value = "";
    if (signEl) signEl.value = "";
    if (bankQREl) bankQREl.value = "";
    alert("Invoice created ✅" + (autoCreateProject && !projectId ? "\nProject bhi auto create ho gaya." : ""));
  };

  const startEdit = (inv: any) => {
    setEditId(inv.id);
    setClientId(inv.clientId || "");
    setProjectId(inv.projectId || "");
    setItems(inv.items && inv.items.length ? inv.items : [{ desc: "", qty: 1, price: 0, total: 0 }]);
    setStatus(inv.status || "Unpaid");
    setPaidAmount(inv.paidAmount || 0);
    setPaidWallet(inv.paidWalletId || "");
    setNotes(inv.notes || "");
    setStartDate(inv.startDate || todayISO());
    setEndDate(inv.endDate || "");
    setAutoCreateProject(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleMarkPaid = async (inv: any) => {
    const due = Math.max(0, (inv.grandTotal || 0) - (inv.paidAmount || 0));
    if (due <= 0) { await updateItem("invoices", { ...inv, status: "Paid" }); return; }
    const amtStr = prompt("Enter amount received:", String(due));
    if (!amtStr) return;
    const amt = +amtStr || 0;
    if (amt <= 0) return;
    const walletName = prompt("Enter Account Name (exact match like Cash/Bank/Online Wallet):", "Cash");
    if (!walletName) return;
    const w = data.wallets.find(x => x.name.toLowerCase() === walletName.toLowerCase());
    if (!w) { alert("Account not found. Please create correct account first."); return; }

    const newPaid = (inv.paidAmount || 0) + amt;
    const newStatus = newPaid >= inv.grandTotal ? "Paid" : "Partial";
    await updateItem("invoices", { ...inv, paidAmount: Math.min(newPaid, inv.grandTotal), paidWalletId: w.id, status: newStatus });
    await updateItem("wallets", { ...w, balance: (w.balance || 0) + amt });
    await addItem("accounting", {
      id: uid("A"), date: todayISO(), type: "IN", clientId: inv.clientId, projectId: inv.projectId,
      category: "Invoice Paid", walletId: w.id, amount: amt,
      desc: `Auto from invoice ${inv.id} (payment)`, receipt: null,
    });
  };

  const sendWhatsApp = (inv: any) => {
    const c = data.clients.find(x => x.id === inv.clientId);
    const phone = normalizePhone(c?.phone);
    const items2 = (inv.items || []).map((it: any) => `${it.desc} x${it.qty} = Rs ${fmtMoney(it.total)}`).join("\n");
    const msg = `Assalam o Alaikum ${c?.name || ""},\n\nInvoice: ${inv.id}\nDate: ${inv.dateTime}\n\n${items2}\n\nTotal: Rs ${fmtMoney(inv.grandTotal)}\nPaid: Rs ${fmtMoney(inv.paidAmount || 0)}\nStatus: ${inv.status}\n\nDigital Target`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const sendReminder = (inv: any) => {
    const c = data.clients.find(x => x.id === inv.clientId);
    const phone = normalizePhone(c?.phone);
    const due = Math.max(0, (inv.grandTotal || 0) - (inv.paidAmount || 0));
    const msg = `Assalam o Alaikum ${c?.name || ""},\n\nYeh friendly reminder hai ke aapki invoice ${inv.id} ka pending amount Rs ${fmtMoney(due)} hai.\n\nKindly payment jaldi se arrange kar dein.\n\nShukriya!\nDigital Target`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const sendReceived = (inv: any) => {
    const c = data.clients.find(x => x.id === inv.clientId);
    const phone = normalizePhone(c?.phone);
    const msg = `Assalam o Alaikum ${c?.name || ""},\n\nAapki payment Rs ${fmtMoney(inv.paidAmount || 0)} mil gayi hai. Invoice ${inv.id}.\n\nShukriya!\nDigital Target`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  // Build QR text payload
  const invoiceTextPayload = useCallback((inv: any) => {
    const c = data.clients.find(x => x.id === inv.clientId);
    const p = data.projects.find(x => x.id === inv.projectId);
    const itemLines = (inv.items || []).map((it: any, i: number) => `${i + 1}. ${it.desc} x${it.qty} = Rs ${fmtMoney(it.total)}`).join("\n");
    return `INVOICE: ${inv.id}\nDate: ${inv.dateTime}\nClient: ${c?.name || ""}\nPhone: ${c?.phone || ""}\nProject: ${p?.title || ""}\n\n${itemLines}\n\nTotal: Rs ${fmtMoney(inv.grandTotal)}\nPaid: Rs ${fmtMoney(inv.paidAmount || 0)}\nStatus: ${inv.status}\n\n${data.settings?.footer || "Digital Target"}`;
  }, [data]);

  const previewA4 = (inv: any) => { setPreviewInv(inv); setPreviewMode("A4"); };
  const previewPOS = (inv: any) => { setPreviewInv(inv); setPreviewMode("POS"); };
  const closePreview = () => setPreviewInv(null);

  // Generate QR after preview renders
  useEffect(() => {
    setAutoQR("");
    if (!previewInv) return;
    let cancelled = false;
    QRCode.toDataURL(invoiceTextPayload(previewInv), { width: 256, margin: 1 })
      .then((url: string) => { if (!cancelled) setAutoQR(url); })
      .catch((e: unknown) => console.warn("QR failed", e));
    return () => { cancelled = true; };
  }, [previewInv, invoiceTextPayload]);

  const printPreview = () => {
    if (!printRef.current) return;
    const w = window.open("", "_blank");
    if (!w) return;
    writeSafeDocument(w, `<html><head><title>Invoice</title><style>
      body{margin:0;font-family:system-ui,sans-serif}
      .r-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
      .r-logo{width:46mm;max-height:26mm;object-fit:contain}
      .r-title{margin:0;font-size:26px;font-weight:900;letter-spacing:1px}
      .r-meta{font-size:12px;color:#111}
      .r-box{border:1px solid #111;border-radius:12px;padding:10px;margin-top:10px}
      .r-table{width:100%;border-collapse:collapse}
      .r-table th,.r-table td{border-bottom:1px solid #111;padding:8px;text-align:left}
      .r-total{display:flex;justify-content:flex-end;margin-top:10px}
      .tbox{min-width:70mm;border:1px solid #111;border-radius:12px;padding:10px;width:70mm}
      .nowrapRow{display:flex;justify-content:space-between;gap:10px}
      .nowrapRow *{white-space:nowrap}
      .qrWrap{display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap}
      .qrBox{width:34mm;height:34mm;border:1px solid #111;border-radius:10px;display:grid;place-items:center;overflow:hidden}
      .qrBox img, .qrBox canvas{width:100%;height:100%;object-fit:contain}
      .sigRow{display:flex;justify-content:flex-end;margin-top:18px}
      .sigBox{width:65mm;text-align:center}
      .sigLine{border-top:1px solid #111;margin-top:26px}
      .footerNote{font-size:12px;margin-top:10px}
      .posCenter{text-align:center}.posHr{border-top:1px dashed #000;margin:6px 0}
      .posSmall{font-size:12px}.posBold{font-weight:900}
      .posLogo{max-width:40mm;max-height:16mm;object-fit:contain}
      .posTbl{width:100%;border-collapse:collapse}
      .posTbl th{font-size:11px;font-weight:900;border-bottom:1px dashed #000;padding:4px 0}
      .posTbl td{padding:3px 0;font-size:12px}
      .posQR{display:flex;justify-content:center;margin:6px 0}
      .small{font-size:12px;color:#64748b}
      @media print{body{margin:0}}
    </style></head><body>${printRef.current.innerHTML}</body></html>`);
    setTimeout(() => w.print(), 300);
  };

  const savePreviewAsImage = async (fmt: "png" | "jpg") => {
    if (!printRef.current) return;
    const target = printRef.current.firstElementChild as HTMLElement;
    if (!target) return;
    const filename = previewInv ? `${previewInv.id}_${previewMode}` : "invoice";
    await saveElementAsImage(target, fmt, filename, {
      scale: previewMode === "POS" ? 3 : 2,
    });
  };

  const exportInvoiceList = () => {
    const rows = data.invoices.slice().reverse().map(inv => {
      const c = data.clients.find(x => x.id === inv.clientId);
      const due = Math.max(0, (inv.grandTotal || 0) - (inv.paidAmount || 0));
      return `<tr><td>${inv.id}</td><td>${c?.name || ""}</td><td>${inv.status || ""}</td><td>Rs ${fmtMoney(inv.grandTotal || 0)}</td><td>Rs ${fmtMoney(inv.paidAmount || 0)}</td><td>Rs ${fmtMoney(due)}</td></tr>`;
    }).join("");
    const w2 = window.open("", "_blank");
    if (!w2) return;
    writeSafeDocument(w2, `<html><head><title>Invoice List</title><style>body{margin:0;font-family:system-ui,sans-serif;padding:14px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left;font-size:13px}th{font-weight:900}</style></head><body>
      <h2 style="margin:0">DIGITAL TARGET</h2>
      <div style="font-weight:900;margin-top:4px">Invoices Report</div>
      <div style="font-size:12px;color:#64748b">Generated: ${nowText()}</div>
      <hr/>
      <table><thead><tr><th>ID</th><th>Client</th><th>Status</th><th>Total</th><th>Paid</th><th>Due</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">No invoices</td></tr>'}</tbody></table>
    </body></html>`);
    setTimeout(() => w2.print(), 300);
  };

  const verifyInvoice = () => {
    const id = prompt("Enter Invoice ID (INV-...)");
    if (!id) return;
    const inv = data.invoices.find(x => x.id === id.trim());
    if (!inv) { alert("Not found"); return; }
    previewA4(inv);
  };

  // Build A4 receipt - exact match to original HTML
  const renderA4Receipt = (inv: any) => {
    const client = data.clients.find(c => c.id === inv.clientId);
    const proj = data.projects.find(p => p.id === inv.projectId);
    const useLogo = inv.logoOverride?.data || data.settings?.logo?.data || "";
    const signData = inv.sign?.data || data.settings?.signature?.data || "";
    const bankQRData = inv.bankQR?.data || data.settings?.bankQR?.data || "";

    return (
      <div style={{ width: "210mm", minHeight: "297mm", padding: "12mm", background: "#fff", color: "#000", fontFamily: "ui-sans-serif, system-ui, Segoe UI, Roboto, Arial, sans-serif" }}>
        <div className="r-top">
          <div>
            {useLogo ? <img className="r-logo" src={useLogo} alt="logo" style={{ width: "46mm", maxHeight: "26mm", objectFit: "contain" }} /> : null}
          </div>
          <div style={{ textAlign: "right" }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, letterSpacing: 1 }}>INVOICE</h1>
            <div style={{ fontSize: 12, color: "#111" }}><b>ID:</b> {inv.id}<br /><b>Date:</b> {inv.dateTime}<br /><b>Status:</b> {inv.status}</div>
          </div>
        </div>

        <div style={{ border: "1px solid #111", borderRadius: 12, padding: 10, marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div><b>Bill To:</b><br />{client?.name || ""}<br />{client?.phone || ""}<div className="small">{client?.ref || ""}</div></div>
            <div><b>Project:</b><br />{proj?.title || ""}<div className="small">{proj?.category || ""}</div></div>
          </div>
        </div>

        <div style={{ border: "1px solid #111", borderRadius: 12, padding: 10, marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ borderBottom: "1px solid #111" }}><th style={{ padding: 8, textAlign: "left" }}>#</th><th style={{ padding: 8, textAlign: "left" }}>DESCRIPTION</th><th style={{ padding: 8, textAlign: "left" }}>QTY</th><th style={{ padding: 8, textAlign: "left" }}>PRICE</th><th style={{ padding: 8, textAlign: "left" }}>TOTAL</th></tr></thead>
            <tbody>
              {(inv.items || []).map((it: any, i: number) => (
                <tr key={i} style={{ borderBottom: "1px solid #111" }}><td style={{ padding: 8 }}>{i + 1}</td><td style={{ padding: 8 }}>{it.desc}</td><td style={{ padding: 8 }}>{it.qty}</td><td style={{ padding: 8 }}>Rs {fmtMoney(it.price)}</td><td style={{ padding: 8 }}>Rs {fmtMoney(it.total)}</td></tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <div style={{ minWidth: "70mm", width: "70mm", border: "1px solid #111", borderRadius: 12, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span style={{ whiteSpace: "nowrap" }}>Grand Total</span><b style={{ whiteSpace: "nowrap" }}>Rs {fmtMoney(inv.grandTotal)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span style={{ whiteSpace: "nowrap" }}>Paid</span><b style={{ whiteSpace: "nowrap" }}>Rs {fmtMoney(inv.paidAmount || 0)}</b></div>
            </div>
          </div>

          {/* QR Section */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <div style={{ width: "34mm", height: "34mm", border: "1px solid #111", borderRadius: 10, display: "grid", placeItems: "center", overflow: "hidden" }}>
              {autoQR ? <img src={autoQR} alt="receipt qr" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : null}
            </div>
            <div style={{ width: "34mm", height: "34mm", border: "1px solid #111", borderRadius: 10, display: "grid", placeItems: "center", overflow: "hidden" }}>
              {bankQRData ? <img src={bankQRData} alt="bankqr" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <div style={{ fontSize: 10 }}>Bank QR</div>}
            </div>
            <div style={{ fontSize: 12 }}>
              <b>Auto Receipt QR</b> contains full receipt text.<br />
              <b>Bank QR</b> is your payment QR (optional).
            </div>
          </div>

          {/* Signature */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
            <div style={{ width: "65mm", textAlign: "center" }}>
              {signData ? <img src={signData} alt="signature" style={{ maxWidth: "65mm", maxHeight: "20mm", objectFit: "contain" }} /> : null}
              <div style={{ borderTop: "1px solid #111", marginTop: signData ? 6 : 26 }}></div>
              <div style={{ fontSize: 12 }}>Signature</div>
            </div>
          </div>

          <div style={{ fontSize: 12, marginTop: 10 }}>
            {data.settings?.footer || ("Digital Target | Phone: " + (data.settings?.phone || ""))}
          </div>
        </div>
      </div>
    );
  };

  // Build POS receipt - VIP Premium Design
  const renderPOSReceipt = (inv: any) => {
    const client = data.clients.find(c => c.id === inv.clientId);
    const proj = data.projects.find(p => p.id === inv.projectId);
    const useLogo = inv.logoOverride?.data || data.settings?.logo?.data || "";
    const due = Math.max(0, (inv.grandTotal || 0) - (inv.paidAmount || 0));

    return (
      <div style={{ width: "80mm", padding: "5mm 4mm", background: "#fff", color: "#000", fontFamily: "'Inter', system-ui, sans-serif" }}>
        {/* VIP Header */}
        <div className="pos-vip-header">
          {useLogo ? <img src={useLogo} alt="logo" style={{ maxWidth: "36mm", maxHeight: "14mm", objectFit: "contain", marginBottom: 4 }} /> : null}
          <div className="pos-brand">{data.settings?.companyName || "DIGITAL TARGET"}</div>
          <div className="pos-tagline">★ Premium Receipt ★</div>
        </div>

        {/* Gold divider */}
        <div className="pos-vip-divider" />

        {/* Invoice Info */}
        <div style={{ fontSize: 11, lineHeight: 1.6, padding: "2mm 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>Invoice</span><b>{inv.id}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>Date</span><span>{inv.dateTime}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>Client</span><b>{client?.name || ""}</b></div>
          {client?.phone && <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>Phone</span><span>{client.phone}</span></div>}
          {proj?.title && <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>Project</span><span>{proj.title}</span></div>}
        </div>

        <div className="pos-vip-divider" />

        {/* Items Table */}
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "2mm 0" }}>
          <thead>
            <tr>
              <th style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid #ddd", padding: "4px 0", textAlign: "left", width: "50%", color: "#888" }}>Item</th>
              <th style={{ fontSize: 9, fontWeight: 800, borderBottom: "1px solid #ddd", padding: "4px 0", textAlign: "center", width: "12%", color: "#888" }}>Qty</th>
              <th style={{ fontSize: 9, fontWeight: 800, borderBottom: "1px solid #ddd", padding: "4px 0", textAlign: "right", width: "19%", color: "#888" }}>Rate</th>
              <th style={{ fontSize: 9, fontWeight: 800, borderBottom: "1px solid #ddd", padding: "4px 0", textAlign: "right", width: "19%", color: "#888" }}>Amt</th>
            </tr>
          </thead>
          <tbody>
            {(inv.items || []).map((it: any, i: number) => (
              <tr key={i}>
                <td style={{ padding: "4px 0", fontSize: 11 }}>{it.desc}</td>
                <td style={{ textAlign: "center", padding: "4px 0", fontSize: 11 }}>{it.qty}</td>
                <td style={{ textAlign: "right", padding: "4px 0", fontSize: 11 }}>{fmtMoney(it.price)}</td>
                <td style={{ textAlign: "right", fontWeight: 700, padding: "4px 0", fontSize: 11 }}>{fmtMoney(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* VIP Total Box */}
        <div className="pos-vip-total-box">
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800 }}>
            <span>TOTAL</span><span>Rs {fmtMoney(inv.grandTotal)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#555", marginTop: 2 }}>
            <span>Paid</span><span>Rs {fmtMoney(inv.paidAmount || 0)}</span>
          </div>
          {due > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#b8860b", fontWeight: 700, marginTop: 2 }}>
              <span>Balance Due</span><span>Rs {fmtMoney(due)}</span>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#888", margin: "2mm 0" }}>
          <span>Status</span>
          <span style={{ fontWeight: 700, color: inv.status === "Paid" ? "#10b981" : inv.status === "Partial" ? "#f59e0b" : "#ef4444" }}>{inv.status}</span>
        </div>

        <div className="pos-vip-divider" />

        {/* QR */}
        <div style={{ textAlign: "center", fontSize: 9, color: "#888", letterSpacing: 1, textTransform: "uppercase", marginTop: 4 }}>Scan to Verify</div>
        <div style={{ display: "flex", justifyContent: "center", margin: "4px 0" }}>
          <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 4 }}>
            {autoQR ? <img src={autoQR} alt="receipt qr" style={{ width: 128, height: 128 }} /> : null}
          </div>
        </div>

        {/* VIP Footer */}
        <div className="pos-vip-footer">
          <div className="thank-you">Thank You!</div>
          <div className="sub-text">{data.settings?.footer || "Digital Target"}</div>
          {data.settings?.phone && <div style={{ fontSize: 9, color: "#aaa", marginTop: 2 }}>{data.settings.phone}</div>}
        </div>
      </div>
    );
  };

  const selectedClient = data.clients.find(c => c.id === clientId);

  return (
    <section className="card">
      <h2>Invoices / Billing</h2>

      {previewInv && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
            <button className="btnSolid" onClick={printPreview}>Print / Save PDF</button>
            <button className="btnSmall" onClick={() => savePreviewAsImage("png")}>Save PNG</button>
            <button className="btnSmall" onClick={() => savePreviewAsImage("jpg")}>Save JPG</button>
            <button className="btnDanger" onClick={closePreview}>Close</button>
            <span className="small">Tip: Print for PDF, or Save as Image.</span>
          </div>
          <div ref={printRef} style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 14, padding: 10 }}>
            {previewMode === "A4" ? renderA4Receipt(previewInv) : renderPOSReceipt(previewInv)}
          </div>
        </div>
      )}

      <div className="grid2">
        <div><label>Client</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Select...</option>
            {data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div><label>Project</label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">(Optional)</option>
            {data.projects.filter(p => !clientId || p.clientId === clientId).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
      </div>
      <div className="grid2">
        <div><label>Client Phone (auto)</label><input value={selectedClient?.phone || ""} readOnly /></div>
        <div><label>Date & Time</label><input value={nowText()} readOnly /></div>
      </div>

      {/* NEW: Project auto-creation panel */}
      <div className="card" style={{ boxShadow: "none", padding: 10, marginTop: 12, background: "rgba(0,0,0,0.02)" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={autoCreateProject}
            onChange={(e) => setAutoCreateProject(e.target.checked)}
            disabled={!!projectId}
          />
          <span><b>Is invoice se auto Project bhi banao</b> {projectId && <span className="small">(disabled — already linked)</span>}</span>
        </label>
        {autoCreateProject && !projectId && (
          <>
            <div className="grid2">
              <div><label>Project Title (optional)</label>
                <input value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} placeholder="auto: Client - First item" />
              </div>
              <div><label>Project Status</label>
                <input value="Running (auto)" readOnly />
              </div>
            </div>
            <div className="grid2" style={{ marginTop: 8 }}>
              <div><label>Start Date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div><label>End Date (optional)</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Logo, Signature, Bank QR uploads per invoice */}
      <div className="grid3" style={{ marginTop: 12 }}>
        <div><label>Logo upload (optional override)</label><input id="iLogo" type="file" accept="image/*" /></div>
        <div><label>Signature upload</label><input id="iSign" type="file" accept="image/*" /></div>
        <div><label>Bank QR upload (optional)</label><input id="iBankQR" type="file" accept="image/*" /></div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <label style={{ margin: 0 }}>Items</label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btnSmall" onClick={() => setItems([...items, { desc: "", qty: 1, price: 0, total: 0 }])}>+ Add Item</button>
            <button className="btnSmall" onClick={() => setItems([{ desc: "", qty: 1, price: 0, total: 0 }])}>Clear Items</button>
          </div>
        </div>
        <div className="tablewrap">
          <table style={{ minWidth: 0 }}>
            <thead><tr><th style={{ width: "58%" }}>Description</th><th style={{ width: "12%" }}>Qty</th><th style={{ width: "15%" }}>Price</th><th style={{ width: "15%" }}>Total</th><th style={{ width: "1%" }}>Action</th></tr></thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i}>
                  <td><input value={item.desc} onChange={(e) => updateItemRow(i, "desc", e.target.value)} placeholder="Description" /></td>
                  <td><input type="number" min="1" value={item.qty} onChange={(e) => updateItemRow(i, "qty", e.target.value)} /></td>
                  <td><input type="number" min="0" value={item.price} onChange={(e) => updateItemRow(i, "price", e.target.value)} /></td>
                  <td><b>{fmtMoney(item.total)}</b></td>
                  <td className="rowActions"><button className="btnSmall" onClick={() => setItems(items.filter((_, j) => j !== i))}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ boxShadow: "none", padding: 10, marginTop: 10, display: "flex", justifyContent: "space-between" }}>
          <div className="small">Live Total Preview</div>
          <div style={{ fontSize: 18, fontWeight: 900 }}>Rs {fmtMoney(grandTotal)}</div>
        </div>
      </div>

      <div className="grid3" style={{ marginTop: 12 }}>
        <div><label>Status</label>
          <select value={status} onChange={(e) => {
            setStatus(e.target.value);
            if (e.target.value === "Paid") setPaidAmount(grandTotal);
            if (e.target.value === "Unpaid") { setPaidAmount(0); setPaidWallet(""); }
          }}>
            <option value="Unpaid">Unpaid</option><option value="Partial">Partial</option><option value="Paid">Paid</option>
          </select>
        </div>
        <div><label>Paid Amount</label><input type="number" value={paidAmount} onChange={(e) => setPaidAmount(+e.target.value)} /></div>
        <div><label>Paid Account (Required if Paid)</label>
          <select value={paidWallet} onChange={(e) => setPaidWallet(e.target.value)}>
            <option value="">Select account...</option>
            {data.wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ marginTop: 10 }}><label>Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" /></div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <button className="btnSolid" onClick={handleCreate}>{editId ? "Update Invoice" : "Create Invoice"}</button>
        {editId && <button className="btnDanger" onClick={() => { setEditId(""); setItems([{ desc: "", qty: 1, price: 0, total: 0 }]); setStatus("Unpaid"); setPaidAmount(0); setPaidWallet(""); setNotes(""); setClientId(""); setProjectId(""); }}>Cancel Edit</button>}
        <button className="btnSmall" onClick={exportInvoiceList}>Export Invoice List</button>
        <button className="btnDanger" onClick={() => { setItems([{ desc: "", qty: 1, price: 0, total: 0 }]); setStatus("Unpaid"); setPaidAmount(0); setPaidWallet(""); setNotes(""); }}>Clear</button>
      </div>

      <hr />
      <div className="tablewrap">
        <table>
          <thead><tr><th>ID</th><th>Client</th><th>Status</th><th>Total</th><th>Paid</th><th>Action</th></tr></thead>
          <tbody>
            {data.invoices.slice().reverse().map((inv) => {
              const c = data.clients.find(x => x.id === inv.clientId);
              return (
                <tr key={inv.id}>
                  <td><b>{inv.id}</b><div className="small">{inv.dateTime}</div></td>
                  <td>{c?.name || ""}</td>
                  <td><span className={`badge ${inv.status === "Paid" ? "ok" : inv.status === "Partial" ? "warn" : "bad"}`}>{inv.status}</span></td>
                  <td>Rs {fmtMoney(inv.grandTotal)}</td>
                  <td>Rs {fmtMoney(inv.paidAmount || 0)}</td>
                  <td className="rowActions">
                    <button className="btnSmall" onClick={() => previewA4(inv)}>A4</button>
                    <button className="btnSmall" onClick={() => previewPOS(inv)}>POS</button>
                    <button className="btnSmall" onClick={() => startEdit(inv)}>Edit</button>
                    <button className="btnSmall" onClick={() => sendWhatsApp(inv)}>WhatsApp</button>
                    <button className="btnSmall" onClick={() => sendReminder(inv)}>Reminder</button>
                    <button className="btnSmall" onClick={() => sendReceived(inv)}>Received</button>
                    <button className="btnSmall" onClick={() => handleMarkPaid(inv)}>Mark Paid</button>
                    <button className="btnSmall" onClick={() => { if (confirm("Delete?")) removeItem("invoices", inv.id); }}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <hr />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btnSolid" onClick={verifyInvoice}>Verify Invoice by ID</button>
        <span className="small">Enter invoice ID for verification & preview.</span>
      </div>
    </section>
  );
}
