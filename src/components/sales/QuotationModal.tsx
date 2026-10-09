import React, { useEffect, useMemo, useRef, useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { todayISO, uid } from "@/lib/db";
import { businessById, unitOfLead, unitOfProduct } from "@/lib/business";
import { formatLocalPhone, normalizePhone, waLink } from "@/lib/phone";
import { Product, activeProducts, productSaleValue } from "@/lib/products";
import { Quotation, QuoteLine, addDaysISO, leadAfterQuotation, lineFromProduct, quoteTotals } from "@/lib/quotation";
import { dataUrlToBlob, downloadDataUrl, renderQuoteCard } from "@/lib/salesCard";
import { mutateLead, nextQuoteNumber } from "@/lib/salesStore";
import { useExtensionVersion, waExt } from "@/lib/waExtension";
import { useActor, useSalesBrand } from "./useSalesBrand";

const fmtDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" });

/**
 * Quotation / sales card: pick the customer, products, price, discount and the
 * sales profile → a branded PNG. Saving numbers it (QT-2026-0001), stores the
 * record, puts the value and QUOTATION status on the lead, and the card can go
 * straight to the customer's WhatsApp.
 */
export default function QuotationModal({ leadId: initialLead, productIds, existing, onClose }: {
  leadId?: string; productIds?: string[]; existing?: Quotation; onClose: () => void;
}) {
  const { data } = useData();
  const { can, roleDoc, workspaceUid } = useAuth();
  const { brand, profiles } = useSalesBrand();
  const actor = useActor();
  const ext = useExtensionVersion();
  const myTeamId = roleDoc?.teamId || "";
  const admin = can("leads.edit");
  const products = data.products as Product[];
  const sellable = activeProducts(products);
  const leads = useMemo(() => (data.leads as any[]).filter((l) => admin || l.assignedTo === myTeamId), [data.leads, admin, myTeamId]);

  const [leadId, setLeadId] = useState(existing?.leadId || initialLead || "");
  const lead = leads.find((l) => l.id === leadId);
  const fromLead = (l: any) => ({ name: l?.name || "", business: l?.businessName || l?.business || "", phone: formatLocalPhone(normalizePhone(l?.whatsapp || l?.phone)) || l?.phone || "", city: l?.city || "" });
  const [customer, setCustomer] = useState(existing?.customer || fromLead(lead));
  useEffect(() => { if (lead && !existing) setCustomer(fromLead(lead)); }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  const initialItems = (): QuoteLine[] => {
    if (existing) return existing.items;
    const ids = productIds?.length ? productIds : (lead?.products || []).map((x: any) => x.productId);
    const out = ids.map((id: string) => products.find((p) => p.id === id)).filter(Boolean).map((p: Product) => lineFromProduct(p));
    return out.length ? out : [];
  };
  const [items, setItems] = useState<QuoteLine[]>(initialItems);
  const [discount, setDiscount] = useState(existing?.discount || 0);
  const [validDays, setValidDays] = useState(7);
  const [notes, setNotes] = useState(existing?.notes || "");
  const [profileId, setProfileId] = useState(existing?.teamId ?? (profiles.find((p) => p.teamId === (lead?.assignedTo || myTeamId))?.teamId ?? profiles[0]?.teamId ?? ""));
  const profile = profiles.find((p) => p.teamId === profileId) || profiles[0];
  const [png, setPng] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Quotation | null>(existing || null);
  const t = quoteTotals(items, discount);
  const today = todayISO();
  const validTill = existing?.validTill || addDaysISO(today, validDays);
  const unit = items[0]?.productId ? unitOfProduct(products.find((p) => p.id === items[0].productId), data.settings) : unitOfLead(lead, data.settings, products);
  const biz = businessById(data.settings, unit);
  const mainProduct = products.find((p) => p.id === items[0]?.productId);

  const draw = (number: string) => renderQuoteCard({
    number, date: fmtDate(existing?.createdAt?.slice(0, 10) || today), validTill: fmtDate(validTill),
    businessName: biz?.name, customer: { ...customer, name: customer.name || "Customer" },
    items: items.map((i) => ({ ...i, logo: products.find((p) => p.id === i.productId)?.logo })),
    subtotal: t.subtotal, discount: t.discount, total: t.total,
    features: mainProduct?.features || [], featuresTitle: mainProduct ? `${mainProduct.name} — features` : undefined,
    demoUrl: mainProduct?.demoUrl, notes, brand: { ...brand, accent: biz?.color }, person: profile?.person || { name: "Sales Team" },
  });
  // Live preview (re-drawn shortly after each change).
  const timer = useRef<number>();
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      draw(saved?.number || "QT-DRAFT").then(setPng).catch((e) => setMsg((e as Error).message));
    }, 350);
    return () => window.clearTimeout(timer.current);
  }, [items, discount, customer, notes, profileId, validTill, saved?.number]); // eslint-disable-line react-hooks/exhaustive-deps

  const addProduct = (id: string) => {
    const p = products.find((x) => x.id === id);
    if (p) setItems([...items, lineFromProduct(p)]);
  };
  const patch = (i: number, p: Partial<QuoteLine>) => setItems(items.map((it, j) => (j === i ? { ...it, ...p } : it)));

  /** Saves (first time: number + record + lead) and returns the record. */
  const save = async (via?: string): Promise<Quotation | null> => {
    if (!workspaceUid) return null;
    if (!customer.name.trim()) { setMsg("Customer ka naam likhein"); return null; }
    if (!items.length || t.total <= 0) { setMsg("Kam az kam aik product aur price chahiye"); return null; }
    if (!admin && profileId !== myTeamId) { setMsg("Sirf apni profile"); return null; }
    if (saved && !via) return saved;
    setBusy(true); setMsg("");
    try {
      let q = saved;
      if (!q) {
        const number = await nextQuoteNumber(workspaceUid);
        q = {
          id: uid("QT"), number, ...(lead ? { leadId: lead.id } : {}), unit, customer: { ...customer, name: customer.name.trim() },
          items, subtotal: t.subtotal, discount: t.discount, total: t.total, validTill, notes: notes.trim(),
          teamId: profileId || "", preparedBy: { teamId: profileId || "", name: profile?.person.name || "", designation: profile?.person.designation, phone: profile?.person.phone, email: profile?.person.email },
          status: "Sent", sentVia: via ? [via] : [], createdAt: new Date().toISOString(), createdBy: actor.by,
        };
        await setDoc(doc(db, "users", workspaceUid, "quotations", q.id), q);
        // Price changed from the catalog? Keep it visible in the lead's history.
        const changed = items.filter((i) => { const p = products.find((x) => x.id === i.productId); return p && productSaleValue(p) !== i.unitPrice; });
        if (lead && (admin || lead.assignedTo === myTeamId)) {
          await mutateLead(workspaceUid, lead.id, (l) => {
            const next = leadAfterQuotation(l, q!, actor.by);
            const last = next.history[next.history.length - 1];
            last.who = actor.who; last.role = actor.role;
            if (changed.length) last.text += ` • price badli: ${changed.map((c) => c.name).join(", ")}`;
            return next;
          });
        }
      } else if (via) {
        q = { ...q, sentVia: [...new Set([...(q.sentVia || []), via])], updatedAt: new Date().toISOString() };
        await setDoc(doc(db, "users", workspaceUid, "quotations", q.id), q);
      }
      setSaved(q);
      setBusy(false);
      return q;
    } catch (e) { setMsg("Save nahi hua: " + (e as Error).message); setBusy(false); return null; }
  };

  const caption = (q: Quotation) =>
    `Assalam o Alaikum ${q.customer.name.split(/\s+/)[0]}!\n\nAap ki quotation *${q.number}*: ${q.items.map((i) => i.name).join(", ")}\n*Total: Rs ${q.total.toLocaleString("en-PK")}*\nValid till ${fmtDate(q.validTill)}\n\n${profile?.person.name || ""}${profile?.person.phone ? ` • ${profile.person.phone}` : ""}\n${brand.companyName}`;
  const file = (q: Quotation) => `${q.number}-${q.customer.name.replace(/[^\w]+/g, "-")}.png`;
  const number = normalizePhone(lead?.whatsapp || lead?.phone || customer.phone);

  /** The card with the quotation's real number (the preview may still say DRAFT). */
  const finalCard = async (q: Quotation) => { const img = await draw(q.number); setPng(img); return img; };
  const doDownload = async () => { const q = await save("download"); if (q) { downloadDataUrl(await finalCard(q), file(q)); setMsg(`✓ ${q.number} save + download`); } };
  const doSend = async () => {
    if (!number) { setMsg("Customer ka WhatsApp number chahiye"); return; }
    const q = await save("whatsapp");
    if (!q) return;
    setBusy(true);
    try { await waExt.sendFile({ phone: number, dataUrl: await finalCard(q), filename: file(q), caption: caption(q) }); setMsg(`✓ ${q.number} WhatsApp par bhej di`); }
    catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  const doOpenWa = async () => {
    const q = await save("wa.me");
    if (!q) return;
    downloadDataUrl(await finalCard(q), file(q));
    window.open(waLink(number, caption(q)) || `https://wa.me/?text=${encodeURIComponent(caption(q))}`, "_blank");
  };
  const doShare = async () => {
    const q = await save("share");
    if (!q) return;
    try {
      const f = new File([dataUrlToBlob(await finalCard(q))], file(q), { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      if (nav.canShare?.({ files: [f] })) await nav.share({ files: [f], text: caption(q) }); else await nav.share({ text: caption(q) });
    } catch { /* cancelled */ }
  };

  const locked = !!saved; // numbered quotations are not edited; make a new one instead

  return (
    <div className="dtModalBackdrop" onClick={onClose}>
      <div className="dtModal wide quoteModal" onClick={(e) => e.stopPropagation()}>
        <div className="dtModalHead">
          <b>🧾 Quotation / sales card {saved ? `— ${saved.number}` : ""}</b>
          <button className="btnSmall" onClick={onClose}>✕</button>
        </div>
        <div className="quoteGrid">
          <div className="quoteForm">
            <label>Lead
              <select value={leadId} onChange={(e) => setLeadId(e.target.value)} disabled={locked}>
                <option value="">— lead ke baghair (customer khud likhein) —</option>
                {leads.map((l) => <option key={l.id} value={l.id}>{l.name}{l.businessName ? ` • ${l.businessName}` : ""}</option>)}
              </select>
            </label>
            <div className="grid2">
              <label>Customer<input value={customer.name} disabled={locked} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></label>
              <label>Business<input value={customer.business || ""} disabled={locked} onChange={(e) => setCustomer({ ...customer, business: e.target.value })} /></label>
              <label>WhatsApp<input value={customer.phone || ""} disabled={locked} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} /></label>
              <label>City<input value={customer.city || ""} disabled={locked} onChange={(e) => setCustomer({ ...customer, city: e.target.value })} /></label>
            </div>
            <div className="lpHead" style={{ marginTop: 8 }}>Products</div>
            {items.map((it, i) => {
              const p = products.find((x) => x.id === it.productId);
              const changed = p && productSaleValue(p) !== it.unitPrice;
              return (
                <div key={i} className="quoteLine">
                  <span className="qlName">{it.icon} {it.name}</span>
                  <input type="number" min={1} value={it.qty} disabled={locked} onChange={(e) => patch(i, { qty: Math.max(1, Number(e.target.value) || 1) })} aria-label="Qty" />
                  <input type="number" value={it.unitPrice} disabled={locked} onChange={(e) => patch(i, { unitPrice: Number(e.target.value) || 0 })} aria-label="Price" className={changed ? "changed" : ""} title={p ? `Catalog: Rs ${productSaleValue(p).toLocaleString("en-PK")}` : ""} />
                  {!locked && <button className="iconBtn" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Remove">✕</button>}
                </div>
              );
            })}
            {!locked && (
              <select value="" onChange={(e) => addProduct(e.target.value)} aria-label="Add product">
                <option value="">+ Product add karein…</option>
                {sellable.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.name} — Rs {productSaleValue(p).toLocaleString("en-PK")}</option>)}
              </select>
            )}
            <div className="grid2" style={{ marginTop: 6 }}>
              <label>Discount (Rs)<input type="number" value={discount || ""} disabled={locked} onChange={(e) => setDiscount(Number(e.target.value) || 0)} /></label>
              <label>Valid (din)<input type="number" value={validDays} disabled={locked} onChange={(e) => setValidDays(Math.max(1, Number(e.target.value) || 7))} /></label>
            </div>
            <label>Note (card par)<input value={notes} disabled={locked} onChange={(e) => setNotes(e.target.value)} placeholder="Installation + training free" /></label>
            <label>Profile (card par)
              <select value={profileId} disabled={locked || profiles.length < 2} onChange={(e) => setProfileId(e.target.value)}>
                {profiles.map((p) => <option key={p.teamId || "me"} value={p.teamId}>{p.person.name} — {p.person.designation}</option>)}
              </select>
            </label>
            <div className="quoteTotal">Subtotal Rs {t.subtotal.toLocaleString("en-PK")}{t.discount ? ` − Rs ${t.discount.toLocaleString("en-PK")}` : ""} = <b>Rs {t.total.toLocaleString("en-PK")}</b></div>
          </div>
          <div className="quotePreview">{png ? <img src={png} alt="Quotation card" /> : <div className="small">Preview ban raha hai…</div>}</div>
        </div>
        <div className="rowActions" style={{ marginTop: 10 }}>
          {ext && <button className="btnSolid" onClick={doSend} disabled={busy || !png}>🟢 Save + WhatsApp par bhejein</button>}
          <button className={ext ? "btnSmall" : "btnSolid"} onClick={doDownload} disabled={busy || !png}>💾 Save + PNG download</button>
          <button className="btnSmall" onClick={doOpenWa} disabled={busy || !png}>WhatsApp kholein</button>
          {typeof navigator !== "undefined" && "share" in navigator && <button className="btnSmall" onClick={doShare} disabled={busy || !png}>Share…</button>}
          {msg && <b className="small">{msg}</b>}
        </div>
      </div>
    </div>
  );
}
