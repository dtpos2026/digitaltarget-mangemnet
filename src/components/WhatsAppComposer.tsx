import React, { useEffect, useMemo, useState } from "react";
import { useData } from "@/contexts/DataContext";
import { normalizePhone, formatLocalPhone } from "@/lib/phone";
import { extensionVersion, waExt } from "@/lib/waExtension";
import { LANGS, TEMPLATE_TYPES, TemplateLang, TemplateVars, renderTemplate } from "@/lib/waTemplates";

export interface ComposerLog {
  at: string;
  type: string;
  lang: TemplateLang;
  channel: "whatsapp_web" | "wa_link";
  text: string;
}

interface Props {
  phone: string;
  /** Template types to offer; the first is selected. */
  types: string[];
  vars: TemplateVars;
  title?: string;
  onClose: () => void;
  /** Called after the message is handed to WhatsApp (for communication history). */
  onSent?: (log: ComposerLog) => void;
}

const LANG_KEY = "dt.waLang";
const typeLabel = (t: string) => TEMPLATE_TYPES.find((x) => x.id === t)?.label || (t.startsWith("line:") ? `Follow-up: ${t.slice(5)}` : t);

/**
 * One WhatsApp message: pick template + language, edit, send.
 * With the Digital Target extension the chat opens in WhatsApp Web with the
 * text typed in (the user presses Send there); otherwise a wa.me link opens.
 */
export default function WhatsAppComposer({ phone, types, vars, title, onClose, onSent }: Props) {
  const { data } = useData();
  const [type, setType] = useState(types[0]);
  const [lang, setLang] = useState<TemplateLang>(() => { try { return (localStorage.getItem(LANG_KEY) as TemplateLang) || "ur"; } catch { return "ur"; } });
  const rendered = useMemo(() => renderTemplate(data.settings, type, lang, vars), [data.settings, type, lang, vars]);
  const [text, setText] = useState(rendered);
  const [num, setNum] = useState(phone ? formatLocalPhone(normalizePhone(phone)) || phone : "");
  const [note, setNote] = useState("");
  useEffect(() => setText(rendered), [rendered]);

  const send = async () => {
    const n = normalizePhone(num);
    if (!n) { setNote("Sahi WhatsApp number likhein"); return; }
    if (!text.trim()) { setNote("Message khali hai"); return; }
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
    let channel: ComposerLog["channel"] = "wa_link";
    if (extensionVersion()) {
      try {
        await waExt.open({ phone: n, text });
        channel = "whatsapp_web";
        setNote("✓ WhatsApp Web mein chat khul gayi — message likha hua hai, wahan Send dabayein.");
      } catch {
        window.open(`https://wa.me/${n}?text=${encodeURIComponent(text)}`, "_blank");
      }
    } else {
      window.open(`https://wa.me/${n}?text=${encodeURIComponent(text)}`, "_blank");
    }
    onSent?.({ at: new Date().toISOString(), type, lang, channel, text: text.slice(0, 1000) });
    if (channel === "wa_link") onClose();
  };

  return (
    <div className="dtModalBackdrop" onClick={onClose}>
      <div className="dtModal" onClick={(e) => e.stopPropagation()}>
        <div className="dtModalHead">
          <b>{title || "WhatsApp message"}</b>
          <button className="btnSmall" onClick={onClose}>✕</button>
        </div>
        <div className="grid2" style={{ gap: 8 }}>
          <div>
            <label>Template</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {types.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
            </select>
          </div>
          <div>
            <label>Language</label>
            <div className="segmented">
              {LANGS.map((l) => <button key={l.id} className={lang === l.id ? "on" : ""} onClick={() => setLang(l.id)}>{l.label}</button>)}
            </div>
          </div>
        </div>
        <label>WhatsApp number</label>
        <input value={num} onChange={(e) => setNum(e.target.value)} inputMode="tel" placeholder="03001234567" />
        <label>Message (edit kar sakte hain)</label>
        <textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} dir={lang === "ur" ? "rtl" : "ltr"} className={lang === "ur" ? "urduText" : ""} />
        {lang === "custom" && <div className="small">Custom template Settings → WhatsApp templates mein save hota hai.</div>}
        {note && <div className="small waWebNote">{note}</div>}
        <div className="rowActions" style={{ marginTop: 10 }}>
          <button className="btnSolid" onClick={send}>🟢 {extensionVersion() ? "WhatsApp Web mein kholein" : "WhatsApp par bhejein"}</button>
          <button className="btnSmall" onClick={() => { navigator.clipboard?.writeText(text); setNote("✓ Copy ho gaya"); }}>Copy</button>
        </div>
      </div>
    </div>
  );
}
