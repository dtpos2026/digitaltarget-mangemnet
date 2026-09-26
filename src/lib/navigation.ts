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
