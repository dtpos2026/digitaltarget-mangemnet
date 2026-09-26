// Runs inside WhatsApp Web (MAIN world) next to wa-js (window.WPP).
// Answers requests from wa-relay.js and reports events (linked / active chat /
// new message). Everything returned is plain data (structured-clone safe).
(() => {
  if (window.__dtAgent) return;
  window.__dtAgent = true;

  const TAG = "__dtwa";
  const W = () => window.__DT_WPP_TEST || window.WPP;
  const post = (msg) => window.postMessage({ [TAG]: true, ...msg }, location.origin);
  const emit = (event, data) => post({ type: "evt", event, data });

  const ready = () => {
    const w = W();
    return !!(w && (w.isReady || (w.loader && w.loader.isReady)));
  };

  const ser = (id) => (id && typeof id === "object" ? id._serialized || `${id.user}@${id.server}` : String(id || ""));
  const digits = (s) => String(s || "").replace(/\D/g, "");
  const chatIdFor = (a) => (a.chatId ? String(a.chatId) : `${digits(a.phone)}@c.us`);

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
      } catch {
        /* no mapping */
      }
    }
    return "";
  }

  function nameOf(chat) {
    const c = chat.contact || {};
    return c.name || chat.formattedTitle || c.pushname || c.verifiedName || c.formattedName || "";
  }

  async function chatInfo(chat) {
    const c = chat.contact || {};
    return {
      id: ser(chat.id),
      name: nameOf(chat),
      pushname: c.pushname || "",
      phone: await phoneOf(chat),
      saved: !!(c.isMyContact || c.name),
      isGroup: !!chat.isGroup || (chat.id && chat.id.server === "g.us"),
      t: Number(chat.t || 0) * 1000,
      unread: Number(chat.unreadCount || 0),
      archived: !!chat.archive,
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
    return { id: ser(key), fromMe, type, t: Number(m.t || 0) * 1000, text: String(text).slice(0, 4000) };
  }

  const ops = {
    async state() {
      const w = W();
      if (!ready()) return { ready: false, authenticated: false, me: "" };
      let me = "";
      try { me = digits((w.conn.getMyUserId() || {}).user); } catch { /* not linked */ }
      return { ready: true, authenticated: !!w.conn.isAuthenticated(), me, embedded: window.top !== window };
    },
    async chats(a = {}) {
      const list = await W().chat.list({ onlyUsers: true });
      const since = a.sinceDays ? Date.now() - a.sinceDays * 864e5 : 0;
      const out = [];
      for (const chat of list) {
        if (out.length >= (a.max || 5000)) break;
        if (a.onlyUnread && !chat.unreadCount) continue;
        const info = await chatInfo(chat);
        if (info.isGroup || info.id.endsWith("@newsletter") || info.id === "status@broadcast") continue;
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
      return info.isGroup ? { ...info, messages: [] } : { ...info, messages: await ops.messages({ chatId: info.id, count: 40 }) };
    },
    async open(a) {
      const id = chatIdFor(a);
      if (W().chat.find) await W().chat.find(id);
      await W().chat.openChatBottom(id);
      if (a.text && W().chat.setInputText) await W().chat.setInputText(a.text, id);
      return true;
    },
    async sendText(a) {
      if (!a.text) throw new Error("Message khali hai");
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

  window.addEventListener("message", async (e) => {
    const d = e.data;
    if (e.source !== window || !d || d[TAG] !== true || d.type !== "req") return;
    try {
      if (!ops[d.op]) throw new Error("Unknown op " + d.op);
      if (d.op !== "state" && !ready()) throw new Error("WhatsApp Web abhi load ho raha hai");
      if (d.op !== "state" && !W().conn.isAuthenticated()) throw new Error("WhatsApp link nahi hai — pehle QR scan karein");
      post({ type: "res", id: d.id, ok: true, result: await ops[d.op](d.args || {}) });
    } catch (err) {
      post({ type: "res", id: d.id, ok: false, error: String((err && err.message) || err) });
    }
  });

  // State changes are polled: robust across WhatsApp Web versions.
  let last = "";
  let hooked = false;
  setInterval(async () => {
    const s = await ops.state().catch(() => ({ ready: false }));
    const k = JSON.stringify(s);
    if (k !== last) { last = k; emit("state", s); }
    if (s.ready && !hooked) {
      hooked = true;
      const w = W();
      w.on("chat.active_chat", async (chat) => {
        try { emit("active", chat ? await chatInfo(chat) : null); } catch { /* ignore */ }
      });
      w.on("chat.new_message", (m) => {
        try {
          const info = msgInfo(m);
          const remote = ser((m.id && m.id.remote) || m.from || m.to);
          if (remote.endsWith("@g.us") || remote === "status@broadcast") return;
          emit("message", { chatId: remote, ...info, text: info.text.slice(0, 200) });
        } catch { /* ignore */ }
      });
    }
  }, 1500);
})();
