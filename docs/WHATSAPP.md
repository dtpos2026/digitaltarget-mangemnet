# WhatsApp Integration

There are two ways to use WhatsApp in the portal. **Option 1 needs no server** and is the default.

## Option 1 — WhatsApp Web inside the portal (browser extension, no server)

WhatsApp tab → **🟢 WhatsApp Web**. The first time, the page shows a 5-step setup: download the
extension from the portal, extract it, open `chrome://extensions`, turn on Developer mode, and use Load unpacked
(details in `chrome-extension/README.md`). After that:

- **Modes:** the extension uses **Fast mode** (wa-js library) when it starts on your WhatsApp Web version. Otherwise it uses **Screen mode**, which reads the chat list and the open chat from the screen.
  - In Screen mode, capture opens chats one by one, so they get marked as read.
  - Sending uses WhatsApp's own click-to-chat page, and the extension then presses Send.
  - Pictures are sent from WhatsApp with 📎.
- **Default is "Alag window"**: WhatsApp now shows "Something went wrong" when it is embedded inside another site. "Portal ke andar (beta)" is still available.
- Real WhatsApp Web opens **inside the portal** (right side). Scan the QR once from the phone
  (Settings → Linked devices → Link a device); the session stays saved in that browser.
  If embedding ever fails, **Alag window** opens it in its own window. The same panel keeps working, and
  WhatsApp Web shows a small Digital Target panel.
- The left panel (POS style) has these parts:
  - link status;
  - **⚡ Capture all chats → leads**, which reads 1:1 chats from the last 30/90/365 days or all of them, optionally skipping saved contacts;
  - **Current chat**: lead status, service and follow-up date, the "Chat se andaza" suggestion, and Save / Update lead;
  - **Quick send**: customer number, auto-filled template, picture/file, *Chat kholein* (writes the message into WhatsApp for you to press Send) or **Send**;
  - **Pending** (unread chats).
- Leads tab → **💬 Chat** opens that lead's chat in WhatsApp Web.
- Calls still ring on the phone.

Limits:
- Capture only happens while a browser with the extension and WhatsApp Web is open.
- It is unofficial automation, so keep sending human-paced.
- A WhatsApp Web update can require updating `chrome-extension/vendor/wppconnect-wa.js`.
- Each team member who handles WhatsApp installs the extension on their computer.
- **Tested:** the extension, routing, capture, send, the Leads→Chat flow and the standalone panel were tested end-to-end in Chromium against a mock WhatsApp Web page. A real QR scan could not be tested because the build sandbox blocks WhatsApp.

## Leads CRM, AI analysis and the Message Center

**Leads tab**
- **Date filters:** Sab, 3 / 7 / 15 din, Is mahine, and Custom (from–to).
- **Other filters:** service, status, lead type (Ads lead / Unsaved number / Saved contact), AI interest (Hot / Warm / Cold) and a search box.
- **Selection:** tick leads one by one, or use Select all / Clear.
- **Bulk actions on selected leads:**
  - ✨ AI analyze;
  - 📣 Message Center;
  - 🗑 Delete — needs a confirmation, and 10 or more leads also need the count typed in.
- **AI analysis** (`src/lib/leadAnalysis.ts`, rule-based, in the browser):
  - It works on captured WhatsApp chats and on older leads whose chat is only in the notes.
  - It finds: the service line (only lines that exist in the catalog), the lead type, an interest % (labelled as an **estimate**, not a guarantee), suggested status, potential value (budget mentioned in the chat, else the catalog price), whether a follow-up is needed and when, the next action, and opt-out.
  - It runs automatically on capture, and re-runs when a reply arrives.
- **Lead profile:** details, AI card, conversation, and a full history. The history lists created / captured, status changes, AI runs, messages sent, replies, notes, conversion and opt-out.

**Message Center** (WhatsApp tab, permission *WhatsApp Message Center & Campaigns*)
- Pick leads (from the Leads selection, or by status / service / days).
- The template is chosen **automatically by each lead's service**, for example Meta Ads, Video Editing, DTPOS or Retail POS, in Urdu, English or Custom. Every message is previewed and can be edited before approval.
- **Safety built in** — the Message Center is not a bulk-spam tool:
  - Consent must be confirmed. The campaign is only for people who contacted you.
  - Opt-outs ("stop", "message na karein", "not interested"…) are stored in `optOuts/` and never messaged again.
  - Invalid, duplicate and Lost numbers are skipped, and the reason is shown.
  - The minimum delay is 30 s (60 s in Screen mode). The daily limit is at most 200 across all campaigns.
  - The campaign **auto-pauses** when:
    - the daily limit is reached;
    - 3 sends fail in a row;
    - more than 30% of sends fail;
    - WhatsApp is disconnected;
    - several recipients opt out.
