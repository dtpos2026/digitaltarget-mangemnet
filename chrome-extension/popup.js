// Extension popup: quick links, and "use this website as the portal" for a
// custom domain (the built-in ones are digital-target007.web.app /
// .firebaseapp.com and localhost).
const BUILT_IN = ["digital-target007.web.app", "digital-target007.firebaseapp.com", "localhost", "127.0.0.1"];
const $ = (id) => document.getElementById(id);

$("portal").onclick = async () => {
  const { portalUrl } = await chrome.storage.local.get("portalUrl");
  chrome.tabs.create({ url: portalUrl || "https://digital-target007.web.app/" });
};
$("wa").onclick = () => chrome.windows.create({ url: "https://web.whatsapp.com/", type: "popup", width: 1180, height: 820 });

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url;
  try { url = new URL(tab.url); } catch { return; }
  if (url.protocol !== "https:" || url.hostname === "web.whatsapp.com") return;
  const { customDomains = [] } = await chrome.storage.local.get("customDomains");
  if (BUILT_IN.includes(url.hostname) || customDomains.includes(url.hostname)) {
    $("site").textContent = `✓ ${url.hostname} portal ke taur par connected hai.`;
    return;
  }
  $("site").innerHTML = `Portal kisi apne domain par hai? (<code>${url.hostname}</code>)`;
  $("add").hidden = false;
  $("add").onclick = async () => {
    const origin = `https://${url.hostname}/*`;
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) return;
    const domains = [...customDomains, url.hostname];
    await chrome.storage.local.set({ customDomains: domains });
    await chrome.scripting.unregisterContentScripts({ ids: ["dt-bridge-custom"] }).catch(() => {});
    await chrome.scripting.registerContentScripts([
      { id: "dt-bridge-custom", matches: domains.map((d) => `https://${d}/*`), js: ["bridge.js"], runAt: "document_start" },
    ]);
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [100],
      addRules: [{
        id: 100, priority: 1,
        action: { type: "modifyHeaders", responseHeaders: [
          { header: "x-frame-options", operation: "remove" },
          { header: "content-security-policy", operation: "remove" },
          { header: "content-security-policy-report-only", operation: "remove" },
        ] },
        condition: { urlFilter: "||web.whatsapp.com/", resourceTypes: ["sub_frame"], initiatorDomains: domains },
      }],
    });
    $("add").hidden = true;
    $("msg").textContent = "✓ Ho gaya. Portal tab reload karein.";
  };
})();
