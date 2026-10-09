# WhatsApp Lead Management, Sales & CRM (extension 1.4.0)

Meta Ads / WhatsApp customers become leads **by themselves**, the sales assistants get them at once, one assistant takes each lead, and the CEO sees everything live. It runs on **WhatsApp Web + the Digital Target extension**. The WhatsApp Business API is not used.

## Flow

```
Customer (Meta ad / direct) ──▶ WhatsApp Web (computer with the extension, Fast mode)
        │ new message event
        ▼
AutoCapture (portal tab on that computer)  ──▶  planIngest()  ──▶  Firestore
   reads the chat (40 msgs) + chat info          one lead per number      users/{ws}/leads/{id}
   ad info (Click-to-WhatsApp)                   AI: HOT / WARM / COLD     users/{ws}/leadPhoneIndex/{phone}
                                                 city, business, need      users/{ws}/notifications/*
        │
        ▼ (onSnapshot, no refresh)
Sales tab of every assistant / CEO  ──▶  🔔 + desktop notification "New WhatsApp Lead Received"
        │
        ▼
TAKE LEAD (transaction: first one wins) ──▶ ASSISTANT HANDLING, AI handoff
        │                                    (no AI reply draft, campaigns skip the number)
        ▼
Follow-up (date / time / note → reminder) → Demo scheduled → Demo completed → Quotation → WON / LOST
```

* **One lead per number.** `leadPhoneIndex/{phone}` is created in the same transaction as the lead. When two computers capture the same message, only one lead is created and only one notification goes to each person (fixed notification ids). A new message on an existing lead is added to its conversation. The lead is re-read inside a transaction first, so nothing the assistant just saved is lost.
* **The AI never moves a lead a person is working on.** After TAKE LEAD (or Assigned, Hot/Warm/Cold, Demo, Quotation, Negotiation) only the conversation, AI analysis and temperature are updated. A temperature set by hand stays (`temperatureManual`).
* **Statuses.** The old values are kept in the database and shown with the new names: `Converted` = **WON**, `Proposal` = **QUOTATION**, `Demo Given` = **DEMO COMPLETED**, `Contacted` = **CONTACTING**. The new values are `Assigned`, `AI Handling`, `Assistant Handling`, `Hot`, `Warm`, `Cold` and `Demo Scheduled`. Old leads keep working.
* **Sources.** These are Meta Ads, Facebook, Instagram, WhatsApp Direct, Website, Referral and Manual. Ad details (title, ad id, link, ctwa id) are stored in `adInfo` when WhatsApp provides them.
* **Follow-ups.** The AI only *suggests* a date (`followUpAuto`). Reminders, the *Aaj ke follow-ups* list and the KPI count only follow-ups that a person set. When a follow-up is due, the person handling the lead gets a bell and desktop notification, once.

## Who sees what

| | CEO / Admin (`leads.view`, `leads.edit`) | Sales assistant (role **Sales Assistant**: `leads.own`, `leads.take`, `products.view`, `schedule.own`) |
|---|---|---|
| Modules | everything | **Sales, Products, Schedule** only |
| Leads | all | own + unassigned pool of **their businesses** (rules enforce own + pool; the portal queries `assignedTo == me` and `assignedTo == ""`) |
| TAKE LEAD | — (assigns instead) | pool leads; refused if someone was first |
| Edit | everything | own leads only; on others' leads only the captured conversation can be written (capture) |
| Assign / reassign | yes | no |
| Schedule | all | own items only (`assignedTo == me`); demos / follow-ups of their leads appear there automatically |
| Quotations | all | own only (`teamId == me`) |
| Targets | set and see everyone's | see own only |
| Products | add / edit (`products.manage`) | view, share, quote |
| Analysis | Team A–Z, every assistant's profile, activity log | **Meri performance** (own numbers only) |
| Team records | all | own record only; can edit own phone / designation / email / photo (never pay fields) |
| Clients, projects, invoices, finance, settings, cost prices | as before | no access (the old `schedule.view` grant that exposed clients, projects and team pay is gone) |

Cost prices of catalog services (margins) are in `serviceCosts/catalog`, readable only by finance / invoice / settings roles. Before, they were inside the settings doc, which every member can read. An admin login moves old ones there automatically, once.

## Multi-business CRM

*Settings → Sales team → 🏢 Businesses*: Software and Digital Marketing to start with. You can add more later (name, icon, colour, and which catalog categories belong to it).

* Each product, lead and quotation belongs to a business. A lead's business follows its products or service line, unless someone picks it by hand in the lead.
* Assistants can be limited to businesses. They then only get those leads: pool view, notifications and round-robin.
* The business switcher (Sab / 💻 Software / 📣 Digital Marketing) filters Sales, Products and each member profile.

## Products, value, quotations

