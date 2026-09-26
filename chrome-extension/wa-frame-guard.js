// Runs in WhatsApp Web's own page (MAIN world) before its scripts.
// 1. Configures wa-js (loaded later by the extension): no analytics, branded device name.
// 2. When WhatsApp Web is embedded inside the portal (an iframe), stops its
//    service worker. A service worker would later serve WhatsApp's page from
//    cache with the "do not embed" header, and the embedded view would go blank.
(() => {
  window.WPPConfig = {
    disableGoogleAnalytics: true,
    googleAnalyticsId: null,
    poweredBy: "Digital Target",
    deviceName: "Digital Target Portal",
    sendStatusToDevice: false,
  };

  if (window.top === window) return;
  try {
    const sw = navigator.serviceWorker;
    if (sw) {
      sw.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
      const blocked = () => Promise.reject(new DOMException("Service worker disabled in embedded WhatsApp", "SecurityError"));
      Object.defineProperty(sw, "register", { value: blocked, configurable: true });
    }
  } catch {
    /* ignore */
  }
})();
