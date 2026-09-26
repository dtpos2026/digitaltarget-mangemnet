# Deployment Guide (Increment 1: Security + WhatsApp)

Backend stays on the existing Firebase project **digital-target007**. No data
migration is needed. Existing collections are unchanged; new collections are
added alongside them.

## ⚠️ Order matters

The new portal **requires** the new security rules, and the new rules
**block the old portal's sign-up path**. Deploy in this order, on a quiet day.

### 1. Review existing accounts (before anything else)

The old app auto-created an `assistant` account for **anyone** who signed up
(audit bug B2). In Firebase Console → Firestore → `roles`, check every document:

- Unknown email with role `assistant` → after step 4, disable it from *Settings → Users*. For now, note it down.
- Every legitimate user must have `workspaceUid` = the admin's uid (the old app already backfilled this).

### 2. Deploy rules and indexes

```bash
npm install
npm run rules:check                     # rules match src/lib/permission-presets.json
npm run test:rules                      # optional, needs Java: 26 rule tests on the emulator
npx firebase login
npx firebase deploy --only firestore:rules,firestore:indexes,storage --project digital-target007
```

Firebase Console → Storage must be enabled (the bucket already exists in the config).

### 3. Deploy the portal

Wherever it is hosted now (Lovable) **or** Firebase Hosting:

```bash
npm run build
npx firebase deploy --only hosting --project digital-target007   # optional, if moving off Lovable
```

No environment variables are required; `.env.example` lists optional overrides.

### 4. First login and user clean-up

1. The admin logs in → *Settings → Users, Roles & Permissions*.
2. Disable unknown accounts from step 1.
3. Check every user's role and permissions (checkboxes). Existing users keep their old access through role presets:

| Old role | Now sees |
|---|---|
| admin | everything (unchanged) |
| manager | everything except Users/Permissions and Audit Log (the admin can tick these) |
| accountant | unchanged (Dashboard, Invoices, Accounting, Khata, Accounts, Reports, Budget) |
| lead_manager | Leads, Schedule, Queries **+ WhatsApp** |
| assistant | Leads, Schedule (unchanged) |
| team_member | My Portal (unchanged), now limited to their **own** records at database level |

4. Link designers, editors and employees to their Team record so My Portal shows their work.

### 5. WhatsApp service

Follow [WHATSAPP.md](./WHATSAPP.md). Then open the WhatsApp tab → **Connect WhatsApp** → scan with 0345-1873354.

## Rollback

- Portal: redeploy the previous build.
- Rules: Firebase Console → Firestore → Rules → *History* → restore the previous version.

The old portal works with the old rules. New data (conversations, audit logs) is harmless to it.

## New Firestore collections

| Path | Written by | Purpose |
|---|---|---|
| `roles/{uid}` (+`permissions[]`, `disabled`, `displayName`) | admin | accounts and permissions |
| `users/{ws}/auditLogs` | portal + service | append-only activity log |
| `users/{ws}/notifications` | service / portal | per-user in-app notifications |
| `users/{ws}/waAccounts` | admin (commands, settings) + service (status/QR) | WhatsApp connection |
| `users/{ws}/waConversations/{id}/messages` | service | chats and messages |
| `users/{ws}/waOutbox` | portal | replies queued for sending |
| `users/{ws}/leadPhoneIndex/{phone}` | service | lead dedup index |
| `waSessions/**`, `waLeases/**` | service only | encrypted session and single-instance lock |

## Backups

Enable Firestore **Point-in-time recovery** and a **scheduled daily export** in
Google Cloud Console (Firestore → Disaster recovery). This replaces the manual
JSON *Backup* button as the real safety net. The button still works for admins
with the "Backup / Restore / Reset" permission.