- **Controls:** Pause / Resume / Stop, plus an optional start time. The campaign runs while the portal tab is open, and after a reload it shows "interrupted" with Resume.
- **Status per message:** queued, sent, delivered (from WhatsApp's own tick, in Fast mode), replied, failed, skipped.
- **Replies** are checked every 2 minutes (or with the button). A reply is saved to the lead's conversation, the lead is re-analysed, and opt-outs are recorded.
- **Analytics per campaign:** selected, sent, delivered, failed, skipped, replies, interested, converted and response %.

## Smart capture, AI reply drafts and exports (extension 1.3.0)

**Capture wizard** (WhatsApp tab → *Capture all chats → leads*): choose filters → *Scan* (nothing is saved) → review → save.
- Filters: source (Facebook/Instagram Ads or organic), service category, interest level (High / Medium / Low), how old the chats are.
- Exclusions (so personal data never becomes a lead): groups and channels always; courier / OTP / bank / bill / delivery messages; chats with no business signal; saved contacts (optional); WhatsApp Business accounts (optional); archived chats; chosen labels; and a **"never capture" list** (🚫 button in the review table and on the current chat). Excluded chats can still be added by hand with *Phir bhi shamil karein*.
- Chats that are excluded because of who they are (saved contact, label, blocklist) are **not opened or read** at all.
- Ads leads are recognised from Meta's ad metadata (when WhatsApp exposes it) and from typical first messages ("Can I get more info on this?", "aap ka ad dekha"). They are saved with source *Facebook*.
- WhatsApp Business **labels** ("Hot lead", "Follow up", "Cold") set the interest level; without a label the level is an estimate from the chat.
- Review table: per chat choose *new lead*, *update the lead we already have*, *link to an existing lead* or *skip*.

**AI reply draft** (current-chat card): drafts a reply from (1) answers you trained, (2) real prices from the Settings catalog, (3) short default replies. It only writes a draft — you press Send. It never sends by itself (unattended replies from a personal WhatsApp break WhatsApp's rules and get numbers banned). Train it in *Settings → AI Reply Training* or from the chat panel (*Is chat se seekhein* turns your earlier replies into answers).

**Exports**: Leads tab → *Excel* (.xlsx with an AI summary sheet) and *PDF* (branded). Selected leads are exported; with none selected, the current filter.

**"Sorry, something went wrong" inside the portal**: WhatsApp often refuses to load inside another site. The extension now notices that page and the portal switches to the separate window by itself; the left panel keeps working. *Alag window* is the recommended mode.

## Campaigns: category-wise content, photo / video / link, delete

- **Each lead gets the message of its own category.** Pick any leads (or filter by category / service / status / days) — the preview groups them by category (Software Development, Digital Marketing, Creative Services, Development, Other). With no custom text, every lead gets the automatic template of its own service.
- **Per-category content**: in *Category-wise message, link aur photo / video* choose the *Sab* tab (applies to everyone) or a category tab and set a custom message (`{name} {service} {company}`), a link, and a photo / video / PDF (max 16 MB). A category without its own link or file inherits the *Sab* one. The file is sent as WhatsApp media with the message as caption; the link is added to the message text.
- The picked file stays in **this browser** (IndexedDB), not in the cloud; the campaign runs only while the portal tab is open anyway. If the file is missing later (other computer / cleared browser) the campaign pauses and says so. Photo / video needs the extension's *Fast mode*; in Screen mode use a link.
- **Delete**: *Delete* on a campaign removes it (recipients, statuses, replies) from the database; *Complete wali delete* clears every finished / stopped campaign at once. A running campaign, and a campaign that sent messages **today**, cannot be deleted (the daily message limit is counted from these records) — delete it tomorrow. Leads, their history and the opt-out list are never touched.

## Option 2 — Server (24/7 capture, QR / linked device)

The portal links **0345-1873354** the way WhatsApp Web does: an admin clicks
**Connect WhatsApp**, a QR code pops up, and the phone scans it from
*WhatsApp → Settings → Linked devices → Link a device*. From then on every chat
is captured into the portal and new numbers become leads automatically.

Per the owner's decision, this does **not** use the Meta WhatsApp Cloud API.

## ⚠️ Risks (read before going live)

| Risk | What it means | Mitigation in this build |
|---|---|---|
| **Against WhatsApp's Terms of Service** | Unofficial automation of a WhatsApp account is not permitted by WhatsApp. The number can be **temporarily or permanently banned**, with no appeal. | Human-paced sending only (1.5s minimum gap, no bulk or broadcast features). The service stays "offline" so the phone still gets notifications. |
| **Protocol changes** | The library ([Baileys](https://github.com/WhiskeySockets/Baileys), `7.0.0-rc14`) reverse-engineers WhatsApp Web. A WhatsApp update can break it until the library is updated. | The version is pinned. The connection code is isolated in `whatsapp-service/`, so an official Cloud API adapter can replace it later without touching the portal. |
| **Session = account access** | Whoever holds the stored session keys can read and send as the business number. | Keys are AES-256-GCM encrypted (`WA_SESSION_KEY`) in `waSessions/`, which no browser user can read (firestore.rules). "Unlink" deletes them. |
| **Always-on server needed** | The link is a live websocket and cannot run inside the browser or a Cloud Function. | A small Docker service (see Deploy below). |

**Recommendation:** use this on a number you can afford to lose. Keep
the Cloud API as the fallback if WhatsApp restricts the number.

## How it works

```
Phone (0345-1873354) ⇄ WhatsApp servers ⇄ whatsapp-service (Docker, always on)
                                               │  Firebase Admin SDK
                                               ▼
                 Firestore: waAccounts · waConversations/messages · leads · notifications
                                               ▲  realtime listeners (rules-protected)
                                               │
                                   Portal → WhatsApp tab / Leads / 🔔
```

1. **Connect:** the portal writes `command: connect` on `users/{ws}/waAccounts/main`. The service picks it up, opens the socket, and publishes the QR on the same document. The popup renders it live.
2. **Scan:** the phone links. The status becomes `connected`, and chat history is imported (optional setting, on by default).
3. **Capture:** every message is saved to `waConversations/{phone}/messages/{id}`, with delivery ticks, edits, deletes, reactions and media (images, documents and voice notes go to Storage under `workspaces/{ws}/whatsapp/`).
4. **Lead capture:** the first message from a new number:
   - normalises the number (`0300…` / `+92300…` → `92300…`)
   - finds an existing lead by that number, including old leads saved as `0300-1234567`
   - otherwise creates a lead with source *WhatsApp* and status *New*. Creation is transactional, so two messages arriving together still produce one lead.
   - links the chat, assigns the default assignee (if set), and notifies everyone with Leads/WhatsApp access.
5. **Reply:** the inbox writes to `waOutbox`. The service checks the conversation, sends the message, and records who sent it (visible in the chat and the audit log).

6. **Photos / documents from the portal:** the 📎 button uploads the file (≤ 16 MB; images, video, audio, PDF, Office, text) to `workspaces/{ws}/whatsapp-outbox/…`. The outbox entry references it, and the service sends it with the typed text as the caption. The rules only accept files from the workspace's own outbox folder.
7. **Calls:** voice and video calls still **ring and are answered on the phone**, because a linked device cannot take calls. The service logs each call in the chat (📞 incoming, then 📵 missed / declined or answered). A call from a new number creates a lead like a message does, and calls are counted in the daily stats.
8. **Daily stats** (`users/{ws}/waStats/{YYYY-MM-DD}`): messages in/out, portal replies per user, first-response times, calls, missed calls, new chats and new leads. History imports are counted by message date. The **Performance** page (permission *Team & WhatsApp Performance*) shows these alongside the lead funnel, leads by source and a per-team-member table (leads, contacted → converted, conversion %, chats, average first response, chats waiting over 1 hour), with CSV export.

Response analytics are stored per conversation: first inbound message, first response time, and message counts in/out.

## Capture Leads (one click)

WhatsApp tab → **⚡ Capture Leads** reads every captured 1:1 chat (last 40 messages each) and:
- links it to an existing lead with the same number, or creates a new lead (source WhatsApp);
- sets the **service category** from what was discussed (AI Software, Digital Marketing, Social Media,
  Graphic Design, Video, Web, Branding) and the **status** (New → Contacted → Interested / Follow-up →
  Converted, or Lost) from the conversation (e.g. "price kitne", "baad mein batata hun", "advance bhej diya",
  "not interested");
- optionally moves existing leads forward (never backwards) and shows a table with the reason for each.

The inbox's customer panel shows the same suggestion for the open chat ("✨ Chat se andaza") with
*Apply to lead*. New leads created automatically by the service also get their service category from
the first message. The rules are keyword-based (English + Roman Urdu) in `src/lib/chatClassifier.ts`.

## Settings (WhatsApp tab → ⚙ Settings)

| Setting | Default |
|---|---|
| Auto-create leads for new numbers | on |
| Create leads from imported (old) chats | off (avoids hundreds of leads from personal/old contacts) |
| Notify on new lead | on |
| Ignore group chats | on |
| Save media | on |
| Import full history on connect | on |
| Default assignee for new leads | none |

If the portal is open on the same phone (so there is nothing to scan), use **"Phone number se link karein"** in the popup. It shows an 8-character pairing code to type in *Linked devices → Link with phone number instead*.

## Deploy the service

Environment variables are listed in `whatsapp-service/.env.example`. Required:

- `WA_SESSION_KEY`: run `cd whatsapp-service && npm run gen-key`. Store it as a secret. Changing it means scanning the QR again.
- Firebase Admin credentials: a service account with **Cloud Datastore User** and **Storage Object Admin** roles.
- `FIREBASE_STORAGE_BUCKET=digital-target007.firebasestorage.app`
- `WORKSPACE_UID` = the admin's uid (recommended; limits the service to that workspace).

Only **one** instance may run per WhatsApp session. A Firestore lease (`waLeases/`) enforces this. A second instance reports an error instead of fighting over the session.

### Option A — small VPS (cheapest, simplest)

```bash
git clone … && cd digitaltarget-mangemnet
docker build -f whatsapp-service/Dockerfile -t dt-whatsapp .
docker run -d --name dt-whatsapp --restart unless-stopped \
  --env-file whatsapp-service/.env \
  -v $PWD/service-account.json:/app/service-account.json:ro \
  -e GOOGLE_APPLICATION_CREDENTIALS=/app/service-account.json \
  dt-whatsapp
```

About 150–250 MB of RAM is enough.

### Option B — Google Cloud Run (same project as Firebase)

```bash
IMAGE=asia-south1-docker.pkg.dev/digital-target007/dt/whatsapp:latest
docker build -f whatsapp-service/Dockerfile -t $IMAGE . && docker push $IMAGE
gcloud run deploy dt-whatsapp --image $IMAGE \
  --project digital-target007 --region asia-south1 \
  --min-instances 1 --max-instances 1 --no-cpu-throttling \
  --set-env-vars WORKSPACE_UID=<admin uid>,FIREBASE_STORAGE_BUCKET=digital-target007.firebasestorage.app \
  --set-secrets WA_SESSION_KEY=wa-session-key:latest
```

`--min-instances 1 --no-cpu-throttling` is required. Without it Cloud Run freezes the container between requests and the WhatsApp socket drops. Note that this runs 24/7 and is billed accordingly.

### Health check

`GET /healthz` returns `{ ok, accounts: [{ status }] }`. The service also writes `heartbeatAt` every 30s. The portal shows **"Service offline"** when the heartbeat is older than 2 minutes.

## Troubleshooting

| Portal shows | Cause / fix |
|---|---|
| Service offline | The container is not running or can't reach Firestore. Check the logs and credentials. |
| QR / pairing code ka waqt khatam | The QR expired unscanned. Click Connect again. |
| Logged out | Someone removed the device from the phone's *Linked devices*. Connect and scan again. Old chats stay in the portal. |
| Connection replaced | The same session was opened elsewhere (a second service instance or an old container). Stop the extra one, then Reconnect. |
| Connected number ≠ expected | A different phone scanned the QR. Unlink and scan with 0345-1873354. |
| Message "failed" in chat | WhatsApp was not connected when sending. Reconnect, then press Retry. |

## Tests

- `whatsapp-service`: `npm test` runs 29 unit tests (parser, encryption, phone normalisation, the full capture pipeline including dedup, history, lid ids, receipts and notifications).
- `npm run test:integration` runs 7 tests on the Firestore emulator (transactional dedup under a race, legacy lead matching, batched history import, encrypted session round-trip, lease exclusivity).
- End-to-end plumbing was verified on the emulator: Connect command → service → status/heartbeat → popup; outbox → clear failure while disconnected; Disconnect releases the lease.
- **Not verified here:** an actual QR scan and live WhatsApp traffic. The build sandbox blocks WhatsApp's servers, so do this once after deploying.
