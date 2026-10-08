# WhatsApp Lead Management & Sales (extension 1.4.0)

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

| | CEO / Admin (`leads.view`, `leads.edit`) | Sales assistant (role **Sales Assistant**: `leads.own`, `leads.take`) |
|---|---|---|
| Leads | all | own + unassigned pool only (rules enforce it; the portal queries `assignedTo == me` and `assignedTo == ""`) |
| TAKE LEAD | — (assigns instead) | pool leads; refused if someone was first |
| Edit | everything | own leads only; on others' leads only the captured conversation can be written (capture) |
| Assign / reassign | yes | no |
| Dashboard | today's numbers for everyone, team performance, activity log | own numbers |
| Invoices, accounts, settings… | as before | hidden (no permission) |

## Setup (once)

1. **Deploy `firestore.rules`** (new leads rules + `salesState`). See `docs/DEPLOYMENT.md`.
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
