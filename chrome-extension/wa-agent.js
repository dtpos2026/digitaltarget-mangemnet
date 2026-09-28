// Runs inside WhatsApp Web (MAIN world) next to wa-js (window.WPP).
// Answers requests from wa-relay.js and reports events (linked / active chat /
// new message). Everything returned is plain data (structured-clone safe).
//
// Two modes:
//  - "wpp": wa-js is ready → fast, reads WhatsApp's own data.
//  - "dom": wa-js did not start on this WhatsApp Web version → reads the
//    screen (chat list, open chat) and sends through WhatsApp's own
//    click-to-chat page. Slower, but works without wa-js.
(() => {
  if (window.__dtAgent) return;
  window.__dtAgent = true;

  const TAG = "__dtwa";
  const W = () => window.__DT_WPP_TEST || window.WPP;
  const post = (msg) => window.postMessage({ [TAG]: true, ...msg }, location.origin);
  const emit = (event, data) => post({ type: "evt", event, data });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  window.addEventListener("error", (e) => {
    if (String(e.filename || "").includes("wppconnect") || /WPP|wa-js/i.test(String(e.message))) errors.push(String(e.message).slice(0, 160));
  });

  const wppReady = () => {
    const w = W();
    return !!(w && (w.isReady || (w.loader && w.loader.isReady)) && w.conn && w.chat);
  };
  const domReady = () => !!document.querySelector("#pane-side");
  const mode = () => {
    if (wppReady()) {
      try { if (W().conn.isAuthenticated()) return "wpp"; } catch { /* fall through */ }
    }
    return domReady() ? "dom" : wppReady() ? "wpp" : "loading";
  };

  const ser = (id) => (id && typeof id === "object" ? id._serialized || `${id.user}@${id.server}` : String(id || ""));
  const digits = (s) => String(s || "").replace(/\D/g, "");
  const chatIdFor = (a) => (a.chatId ? String(a.chatId) : `${digits(a.phone)}@c.us`);
  const phoneFromJid = (jid) => (/@c\.us$|@s\.whatsapp\.net$/.test(jid) ? digits(jid.split("@")[0]) : "");
  const looksLikePhone = (s) => /^\+?[\d\s()-]{8,}$/.test(String(s || "").trim());
  const skipJid = (jid) => /@g\.us$|@newsletter$|^status@broadcast$|@broadcast$/.test(jid);

  function myNumber() {
    try {
      const w = W();
      if (wppReady()) { const u = digits((w.conn.getMyUserId() || {}).user); if (u) return u; }
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem("last-wid-md") || localStorage.getItem("last-wid") || "";
      return digits(String(raw).replace(/"/g, "").split(/[:@]/)[0]);
    } catch { return ""; }
  }

  // ---------------------------------------------------------------- wa-js mode
  async function phoneOf(chat) {
    const id = chat.id || {};
    if (id.server === "c.us") return id.user || "";
    const c = chat.contact || {};
    const pn = c.phoneNumber || (c.attributes && c.attributes.phoneNumber);
    if (pn) return digits(pn.user || ser(pn).split("@")[0]);
    if (id.server === "lid" && W().contact && W().contact.getPnLidEntry) {
      try {
        const e = await W().contact.getPnLidEntry(ser(id));
        if (e && e.phoneNumber) return digits(e.phoneNumber.id || e.phoneNumber.user || e.phoneNumber._serialized);
      } catch { /* no mapping */ }
    }
    return "";
  }
  const nameOf = (chat) => {
    const c = chat.contact || {};
    return c.name || chat.formattedTitle || c.pushname || c.verifiedName || c.formattedName || "";
  };
  async function chatInfo(chat) {
    const c = chat.contact || {};
    return {
      id: ser(chat.id), name: nameOf(chat), pushname: c.pushname || "", phone: await phoneOf(chat),
      saved: !!(c.isMyContact || c.name), isGroup: !!chat.isGroup || (chat.id && chat.id.server === "g.us"),
      t: Number(chat.t || 0) * 1000, unread: Number(chat.unreadCount || 0), archived: !!chat.archive,
    };
  }
  function msgInfo(m) {
    const key = m.id || {};
    const fromMe = typeof key === "object" ? !!key.fromMe : !!m.fromMe || String(key).startsWith("true_");
    const type = m.type || "chat";
    let text = "";
    if (type === "chat") text = m.body || "";
    else if (m.caption) text = m.caption;
    else if (type === "call_log") text = "[call]";
    else text = `[${type}]`;
    const remote = ser((key && key.remote) || m.from || "");
    // ack: 1 sent to server, 2 delivered, 3 read (WhatsApp's own receipt).
    return { id: ser(key), fromMe, type, t: Number(m.t || 0) * 1000, text: String(text).slice(0, 4000), remote, ack: Number(m.ack || 0) };
  }

  const wpp = {
    async chats(a = {}) {
      const list = await W().chat.list({ onlyUsers: true });
      const since = a.sinceDays ? Date.now() - a.sinceDays * 864e5 : 0;
      const out = [];
      for (const chat of list) {
        if (out.length >= (a.max || 5000)) break;
        if (a.onlyUnread && !chat.unreadCount) continue;
        const info = await chatInfo(chat);
        if (info.isGroup || skipJid(info.id)) continue;
        if (since && info.t && info.t < since) continue;
        out.push(info);
      }
      return out;
    },
    async messages(a) {
      const msgs = await W().chat.getMessages(a.chatId, { count: a.count || 40 });
      return (msgs || []).map(msgInfo).filter((m) => m.type !== "e2e_notification" && m.type !== "notification_template");
    },
    async active() {
      const chat = W().chat.getActiveChat();
      if (!chat) return null;
      const info = await chatInfo(chat);
      return info.isGroup ? { ...info, messages: [] } : { ...info, messages: await wpp.messages({ chatId: info.id, count: 40 }) };
    },
    async open(a) {
      const id = chatIdFor(a);
      if (W().chat.find) await W().chat.find(id);
      await W().chat.openChatBottom(id);
      if (a.text && W().chat.setInputText) await W().chat.setInputText(a.text, id);
      return true;
    },
    async sendText(a) {
      const r = await W().chat.sendTextMessage(chatIdFor(a), a.text, { createChat: true });
      return { id: ser(r && r.id) };
    },
    async sendFile(a) {
      const r = await W().chat.sendFileMessage(chatIdFor(a), a.dataUrl, {
        type: "auto-detect", filename: a.filename || "file", caption: a.caption || "", createChat: true,
      });
      return { id: ser(r && r.id) };
    },
  };

  // ------------------------------------------------------------------ DOM mode
  const pane = () => document.querySelector("#pane-side");
  function rowNodes() {
    const p = pane();
    if (!p) return [];
    const sel = '[role="listitem"], [role="row"]';
    return [...p.querySelectorAll(sel)].filter((r) => r.querySelector("span[title]") && !r.parentElement.closest(`#pane-side ${sel.split(", ").join(", #pane-side ")}`));
  }
  const rowTitle = (r) => {
    const s = r.querySelector('span[dir="auto"][title]') || r.querySelector("span[title]");
    return s ? s.getAttribute("title") || s.textContent || "" : "";
  };
  const TIME_RE = /^(\d{1,2}:\d{2}(\s?[ap]\.?m\.?)?|yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})$/i;
  function rowTime(r) {
    for (const el of r.querySelectorAll("div, span")) {
      if (el.children.length) continue;
      const t = (el.textContent || "").trim();
      if (TIME_RE.test(t)) return parseListTime(t);
    }
    return 0;
  }
  const monthFirst = () => /^en-US/i.test(navigator.language || "");
  function parseDate(d1, d2, y) {
    const year = y.length === 2 ? 2000 + +y : +y;
    const [m, d] = monthFirst() ? [+d1, +d2] : [+d2, +d1];
    return new Date(year, m - 1, d).getTime();
  }
  function parseListTime(t) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (/^\d{1,2}:\d{2}/.test(t) || /^today$/i.test(t)) return now.getTime();
    if (/^yesterday$/i.test(t)) return today - 864e5;
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const di = days.indexOf(t.toLowerCase());
    if (di >= 0) return today - (((now.getDay() - di + 7) % 7) || 7) * 864e5;
    const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    return m ? parseDate(m[1], m[2], m[3]) : 0;
  }
  function rowInfo(r) {
    const title = rowTitle(r);
    const badge = r.querySelector('span[aria-label*="unread" i]');
    const unread = badge ? Number(digits(badge.textContent)) || 1 : 0;
    const isGroup = !!r.querySelector('[data-icon^="default-group"], [data-icon*="group"]');
    const phone = looksLikePhone(title) ? digits(title) : "";
    return { id: "dom:" + title, name: phone ? "" : title, pushname: "", phone, saved: !phone, isGroup, t: rowTime(r), unread, archived: false };
  }
  function headerTitle() {
    const h = document.querySelector("#main header");
    if (!h) return "";
    const s = h.querySelector('span[dir="auto"][title]') || h.querySelector('span[dir="auto"]') || h.querySelector("[title]");
    return s ? (s.getAttribute("title") || s.textContent || "").trim() : "";
  }
  function parsePre(p) {
    // "[10:15 am, 26/09/2026] Name: "
    const m = String(p || "").match(/\[(\d{1,2}):(\d{2})\s*([ap])?\.?m?\.?,\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\]/i);
    if (!m) return 0;
    let h = +m[1];
    if (m[3]) { const pm = m[3].toLowerCase() === "p"; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    return parseDate(m[4], m[5], m[6]) + h * 36e5 + +m[2] * 6e4;
  }
  function domMessages(count = 40) {
    const main = document.querySelector("#main");
    if (!main) return [];
    const seen = new Set();
    const out = [];
    for (const r of main.querySelectorAll("div[data-id]")) {
      const id = r.getAttribute("data-id") || "";
      if (!/^(true|false)_/.test(id) || seen.has(id)) continue;
      seen.add(id);
      const remote = id.split("_")[1] || "";
      const pre = r.querySelector("[data-pre-plain-text]");
      const textEl = r.querySelector("span.selectable-text") || (pre && pre.querySelector("span"));
      let text = textEl ? textEl.innerText.trim() : "";
      let type = "chat";
      if (!text) {
        type = r.querySelector('img[src^="blob:"], img[src^="data:"]') ? "image"
          : r.querySelector('[data-icon*="ptt"], [data-icon*="audio"], audio') ? "ptt"
          : r.querySelector('[data-icon*="document"], [data-icon*="doc-"]') ? "document"
          : r.querySelector('[data-icon*="call"]') ? "call_log" : "other";
        text = `[${type}]`;
      }
      out.push({ id, fromMe: id.startsWith("true_"), type, t: parsePre(pre && pre.getAttribute("data-pre-plain-text")), text: text.slice(0, 4000), remote });
    }
    return out.slice(-count);
  }
  async function waitFor(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (fn()) return true; await sleep(150); }
    return false;
  }
  function click(el) {
    for (const type of ["mousedown", "mouseup", "click"]) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
  async function openByTitle(title) {
    if (headerTitle() === title) return;
    const p = pane();
    if (!p) throw new Error("WhatsApp chat list nahi mili");
    const find = () => rowNodes().find((r) => rowTitle(r) === title);
    let r = find();
    if (!r) {
      p.scrollTop = 0;
      await sleep(300);
      r = find();
      for (let i = 0; i < 500 && !r; i++) {
        const before = p.scrollTop;
        p.scrollTop += p.clientHeight * 0.8;
        await sleep(220);
        r = find();
        if (p.scrollTop === before) break;
      }
    }
    if (!r) throw new Error("Chat list mein nahi mili: " + title);
    click(r.querySelector("span[title]") || r);
    await waitFor(() => headerTitle() === title, 6000);
    await waitFor(() => domMessages(1).length > 0, 3000);
    await sleep(400);
  }
  function goSend(phone, text, autoSend) {
    const n = digits(phone);
    if (!n) throw new Error("Number sahi nahi");
    try { sessionStorage.setItem("dtPendingSend", JSON.stringify({ n, text: text || "", autoSend: !!autoSend, at: Date.now() })); } catch { /* ignore */ }
    setTimeout(() => location.assign(`https://web.whatsapp.com/send?phone=${n}${text ? `&text=${encodeURIComponent(text)}` : ""}`), 50);
  }
  // After a /send?phone= reload: press Send for a queued portal message.
  (async () => {
    let p = null;
    try { p = JSON.parse(sessionStorage.getItem("dtPendingSend") || "null"); sessionStorage.removeItem("dtPendingSend"); } catch { /* ignore */ }
    if (!p || !p.autoSend || Date.now() - p.at > 120000) return;
    const btn = () => {
      const s = document.querySelector('#main footer button[aria-label="Send" i], #main footer span[data-icon="send"], #main footer span[data-icon="wds-ic-send-filled"]');
      return s ? s.closest("button") || s : null;
    };
    if (await waitFor(btn, 45000)) { await sleep(600); click(btn()); }
  })();

  const dom = {
    async chats(a = {}) {
      const p = pane();
      if (!p) throw new Error("WhatsApp chat list nahi mili");
      const since = a.sinceDays ? Date.now() - a.sinceDays * 864e5 : 0;
      const byId = new Map();
      const collect = () => rowNodes().forEach((r) => { const i = rowInfo(r); if (i.name || i.phone) byId.set(i.id, i); });
      if (a.onlyUnread) { collect(); return [...byId.values()].filter((c) => c.unread && !c.isGroup); }
      const start = p.scrollTop;
      p.scrollTop = 0;
      await sleep(300);
      collect();
      for (let i = 0; i < 600; i++) {
        const before = p.scrollTop;
        p.scrollTop += p.clientHeight * 0.8;
        await sleep(220);
        collect();
        if (p.scrollTop === before || byId.size >= (a.max || 5000)) break;
        if (since) {
          const vis = rowNodes().map(rowTime).filter(Boolean);
          if (vis.length && Math.max(...vis) < since) break; // list is newest-first
        }
      }
      p.scrollTop = start;
      return [...byId.values()].filter((c) => !c.isGroup && (!since || !c.t || c.t >= since));
    },
    async messages(a) {
      const id = String(a.chatId || "");
      if (id.startsWith("dom:")) await openByTitle(id.slice(4));
      return domMessages(a.count || 40);
    },
    async active() {
      const name = headerTitle();
      if (!name) return null;
      const messages = domMessages(40);
      const remote = (messages.find((m) => m.remote) || {}).remote || "";
      const phone = phoneFromJid(remote) || (looksLikePhone(name) ? digits(name) : "");
      return {
        id: remote || "dom:" + name, name: looksLikePhone(name) ? "" : name, pushname: "", phone,
        saved: !looksLikePhone(name), isGroup: skipJid(remote), t: Date.now(), unread: 0, archived: false,
        messages: skipJid(remote) ? [] : messages,
      };
    },
    async open(a) {
      if (a.chatId && String(a.chatId).startsWith("dom:")) { await openByTitle(String(a.chatId).slice(4)); return true; }
      const phone = a.phone || phoneFromJid(String(a.chatId || ""));
      if (!phone) throw new Error("Is chat ka number maloom nahi — WhatsApp mein khud kholein");
      goSend(phone, a.text, false);
      return true;
    },
    async sendText(a) {
      const phone = a.phone || phoneFromJid(String(a.chatId || ""));
      if (!phone) throw new Error("Number maloom nahi");
      goSend(phone, a.text, true);
      return { id: "queued" };
    },
    async sendFile() {
      throw new Error("Is WhatsApp version par file portal se nahi ja sakti — 'Chat kholein' dabayein aur WhatsApp mein 📎 se bhejein");
    },
  };

  // ------------------------------------------------------------------ requests
  async function state() {
    const m = mode();
    const w = W();
    return {
      ready: m !== "loading",
      authenticated: m === "dom" ? true : m === "wpp" ? !!w.conn.isAuthenticated() : false,
      me: myNumber(),
      mode: m,
      embedded: window.top !== window,
      diag: {
        wpp: !!w, injected: !!(w && w.isInjected), wppReady: wppReady(),
        loader: (w && w.loader && w.loader.loaderType) || "", qr: !!document.querySelector('canvas[aria-label*="QR" i], [data-ref] canvas'),
        errors: errors.slice(-3),
      },
    };
  }

  window.addEventListener("message", async (e) => {
    const d = e.data;
    if (e.source !== window || !d || d[TAG] !== true || d.type !== "req") return;
    try {
      let result;
      if (d.op === "state") result = await state();
      else {
        const m = mode();
        if (m === "loading") throw new Error("WhatsApp Web abhi load ho raha hai — QR scan karein ya thora intezar karein");
        const impl = m === "wpp" ? wpp : dom;
        if (!impl[d.op]) throw new Error("Unknown op " + d.op);
        if ((d.op === "sendText") && !(d.args && d.args.text)) throw new Error("Message khali hai");
        result = await impl[d.op](d.args || {});
      }
      post({ type: "res", id: d.id, ok: true, result });
    } catch (err) {
      post({ type: "res", id: d.id, ok: false, error: String((err && err.message) || err) });
    }
  });

  // State / events are polled: robust across WhatsApp Web versions.
  let last = "";
  let hooked = false;
  let lastHeader = "";
  let lastUnread = -1;
  setInterval(async () => {
    const s = await state().catch(() => ({ ready: false }));
    const k = JSON.stringify({ ...s, diag: undefined });
    if (k !== last) { last = k; emit("state", s); }
    if (s.mode === "wpp" && !hooked) {
      hooked = true;
      const w = W();
      w.on("chat.active_chat", async (chat) => {
        try { emit("active", chat ? await chatInfo(chat) : null); } catch { /* ignore */ }
      });
      w.on("chat.new_message", (m) => {
        try {
          const info = msgInfo(m);
          if (skipJid(info.remote)) return;
          emit("message", { chatId: info.remote, ...info, text: info.text.slice(0, 200) });
        } catch { /* ignore */ }
      });
    }
    if (s.mode === "dom") {
      const h = headerTitle();
      if (h !== lastHeader) { lastHeader = h; emit("active", h ? { id: "dom:" + h, name: h } : null); }
      const unread = rowNodes().reduce((n, r) => n + rowInfo(r).unread, 0);
      if (lastUnread >= 0 && unread !== lastUnread) emit("message", { chatId: "", unread });
      lastUnread = unread;
    }
  }, 1500);
})();
