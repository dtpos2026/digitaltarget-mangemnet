import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { uid } from "@/lib/db";
import { businessesOf } from "@/lib/business";
import { categoriesOf, linesOfCategory, PricingModel, servicesOf } from "@/lib/catalog";
import { PRICING_LABEL, Product, priceLabel, productSaleValue, syncServicePrice } from "@/lib/products";
import { resizeImageFile } from "@/lib/imageResize";

const EMPTY: Product = { id: "", name: "", unit: "", features: [], pricing: "one_time", price: 0, setupFee: 0, per: "", active: true, icon: "⭐" };

/** Add / edit a product (CEO / admin, products.manage). */
export default function ProductEditor({ product, onClose }: { product?: Product | null; onClose: () => void }) {
  const { data, addItem, updateItem, updateSettings } = useData();
  const { can, user } = useAuth();
  const units = businessesOf(data.settings);
  const [p, setP] = useState<Product>(() => product ? { ...EMPTY, ...product } : { ...EMPTY, unit: units[0]?.id || "" });
  const [features, setFeatures] = useState((product?.features || []).join("\n"));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Product>) => setP({ ...p, ...patch });
  const categories = categoriesOf(data.settings);
  const lines = p.category ? linesOfCategory(data.settings, p.category) : [];

  const upload = async (f?: File) => {
    if (!f) return;
    try { set({ logo: await resizeImageFile(f, 256) }); } catch (e) { setMsg((e as Error).message); }
  };

  const save = async () => {
    if (!p.name.trim()) { setMsg("Product ka naam likhein"); return; }
    if (!p.unit) { setMsg("Business chunein"); return; }
    setBusy(true); setMsg("");
    const next: Product = {
      ...p, id: p.id || uid("PRD"), name: p.name.trim(), price: Number(p.price) || 0, setupFee: Number(p.setupFee) || 0,
      features: features.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 15),
      updatedAt: new Date().toISOString(), updatedBy: user?.email || "", ...(p.createdAt ? {} : { createdAt: new Date().toISOString() }),
    };
    try {
      if (product?.id) await updateItem("products", next); else await addItem("products", next);
      // Same price on invoices: the linked catalog service follows the product.
      const services = can("settings.manage") ? syncServicePrice(data.settings, next) : null;
      if (services) await updateSettings({ ...data.settings, services });
      onClose();
    } catch (e) { setMsg("Save nahi hua: " + (e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="dtModalBackdrop" onClick={onClose}>
      <div className="dtModal wide productEditor" onClick={(e) => e.stopPropagation()}>
        <div className="dtModalHead"><b>{product?.id ? `Edit — ${product.name}` : "Naya product / service"}</b><button className="btnSmall" onClick={onClose}>✕</button></div>
        <div className="peGrid">
          <div className="peLogo">
            <div className="prodLogo big">{p.logo ? <img src={p.logo} alt="" /> : <span>{p.icon || "⭐"}</span>}</div>
            <label className="btnSmall" style={{ cursor: "pointer" }}>Logo upload<input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} /></label>
            {p.logo && <button className="linkBtn" onClick={() => set({ logo: "" })}>Logo hatayein</button>}
            <label>Icon (emoji)<input value={p.icon || ""} onChange={(e) => set({ icon: e.target.value.slice(0, 4) })} /></label>
          </div>
          <div>
            <div className="grid2">
              <label>Naam<input value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="DTPOS Restaurant Software" /></label>
              <label>Business
                <select value={p.unit} onChange={(e) => set({ unit: e.target.value })}>
                  <option value="">Chunein…</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.icon} {u.name}</option>)}
                </select>
              </label>
              <label>Category
                <select value={p.category || ""} onChange={(e) => set({ category: e.target.value, line: "" })}>
                  <option value="">—</option>{categories.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label>Service line (AI is se lead match karta hai)
                <select value={p.line || ""} onChange={(e) => set({ line: e.target.value })}>
                  <option value="">—</option>{lines.map((l) => <option key={l}>{l}</option>)}
                </select>
              </label>
            </div>
            <label>Tagline<input value={p.tagline || ""} onChange={(e) => set({ tagline: e.target.value })} placeholder="Restaurant ka mukammal hisaab — billing, kitchen, stock" /></label>
            <label>Description<textarea rows={3} value={p.description || ""} onChange={(e) => set({ description: e.target.value })} /></label>
            <label>Features (har line par aik)<textarea rows={5} value={features} onChange={(e) => setFeatures(e.target.value)} placeholder={"Online + offline billing\nKitchen order printing\nStock & recipe management"} /></label>
          </div>
        </div>
        <div className="grid3">
          <label>Pricing
            <select value={p.pricing} onChange={(e) => set({ pricing: e.target.value as PricingModel })}>
              {(Object.keys(PRICING_LABEL) as PricingModel[]).map((k) => <option key={k} value={k}>{PRICING_LABEL[k]}</option>)}
            </select>
          </label>
          <label>{p.pricing === "setup_plus_monthly" ? "Monthly (Rs)" : "Price (Rs)"}<input type="number" value={p.price || ""} onChange={(e) => set({ price: Number(e.target.value) })} /></label>
          {p.pricing === "setup_plus_monthly"
            ? <label>Setup fee (Rs)<input type="number" value={p.setupFee || ""} onChange={(e) => set({ setupFee: Number(e.target.value) })} /></label>
            : <label>Per (month / license / project / day)<input value={p.per || ""} onChange={(e) => set({ per: e.target.value })} /></label>}
          {p.pricing === "daily" && <label>Pehli sale mein din<input type="number" value={p.periods || 7} onChange={(e) => set({ periods: Number(e.target.value) || 7 })} /></label>}
          <label>Demo link<input value={p.demoUrl || ""} onChange={(e) => set({ demoUrl: e.target.value })} placeholder="https://…" /></label>
          <label>Video link<input value={p.videoUrl || ""} onChange={(e) => set({ videoUrl: e.target.value })} placeholder="YouTube / Drive" /></label>
          <label>Invoice service (catalog)
            <select value={p.serviceId || ""} onChange={(e) => set({ serviceId: e.target.value })}>
              <option value="">— link nahi —</option>
              {servicesOf(data.settings).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <div className="rowActions" style={{ marginTop: 8 }}>
          <label className="permItem"><input type="checkbox" checked={p.active !== false} onChange={(e) => set({ active: e.target.checked })} /><span>Active (assistants ko dikhe)</span></label>
          <label className="permItem"><input type="checkbox" checked={!!p.popular} onChange={(e) => set({ popular: e.target.checked })} /><span>⭐ Popular</span></label>
          <span className="small">Price: <b>{priceLabel(p)}</b> • pehli sale ki value: <b>Rs {productSaleValue(p).toLocaleString("en-PK")}</b></span>
        </div>
        <div className="rowActions" style={{ marginTop: 10 }}>
          <button className="btnSolid" onClick={save} disabled={busy}>{busy ? "…" : "Save"}</button>
          <button className="btnSmall" onClick={onClose}>Cancel</button>
          {msg && <span className="warnText small">{msg}</span>}
        </div>
      </div>
    </div>
  );
}
