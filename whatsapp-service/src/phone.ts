// Mirrors src/lib/phone.ts in the portal; keep the two in sync.

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

export function formatLocalPhone(e164: string): string {
  if (!e164) return "";
  if (e164.startsWith("92") && e164.length === 12) return "0" + e164.slice(2);
  return "+" + e164;
}

/** "923451873354:12@s.whatsapp.net" → "923451873354" */
export function jidUser(jid: string | undefined | null): string {
  if (!jid) return "";
  return jid.split("@")[0].split(":")[0];
}
