// Runs on the Digital Target portal page. Lets the portal talk to the
// extension with window.postMessage (no extension id needed).
(() => {
  if (window.__dtBridge) return;
  window.__dtBridge = true;
  const version = chrome.runtime.getManifest().version;
  const post = (m) => window.postMessage(m, location.origin);
  document.documentElement.setAttribute("data-dt-wa-ext", version);

  const hello = () => {
    post({ __dt: "hello", version });
    chrome.runtime.sendMessage({ kind: "portal-hello" }).catch(() => {});
  };

  window.addEventListener("message", (e) => {
    const d = e.data;
    if (e.source !== window || !d || typeof d !== "object") return;
    if (d.__dt === "ping") return hello();
    if (d.__dt !== "req") return;
    chrome.runtime
      .sendMessage({ kind: "portal-req", op: d.op, args: d.args })
      .then((r) => post({ __dt: "res", id: d.id, ...(r || { ok: false, error: "No answer" }) }))
      .catch((err) => post({ __dt: "res", id: d.id, ok: false, error: String((err && err.message) || err) }));
  });

  chrome.runtime.onMessage.addListener((m) => {
    if (m && m.kind === "event") post({ __dt: "evt", event: m.event, data: m.data, embedded: !!m.embedded });
  });

  hello();
})();
