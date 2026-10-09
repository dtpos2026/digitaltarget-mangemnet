import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { businessById } from "@/lib/business";
import { withHistory } from "@/lib/leadHistory";
import { formatLocalPhone, normalizePhone, waLink } from "@/lib/phone";
import { Product, priceLabel, productMessage } from "@/lib/products";
import { dataUrlToBlob, downloadDataUrl, renderProductCard } from "@/lib/salesCard";
import { mutateLead } from "@/lib/salesStore";
import { useExtensionVersion, waExt } from "@/lib/waExtension";
import { useActor, useSalesBrand } from "./useSalesBrand";

/**
 * Share a product with a customer on WhatsApp: message (editable) and,
 * optionally, the product card as an image. Sent through the extension when
 * it is installed (straight into the customer's chat), else wa.me / download.
 */
export default function ShareModal({ product, leadId: initialLead, onClose }: { product: Product; leadId?: string; onClose: () => void }) {
  const { data } = useData();
  const { can, roleDoc, workspaceUid } = useAuth();
  const { brand, me } = useSalesBrand();
  const actor = useActor();
  const ext = useExtensionVersion();
  const myTeamId = roleDoc?.teamId || "";
  // An assistant shares with their own leads only (pool leads: TAKE first).
  const leads = useMemo(() => (data.leads as any[]).filter((l) => can("leads.view") || l.assignedTo === myTeamId), [data.leads, can, myTeamId]);
  const [leadId, setLeadId] = useState(initialLead || "");
  const [q, setQ] = useState("");
  const [phone, setPhone] = useState("");
  const lead = leads.find((l) => l.id === leadId);
  const first = String(lead?.name || "").split(/\s+/)[0];
  const opts = { company: brand.companyName, phone: me.phone || brand.phone, website: brand.website };
  const [text, setText] = useState(() => productMessage(product, { ...opts, customer: first }));
  useEffect(() => { setText(productMessage(product, { ...opts, customer: first })); }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [withCard, setWithCard] = useState(true);
  const [addToLead, setAddToLead] = useState(true);
  const [card, setCard] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const number = normalizePhone(lead?.whatsapp || lead?.phone || lead?.phoneE164 || phone);
  const canEditLead = !!lead && (can("leads.edit") || lead.assignedTo === myTeamId);

  useEffect(() => {
    let live = true;
    renderProductCard({
      name: product.name, icon: product.icon, logo: product.logo, tagline: product.tagline, description: product.description,
      features: product.features, price: priceLabel(product), demoUrl: product.demoUrl, businessName: businessById(data.settings, product.unit)?.name,
      brand, person: me,
    }).then((d) => { if (live) setCard(d); }).catch(() => undefined);
    return () => { live = false; };
  }, [product, data.settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const filename = `${product.name.replace(/[^\w]+/g, "-")}.png`;
  const logShare = async (via: string) => {
    if (!lead || !canEditLead || !workspaceUid) return;
    await mutateLead(workspaceUid, lead.id, (l) => {
      const has = (l.products || []).some((x: any) => x.productId === product.id);
      const next = addToLead && !has ? { ...l, products: [...(l.products || []), { productId: product.id, name: product.name, qty: 1 }] } : l;
      return withHistory({ ...next, lastContactAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { type: "whatsapp", text: `Product share (${via}): ${product.name} — ${priceLabel(product)}`, by: actor.by, who: actor.who, role: actor.role });
    }).catch(() => undefined);
  };

  const sendExt = async () => {
    if (!number) { setMsg("Customer ka number chahiye"); return; }
    setBusy(true); setMsg("");
    try {
      if (withCard && card) await waExt.sendFile({ phone: number, dataUrl: card, filename, caption: text });
      else await waExt.sendText({ phone: number, text });
      await logShare("WhatsApp");
      setMsg("✓ WhatsApp par bhej diya");
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  const openWa = async () => {
    const l = waLink(number, text) || `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(l, "_blank");
    if (withCard && card) downloadDataUrl(card, filename);
    await logShare("wa.me");
  };
  const webShare = async () => {
    try {
      const file = new File([dataUrlToBlob(card)], filename, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      if (nav.canShare?.({ files: [file] })) await nav.share({ files: [file], text });
      else await nav.share({ text });
      await logShare("share");
    } catch { /* cancelled */ }
  };

  const shown = leads.filter((l) => !q || `${l.name} ${l.phone} ${l.businessName || ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 50);

  return (
    <div className="dtModalBackdrop" onClick={onClose}>
      <div className="dtModal wide shareModal" onClick={(e) => e.stopPropagation()}>
        <div className="dtModalHead"><b>📤 Share — {product.name}</b><button className="btnSmall" onClick={onClose}>✕</button></div>
        <div className="shareGrid">
          <div>
            <label>Customer (lead)
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Naam / number dhoondein…" />
            </label>
            <select value={leadId} onChange={(e) => setLeadId(e.target.value)} size={Math.min(6, shown.length + 1)} aria-label="Lead">
              <option value="">— number khud likhein —</option>
              {shown.map((l) => <option key={l.id} value={l.id}>{l.name} • {formatLocalPhone(normalizePhone(l.whatsapp || l.phone)) || l.phone}</option>)}
            </select>
            {!lead && <label>WhatsApp number<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx-xxxxxxx" /></label>}
            <label>Message<textarea rows={11} value={text} onChange={(e) => setText(e.target.value)} /></label>
            <div className="rowActions">
              <label className="permItem"><input type="checkbox" checked={withCard} onChange={(e) => setWithCard(e.target.checked)} /><span>Card (image) bhi bhejein</span></label>
              {canEditLead && <label className="permItem"><input type="checkbox" checked={addToLead} onChange={(e) => setAddToLead(e.target.checked)} /><span>Lead ke products mein add karein</span></label>}
            </div>
          </div>
          <div className="shareCard">{card ? <img src={card} alt="Product card" /> : <div className="small">Card ban raha hai…</div>}</div>
        </div>
        <div className="rowActions" style={{ marginTop: 10 }}>
          {ext && <button className="btnSolid" onClick={sendExt} disabled={busy || !number}>{busy ? "…" : "🟢 WhatsApp par bhejein"}</button>}
          <button className={ext ? "btnSmall" : "btnSolid"} onClick={openWa}>WhatsApp kholein{withCard ? " + card download" : ""}</button>
          {card && <button className="btnSmall" onClick={() => downloadDataUrl(card, filename)}>⬇ Card PNG</button>}
          {typeof navigator !== "undefined" && "share" in navigator && card && <button className="btnSmall" onClick={webShare}>Share…</button>}
          <button className="btnSmall" onClick={() => navigator.clipboard?.writeText(text).then(() => setMsg("✓ Copy ho gaya"))}>📋 Copy text</button>
          {msg && <b className="small">{msg}</b>}
        </div>
      </div>
    </div>
  );
}
