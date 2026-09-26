# Digital Target WhatsApp Connector (browser extension)

Shows **WhatsApp Web inside the portal** (WhatsApp tab → WhatsApp Web) and lets
the portal read chats to capture leads. No server is needed.

## Install (Chrome or Edge, once per computer)
1. Portal → WhatsApp → **Extension download karein**, then extract the ZIP.
2. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and pick the `dt-whatsapp-extension` folder.
4. Reload the portal. Scan the QR once (phone → Settings → Linked devices → Link a device).

If the portal runs on its own domain (not `digital-target007.web.app`), open the
portal, click the extension icon, then **Is website ko portal banayein**.

## How it works
- `bridge.js` runs on the portal pages and relays `window.postMessage` requests.
- `background.js` routes them to WhatsApp Web (embedded frame, or its own window).
- `wa-agent.js` runs inside WhatsApp Web and uses [wa-js](https://github.com/wppconnect-team/wa-js)
  (`vendor/`, Apache-2.0) to list chats, read the last messages, open a chat and send.
- `rules.json` removes WhatsApp's "do not embed" headers **only** for frames
  opened by the portal domains, so WhatsApp Web can load inside the portal.
  `wa-frame-guard.js` turns off WhatsApp's service worker in that frame.
- In its own window WhatsApp Web shows a small Digital Target panel
  (save this chat as lead / capture all chats).

## Limits
- Works while the browser (and WhatsApp Web) is open; nothing is captured when the computer is off.
  For 24/7 capture use `whatsapp-service/` (server).
- Unofficial automation: keep sending human-paced (no bulk messages) to avoid a WhatsApp ban.
- WhatsApp Web updates can break wa-js; update `vendor/wppconnect-wa.js` from npm
  (`@wppconnect/wa-js`) and bump `version` in `manifest.json`.
