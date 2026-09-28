# Phase 3 audit — before the business-management build-out

Audit of the existing portal (branch `claude/beautiful-pascal-bjh0ug`, commit `5c1affe`) done
*before* writing any new code, so the new features extend what is there instead of duplicating it.

## 1. Architecture as built

| Layer | What exists |
|---|---|
| App | React 18 + Vite + TypeScript, no router (tab state + `navigation.ts` event bus) |
| Data | Firestore `users/{ws}/{collection}/{id}`; settings in one doc `users/{ws}/meta/settings` |
| Load | `loadAllData()` reads **every doc of all 15 collections into memory** on login; `leads`, `assignments`, `queries` also live via `onSnapshot` |
| Auth | `AuthContext` → `roles/{uid}` (role + per-user permission array); no auto-role |
| Rules | `firestore.rules` generated from `src/lib/permission-presets.json` (`npm run rules:generate`), 30 permissions, generic `users/{ws}/{col}/{id}` matcher driven by `collectionRead` / `collectionWrite` maps |
| WhatsApp | Chrome extension (v1.1, fast + screen mode) and an optional always-on server (`whatsapp-service/`) |
| AI | Rule-based: `insights.ts` (business level), `moduleInsights.ts` (per module), `growthTasks.ts` |
| Reports | `exportUtils.ts` — one branded letterhead, print + PNG/JPG from the same page |

## 2. What already covers the new spec (do **not** rebuild)

| Requirement | Already exists |
|---|---|
| Services & categories | `src/lib/catalog.ts` + `settings.services`, editable in Settings → Services |
| Invoice core | number, items, service per item, discount, tax, paid, due date, payment method, category, terms, verify QR |
| Payments → accounting | `postPayment()` writes an `accounting` IN row + wallet |
| Leads CRM | lead fields, statuses, WhatsApp link, chat capture, keyword classifier |
| AI analysis | per-module insights + Growth Tasks with Complete / delete |
| Reports | daily/weekly/monthly/custom in `ReportsTab`, branded export everywhere |
| Ledger | `khata` (lena/dena), `wallets`, `walletTransfers` |
| Audit trail | `auditLogs` + `AuditLog.tsx` |

## 3. Gaps the new spec needs

1. **Service model is thin** — no package, duration, setup+monthly pricing, or active/inactive; category groups (Software Development / Digital Marketing / Creative / Development) do not exist.
2. **No business vs personal expense split.** `accounting` has one flat category list that *mixes* both ("Office Expense" next to "Meal / Dinner"), so net saving cannot be computed per the spec.
3. **Financial rules are duplicated and inconsistent** — income is "all IN except Account Adjustment" in `insights.ts`, `DashboardTab` and the Budget header, but **only `category === "Invoice Paid"`** in the Budget savings history. Same data, two different answers. Must become one shared rule.
4. **No invoice period** — no start/end date, no package duration, no renewal or expiry tracking.
5. **Payments are partial** — one `paidAmount` + a `payments` array written only on create; no "Record payment" history on every invoice, no reference field.
6. **No monthly targets**, no target breakdown by service, no daily/weekly required run-rate.
7. **No monthly closing, no archive, no administrator history.** This is the largest new module and nothing exists for it.
8. **Leads:** no date filters, no selection / bulk delete, no message centre, no per-lead history timeline.
9. **Schedule is manual only** — no AI parsing of free text into a task.
10. **Performance risk:** `loadAllData` has no pagination. Archive data must therefore live in collections that are **not** part of `ALL_COLLECTIONS`, or every login gets slower forever.

## 4. Duplication risks (decisions taken)

| Temptation | Decision |
|---|---|
| A new services module | Extend `catalog.ts` + `settings.services`; old services keep working via a migration read |
| A second AI engine | Extend `insights.ts` / `moduleInsights.ts`; targets and closing feed the same engine |
| A second WhatsApp sender | Reuse `waExt` (extension) — the message centre queues through it |
| A new schedule store | Extend the existing `schedule` collection with AI-suggested rows |
| A new client ledger store | Derive the ledger from `invoices` + `accounting` + `khata` |
| Deleting rows on month close | Never delete: stamp `archivedMonth` and archive a snapshot; only an administrator deletes |

## 5. Build order (user's stated priority)

Data accuracy → financial accuracy → existing-feature stability → closing/archive safety → automation → AI → UI/UX → performance.

- **A** Finance rules unified, services catalog v2, expense scope, settings registries, targets, permissions + rules
- **B** Invoice periods, packages, payments, renewals, WhatsApp templates
- **C** Leads filters, bulk selection, AI categorisation, message centre
- **D** Monthly closing + administrator history
- **E** AI targets, schedule assistant, assignment suggestions
- **F** Dashboard, reports, client profile, tests, final report
