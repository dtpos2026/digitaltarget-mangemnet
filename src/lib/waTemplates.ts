// WhatsApp message templates (Urdu / English / Custom) with placeholders.
// Defaults live here; the admin overrides any of them in Settings →
// WhatsApp templates (`settings.waTemplates[type][lang]`).
//
// Used by invoices (invoice / payment / reminders / renewal), and by the
// Message Center for lead follow-ups by service category.

export type TemplateLang = "ur" | "en" | "custom";
export const LANGS: { id: TemplateLang; label: string }[] = [
  { id: "ur", label: "اردو Urdu" },
  { id: "en", label: "English" },
  { id: "custom", label: "Custom" },
];

export type TemplateType =
  | "invoice" | "payment_received" | "payment_reminder" | "overdue_reminder" | "renewal_reminder"
  | "lead_welcome" | "lead_followup";

export const TEMPLATE_TYPES: { id: TemplateType; label: string; group: "invoice" | "lead" }[] = [
  { id: "invoice", label: "Invoice bhejein", group: "invoice" },
  { id: "payment_received", label: "Payment received", group: "invoice" },
  { id: "payment_reminder", label: "Payment reminder", group: "invoice" },
  { id: "overdue_reminder", label: "Overdue reminder", group: "invoice" },
  { id: "renewal_reminder", label: "Renewal reminder", group: "invoice" },
  { id: "lead_welcome", label: "Lead: welcome / intro", group: "lead" },
  { id: "lead_followup", label: "Lead: follow-up", group: "lead" },
];

/**
 * Placeholders: {name} {company} {invoice} {amount} {paid} {balance} {due}
 * {start} {end} {service} {package} {items} {phone}
 */
const DEFAULTS: Record<TemplateType, Record<"ur" | "en", string>> = {
  invoice: {
    ur: "السلام علیکم {name}،\n\nآپ کی Invoice {invoice} تیار ہے۔\n{items}\n\nکل رقم: Rs {amount}\nادا شدہ: Rs {paid}\nبقایا: Rs {balance}{due_line_ur}\n\nشکریہ،\n{company}",
    en: "Assalam o Alaikum {name},\n\nYour invoice {invoice} is ready.\n{items}\n\nTotal: Rs {amount}\nPaid: Rs {paid}\nBalance: Rs {balance}{due_line_en}\n\nThank you,\n{company}",
  },
  payment_received: {
    ur: "السلام علیکم {name}،\n\nآپ کی Rs {paid_now} کی payment موصول ہوگئی ہے۔ Invoice {invoice} کے حوالے سے شکریہ۔{balance_line_ur}\n\n{company}",
    en: "Assalam o Alaikum {name},\n\nWe have received your payment of Rs {paid_now} for invoice {invoice}. Thank you!{balance_line_en}\n\n{company}",
  },
  payment_reminder: {
    ur: "السلام علیکم {name}،\n\nیاد دہانی: Invoice {invoice} کی بقایا رقم Rs {balance} ہے{due_short_ur}۔\nبراہ کرم ادائیگی کا بندوبست کر دیں۔ شکریہ!\n\n{company}",
    en: "Assalam o Alaikum {name},\n\nFriendly reminder: Rs {balance} is pending on invoice {invoice}{due_short_en}.\nKindly arrange the payment. Thank you!\n\n{company}",
  },
  overdue_reminder: {
    ur: "السلام علیکم {name}،\n\nInvoice {invoice} کی ادائیگی کی تاریخ ({due}) گزر چکی ہے۔ بقایا رقم: Rs {balance}۔\nبراہ کرم جلد ادائیگی کر دیں تاکہ سروس بلا تعطل جاری رہے۔\n\n{company}",
    en: "Assalam o Alaikum {name},\n\nInvoice {invoice} was due on {due} and Rs {balance} is still pending.\nPlease clear it soon so the service continues without interruption.\n\n{company}",
  },
  renewal_reminder: {
    ur: "السلام علیکم {name}،\n\nآپ کا {service} {package} پیکج {end} کو ختم ہو رہا ہے۔\nکیا ہم اسے اگلے period کے لیے renew کر دیں؟\n\n{company}",
    en: "Assalam o Alaikum {name},\n\nYour {service} {package} package ends on {end}.\nShall we renew it for the next period?\n\n{company}",
  },
  lead_welcome: {
    ur: "السلام علیکم {name}،\n\n{company} سے رابطہ کرنے کا شکریہ۔ ہم AI software، digital marketing اور social media management کرتے ہیں۔\n{service_line_ur}\n\nآپ کو کس چیز میں مدد چاہیے؟",
    en: "Assalam o Alaikum {name},\n\nThank you for contacting {company}. We build AI software and run digital marketing and social media.\n{service_line_en}\n\nHow can we help you?",
  },
  lead_followup: {
    ur: "السلام علیکم {name}،\n\n{service} کے حوالے سے فالو اپ کر رہے ہیں۔ کیا آپ نے ہماری تفصیلات دیکھ لیں؟ کوئی سوال ہو تو بتائیں۔\n\n{company}",
    en: "Assalam o Alaikum {name},\n\nJust following up about {service}. Did you get a chance to look at our details? Happy to answer any questions.\n\n{company}",
  },
};

