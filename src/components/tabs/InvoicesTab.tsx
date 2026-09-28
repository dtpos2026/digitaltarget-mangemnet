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
  calcTotals, DEFAULT_INVOICE_PREFIX, DEFAULT_TERMS, DiscountType, InvoiceItem, InvoicePayment, invoiceView,
  lineTotal, nextInvoiceNo, PAYMENT_METHODS, statusClass, endDateFor, durationLabel, daysToEnd, renewalState,
  paymentsOf, paidTotal,
} from "@/lib/invoice";
import { InvoiceA4, InvoicePOS } from "@/components/invoices/InvoiceTemplates";
import { newVerifyToken, publishVerification, verifyUrl } from "@/lib/invoiceVerify";
import { activeServicesOf, DURATIONS, DurationId, isRecurring, linesOf, serviceById } from "@/lib/catalog";
import WhatsAppComposer from "@/components/WhatsAppComposer";
import ModuleInsights from "@/components/ModuleInsights";
import { printElementHTML } from "@/lib/exportUtils";

const emptyItem = (): InvoiceItem => ({ desc: "", qty: 1, price: 0, total: 0 });

export default function InvoicesTab() {
  const { data, addItem, removeItem, updateItem, updateSettings, adjustWallet } = useData();
  const { can, workspaceUid, user } = useAuth();
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
  const [category, setCategory] = useState("");
  const [catFilter, setCatFilter] = useState("ALL");
  // Period / package (ads, management, subscriptions)
  const [startDate, setStartDate] = useState(todayISO());
  const [duration, setDuration] = useState<DurationId>("none");
  const [packageName, setPackageName] = useState("");
  const [trackRenewal, setTrackRenewal] = useState(false);
  const [renewalOf, setRenewalOf] = useState("");
  const services = activeServicesOf(settings);
  const lines = linesOf(settings);
  const methods: string[] = Array.isArray(settings.paymentMethods) && settings.paymentMethods.length ? settings.paymentMethods : PAYMENT_METHODS;
  const renewDays = Number(settings.renewalReminderDays) || 7;

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
  const [payDate, setPayDate] = useState(todayISO());
  const [payRef, setPayRef] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [composer, setComposer] = useState<{ inv: any; types: string[]; paidNow?: number } | null>(null);

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
    setAutoCreateProject(true); setProjectTitle(""); setEndDate(""); setShowBranding(false); setCategory("");
    setStartDate(todayISO()); setDuration("none"); setPackageName(""); setTrackRenewal(false); setRenewalOf("");
  };

  const openNew = () => { resetEditor(); setEditorOpen(true); window.scrollTo({ top: 0, behavior: "smooth" }); };

  /** Days in the period (inclusive) — used as qty for per-day services. */
  const periodDays = (start: string, end: string) => {
    if (!start || !end) return 0;
    const d = Math.round((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86400000) + 1;
    return d > 0 ? d : 0;
  };
  /** Per-day services follow the period length. */
  const syncDailyQty = (list: InvoiceItem[], start: string, end: string) => {
    const days = periodDays(start, end);
    if (!days) return list;
    return list.map((it) => {
      const svc = it.service ? serviceById(settings, it.service) : undefined;
      return svc?.pricing === "daily" && (it as any).kind !== "setup" ? { ...it, qty: days, total: lineTotal(days, it.price) } : it;
    });
  };
  const changeDuration = (d: DurationId) => {
    setDuration(d);
    if (d === "custom") return;
    const end = endDateFor(startDate, d);
    setEndDate(end);
    setItems(syncDailyQty(items, startDate, end));
  };
  const changeStart = (v: string) => {
    setStartDate(v);
    if (duration !== "custom" && duration !== "none") {
      const end = endDateFor(v, duration);
      setEndDate(end);
      setItems(syncDailyQty(items, v, end));
    }
  };
  const changeEnd = (v: string) => {
    setEndDate(v);
    if (duration !== "none") setDuration("custom");
    setItems(syncDailyQty(items, startDate, v));
  };

  const pickService = (idx: number, id: string) => {
    const svc = services.find((x) => x.id === id);
    if (!svc) return;
    if (!category) setCategory(svc.line);
    if (!packageName && svc.packageName) setPackageName(svc.packageName);
    let end = endDate;
    if (svc.duration && svc.duration !== "none" && duration === "none") {
      setDuration(svc.duration);
      end = endDateFor(startDate, svc.duration);
      setEndDate(end);
    }
    if (isRecurring(svc)) setTrackRenewal(true);
    const days = periodDays(startDate, end);
    const qty = svc.pricing === "daily" && days ? days : items[idx]?.qty || 1;
    const main = { ...items[idx], desc: svc.name, price: svc.rate, qty, total: lineTotal(qty, svc.rate), service: svc.id } as InvoiceItem;
    const next = items.map((it, i) => (i === idx ? main : it));
    // Setup + monthly: the one-off setup fee is its own line.
    if (svc.pricing === "setup_plus_monthly" && svc.setupFee) {
      next.splice(idx, 0, { desc: `${svc.name} — setup fee`, qty: 1, price: svc.setupFee, total: svc.setupFee, service: svc.id, kind: "setup" } as InvoiceItem);
    }
    setItems(next);
  };

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
    setAutoCreateProject(false); setCategory(inv.category || "");
    setStartDate(inv.startDate || inv.dateISO || todayISO()); setEndDate(inv.endDate || "");
    setDuration((inv.duration as DurationId) || (inv.endDate ? "custom" : "none")); setPackageName(inv.packageName || "");
    setTrackRenewal(!!inv.endDate && inv.renewal !== false); setRenewalOf(inv.renewalOf || "");
    setEditorOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSave = async () => {
    if (!clientId) { alert("Client select karein"); return; }
    if (!category) { alert("Service category select karein (e.g. Digital Marketing)"); return; }
    const cleanItems = items.filter((i) => i.desc.trim()).map((i) => ({ ...i, desc: i.desc.trim(), total: lineTotal(i.qty, i.price) }));
    if (!cleanItems.length) { alert("Kam az kam 1 item likhein"); return; }
    const t = calcTotals(cleanItems, discountType, discountValue, taxRate);
    const common = {
      clientId, projectId, category, invoiceNo: invoiceNo.trim() || nextInvoiceNo(data.invoices, prefix), items: cleanItems,
      subtotal: t.subtotal, discountType, discountValue: Number(discountValue) || 0, discountAmount: t.discountAmount,
      taxRate: Number(taxRate) || 0, taxAmount: t.taxAmount, grandTotal: t.grandTotal,
      dateISO: issueDate, dueDate, paymentMethod, notes, terms,
      startDate: duration === "none" ? "" : startDate, endDate: duration === "none" ? "" : endDate,
      duration, packageName: packageName.trim(), renewal: duration !== "none" && trackRenewal,
      renewalOf: renewalOf || "",
    };
    if (duration !== "none" && endDate && startDate && endDate < startDate) { alert("End date start date se pehle nahi ho sakti"); return; }
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
          category: category || "Auto from Invoice", start: (common.startDate || issueDate || todayISO()) + "T09:00", end: common.endDate ? common.endDate + "T18:00" : "",
          status: "Running", budget: t.grandTotal, notes: "Auto-created from invoice",
        };
        await addItem("projects", newProj);
        finalProjectId = newProj.id;
      }

      const firstPay: InvoicePayment | null = amtPaid > 0
        ? { id: uid("PAY"), date: issueDate || todayISO(), amount: amtPaid, method: paymentMethod, walletId: paidWallet, reference: "", notes: "Invoice banate waqt", accountingId: uid("A"), by: user?.email || "" }
        : null;
      const inv = {
        id: uid("INV"), ...common, projectId: finalProjectId, status: amtPaid >= t.grandTotal && t.grandTotal > 0 ? "Paid" : amtPaid > 0 ? "Partial" : "Unpaid",
        paidAmount: amtPaid, paidWalletId: paidWallet, dateTime: nowText(),
        logoOverride, sign: signUpload || null, bankQR: bankQRUpload || null,
        payments: firstPay ? [firstPay] : [],
        verifyToken: newVerifyToken(),
        createdAt: new Date().toISOString(),
      };
      await addItem("invoices", inv);
      await publish(inv);
      if (firstPay) await postPayment(inv, firstPay);
      if (renewalOf) {
        const old = data.invoices.find((x: any) => x.id === renewalOf);
        if (old) await updateItem("invoices", { ...old, renewedBy: inv.id, renewedAt: new Date().toISOString() });
      }
      setEditorOpen(false);
      setPreviewInv(inv);
      setPreviewMode("A4");
    } finally {
      setBusy(false);
    }
  };

  /** Ledger side of a payment: accounting IN entry (same id as the payment's accountingId) + wallet balance. */
  const postPayment = async (inv: any, pay: InvoicePayment) => {
    await addItem("accounting", {
      id: pay.accountingId || uid("A"), date: pay.date || todayISO(), type: "IN", clientId: inv.clientId, projectId: inv.projectId,
      category: "Invoice Paid", walletId: pay.walletId, amount: pay.amount, scope: "",
      desc: `Invoice ${inv.invoiceNo || inv.id} (${pay.method}${pay.reference ? `, ref ${pay.reference}` : ""})`,
      invoiceId: inv.id, paymentId: pay.id, receipt: null, createdAt: new Date().toISOString(),
    });
    if (pay.walletId && data.wallets.some((x: any) => x.id === pay.walletId)) await adjustWallet(pay.walletId, pay.amount, `Invoice ${inv.invoiceNo || inv.id}`);
  };

  /** Adds one payment to an invoice, posts it to the ledger and returns the updated invoice. */
  const recordPayment = async (inv: any, p: Omit<InvoicePayment, "id" | "accountingId">) => {
    const v = invoiceView(inv);
    const amt = Math.min(Number(p.amount) || 0, v.due);
    if (amt <= 0) throw new Error("Amount likhein");
    if (!p.walletId) throw new Error("Account select karein");
    const pay: InvoicePayment = { ...p, amount: amt, id: uid("PAY"), accountingId: uid("A"), by: user?.email || "" };
    const history = [...paymentsOf(inv), pay];
    const newPaid = Math.min(paidTotal(history), v.grandTotal);
    const paidInv = {
      ...inv, payments: history, paidAmount: newPaid, paidWalletId: p.walletId, paymentMethod: p.method,
      status: newPaid >= v.grandTotal ? "Paid" : "Partial", lastPaymentAt: pay.date,
      verifyToken: inv.verifyToken || newVerifyToken(),
    };
    await updateItem("invoices", paidInv);
    await publish(paidInv);
    await postPayment(paidInv, pay);
    return { paidInv, pay };
  };

  const openPayment = (inv: any) => {
    const v = invoiceView(inv);
    setPayInv(inv); setPayAmount(v.due); setPayWallet(inv.paidWalletId || data.wallets[0]?.id || "");
    setPayMethod(inv.paymentMethod || methods[0] || "Cash"); setPayDate(todayISO()); setPayRef(""); setPayNotes("");
  };

  const savePayment = async () => {
    if (!payInv) return;
    try {
      setBusy(true);
      const { paidInv, pay } = await recordPayment(payInv, { date: payDate, amount: payAmount, method: payMethod, walletId: payWallet, reference: payRef.trim(), notes: payNotes.trim() });
      setPayInv(null);
      if (normalizePhone(clientOf(paidInv.clientId)?.phone)) setComposer({ inv: paidInv, types: ["payment_received", "invoice"], paidNow: pay.amount });
    } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  };

  /** One click: the full balance as paid into the invoice's usual account. */
  const markPaid = async (inv: any) => {
    const v = invoiceView(inv);
    const walletId = inv.paidWalletId || data.wallets[0]?.id;
    if (!walletId) { openPayment(inv); return; }
    const w = data.wallets.find((x: any) => x.id === walletId);
    if (!confirm(`${v.number}: Rs ${fmtMoney(v.due)} ko "${w?.name || "account"}" mein paid mark karein? (aaj ki tareekh, ${inv.paymentMethod || "Cash"})`)) return;
    try {
      setBusy(true);
      const { paidInv, pay } = await recordPayment(inv, { date: todayISO(), amount: v.due, method: inv.paymentMethod || "Cash", walletId, reference: "", notes: "Mark as Paid" });
      if (normalizePhone(clientOf(paidInv.clientId)?.phone)) setComposer({ inv: paidInv, types: ["payment_received", "invoice"], paidNow: pay.amount });
    } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  };

  /** Renewal: a new invoice for the next period, linked to this one. */
  const startRenewal = (inv: any) => {
    const v = invoiceView(inv);
    resetEditor();
    const nextStart = inv.endDate ? new Date(new Date(`${inv.endDate}T00:00:00`).getTime() + 86400000).toISOString().slice(0, 10) : todayISO();
    const dur: DurationId = (inv.duration && inv.duration !== "custom" && inv.duration !== "none") ? inv.duration : "1m";
    const end = endDateFor(nextStart, dur);
    setClientId(inv.clientId || ""); setCategory(inv.category || ""); setPackageName(inv.packageName || "");
    setStartDate(nextStart); setDuration(dur); setEndDate(end); setTrackRenewal(true); setRenewalOf(inv.id);
    // Setup fees are one-off: not repeated on a renewal.
    const again = v.items.filter((it: any) => it.kind !== "setup").map((it) => ({ ...it }));
    setItems(syncDailyQty(again.length ? again : [emptyItem()], nextStart, end));
    setProjectId(inv.projectId || ""); setAutoCreateProject(false);
    setEditorOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (inv: any) => {
    const pays = paymentsOf(inv);
    const linked = pays.filter((p) => p.accountingId && data.accounting.some((a: any) => a.id === p.accountingId));
    const unlinked = pays.length - linked.length;
    const msg = [`Invoice ${inv.invoiceNo || inv.id} delete karein?`];
    if (linked.length) msg.push(`\n${linked.length} payment(s) — Rs ${fmtMoney(paidTotal(linked))} — ki Accounting entries delete aur account balance wapas ho jayenge.`);
    if (unlinked > 0) msg.push(`\n${unlinked} purani payment(s) ki entry khud reverse nahi hogi — Accounting mein check karein.`);
    if (!confirm(msg.join(""))) return;
    // Sum per wallet first: writing each payment against the same (stale)
    // wallet snapshot would only reverse the last one.
    const back: Record<string, number> = {};
    for (const p of linked) {
      const row = data.accounting.find((a: any) => a.id === p.accountingId);
      if (!row) continue;
      if (row.walletId) back[row.walletId] = (back[row.walletId] || 0) + (Number(row.amount) || 0);
      await removeItem("accounting", row.id);
    }
    for (const [walletId, amt] of Object.entries(back)) {
      if (data.wallets.some((x: any) => x.id === walletId)) await adjustWallet(walletId, -amt, `Invoice ${inv.invoiceNo || inv.id} deleted`);
    }
    await removeItem("invoices", inv.id);
    // Keep the QR link alive but show the invoice as cancelled (anti-fraud).
    if (inv.verifyToken) await publish(inv, true);
  };

  // ---------- WhatsApp (templates: Settings → WhatsApp templates) ----------
  /** Best template for the invoice's state, others offered in the list. */
  const waTypesFor = (inv: any) => {
    const v = invoiceView(inv);
    const rs = renewalState(inv, renewDays);
    const first = rs === "due_soon" || rs === "expired" ? "renewal_reminder"
      : v.due <= 0 ? "payment_received" : v.status === "Overdue" ? "overdue_reminder" : v.paid > 0 ? "payment_reminder" : "invoice";
    return [first, ...["invoice", "payment_received", "payment_reminder", "overdue_reminder", "renewal_reminder"].filter((t) => t !== first)];
  };
  const openWa = (inv: any, first?: string) => {
    const types = waTypesFor(inv);
    setComposer({ inv, types: first ? [first, ...types.filter((t) => t !== first)] : types });
  };
  const waVars = (inv: any, paidNow?: number) => {
    const v = invoiceView(inv);
    const svc = v.items.map((i) => (i.service ? serviceById(settings, i.service) : undefined)).find(Boolean);
    return {
      name: clientOf(inv.clientId)?.name || "", invoice: v.number, amount: fmtMoney(v.grandTotal), paid: fmtMoney(v.paid),
      balance: v.due > 0 ? fmtMoney(v.due) : "0", due: inv.dueDate || "", start: inv.startDate || "", end: inv.endDate || "",
      service: svc?.line || inv.category || "", package: inv.packageName || "", paid_now: fmtMoney(paidNow ?? v.paid),
      items: v.items.map((it) => `• ${it.desc} x${it.qty} = Rs ${fmtMoney(it.total)}`).join("\n"),
    };
  };
  const logWa = async (inv: any, log: { at: string; type: string; lang: string; channel: string }) => {
    const fresh = data.invoices.find((x: any) => x.id === inv.id) || inv;
    await updateItem("invoices", { ...fresh, waLog: [...(fresh.waLog || []), { at: log.at, type: log.type, lang: log.lang, channel: log.channel, by: user?.email || "" }].slice(-30) });
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
    printElementHTML(`      <table><thead><tr><th>Invoice</th><th>Client</th><th>Date</th><th>Status</th><th>Total</th><th>Paid</th><th>Balance</th></tr></thead><tbody>${rows || "<tr><td colspan=7>No invoices</td></tr>"}</tbody></table>`, "Invoices Report");
  };

  // ---------- list ----------
  const views = useMemo(() => data.invoices.map((inv: any) => ({ inv, v: invoiceView(inv) })), [data.invoices]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return views
      .filter(({ inv, v }) => (filter === "ALL" || v.status === filter) && (catFilter === "ALL" || inv.category === catFilter) &&
        (!q || [v.number, clientOf(inv.clientId)?.name].some((x) => String(x || "").toLowerCase().includes(q))))
      .sort((a, b) => String(b.v.date).localeCompare(String(a.v.date)))
      .map(({ inv }) => inv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views, search, filter, catFilter, data.clients]);
  const renewals = useMemo(() => data.invoices
    .map((inv: any) => ({ inv, state: renewalState(inv, renewDays), left: daysToEnd(inv.endDate) }))
    .filter((r: any) => (r.state === "due_soon" || r.state === "expired") && (r.left ?? 0) >= -45)
    .sort((a: any, b: any) => (a.left ?? 0) - (b.left ?? 0)), [data.invoices, renewDays]);
  const kpi = views.reduce((k, { v }) => ({
    total: k.total + v.grandTotal, paid: k.paid + v.paid, due: k.due + v.due, overdue: k.overdue + (v.status === "Overdue" ? 1 : 0),
  }), { total: 0, paid: 0, due: 0, overdue: 0 });

  return (
    <>
      <ModuleInsights module="invoices" />
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

      {renewals.length > 0 && (
        <section className="card renewals">
          <div className="sectionHead">
            <div>
              <h2 style={{ margin: 0 }}>↻ Renewals &amp; expiry</h2>
              <div className="small">Packages jo {renewDays} din mein khatam ho rahe hain ya ho chuke hain.</div>
            </div>
          </div>
          <div className="renewList">
            {renewals.map(({ inv, state, left }: any) => {
              const v = invoiceView(inv);
              return (
                <div key={inv.id} className={`renewItem ${state}`}>
                  <div>
                    <b>{clientOf(inv.clientId)?.name || "—"}</b>
                    <div className="small">{inv.packageName || inv.category || v.items[0]?.desc} • {v.number}</div>
                  </div>
                  <div className="small">Ends {inv.endDate}<div><span className={`badge ${state === "expired" ? "bad" : "warn"}`}>{state === "expired" ? `${Math.abs(left)} din pehle khatam` : left === 0 ? "Aaj khatam" : `${left} din baqi`}</span></div></div>
                  <div className="rowActions">
                    <button className="btnSmall" onClick={() => openWa(inv, "renewal_reminder")}>WhatsApp reminder</button>
                    {canManage && <button className="btnSolid" onClick={() => startRenewal(inv)}>↻ Renew</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

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
            <div className="grid2" style={{ gap: 8 }}>
              <div><label>Service category *</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Select…</option>
                  {lines.map((l) => <option key={l}>{l}</option>)}
                </select>
              </div>
              <div><label>Invoice No.</label><input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></div>
            </div>
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
                  <input value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} placeholder="Project title (auto)" />
                )}
              </div>
            )}
          </div>

          <div className="invPeriod">
            <div className="invPeriodHead">
              <b>Package / period</b>
              <span className="small">Ads, management aur monthly packages ke liye — end date khud nikalti hai, renewal track hota hai.</span>
            </div>
            <div className="invPeriodGrid">
              <div><label>Duration</label>
                <select value={duration} onChange={(e) => changeDuration(e.target.value as DurationId)}>
                  {DURATIONS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </div>
              {duration !== "none" && (
                <>
                  <div><label>Start date</label><input type="date" value={startDate} onChange={(e) => changeStart(e.target.value)} /></div>
                  <div><label>End date {duration !== "custom" && <span className="small">(auto)</span>}</label><input type="date" value={endDate} min={startDate} onChange={(e) => changeEnd(e.target.value)} /></div>
                  <div><label>Package name</label><input value={packageName} onChange={(e) => setPackageName(e.target.value)} placeholder="e.g. Monthly Ads Package" /></div>
                  <label className="permItem invRenew">
                    <input type="checkbox" checked={trackRenewal} onChange={(e) => setTrackRenewal(e.target.checked)} />
                    <span>Renewal / expiry track karein</span>
                  </label>
                </>
              )}
            </div>
            {duration !== "none" && startDate && endDate && <div className="small">{periodDays(startDate, endDate)} din • {startDate} → {endDate}{renewalOf ? " • Renewal" : ""}</div>}
          </div>

          <div className="invItems">
            <div className="invItemsHead"><span>Service / description</span><span>Qty</span><span>Rate</span><span>Amount</span><span /></div>
            {items.map((it, i) => (
              <div className="invItemRow" key={i}>
                <div className="invDesc">
                  <select value="" onChange={(e) => pickService(i, e.target.value)} aria-label="Pick a service" title="Service list se chunein">
                    <option value="">＋ Service</option>
                    {lines.map((l) => (
                      <optgroup key={l} label={l}>
                        {services.filter((x) => x.line === l).map((x) => <option key={x.id} value={x.id}>{x.name} — Rs {fmtMoney(x.rate)}{x.unit ? `/${x.unit}` : ""}{x.pricing === "setup_plus_monthly" ? ` + setup ${fmtMoney(x.setupFee || 0)}` : ""}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <input value={it.desc} onChange={(e) => setItem(i, "desc", e.target.value)} placeholder="e.g. Facebook Ads management (1 month)" aria-label="Description" />
                </div>
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
                    {Array.from(new Set([...methods, paymentMethod])).map((m) => <option key={m}>{m}</option>)}
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
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ width: "auto" }} aria-label="Filter by category">
              <option value="ALL">All categories</option>
              {lines.map((l) => <option key={l}>{l}</option>)}
            </select>
            {["ALL", "Unpaid", "Partial", "Overdue", "Paid"].map((f) => (
              <button key={f} className={`waChip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>{f === "ALL" ? "All" : f}</button>
            ))}
          </div>
        </div>
        <div className="tablewrap" style={{ marginTop: 10 }}>
          <table>
            <thead><tr><th>Invoice</th><th>Client</th><th>Category</th><th>Date / Due</th><th>Period</th><th className="num">Total</th><th className="num">Balance</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map((inv: any) => {
                const v = invoiceView(inv);
                return (
                  <tr key={inv.id}>
                    <td style={{ whiteSpace: "nowrap" }}><b>{v.number}</b></td>
                    <td>{clientOf(inv.clientId)?.name || "—"}<div className="small">{projectOf(inv.projectId)?.title || ""}</div></td>
                    <td>{inv.category ? <span className="badge pri">{inv.category}</span> : <span className="small">—</span>}</td>
                    <td>{v.date}<div className="small">{inv.dueDate ? `Due ${inv.dueDate}` : ""}</div></td>
                    <td>{inv.endDate ? (
                      <>
                        <div className="small">{inv.startDate} → {inv.endDate}</div>
                        <div>{inv.packageName && <span className="small">{inv.packageName} </span>}{(() => {
                          const st = renewalState(inv, renewDays); const left = daysToEnd(inv.endDate);
                          return st === "expired" ? <span className="badge bad">Expired</span>
                            : st === "due_soon" ? <span className="badge warn">{left} din baqi</span>
                            : inv.renewedBy ? <span className="badge ok">Renewed</span>
                            : st === "active" ? <span className="badge">{durationLabel(inv.duration) || "Active"}</span> : null;
                        })()}</div>
                      </>
                    ) : <span className="small">—</span>}</td>
                    <td className="num">Rs {fmtMoney(v.grandTotal)}</td>
                    <td className="num"><b>Rs {fmtMoney(v.due)}</b></td>
                    <td><span className={`badge ${statusClass(v.status)}`}>{v.status}</span></td>
                    <td className="rowActions">
                      <button className="btnSmall" onClick={() => { setPreviewInv(inv); setPreviewMode("A4"); }}>View</button>
                      {canManage && v.due > 0 && <button className="btnSmall" onClick={() => openPayment(inv)}>Record payment</button>}
                      {canManage && v.due > 0 && <button className="btnSmall" onClick={() => markPaid(inv)} disabled={busy}>✓ Mark Paid</button>}
                      {canManage && inv.endDate && !inv.renewedBy && <button className="btnSmall" onClick={() => startRenewal(inv)}>↻ Renew</button>}
                      {canManage && <button className="btnSmall" onClick={() => startEdit(inv)}>Edit</button>}
                      <button className="btnSmall" onClick={() => openWa(inv)} title="Send on WhatsApp">WhatsApp</button>
                      {canManage && <button className="btnSmall" onClick={() => handleDelete(inv)}>Delete</button>}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={9} className="small">Koi invoice nahi.</td></tr>}
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
                <button className="btnSmall" onClick={() => openWa(previewInv)}>WhatsApp</button>
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
              <div><b>Record payment</b><div className="small">{invoiceView(payInv).number} • Total Rs {fmtMoney(invoiceView(payInv).grandTotal)} • Balance Rs {fmtMoney(invoiceView(payInv).due)}</div></div>
              <button className="btnSmall" onClick={() => setPayInv(null)}>✕</button>
            </div>
            <div className="grid2" style={{ gap: 8 }}>
              <div><label>Amount received</label><input type="number" min="0" value={payAmount} onChange={(e) => setPayAmount(+e.target.value)} /></div>
              <div><label>Payment date</label><input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></div>
              <div><label>Method</label>
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>{Array.from(new Set([...methods, payMethod])).map((m) => <option key={m}>{m}</option>)}</select>
              </div>
              <div><label>Bank / Cash account</label>
                <select value={payWallet} onChange={(e) => setPayWallet(e.target.value)}>
                  <option value="">Select…</option>
                  {data.wallets.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
            </div>
            {data.wallets.length === 0 && <div className="small">Pehle Accounts tab mein account (Cash / Bank) banayein.</div>}
            <label>Reference (TID / cheque no.)</label>
            <input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="optional" />
            <label>Notes</label>
            <input value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="optional" />
            {paymentsOf(payInv).length > 0 && (
              <div className="payHistory">
                <div className="small"><b>Pichli payments</b></div>
                {paymentsOf(payInv).map((p) => (
                  <div key={p.id} className="small">{p.date} • Rs {fmtMoney(p.amount)} • {p.method}{p.reference ? ` • ref ${p.reference}` : ""}{p.walletId ? ` • ${data.wallets.find((w: any) => w.id === p.walletId)?.name || ""}` : ""}</div>
                ))}
              </div>
            )}
            <div className="rowActions" style={{ marginTop: 14 }}>
              <button className="btnSolid" onClick={savePayment} disabled={busy}>Save payment</button>
              <button className="btnSmall" onClick={() => setPayAmount(invoiceView(payInv).due)}>Poora balance</button>
            </div>
          </div>
        </div>
      )}

      {composer && (
        <WhatsAppComposer
          phone={clientOf(composer.inv.clientId)?.whatsapp || clientOf(composer.inv.clientId)?.phone || ""}
          types={composer.types}
          vars={waVars(composer.inv, composer.paidNow)}
          title={`WhatsApp — ${invoiceView(composer.inv).number}`}
          onClose={() => setComposer(null)}
          onSent={(log) => logWa(composer.inv, log)}
        />
      )}
    </>
  );
}
