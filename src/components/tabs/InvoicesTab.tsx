import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { useData } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { uid, fmtMoney, nowText, todayISO, fileToBase64 } from "@/lib/db";
import { saveElementAsImage } from "@/lib/exportUtils";
import { writeSafeDocument } from "@/lib/safeHtml";
import { normalizePhone } from "@/lib/phone";
import {
  calcTotals, DEFAULT_INVOICE_PREFIX, DEFAULT_TERMS, DiscountType, InvoiceItem, invoiceView,
  lineTotal, nextInvoiceNo, PAYMENT_METHODS, statusClass,
} from "@/lib/invoice";
import { InvoiceA4, InvoicePOS } from "@/components/invoices/InvoiceTemplates";
import { newVerifyToken, publishVerification, verifyUrl } from "@/lib/invoiceVerify";

const emptyItem = (): InvoiceItem => ({ desc: "", qty: 1, price: 0, total: 0 });

export default function InvoicesTab() {
  const { data, addItem, removeItem, updateItem, updateSettings } = useData();
  const { can, workspaceUid } = useAuth();
  const canManage = can("invoices.manage");
  const settings = data.settings || {};
  const prefix = settings.invoicePrefix || DEFAULT_INVOICE_PREFIX;

  // ---------- editor state ----------
  const [editorOpen, setEditorOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [issueDate, setIssueDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState<InvoiceItem[]>([emptyItem()]);
  const [discountType, setDiscountType] = useState<DiscountType>("amount");
  const [discountValue, setDiscountValue] = useState(0);
  const [taxRate, setTaxRate] = useState<number>(Number(settings.defaultTaxRate) || 0);
  const [status, setStatus] = useState("Unpaid");
  const [paidAmount, setPaidAmount] = useState(0);
  const [paidWallet, setPaidWallet] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState(settings.invoiceTerms || DEFAULT_TERMS);
  const [autoCreateProject, setAutoCreateProject] = useState(true);
  const [projectTitle, setProjectTitle] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showBranding, setShowBranding] = useState(false);

  // ---------- list / preview state ----------
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [previewInv, setPreviewInv] = useState<any>(null);
  const [previewMode, setPreviewMode] = useState<"A4" | "POS">("A4");
  const [autoQR, setAutoQR] = useState("");
  const [busy, setBusy] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const [payInv, setPayInv] = useState<any>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payWallet, setPayWallet] = useState("");
  const [payMethod, setPayMethod] = useState("Cash");

  const totals = calcTotals(items, discountType, discountValue, taxRate);
  const clientOf = (id: string) => data.clients.find((c: any) => c.id === id);
  const projectOf = (id: string) => data.projects.find((p: any) => p.id === id);
  const publish = (inv: any, voided = false) =>
    workspaceUid ? publishVerification(workspaceUid, inv, clientOf(inv.clientId)?.name || "", settings, voided) : Promise.resolve();

  const resetEditor = () => {
    setEditId(""); setClientId(""); setProjectId(""); setInvoiceNo(nextInvoiceNo(data.invoices, prefix));
    setIssueDate(todayISO()); setDueDate(""); setItems([emptyItem()]); setDiscountType("amount"); setDiscountValue(0);
    setTaxRate(Number(settings.defaultTaxRate) || 0); setStatus("Unpaid"); setPaidAmount(0); setPaidWallet("");
    setPaymentMethod("Cash"); setNotes(""); setTerms(settings.invoiceTerms || DEFAULT_TERMS);
    setAutoCreateProject(true); setProjectTitle(""); setEndDate(""); setShowBranding(false);
  };

  const openNew = () => { resetEditor(); setEditorOpen(true); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const setItem = (idx: number, field: keyof InvoiceItem, val: string) => {
    const next = items.map((it, i) => {
      if (i !== idx) return it;
      const upd = { ...it, [field]: field === "desc" ? val : +val || 0 };
      return { ...upd, total: lineTotal(upd.qty, upd.price) };
    });
    setItems(next);
  };

  const startEdit = (inv: any) => {
    setEditId(inv.id); setClientId(inv.clientId || ""); setProjectId(inv.projectId || "");
    setInvoiceNo(inv.invoiceNo || inv.id); setIssueDate(inv.dateISO || todayISO()); setDueDate(inv.dueDate || "");
    setItems(inv.items?.length ? inv.items : [emptyItem()]);
    setDiscountType(inv.discountType || "amount"); setDiscountValue(inv.discountValue || 0); setTaxRate(inv.taxRate || 0);
    setStatus(inv.status || "Unpaid"); setPaidAmount(inv.paidAmount || 0); setPaidWallet(inv.paidWalletId || "");
    setPaymentMethod(inv.paymentMethod || "Cash"); setNotes(inv.notes || ""); setTerms(inv.terms ?? settings.invoiceTerms ?? DEFAULT_TERMS);
    setAutoCreateProject(false); setEditorOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSave = async () => {
    if (!clientId) { alert("Client select karein"); return; }
    const cleanItems = items.filter((i) => i.desc.trim()).map((i) => ({ ...i, desc: i.desc.trim(), total: lineTotal(i.qty, i.price) }));
    if (!cleanItems.length) { alert("Kam az kam 1 item likhein"); return; }
    const t = calcTotals(cleanItems, discountType, discountValue, taxRate);
    const common = {
      clientId, projectId, invoiceNo: invoiceNo.trim() || nextInvoiceNo(data.invoices, prefix), items: cleanItems,
      subtotal: t.subtotal, discountType, discountValue: Number(discountValue) || 0, discountAmount: t.discountAmount,
      taxRate: Number(taxRate) || 0, taxAmount: t.taxAmount, grandTotal: t.grandTotal,
      dateISO: issueDate, dueDate, paymentMethod, notes, terms,
    };
    if (data.invoices.some((x: any) => x.id !== editId && x.invoiceNo === common.invoiceNo)) {
      alert(`Invoice number ${common.invoiceNo} pehle se mojood hai.`); return;
    }

    setBusy(true);
    try {
      if (editId) {
        // Payments are recorded through "Record payment" so the ledger stays in step;
        // editing only recalculates the status against what was already paid.
        const existing = data.invoices.find((x: any) => x.id === editId);
        const paid = existing?.paidAmount || 0;
        const st = paid >= t.grandTotal && t.grandTotal > 0 ? "Paid" : paid > 0 ? "Partial" : "Unpaid";
        const updated = { ...existing, ...common, status: st, paidAmount: Math.min(paid, t.grandTotal), verifyToken: existing?.verifyToken || newVerifyToken() };
        await updateItem("invoices", updated);
        await publish(updated);
        setEditorOpen(false);
        return;
      }

      if ((status === "Paid" || status === "Partial") && !paidWallet) { alert("Payment kis account mein aayi? Account select karein."); return; }
      const amtPaid = status === "Paid" ? t.grandTotal : status === "Partial" ? Math.min(paidAmount, t.grandTotal) : 0;
      if (status === "Partial" && amtPaid <= 0) { alert("Partial ke liye paid amount likhein"); return; }

      const logoEl = document.getElementById("iLogo") as HTMLInputElement | null;
      const signEl = document.getElementById("iSign") as HTMLInputElement | null;
      const bankQREl = document.getElementById("iBankQR") as HTMLInputElement | null;
      const logoOverride = await fileToBase64(logoEl?.files?.[0]);
      const signUpload = await fileToBase64(signEl?.files?.[0]);
      const bankQRUpload = await fileToBase64(bankQREl?.files?.[0]);
      if ((signUpload || bankQRUpload) && can("settings.manage")) {
        await updateSettings({ ...settings, ...(signUpload ? { signature: signUpload } : {}), ...(bankQRUpload ? { bankQR: bankQRUpload } : {}) });
      }

      let finalProjectId = projectId;
      if (autoCreateProject && !projectId) {
        const c = clientOf(clientId);
        const newProj = {
          id: uid("P"), clientId, title: (projectTitle.trim() || `${c?.name || "Project"} - ${cleanItems[0]?.desc || todayISO()}`).slice(0, 80),
          category: "Auto from Invoice", start: (issueDate || todayISO()) + "T09:00", end: endDate ? endDate + "T18:00" : "",
          status: "Running", budget: t.grandTotal, notes: "Auto-created from invoice",
        };
        await addItem("projects", newProj);
        finalProjectId = newProj.id;
      }

      const inv = {
        id: uid("INV"), ...common, projectId: finalProjectId, status: amtPaid >= t.grandTotal && t.grandTotal > 0 ? "Paid" : amtPaid > 0 ? "Partial" : "Unpaid",
        paidAmount: amtPaid, paidWalletId: paidWallet, dateTime: nowText(), startDate: issueDate, endDate,
        logoOverride, sign: signUpload || null, bankQR: bankQRUpload || null,
        payments: amtPaid > 0 ? [{ date: todayISO(), amount: amtPaid, walletId: paidWallet, method: paymentMethod }] : [],
        verifyToken: newVerifyToken(),
      };
      await addItem("invoices", inv);
      await publish(inv);
      if (amtPaid > 0) await postPayment(inv, amtPaid, paidWallet, paymentMethod);
      setEditorOpen(false);
      setPreviewInv(inv);
      setPreviewMode("A4");
    } finally {
      setBusy(false);
    }
  };

  /** Ledger side of a payment: accounting IN entry + wallet balance. */
  const postPayment = async (inv: any, amt: number, walletId: string, method: string) => {
    await addItem("accounting", {
      id: uid("A"), date: todayISO(), type: "IN", clientId: inv.clientId, projectId: inv.projectId,
      category: "Invoice Paid", walletId, amount: amt, desc: `Invoice ${inv.invoiceNo || inv.id} (${method})`, receipt: null,
    });
    const w = data.wallets.find((x: any) => x.id === walletId);
    if (w) await updateItem("wallets", { ...w, balance: (w.balance || 0) + amt });
  };

  const openPayment = (inv: any) => {
    const v = invoiceView(inv);
    setPayInv(inv); setPayAmount(v.due); setPayWallet(inv.paidWalletId || data.wallets[0]?.id || ""); setPayMethod(inv.paymentMethod || "Cash");
  };

  const savePayment = async () => {
    if (!payInv) return;
    const v = invoiceView(payInv);
    const amt = Math.min(Number(payAmount) || 0, v.due);
    if (amt <= 0) { alert("Amount likhein"); return; }
    if (!payWallet) { alert("Account select karein"); return; }
    const newPaid = v.paid + amt;
    const paidInv = {
      ...payInv, paidAmount: newPaid, paidWalletId: payWallet, paymentMethod: payMethod,
      status: newPaid >= v.grandTotal ? "Paid" : "Partial",
      payments: [...(payInv.payments || []), { date: todayISO(), amount: amt, walletId: payWallet, method: payMethod }],
      verifyToken: payInv.verifyToken || newVerifyToken(),
    };
    await updateItem("invoices", paidInv);
    await publish(paidInv);
    await postPayment(payInv, amt, payWallet, payMethod);
    setPayInv(null);
  };

  const handleDelete = async (inv: any) => {
    const paid = (inv.paidAmount || 0) > 0;
    if (!confirm(`Invoice ${inv.invoiceNo || inv.id} delete karein?${paid ? "\n\nIs par payment record hai — Accounting entries aur account balance khud reverse nahi honge." : ""}`)) return;
    await removeItem("invoices", inv.id);
    // Keep the QR link alive but show the invoice as cancelled (anti-fraud).
    if (inv.verifyToken) await publish(inv, true);
  };

  // ---------- WhatsApp ----------
  const openWa = (inv: any, msg: string) => {
    const phone = normalizePhone(clientOf(inv.clientId)?.phone);
    if (!phone) { alert("Client ka phone number sahi nahi hai."); return; }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  };
  const waInvoice = (inv: any) => {
    const v = invoiceView(inv); const c = clientOf(inv.clientId);
    const lines = v.items.map((it) => `• ${it.desc} x${it.qty} = Rs ${fmtMoney(it.total)}`).join("\n");
    openWa(inv, `Assalam o Alaikum ${c?.name || ""},\n\nInvoice: ${v.number}\nDate: ${v.date}${inv.dueDate ? `\nDue: ${inv.dueDate}` : ""}\n\n${lines}\n\nTotal: Rs ${fmtMoney(v.grandTotal)}\nPaid: Rs ${fmtMoney(v.paid)}\nBalance: Rs ${fmtMoney(v.due)}\n\n${settings.companyName || "Digital Target"}`);
  };
  const waReminder = (inv: any) => {
    const v = invoiceView(inv); const c = clientOf(inv.clientId);
    openWa(inv, `Assalam o Alaikum ${c?.name || ""},\n\nFriendly reminder: invoice ${v.number} ka pending amount Rs ${fmtMoney(v.due)} hai${inv.dueDate ? ` (due ${inv.dueDate})` : ""}.\n\nKindly payment arrange kar dein. Shukriya!\n${settings.companyName || "Digital Target"}`);
  };
  const waReceived = (inv: any) => {
    const v = invoiceView(inv); const c = clientOf(inv.clientId);
    openWa(inv, `Assalam o Alaikum ${c?.name || ""},\n\nAap ki payment Rs ${fmtMoney(v.paid)} mil gayi hai (Invoice ${v.number}).${v.due > 0 ? `\nRemaining: Rs ${fmtMoney(v.due)}` : ""}\n\nShukriya!\n${settings.companyName || "Digital Target"}`);
  };

  // ---------- preview / export ----------
  const qrPayload = useCallback((inv: any) => {
    const v = invoiceView(inv);
    return `INVOICE ${v.number}\nDate: ${v.date}\nClient: ${clientOf(inv.clientId)?.name || ""}\nTotal: Rs ${fmtMoney(v.grandTotal)}\nPaid: Rs ${fmtMoney(v.paid)}\nStatus: ${v.status}\n${settings.companyName || "Digital Target"}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.clients, settings.companyName]);

  // Older invoices get a verification link the first time a manager opens them.
  useEffect(() => {
    if (!previewInv || previewInv.verifyToken || !canManage) return;
    const withToken = { ...previewInv, verifyToken: newVerifyToken() };
    updateItem("invoices", withToken).then(() => publish(withToken)).then(() => setPreviewInv(withToken)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewInv?.id]);

  useEffect(() => {
    setAutoQR("");
    if (!previewInv) return;
    let cancelled = false;
    const payload = previewInv.verifyToken ? verifyUrl(previewInv.verifyToken) : qrPayload(previewInv);
    QRCode.toDataURL(payload, { width: 240, margin: 1, color: { dark: "#3D096D" } })
      .then((u: string) => { if (!cancelled) setAutoQR(u); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [previewInv, qrPayload]);

  const printPreview = () => {
    if (!printRef.current) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const size = previewMode === "A4" ? "@page{size:A4;margin:0}" : "@page{size:80mm auto;margin:0}";
    writeSafeDocument(w, `<html><head><title>${invoiceView(previewInv).number}</title><style>body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}${size}</style></head><body>${printRef.current.innerHTML}</body></html>`);
    setTimeout(() => w.print(), 400);
  };

  const downloadPDF = async () => {
    const node = printRef.current?.firstElementChild as HTMLElement | null;
    if (!node) return;
    setBusy(true);
    try {
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      const img = canvas.toDataURL("image/jpeg", 0.95);
      if (previewMode === "A4") {
        const pdf = new jsPDF({ unit: "mm", format: "a4" });
        const w = 210, h = (canvas.height * w) / canvas.width;
        let y = 0;
        pdf.addImage(img, "JPEG", 0, y, w, h);
        while (h + y > 297 + 0.5) { y -= 297; pdf.addPage(); pdf.addImage(img, "JPEG", 0, y, w, h); }
        pdf.save(`${invoiceView(previewInv).number}.pdf`);
      } else {
        const w = 80, h = (canvas.height * w) / canvas.width;
        const pdf = new jsPDF({ unit: "mm", format: [w, h] });
        pdf.addImage(img, "JPEG", 0, 0, w, h);
        pdf.save(`${invoiceView(previewInv).number}_receipt.pdf`);
      }
    } finally {
      setBusy(false);
    }
  };

  const saveImage = async (fmt: "png" | "jpg") => {
    const node = printRef.current?.firstElementChild as HTMLElement | null;
    if (node) await saveElementAsImage(node, fmt, `${invoiceView(previewInv).number}_${previewMode}`, { scale: previewMode === "POS" ? 3 : 2 });
  };

  const exportList = () => {
    const rows = filtered.map((inv: any) => {
      const v = invoiceView(inv);
      return `<tr><td>${v.number}</td><td>${clientOf(inv.clientId)?.name || ""}</td><td>${v.date}</td><td>${v.status}</td><td>Rs ${fmtMoney(v.grandTotal)}</td><td>Rs ${fmtMoney(v.paid)}</td><td>Rs ${fmtMoney(v.due)}</td></tr>`;
    }).join("");
    const w = window.open("", "_blank");
    if (!w) return;
    writeSafeDocument(w, `<html><head><title>Invoices</title><style>body{font-family:Inter,Arial,sans-serif;padding:18px;color:#1F1633}h2{color:#3D096D;margin:0}table{width:100%;border-collapse:collapse;margin-top:12px}th{background:#3D096D;color:#fff;text-align:left;padding:8px;font-size:11px}td{border-bottom:1px solid #eee;padding:8px;font-size:12px}</style></head><body>
      <h2>DIGITAL TARGET — Invoices Report</h2><div style="font-size:12px;color:#666">Generated ${nowText()}</div>
      <table><thead><tr><th>Invoice</th><th>Client</th><th>Date</th><th>Status</th><th>Total</th><th>Paid</th><th>Balance</th></tr></thead><tbody>${rows || "<tr><td colspan=7>No invoices</td></tr>"}</tbody></table></body></html>`);
    setTimeout(() => w.print(), 300);
  };

  // ---------- list ----------
  const views = useMemo(() => data.invoices.map((inv: any) => ({ inv, v: invoiceView(inv) })), [data.invoices]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return views
      .filter(({ inv, v }) => (filter === "ALL" || v.status === filter) &&
        (!q || [v.number, clientOf(inv.clientId)?.name].some((x) => String(x || "").toLowerCase().includes(q))))
      .sort((a, b) => String(b.v.date).localeCompare(String(a.v.date)))
      .map(({ inv }) => inv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views, search, filter, data.clients]);
  const kpi = views.reduce((k, { v }) => ({
    total: k.total + v.grandTotal, paid: k.paid + v.paid, due: k.due + v.due, overdue: k.overdue + (v.status === "Overdue" ? 1 : 0),
  }), { total: 0, paid: 0, due: 0, overdue: 0 });

  return (
    <>
      <section className="card">
        <div className="sectionHead">
          <div>
            <h2 style={{ margin: 0 }}>Invoices</h2>
            <div className="small">Branded invoices, payments aur reminders ek jagah.</div>
          </div>
          <div className="rowActions">
            <button className="btnSmall" onClick={exportList}>Export list</button>
            {canManage && <button className="btnSolid" onClick={openNew}>+ New Invoice</button>}
          </div>
        </div>
        <div className="kpis kpis4" style={{ marginTop: 12 }}>
          <div className="kpi"><div className="t">Total Invoiced</div><div className="v">Rs {fmtMoney(kpi.total)}</div></div>
          <div className="kpi"><div className="t">Received</div><div className="v">Rs {fmtMoney(kpi.paid)}</div></div>
          <div className="kpi"><div className="t">Outstanding</div><div className="v">Rs {fmtMoney(kpi.due)}</div></div>
          <div className="kpi"><div className="t">Overdue</div><div className="v">{kpi.overdue}</div></div>
        </div>
      </section>

      {editorOpen && canManage && (
        <section className="card invEditor">
          <div className="sectionHead">
            <h2 style={{ margin: 0 }}>{editId ? `Edit ${invoiceNo}` : "New Invoice"}</h2>
            <button className="btnSmall" onClick={() => setEditorOpen(false)}>✕ Close</button>
          </div>

          <div className="grid3" style={{ marginTop: 10 }}>
            <div><label>Client *</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Select client…</option>
                {data.clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {clientId && <div className="small">{clientOf(clientId)?.phone || ""}</div>}
            </div>
            <div><label>Invoice No.</label><input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></div>
            <div className="grid2" style={{ gap: 8 }}>
              <div><label>Date</label><input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></div>
              <div><label>Due date</label><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
            </div>
          </div>

          <div className="grid2" style={{ marginTop: 10 }}>
            <div><label>Project</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">(Optional)</option>
                {data.projects.filter((p: any) => !clientId || p.clientId === clientId).map((p: any) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            {!editId && !projectId && (
              <div>
                <label className="permItem" style={{ marginTop: 22 }}>
                  <input type="checkbox" checked={autoCreateProject} onChange={(e) => setAutoCreateProject(e.target.checked)} />
                  <span>Is invoice se Project bhi banayein</span>
                </label>
                {autoCreateProject && (
                  <div className="grid2" style={{ gap: 8 }}>
                    <input value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} placeholder="Project title (auto)" />
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} title="Project end date" />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="invItems">
            <div className="invItemsHead"><span>Description</span><span>Qty</span><span>Rate</span><span>Amount</span><span /></div>
            {items.map((it, i) => (
              <div className="invItemRow" key={i}>
                <input value={it.desc} onChange={(e) => setItem(i, "desc", e.target.value)} placeholder="e.g. Facebook Ads management (1 month)" aria-label="Description" />
                <input type="number" min="0" value={it.qty} onChange={(e) => setItem(i, "qty", e.target.value)} aria-label="Qty" />
                <input type="number" min="0" value={it.price} onChange={(e) => setItem(i, "price", e.target.value)} aria-label="Rate" />
                <b className="invAmt">{fmtMoney(lineTotal(it.qty, it.price))}</b>
                <button className="iconBtn" onClick={() => setItems(items.length > 1 ? items.filter((_, j) => j !== i) : [emptyItem()])} aria-label="Remove item">✕</button>
              </div>
            ))}
            <button className="btnSmall" onClick={() => setItems([...items, emptyItem()])}>+ Add item</button>
          </div>

          <div className="invBottom">
            <div className="grid" style={{ gap: 10 }}>
              <div className="grid3" style={{ gap: 8 }}>
                <div><label>Discount</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <select value={discountType} onChange={(e) => setDiscountType(e.target.value as DiscountType)} style={{ width: 80 }}>
                      <option value="amount">Rs</option><option value="percent">%</option>
                    </select>
                    <input type="number" min="0" value={discountValue} onChange={(e) => setDiscountValue(+e.target.value)} />
                  </div>
                </div>
                <div><label>Tax %</label><input type="number" min="0" step="0.5" value={taxRate} onChange={(e) => setTaxRate(+e.target.value)} /></div>
                <div><label>Payment method</label>
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              {!editId && (
                <div className="grid3" style={{ gap: 8 }}>
                  <div><label>Status</label>
                    <select value={status} onChange={(e) => { setStatus(e.target.value); if (e.target.value === "Unpaid") setPaidAmount(0); }}>
                      <option>Unpaid</option><option>Partial</option><option>Paid</option>
                    </select>
                  </div>
                  <div><label>Paid now</label>
                    <input type="number" min="0" value={status === "Paid" ? totals.grandTotal : paidAmount} disabled={status !== "Partial"} onChange={(e) => setPaidAmount(+e.target.value)} />
                  </div>
                  <div><label>Received in account</label>
                    <select value={paidWallet} onChange={(e) => setPaidWallet(e.target.value)} disabled={status === "Unpaid"}>
                      <option value="">Select…</option>
                      {data.wallets.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {editId && <div className="small">Payments "Record payment" button se add karein taake accounting sahi rahe.</div>}
              <div><label>Notes (invoice par nazar aayenge)</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ minHeight: 56 }} /></div>
              <div><label>Terms &amp; conditions</label><textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} style={{ minHeight: 72 }} /></div>
              {!editId && (
                <div>
                  <button className="linkBtn" onClick={() => setShowBranding(!showBranding)}>{showBranding ? "▾" : "▸"} Is invoice ke liye logo / signature / bank QR alag lagayein</button>
                  {showBranding && (
                    <div className="grid3" style={{ marginTop: 8 }}>
                      <div><label>Logo</label><input id="iLogo" type="file" accept="image/*" /></div>
                      <div><label>Signature</label><input id="iSign" type="file" accept="image/*" /></div>
                      <div><label>Bank QR</label><input id="iBankQR" type="file" accept="image/*" /></div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="invSummary">
              <div><span>Subtotal</span><b>Rs {fmtMoney(totals.subtotal)}</b></div>
              <div><span>Discount</span><b>- Rs {fmtMoney(totals.discountAmount)}</b></div>
              <div><span>Tax ({taxRate || 0}%)</span><b>Rs {fmtMoney(totals.taxAmount)}</b></div>
              <div className="grand"><span>Total</span><b>Rs {fmtMoney(totals.grandTotal)}</b></div>
              <button className="btnSolid" style={{ width: "100%", marginTop: 12 }} onClick={handleSave} disabled={busy}>
                {busy ? "Saving…" : editId ? "Update Invoice" : "Save & Preview"}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <div className="sectionHead">
          <input className="invSearch" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice # or client…" />
          <div className="waFilters" style={{ marginTop: 0 }}>
            {["ALL", "Unpaid", "Partial", "Overdue", "Paid"].map((f) => (
              <button key={f} className={`waChip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>{f === "ALL" ? "All" : f}</button>
            ))}
          </div>
        </div>
        <div className="tablewrap" style={{ marginTop: 10 }}>
          <table>
            <thead><tr><th>Invoice</th><th>Client</th><th>Date / Due</th><th className="num">Total</th><th className="num">Balance</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map((inv: any) => {
                const v = invoiceView(inv);
                return (
                  <tr key={inv.id}>
                    <td style={{ whiteSpace: "nowrap" }}><b>{v.number}</b></td>
                    <td>{clientOf(inv.clientId)?.name || "—"}</td>
                    <td>{v.date}<div className="small">{inv.dueDate ? `Due ${inv.dueDate}` : ""}</div></td>
                    <td className="num">Rs {fmtMoney(v.grandTotal)}</td>
                    <td className="num"><b>Rs {fmtMoney(v.due)}</b></td>
                    <td><span className={`badge ${statusClass(v.status)}`}>{v.status}</span></td>
                    <td className="rowActions">
                      <button className="btnSmall" onClick={() => { setPreviewInv(inv); setPreviewMode("A4"); }}>View</button>
                      {canManage && v.due > 0 && <button className="btnSmall" onClick={() => openPayment(inv)}>Record payment</button>}
                      {canManage && <button className="btnSmall" onClick={() => startEdit(inv)}>Edit</button>}
                      <button className="btnSmall" onClick={() => (v.due > 0 && v.paid === 0 ? waInvoice(inv) : v.due > 0 ? waReminder(inv) : waReceived(inv))} title="Send on WhatsApp">WhatsApp</button>
                      {canManage && <button className="btnSmall" onClick={() => handleDelete(inv)}>Delete</button>}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={7} className="small">Koi invoice nahi.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {previewInv && (
        <div className="dtModalBackdrop" onClick={() => setPreviewInv(null)}>
          <div className="dtModal invPreview" onClick={(e) => e.stopPropagation()}>
            <div className="dtModalHead">
              <div className="rowActions">
                <button className={`waChip ${previewMode === "A4" ? "active" : ""}`} onClick={() => setPreviewMode("A4")}>A4 Invoice</button>
                <button className={`waChip ${previewMode === "POS" ? "active" : ""}`} onClick={() => setPreviewMode("POS")}>POS Receipt</button>
              </div>
              <div className="rowActions">
                <button className="btnSolid" onClick={downloadPDF} disabled={busy}>{busy ? "…" : "⬇ PDF"}</button>
                <button className="btnSmall" onClick={printPreview}>🖨 Print</button>
                <button className="btnSmall" onClick={() => saveImage("png")}>PNG</button>
                <button className="btnSmall" onClick={() => waInvoice(previewInv)}>WhatsApp</button>
                <button className="btnSmall" onClick={() => setPreviewInv(null)}>✕</button>
              </div>
            </div>
            <div className="invPaper">
              <div ref={printRef}>
                {previewMode === "A4"
                  ? <InvoiceA4 inv={previewInv} client={clientOf(previewInv.clientId)} project={projectOf(previewInv.projectId)} settings={settings} qr={autoQR} />
                  : <InvoicePOS inv={previewInv} client={clientOf(previewInv.clientId)} project={projectOf(previewInv.projectId)} settings={settings} qr={autoQR} />}
              </div>
            </div>
          </div>
        </div>
      )}

      {payInv && (
        <div className="dtModalBackdrop" onClick={() => setPayInv(null)}>
          <div className="dtModal" onClick={(e) => e.stopPropagation()}>
            <div className="dtModalHead">
              <div><b>Record payment</b><div className="small">{invoiceView(payInv).number} • Balance Rs {fmtMoney(invoiceView(payInv).due)}</div></div>
              <button className="btnSmall" onClick={() => setPayInv(null)}>✕</button>
            </div>
            <label>Amount received</label>
            <input type="number" min="0" value={payAmount} onChange={(e) => setPayAmount(+e.target.value)} />
            <label>Received in account</label>
            <select value={payWallet} onChange={(e) => setPayWallet(e.target.value)}>
              <option value="">Select…</option>
              {data.wallets.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            {data.wallets.length === 0 && <div className="small">Pehle Accounts tab mein account (Cash / Bank) banayein.</div>}
            <label>Method</label>
            <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
            <button className="btnSolid" style={{ width: "100%", marginTop: 14 }} onClick={savePayment}>Save payment</button>
          </div>
        </div>
      )}
    </>
  );
}
