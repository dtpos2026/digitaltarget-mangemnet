// Phone helpers shared by Leads, Invoices and the WhatsApp inbox.
// whatsapp-service/src/phone.ts implements the same rules; keep them in sync.

/**
 * Normalises a number to international digits without "+", e.g.
 * "0345-1873354" → "923451873354", "+92 345 1873354" → "923451873354".
 * Local numbers starting with 0 (or a bare 10-digit 3xx mobile) get the
 * default country code. Returns "" when the input is not a plausible number.
 */
export function normalizePhone(raw: unknown, defaultCountry = "92"): string {
  let d = String(raw ?? "").trim().replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = defaultCountry + d.slice(1);
  else if (defaultCountry === "92" && d.length === 10 && d.startsWith("3")) d = defaultCountry + d;
  d = d.replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? d : "";
}

/** "923451873354" → "03451873354"; other countries keep "+<digits>". */
export function formatLocalPhone(e164: string): string {
  if (!e164) return "";
  if (e164.startsWith("92") && e164.length === 12) return "0" + e164.slice(2);
  return "+" + e164;
}

/** Click-to-chat link; wa.me needs the international format. */
export function waLink(phone: unknown, text?: string): string | null {
  const n = normalizePhone(phone);
  if (!n) return null;
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Normalised numbers a lead is reachable on (phone + WhatsApp). */
export function leadPhones(lead: { phone?: unknown; whatsapp?: unknown; phoneE164?: unknown }): string[] {
  return Array.from(
    new Set([normalizePhone(lead.phoneE164), normalizePhone(lead.whatsapp), normalizePhone(lead.phone)].filter(Boolean))
  );
}
