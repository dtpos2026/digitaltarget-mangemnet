// Routes messages between the portal tab(s) and WhatsApp Web (embedded frame
// or its own window). The worker can be stopped at any time, so the routing
// tables live in chrome.storage.session.
const WA_URL = "https://web.whatsapp.com/";
const store = chrome.storage.session;

async function table(name) {
  return (await store.get(name))[name] || {};
}
async function saveTable(name, value) {
  await store.set({ [name]: value });
}

async function agentsFor(tabId) {
  const agents = Object.values(await table("agents"));
  const portals = await table("portals");
  const embedded = agents.filter((a) => a.tabId === tabId);
  const standalone = agents.filter((a) => a.top && !portals[a.tabId]).sort((a, b) => b.at - a.at);
  return [...embedded, ...standalone];
}

async function dropAgent(a) {
  const agents = await table("agents");
  delete agents[`${a.tabId}:${a.frameId}`];
  await saveTable("agents", agents);
}

async function forwardToAgent(tabId, op, args) {
  const list = await agentsFor(tabId);
  if (!list.length) throw new Error("WhatsApp Web open nahi hai");
  let lastErr;
  for (const a of list) {
    try {
      const r = await chrome.tabs.sendMessage(a.tabId, { kind: "agent-req", op, args }, { frameId: a.frameId });
      if (r === undefined) throw new Error("no answer");
      return { ...r, embedded: a.tabId === tabId };
    } catch (e) {
      lastErr = e;
      if (/Receiving end|No tab|no frame|no answer/i.test(String(e && e.message))) await dropAgent(a);
      else throw e;
    }
  }
  throw lastErr || new Error("WhatsApp Web open nahi hai");
}

async function toPortals(msg, onlyTab) {
  const portals = await table("portals");
  const ids = onlyTab != null && portals[onlyTab] ? [onlyTab] : Object.keys(portals).map(Number);
  let delivered = 0;
  for (const id of ids) {
    try {
      await chrome.tabs.sendMessage(id, { kind: "event", ...msg }, { frameId: 0 });
      delivered++;
    } catch {
      delete portals[id];
    }
  }
  await saveTable("portals", portals);
  return delivered;
}

// Two quick requests (e.g. two portal tabs) must not open two WhatsApp windows.
let opening = null;
function openWindow() {
  if (opening) return opening;
  opening = (async () => {
    const tabs = await chrome.tabs.query({ url: WA_URL + "*" });
    if (tabs.length) {
      await chrome.windows.update(tabs[0].windowId, { focused: true });
      await chrome.tabs.update(tabs[0].id, { active: true });
      return { reused: true };
    }
    await chrome.windows.create({ url: WA_URL, type: "popup", width: 1180, height: 820, focused: true });
    return { reused: false };
  })().finally(() => setTimeout(() => { opening = null; }, 3000));
  return opening;
}

async function handle(msg, sender) {
  const tabId = sender.tab && sender.tab.id;
  switch (msg.kind) {
    case "portal-hello": {
      const portals = await table("portals");
      portals[tabId] = { tabId, origin: sender.origin, at: Date.now() };
      await saveTable("portals", portals);
      await chrome.storage.local.set({ portalUrl: sender.origin + "/" });
      return { version: chrome.runtime.getManifest().version };
    }
    case "portal-req": {
      if (msg.op === "openWindow") return { ok: true, result: await openWindow() };
      if (msg.op === "agents") {
        const list = await agentsFor(tabId);
        return { ok: true, result: { embedded: list.some((a) => a.tabId === tabId), window: list.some((a) => a.tabId !== tabId) } };
      }
      try {
        return await forwardToAgent(tabId, msg.op, msg.args);
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    }
    case "agent-hello": {
      const agents = await table("agents");
      agents[`${tabId}:${sender.frameId}`] = { tabId, frameId: sender.frameId, top: sender.frameId === 0, at: Date.now() };
      await saveTable("agents", agents);
      const portals = await table("portals");
      await toPortals({ event: "agent", data: { embedded: !!portals[tabId] }, embedded: !!portals[tabId] }, portals[tabId] ? tabId : null);
      return { ok: true };
    }
    case "agent-event": {
      const portals = await table("portals");
      const embedded = !!portals[tabId];
      await toPortals({ event: msg.event, data: msg.data, embedded }, embedded ? tabId : null);
      return { ok: true };
    }
    case "panel-action": {
      const delivered = await toPortals({ event: "panel", data: { action: msg.action }, embedded: false });
      const { portalUrl } = await chrome.storage.local.get("portalUrl");
      return { delivered, portalUrl: portalUrl || "" };
    }
    case "open-portal": {
      const { portalUrl } = await chrome.storage.local.get("portalUrl");
      if (portalUrl) await chrome.tabs.create({ url: portalUrl });
      return { ok: !!portalUrl };
    }
  }
  return undefined;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const agents = await table("agents");
  for (const k of Object.keys(agents)) if (agents[k].tabId === tabId) delete agents[k];
  await saveTable("agents", agents);
  const portals = await table("portals");
  delete portals[tabId];
  await saveTable("portals", portals);
});
