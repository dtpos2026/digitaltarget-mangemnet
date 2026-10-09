import React, { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { businessById, businessesOf, useBusinessUnit } from "@/lib/business";
import { Product, activeProducts, priceLabel, productFromService, servicesWithoutProduct } from "@/lib/products";
import BusinessSwitcher from "./BusinessSwitcher";
import ProductEditor from "./ProductEditor";
import ShareModal from "./ShareModal";
import QuotationModal from "./QuotationModal";

/**
 * Products & services the team sells: logo / icon, price, features,
 * description and demo — with WhatsApp sharing and a quotation card from
 * every product. Everyone in sales sees it; only products.manage edits.
 */
export default function ProductsTab() {
  const { data, addItem, updateItem } = useData();
  const { can } = useAuth();
  const manage = can("products.manage") || can("settings.manage");
  const unit = useBusinessUnit();
  const [q, setQ] = useState("");
  const [showOff, setShowOff] = useState(false);
  const [edit, setEdit] = useState<Product | null | undefined>(undefined);
  const [share, setShare] = useState<Product | null>(null);
  const [quote, setQuote] = useState<Product | null>(null);
  const [msg, setMsg] = useState("");
  const all = data.products as Product[];
  const list = useMemo(() => {
    const base = showOff && manage ? all.filter((p) => !unit || p.unit === unit) : activeProducts(all, unit);
    const s = q.trim().toLowerCase();
    return base.filter((p) => !s || `${p.name} ${p.tagline || ""} ${p.description || ""} ${p.features.join(" ")} ${p.line || ""}`.toLowerCase().includes(s));
  }, [all, unit, q, showOff, manage]);
  const missing = manage ? servicesWithoutProduct(data.settings, all) : [];

  const importCatalog = async () => {
    if (!confirm(`Catalog ki ${missing.length} services products ban jayengi (baad mein logo, features, demo add karein). Continue?`)) return;
    let n = 0;
    for (const s of missing) {
      await addItem("products", { ...productFromService(s, data.settings), order: 100 + n, createdAt: new Date().toISOString() });
      n++;
    }
    setMsg(`✓ ${n} products ban gaye`);
  };

  return (
    <>
      <section className="card">
        <div className="sectionHead">
          <div>
            <h2 style={{ margin: 0 }}>Products & Services</h2>
            <div className="small">Software aur services ka catalog — price, features, demo. Customer ko WhatsApp par bhejein ya quotation card banayein.</div>
          </div>
          {manage && (
            <div className="rowActions">
              <button className="btnSolid" onClick={() => setEdit(null)}>+ Naya product</button>
              {missing.length > 0 && <button className="btnSmall" onClick={importCatalog}>Catalog se import ({missing.length})</button>}
            </div>
          )}
        </div>
        <div className="prodBar">
          <BusinessSwitcher />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product, feature dhoondein…" />
          {manage && <label className="permItem"><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /><span className="small">Inactive bhi</span></label>}
        </div>
        {msg && <div className="small"><b>{msg}</b></div>}
      </section>

      {list.length === 0 ? (
        <section className="card small">
          {all.length === 0 ? (manage ? "Abhi koi product nahi — \"Catalog se import\" ya \"+ Naya product\" se shuru karein." : "Abhi koi product nahi — admin products add karega.") : "Is filter mein koi product nahi."}
        </section>
      ) : (
        <div className="prodGrid">
          {list.map((p) => {
            const biz = businessById(data.settings, p.unit);
            return (
              <article key={p.id} className={`prodCard ${p.active === false ? "off" : ""}`}>
                <div className="prodTop">
                  <div className="prodLogo">{p.logo ? <img src={p.logo} alt="" /> : <span>{p.icon || "⭐"}</span>}</div>
                  <div style={{ minWidth: 0 }}>
                    <b className="prodName">{p.name}</b>
                    {p.popular && <span className="badge warn" style={{ marginLeft: 6 }}>⭐ Popular</span>}
                    {biz && <div className="small" style={{ color: biz.color }}>{biz.icon} {biz.name}</div>}
                    {p.tagline && <div className="small">{p.tagline}</div>}
                  </div>
                </div>
                <div className="prodPrice">{priceLabel(p)}</div>
                {p.description && <p className="small prodDesc">{p.description}</p>}
                {p.features.length > 0 && (
                  <ul className="prodFeat">
                    {p.features.slice(0, 5).map((f, i) => <li key={i}>{f}</li>)}
                    {p.features.length > 5 && <li className="small">+{p.features.length - 5} aur</li>}
                  </ul>
                )}
                <div className="rowActions prodActions">
                  <button className="btnSolid" onClick={() => setShare(p)}>📤 WhatsApp share</button>
                  <button className="btnSmall" onClick={() => setQuote(p)}>🧾 Quotation</button>
                  {p.demoUrl && <a className="btnSmall" href={p.demoUrl} target="_blank" rel="noreferrer">🎥 Demo</a>}
                  {manage && <button className="btnSmall" onClick={() => setEdit(p)}>✎ Edit</button>}
                  {manage && <button className="btnSmall" onClick={() => updateItem("products", { ...p, active: p.active === false })}>{p.active === false ? "Active karein" : "Band karein"}</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {businessesOf(data.settings).length === 0 && <div className="small">Settings → Sales team mein businesses set karein.</div>}
      {edit !== undefined && <ProductEditor product={edit} onClose={() => setEdit(undefined)} />}
      {share && <ShareModal product={share} onClose={() => setShare(null)} />}
      {quote && <QuotationModal productIds={[quote.id]} onClose={() => setQuote(null)} />}
    </>
  );
}