* **Products** tab: the catalog is shown as cards with logo or icon, price, features, description and demo link. *Catalog se import* turns the invoice catalog into products. A product's price stays in step with its linked invoice service.
* **📤 WhatsApp share**: a message with name, features, price and demo, plus an optional branded product card (PNG). It goes straight into the customer's chat through the extension, or through wa.me, download or share.
* **Lead value** is never the customer's budget. In order, it is:
  1. the WON amount;
  2. the latest quotation;
  3. the products chosen on the lead (price × qty − discount);
  4. the starting price of the lead's service line.

  The budget is shown separately.
* **🧾 Quotation / sales card**: pick the customer, products, price, discount and sales profile. This makes a branded PNG with logo, items, total, features, a demo QR and the consultant card. *Save* numbers it (`QT-2026-0001`), keeps the record, sets the lead to QUOTATION with that value, and can send the card on WhatsApp.

## Lead history

Every lead keeps a complete timeline:
* capture and WhatsApp messages;
* **calls / WhatsApp / meetings / visits / emails / notes** logged with outcome, minutes and time;
* follow-ups, demo, quotations, status changes, TAKE and assign.

Each entry records who did it. Entries an administrator adds are marked 🛡 Admin. Filters show calls, WhatsApp, follow-ups, demo, quotations, status, notes, admin or AI. Up to 500 entries are kept; automatic AI notes are trimmed to the latest 30.

## Team management

* **Sales → 📊 Team A–Z** (CEO): one row per assistant for the month. It shows leads, contacted, demos, quotations, won, revenue, conversion and close rate, pipeline, follow-ups (late), activities and target %. Click a column to sort.
* Click a name, or *Team → 📊 Sales*, to open that assistant on their own page:
  * overview (KPIs, target meters, 14-day activity);
  * leads, chats, activities;
  * sales and quotations;
  * target (set by the CEO), schedule;
  * profile (shown on quotation cards).
* An assistant sees the same page for themselves as **📈 Meri performance**.
* **My Portal** is hidden for the administrator and managers. It stays only for the production team (designers / editors: own tasks, payouts, queries).

## Setup (once)

1. **Deploy `firestore.rules` and `storage.rules`** (leads, `salesState`, `products`, `quotations`, `salesTargets`, `serviceCosts`, own schedule / team record). See `docs/DEPLOYMENT.md`. Existing Sales Assistant logins pick up the new rights automatically (role preset).
2. **Extension 1.4.0** on the computer that keeps WhatsApp Web open: `chrome://extensions` → remove the old one → *Load unpacked* (or the new zip) → open WhatsApp Web once. **Fast mode** is needed for automatic capture. In Screen mode, use the *Capture* button.
3. **Users:** *Settings → User Management*. For each assistant, create a login with the role **Sales Assistant** and 🔗 link it to a Team member.
4. **Settings → 🧲 Sales team**:
   * choose the assistants;
   * pick the mode: **Pool** (everyone is notified, first TAKE wins), **Round-robin** (auto-assign in turn), or **Manual** (CEO assigns);
   * tick who else is notified (CEO);
   * keep *auto-capture* on.
5. On every computer, allow browser notifications (🔔 → *Browser notifications on karein*).

## Future: WhatsApp Business API

`src/lib/leadIngest.ts` is channel-agnostic. `planIngest(conversation, existingLead, ctx)` takes `{ channel, phone, name, messages[], ad }` and returns create / update / skip. A Cloud API webhook (for example, a Cloud Function) can map the webhook payload to that shape. It would then call the same function with the Admin SDK and write the lead, the phone index and the notifications, the way `src/lib/salesStore.ts#ingestConversation` does in the browser. The CRM, rules and UI do not change. Use `channel: "wa-cloud-api"`.

## Tests

* Unit: `src/lib/__tests__/sales.test.ts` covers the pipeline, take, follow-ups, KPIs, ingest, dedupe and handoff.
* Rules: `tests/rules/firestore.rules.test.ts`, section *sales assistants*. It covers visibility, TAKE LEAD race, capture write-only, and CEO reassign.
* E2E (emulators + Playwright, CEO + 2 assistants) covers the full flow in one run: Meta-ad message, live lead in under 2 s, notifications, simultaneous TAKE (one wins), handoff, new message, due follow-up, demo, quotation, WON, a second lead LOST, no duplicate, privacy, KPIs and activity.
* CRM update:
  * Unit tests: `src/lib/__tests__/crm.test.ts` cover businesses, product prices, lead value, quotations, history, analytics and cost split.
  * Rules: section *sales assistants: only their own data outside leads*.
  * E2E (admin + assistant): cost migration, My Portal hidden, business units, product import / edit / share card, value from products (budget apart), call log with outcome, quotation PNG numbered and downloaded, follow-up → own schedule, WON amount, Meri performance, own profile, Team A–Z, member profile and target, admin-marked activity.
