// Tiny app-wide navigation bus (the portal has no router yet): lets the
// notification bell or the Leads tab open a tab / WhatsApp conversation.
export interface NavDetail {
  tab: string;
  conversationId?: string;
  leadId?: string;
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

/** Opens WhatsApp Web in its own window (it cannot be embedded inside a website). */
export function openWhatsAppWeb() {
  const w = Math.min(1280, window.screen.availWidth - 40);
  const h = Math.min(860, window.screen.availHeight - 60);
  window.open("https://web.whatsapp.com/", "dt-whatsapp-web", `width=${w},height=${h},left=20,top=20`);
}