/**
 * Service-line specific follow-ups (Message Center picks these by the lead's
 * service). Keys are service lines from the catalog; anything else uses the
 * generic lead_followup template.
 */
export const LINE_FOLLOWUPS: Record<string, Record<"ur" | "en", string>> = {
  "Meta Ads (Facebook + Instagram)": {
    ur: "السلام علیکم {name}،\n\nآپ نے Facebook / Instagram ads کے بارے میں پوچھا تھا۔ ہمارا ads پیکج Rs 700 روزانہ سے شروع ہوتا ہے (ہفتہ وار تقریباً Rs 4,900، ماہانہ تقریباً Rs 17,500)۔\nآپ کا بزنس کون سا ہے اور کس شہر میں ads چلانے ہیں؟\n\n{company}",
    en: "Assalam o Alaikum {name},\n\nYou asked about Facebook / Instagram ads. Our ads packages start at Rs 700/day (about Rs 4,900 weekly, Rs 17,500 monthly).\nWhat is your business and which city should the ads target?\n\n{company}",
  },
  "Video Editing": {
    ur: "السلام علیکم {name}،\n\nآپ نے video editing کے بارے میں رابطہ کیا تھا۔ آپ کو کس قسم کی videos چاہئیں (reels، ads، YouTube)؟ اور مہینے میں تقریباً کتنی؟\n\n{company}",
    en: "Assalam o Alaikum {name},\n\nYou contacted us about video editing. What kind of videos do you need (reels, ads, YouTube) and roughly how many per month?\n\n{company}",
  },
  "Graphic Design": {
    ur: "السلام علیکم {name}،\n\nآپ نے graphic design کے بارے میں پوچھا تھا۔ ہم social media posts، logo اور branding ڈیزائن کرتے ہیں۔ آپ کو کیا چاہیے؟\n\n{company}",
    en: "Assalam o Alaikum {name},\n\nYou asked about graphic design. We design social media posts, logos and branding. What do you need?\n\n{company}",
  },
  "Restaurant Software / DTPOS": {
    ur: "السلام علیکم {name}،\n\nآپ نے restaurant software (DTPOS) کے بارے میں پوچھا تھا۔ اس میں billing، table management، kitchen اور reports شامل ہیں۔ کیا ہم آپ کو demo دکھا دیں؟\n\n{company}",
    en: "Assalam o Alaikum {name},\n\nYou asked about our restaurant software (DTPOS) — billing, table management, kitchen and reports. Shall we show you a demo?\n\n{company}",
  },
  "Retail POS": {
    ur: "السلام علیکم {name}،\n\nآپ نے POS software کے بارے میں پوچھا تھا۔ اس میں billing، stock اور reports ہیں۔ آپ کی دکان کس چیز کی ہے؟ ہم demo دکھا سکتے ہیں۔\n\n{company}",
    en: "Assalam o Alaikum {name},\n\nYou asked about our POS software — billing, stock and reports. What kind of shop do you run? We can show you a demo.\n\n{company}",
  },
  "Web Development": {
    ur: "السلام علیکم {name}،\n\nآپ نے website کے بارے میں پوچھا تھا۔ آپ کو کس قسم کی website چاہیے (business، e-commerce)؟ کوئی reference website ہو تو بھیج دیں۔\n\n{company}",
    en: "Assalam o Alaikum {name},\n\nYou asked about a website. What kind of site do you need (business, e-commerce)? Feel free to send a reference site.\n\n{company}",
  },
  "App Development": {
    ur: "السلام علیکم {name}،\n\nآپ نے mobile app کے بارے میں پوچھا تھا۔ app کس کام کے لیے ہے اور کون سے features چاہئیں؟\n\n{company}",
    en: "Assalam o Alaikum {name},\n\nYou asked about a mobile app. What is the app for and which features do you need?\n\n{company}",
  },
  "Social Media Management": {
    ur: "السلام علیکم {name}،\n\nہماری monthly social media management میں post design، captions، reels اور page handling شامل ہے۔ کیا ہم packages بھیج دیں؟\n\n{company}",
    en: "Assalam o Alaikum {name},\n\nOur monthly social media management covers post design, captions, reels and page handling. Shall we send you the packages?\n\n{company}",
  },
  Branding: {
    ur: "السلام علیکم {name}،\n\nآپ نے branding کے بارے میں پوچھا تھا۔ ہمارے brand identity پیکج میں logo، colors اور brand guide شامل ہیں۔ آپ کا بزنس کیا ہے؟\n\n{company}",
    en: "Assalam o Alaikum {name},\n\nYou asked about branding. Our brand identity package includes logo, colours and a brand guide. What is your business?\n\n{company}",
  },
};

