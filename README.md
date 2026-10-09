# Digital Target — Management Portal

React + Vite + TypeScript portal on Firebase (Auth, Firestore, Storage), plus a
small Node service that links the business WhatsApp number (QR / linked device).

| Doc | |
|---|---|
| [docs/AUDIT_REPORT.md](docs/AUDIT_REPORT.md) | Phase 1 audit of the original system |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | **Deploy order**, rules, account clean-up, rollback |
| [docs/WHATSAPP.md](docs/WHATSAPP.md) | WhatsApp link: risks, how it works, service deploy, troubleshooting |
| [docs/SALES_SYSTEM.md](docs/SALES_SYSTEM.md) | WhatsApp leads → Sales / CRM: auto-capture, TAKE LEAD, permissions, businesses, products, quotations, team A–Z, setup |

## Architecture

```
Browser (portal)  ──Firebase SDK──▶  Firestore / Storage  ◀──Admin SDK──  whatsapp-service (Docker)
   │  permissions checked in UI         ▲ firestore.rules /                   │ Baileys socket
   │  and enforced by rules ────────────┘ storage.rules                       ▼
                                                                         WhatsApp (0345-1873354)
```

- **Permissions**: `src/lib/permission-presets.json` is the single source for roles, the checkbox permissions,
  and which permission reads/writes each collection. `npm run rules:generate` writes the same data into
  `firestore.rules` / `storage.rules`. `npm run rules:check` fails if they drift.
- **Data**: unchanged layout `users/{workspaceUid}/{collection}/{id}`, loaded per permission
  (My Portal users only load their own records). Live updates for leads, assignments, queries,
  WhatsApp and notifications.
- **Audit log**: every create/update/delete from the portal, user/permission changes and WhatsApp sends
  (`users/{ws}/auditLogs`, append-only).

## Commands

```bash
npm install
npm run dev              # portal on :8080
npm run build
npm test                 # portal unit tests
npm run test:rules       # security rules on the Firebase emulator (needs Java)
npm run rules:generate   # after editing permission-presets.json

cd whatsapp-service && npm install
npm test                 # service unit tests
npm run test:integration # service tests on the Firestore emulator
npm run dev              # run the service locally (see .env.example)
```

## Status

**Done (increment 3):** invoice QR opens a public verified slip (/verify/{token}); Budget & Growth with automatic
business analysis (health score, forecast, +15% target, leads needed, insights and action plan); Clients rebuilt
(search, edit, profile with invoices / projects / leads); consistent module styling; one-click WhatsApp Web.

**Done (increment 2):** Digital Target branding (logo mark, purple theme, new sidebar/topbar shell,
login, mobile drawer); invoices redesigned end to end (numbering, discount, tax, payment method, terms, branded
A4 + POS templates, PDF download, record-payment dialog); WhatsApp photo/document sending, call log, daily stats
and the Performance page.

**Done (increment 1):** audit; security foundation (no public sign-up, role presets + per-user permission
checkboxes, database-enforced access, disabled accounts, secure user creation, XSS fix); audit log;
WhatsApp QR connect popup, capture service, inbox, automatic lead capture with dedup, notifications;
bug fixes listed in the commit history.

**Next phases (planned):**
1. Full Leads CRM (timeline, configurable statuses/sources, tags, value, priority) + lead analytics per member
3. Unified tasks + Graphic Design / Video Editing workflows (revisions, files, approvals)
4. Campaigns / Ads with cost, CPL and attribution; client profile with full history
6. Reports (CSV / Excel / PDF), global search, router + UI redesign, soft delete everywhere

## Latest increment — WhatsApp Web inside the portal, AI growth analysis, branded reports
- **WhatsApp Web inside the portal** (no server): `chrome-extension/` + WhatsApp tab → WhatsApp Web. See `docs/WHATSAPP.md`.
- **AI Growth Analysis** on every module (Dashboard, Leads, WhatsApp, Clients, Projects, Assignments, Invoices, Accounting, Team). It is rule-based, runs in the browser (`src/lib/moduleInsights.ts`), and each point has an action you can turn into a task with **＋ Task**.
- **Growth Tasks** (Dashboard): *AI se is hafte ka plan banayein* collects the urgent actions from all modules into a to-do list with due dates and weekly progress. Tasks are stored in `settings.growthTasks`.
- **Branded reports:** every report opens on the Digital Target letterhead (logo, company details, footer). It has **Print / Save PDF, PNG and JPG** buttons, and the image is taken from the same page that prints. The PNG/JPG buttons in the tabs render the same letterhead.
- **New POS receipt:** logo, services line, invoice/receipt band, items, boxed total, payment method, status, verify QR. The PNG matches the print.
