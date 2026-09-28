import React, { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { LANGS, LINE_FOLLOWUPS, TEMPLATE_TYPES, TemplateLang, templateText } from "@/lib/waTemplates";

type Store = Record<string, Partial<Record<TemplateLang, string>>>;

const KEYS: { id: string; label: string }[] = [
  ...TEMPLATE_TYPES.map((t) => ({ id: t.id as string, label: t.label })),
  ...Object.keys(LINE_FOLLOWUPS).map((l) => ({ id: `line:${l}`, label: `Lead follow-up: ${l}` })),
];

/**
 * Settings → WhatsApp templates. Urdu / English defaults can be rewritten,
 * and each type has a Custom slot. Placeholders: {name} {company} {invoice}
 * {amount} {paid} {paid_now} {balance} {due} {start} {end} {service} {package} {items}
 */
export default function WaTemplateSettings() {
  const { data, updateSettings } = useData();
  const { can } = useAuth();
  const [store, setStore] = useState<Store>(() => ({ ...(data.settings?.waTemplates || {}) }));
  const [key, setKey] = useState(KEYS[0].id);
  const [lang, setLang] = useState<TemplateLang>("ur");
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  if (!can("settings.manage")) return null;

  const value = store[key]?.[lang] ?? templateText({ waTemplates: {} }, key, lang);
  const isCustomised = !!store[key]?.[lang];
  const set = (v: string) => { setStore({ ...store, [key]: { ...(store[key] || {}), [lang]: v } }); setDirty(true); setMsg(""); };
  const reset = () => {
    const next = { ...store, [key]: { ...(store[key] || {}) } };
    delete next[key][lang];
    setStore(next); setDirty(true);
  };
  const save = async () => {
    // Only non-empty overrides are stored.
    const clean: Store = {};
    for (const [k, v] of Object.entries(store)) {
      const langs = Object.fromEntries(Object.entries(v || {}).filter(([, t]) => t && String(t).trim()));
      if (Object.keys(langs).length) clean[k] = langs;
    }
    try {
      await updateSettings({ ...data.settings, waTemplates: clean });
      setDirty(false); setMsg("✓ Save ho gaya");
    } catch (e) { setMsg("Save nahi hua: " + (e as Error).message); }
  };

  return (
    <section className="card" style={{ marginTop: 14 }}>
      <div className="sectionHead">
        <div>
          <h2 style={{ margin: 0 }}>WhatsApp templates</h2>
          <div className="small">Invoice, payment, reminders, renewal aur leads ke messages. Placeholders: {"{name} {invoice} {amount} {paid_now} {balance} {due} {end} {service} {package} {company}"}</div>
        </div>
        <button className="btnSolid" onClick={save} disabled={!dirty}>Save</button>
      </div>
      <div className="grid2" style={{ gap: 8, marginTop: 10 }}>
        <div><label>Template</label>
          <select value={key} onChange={(e) => setKey(e.target.value)}>
            {KEYS.map((k) => <option key={k.id} value={k.id}>{k.label}{store[k.id] ? " •" : ""}</option>)}
          </select>
        </div>
        <div><label>Language</label>
          <div className="segmented">
            {LANGS.map((l) => <button key={l.id} className={lang === l.id ? "on" : ""} onClick={() => setLang(l.id)}>{l.label}</button>)}
          </div>
        </div>
      </div>
      <textarea rows={8} value={value} onChange={(e) => set(e.target.value)} dir={lang === "ur" ? "rtl" : "ltr"} className={lang === "ur" ? "urduText" : ""} style={{ marginTop: 8 }} />
      <div className="rowActions">
        {isCustomised && <button className="btnSmall" onClick={reset}>Default wapas</button>}
        <span className="small">{isCustomised ? "Aap ka apna text" : lang === "custom" ? "Custom khali hai — English default dikh raha hai" : "Default text"}</span>
        {msg && <span className="small">{msg}</span>}
      </div>
    </section>
  );
}