// Lines that share a template with a sibling line.
const LINE_ALIAS: Record<string, string> = {
  "Video Production": "Video Editing",
  "Social Media Content": "Graphic Design",
  "Page Management": "Social Media Management",
  "Advertisement Packages": "Meta Ads (Facebook + Instagram)",
  "Mobile Apps / App Development": "App Development",
  "Web Applications": "Web Development",
  "Hybrid / Cloud Software": "Restaurant Software / DTPOS",
  "Offline Windows Software": "Retail POS",
};

export type TemplateVars = Record<string, string | number | undefined | null>;

export interface TemplateSettings {
  waTemplates?: Partial<Record<string, Partial<Record<TemplateLang, string>>>>;
  companyName?: string;
}

/** Template text for a type + language, admin override first. */
export function templateText(settings: TemplateSettings | undefined, type: string, lang: TemplateLang): string {
  const custom = settings?.waTemplates?.[type]?.[lang];
  if (custom && custom.trim()) return custom;
  if (lang === "custom") return templateText(settings, type, "en");
  if (type.startsWith("line:")) {
    const line = type.slice(5);
    const t = LINE_FOLLOWUPS[line] || LINE_FOLLOWUPS[LINE_ALIAS[line] || ""];
    return t ? t[lang] : DEFAULTS.lead_followup[lang];
  }
  return (DEFAULTS as Record<string, Record<"ur" | "en", string>>)[type]?.[lang] || "";
}

/** The follow-up template key for a lead's service line. */
export const lineTemplateKey = (line?: string) => {
  if (!line) return "lead_followup";
  if (LINE_FOLLOWUPS[line] || LINE_ALIAS[line]) return `line:${line}`;
  return "lead_followup";
};

/** Replaces {placeholders}; unknown ones are removed and blank lines tidied. */
export function fillTemplate(text: string, vars: TemplateVars, lang: TemplateLang = "en"): string {
  const isUr = lang === "ur";
  const due = vars.due ? String(vars.due) : "";
  const balance = Number(vars.balance) || 0;
  const derived: TemplateVars = {
    due_line_ur: due ? `\nآخری تاریخ: ${due}` : "",
    due_line_en: due ? `\nDue date: ${due}` : "",
    due_short_ur: due ? ` (آخری تاریخ ${due})` : "",
    due_short_en: due ? ` (due ${due})` : "",
    balance_line_ur: balance > 0 ? `\nبقایا رقم: Rs ${vars.balance}` : "",
    balance_line_en: balance > 0 ? `\nRemaining balance: Rs ${vars.balance}` : "",
    service_line_ur: vars.service ? `آپ نے ${vars.service} کے بارے میں پوچھا تھا۔` : "",
    service_line_en: vars.service ? `You asked about ${vars.service}.` : "",
  };
  const all = { ...derived, ...vars };
  const out = text.replace(/\{(\w+)\}/g, (_, k) => {
    const v = all[k];
    return v === undefined || v === null ? "" : String(v);
  });
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .replace(/ +([.,!?،۔])/g, "$1")
    .replace(isUr ? /،\s*\n/g : /,\s*\n/g, isUr ? "،\n" : ",\n")
    .trim();
}

export function renderTemplate(settings: TemplateSettings | undefined, type: string, lang: TemplateLang, vars: TemplateVars) {
  return fillTemplate(templateText(settings, type, lang), { company: settings?.companyName || "Digital Target", ...vars }, lang);
}

/** Opt-out words (Urdu / Roman Urdu / English). A lead saying these is never messaged again. */
export const OPT_OUT_RE = /\b(stop|unsubscribe|don'?t (message|text|contact)|do not (message|contact)|remove me|not interested|mat bhej|message na (karein|karo|bhejein)|band karo|block)\b|پیغام نہ|میسج نہ|رابطہ نہ کریں/i;
