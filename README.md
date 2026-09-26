# Digital Target — Management Portal

React + Vite + TypeScript portal on Firebase (Auth, Firestore, Storage), plus a
small Node service that links the business WhatsApp number (QR / linked device).

| Doc | |
|---|---|
| [docs/AUDIT_REPORT.md](docs/AUDIT_REPORT.md) | Phase 1 audit of the original system |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | **Deploy order**, rules, account clean-up, rollback |
| [docs/WHATSAPP.md](docs/WHATSAPP.md) | WhatsApp link: risks, how it works, service deploy, troubleshooting |

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
