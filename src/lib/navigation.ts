// Tiny app-wide navigation bus (the portal has no router yet): lets the
// notification bell or the Leads tab open a tab / WhatsApp conversation.
export interface NavDetail {
  tab: string;
  conversationId?: string;
  leadId?: string;
  /** WhatsApp number (international digits) to open in WhatsApp Web. */
  phone?: string;
  /** WhatsApp chat id (e.g. "…@lid" when the number is hidden). */
  chatId?: string;
  /** WhatsApp tab sub-view, e.g. "campaign" for the Message Center. */
  view?: string;
  /** Leads to pre-select (Message Center). */
  leadIds?: string[];
}

const EVENT = "dt:navigate";

export function navigate(detail: NavDetail) {
  window.dispatchEvent(new CustomEvent<NavDetail>(EVENT, { detail }));
}

export function onNavigate(fn: (d: NavDetail) => void) {
  const handler = (e: Event) => fn((e as CustomEvent<NavDetail>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/**
 * Opens WhatsApp Web: inside the portal's WhatsApp tab when the Digital Target
 * browser extension is installed, otherwise in its own window (a plain
 * website cannot embed WhatsApp Web).
 */
export function openWhatsAppWeb(canUseTab = true) {
  if (canUseTab && document.documentElement.hasAttribute("data-dt-wa-ext")) {
    try { localStorage.setItem("dt.waView", "web"); } catch { /* ignore */ }
    navigate({ tab: "whatsapp" });
    return;
  }
  const w = Math.min(1280, window.screen.availWidth - 40);
  const h = Math.min(860, window.screen.availHeight - 60);
  window.open("https://web.whatsapp.com/", "dt-whatsapp-web", `width=${w},height=${h},left=20,top=20`);
}
