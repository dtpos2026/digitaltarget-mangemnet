// Isolated-world script inside WhatsApp Web. Relays between the extension
// (background) and wa-agent.js in the page. When WhatsApp Web is open in its
// own window (not embedded in the portal) it also shows a small Digital
// Target panel with "Save lead" / "Capture all chats".
(() => {
  if (window.__dtRelay) return;
  window.__dtRelay = true;
  const TAG = "__dtwa";
  const top = window.top === window;
  const pending = new Map();
  let seq = 0;

  const toAgent = (op, args) =>
    new Promise((resolve) => {
      const id = `r${Date.now()}_${++seq}`;
      const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: "WhatsApp Web ne jawab nahi diya" }); }, op === "chats" ? 180000 : 45000);
      pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
      window.postMessage({ [TAG]: true, type: "req", id, op, args }, location.origin);
    });

  window.addEventListener("message", (e) => {
    const d = e.data;
    if (e.source !== window || !d || d[TAG] !== true) return;
    if (d.type === "res" && pending.has(d.id)) {
      pending.get(d.id)({ ok: d.ok, result: d.result, error: d.error });
      pending.delete(d.id);
    } else if (d.type === "evt") {
      chrome.runtime.sendMessage({ kind: "agent-event", event: d.event, data: d.data }).catch(() => {});
      if (top) panelEvent(d.event, d.data);
    }
  });

  chrome.runtime.onMessage.addListener((m, _sender, sendResponse) => {
    if (!m || m.kind !== "agent-req") return;
    toAgent(m.op, m.args).then(sendResponse);
    return true;
  });

  const hello = () => chrome.runtime.sendMessage({ kind: "agent-hello", top }).catch(() => {});
  hello();
  // Re-announce: the extension's worker may have restarted and forgotten us.
  setInterval(hello, 60000);

  // ---------- Standalone-window panel ----------
  let panel, statusEl, chatEl, noteEl;
  const mark = '<svg width="18" height="18" viewBox="0 0 2 2"><g fill="#fff"><polygon points="0,0 1,0 1,1"/><polygon points="1,0 2,0 2,1"/><polygon points="0,1 1,1 1,2"/><polygon points="1,1 2,1 2,2"/></g></svg>';

  function buildPanel() {
    if (panel || !document.body) return;
    panel = document.createElement("div");
    panel.id = "dt-wa-panel";
    panel.innerHTML = `
      <button class="dtp-head" type="button">${mark}<b>Digital Target</b><span class="dtp-caret">▾</span></button>
      <div class="dtp-body">
        <div class="dtp-status">Loading…</div>
        <div class="dtp-chat"></div>
        <button class="dtp-btn dtp-save" type="button">＋ Is chat ki lead save karein</button>
        <button class="dtp-btn dtp-all" type="button">⚡ Capture all chats → leads</button>
        <div class="dtp-note"></div>
      </div>`;
    document.body.appendChild(panel);
    statusEl = panel.querySelector(".dtp-status");
    chatEl = panel.querySelector(".dtp-chat");
    noteEl = panel.querySelector(".dtp-note");
    panel.querySelector(".dtp-head").onclick = () => panel.classList.toggle("dtp-min");
    panel.querySelector(".dtp-save").onclick = () => act("saveActive");
    panel.querySelector(".dtp-all").onclick = () => act("captureAll");
  }

  async function act(action) {
    noteEl.textContent = "Portal ko bheja ja raha hai…";
    const r = await chrome.runtime.sendMessage({ kind: "panel-action", action }).catch(() => null);
    if (r && r.delivered) {
      noteEl.textContent = "✓ Portal mein dekhein — wahan lead save / capture ho rahi hai.";
    } else {
      noteEl.innerHTML = "";
      noteEl.append("Portal tab khula nahi hai. ");
      const b = document.createElement("button");
      b.className = "dtp-link";
      b.textContent = "Portal kholein";
      b.onclick = () => chrome.runtime.sendMessage({ kind: "open-portal" });
      noteEl.append(b);
    }
  }

  function panelEvent(event, data) {
    buildPanel();
    if (!panel) return;
    if (event === "state") {
      statusEl.textContent = !data.ready ? "WhatsApp Web load ho raha hai…"
        : data.authenticated ? `✓ Linked${data.me ? " • " + data.me : ""}` : "QR scan karein: Phone → Linked devices → Link a device";
      statusEl.className = "dtp-status" + (data.authenticated ? " ok" : "");
    } else if (event === "active") {
      chatEl.textContent = data ? `${data.name || "Unknown"}${data.phone ? " • " + data.phone : ""}` : "";
    }
  }

  if (top) {
    if (document.body) buildPanel();
    else document.addEventListener("DOMContentLoaded", buildPanel);
  }
})();
