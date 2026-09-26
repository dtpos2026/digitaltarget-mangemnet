# Digital Target Portal — Phase 1 Audit Report

**Source:** `digital-target-final.zip` (Lovable export) · **Audit date:** 2026-09-26
**Scope:** 5,465 lines of app code (`src/pages`, `src/contexts`, `src/lib`, `src/components/tabs`, `src/components/app`) plus shadcn UI boilerplate.

> اس phase میں code میں کوئی تبدیلی نہیں کی گئی۔ Original source بغیر modification کے commit `12b3f97` میں ہے۔

---

## 0. خلاصہ (Executive Summary)

- یہ ایک **single-page React + Vite + TypeScript** app ہے جو Lovable سے بنی ہے۔ Backend صرف **Firebase** ہے (Auth + Firestore)۔ کوئی server، Cloud Function، webhook، cron یا API موجود نہیں۔
- App اصل میں ایک **finance / agency-operations tool** ہے (Invoices, Accounting, Khata, Wallets, Budget, Team payouts)۔ Leads module بنیادی ہے، اور WhatsApp صرف `wa.me` links تک محدود ہے۔
- **Security سب سے بڑا مسئلہ ہے:** roles اور permissions صرف frontend میں check ہوتے ہیں۔ Repo میں Firestore Security Rules موجود نہیں۔ کوئی بھی شخص Sign Up کر کے خودکار طور پر business data تک رسائی لے سکتا ہے (تفصیل §13)۔
- Build پاس ہوتی ہے (`vite build` ✓، `tsc` ✓)۔ ESLint میں 156 errors ہیں (زیادہ تر `any`)۔ Tests صرف ایک placeholder test ہے۔
- **سفارش:** Business logic (invoice/ledger calculations، invoice templates، assignment forms) محفوظ رکھیں۔ Data layer، auth/RBAC اور UI shell refactor کریں۔ WhatsApp، Campaigns، Notifications، Audit log اور Analytics نئے سرے سے بنائیں۔ Relational requirements کی وجہ سے **Supabase (Postgres + RLS)** پر phased migration تجویز ہے (§21)۔

---

## 1. موجودہ Modules

| # | Module (Tab) | File | Lines | کیا کرتا ہے |
|---|---|---|---|---|
| 1 | Login / Sign-up | `pages/Login.tsx` | 76 | Email/password login اور کھلا sign-up |
| 2 | Dashboard | `tabs/DashboardTab.tsx` | 352 | Finance KPIs (income/expense/profit/receivables/payouts)، canvas charts، آج کا schedule، pending payments، PDF/PNG export |
| 3 | Clients | `tabs/ClientsTab.tsx` | 68 | Name/phone/ref/status۔ صرف add اور delete (edit نہیں) |
| 4 | Projects | `tabs/ProjectsTab.tsx` | 225 | Client projects، calendar اور timeline view، late detection |
| 5 | Assignments | `tabs/AssignmentsTab.tsx` | 232 | Team member کو کام دینا (category: Video Editing / Graphic Design / Reels…)، deadline، rate، drive link، T&C، PNG "Work Assignment Form" |
| 6 | Invoices | `tabs/InvoicesTab.tsx` | 651 | Line items، Paid/Partial/Unpaid، wallet posting، project auto-create، A4 اور 80mm POS templates، QR، signature، bank QR، WhatsApp share/reminder |
| 7 | Accounting | `tabs/AccountingTab.tsx` | 219 | IN/OUT ledger، categories، wallet balance adjust، print |
| 8 | Khata | `tabs/KhataTab.tsx` | 218 | لینا/دینا ledger، partial payments، invoices سے sync |
| 9 | Accounts | `tabs/AccountsTab.tsx` | 154 | Wallets (Cash/Bank…)، balance adjust، transfers |
| 10 | Team | `tabs/TeamTab.tsx` | 565 | Team records، rate/paid، work logs، rating، payouts، experience certificate، profile print |
| 11 | Schedule | `tabs/ScheduleTab.tsx` | 267 | Daily tasks/meetings، assignment، priority، branded sheet اور thermal print |
| 12 | Reports | `tabs/ReportsTab.tsx` | 157 | Accounting report (daily/range/client)، CSV، master summary print |
| 13 | Leads | `tabs/LeadsTab.tsx` | 277 | Lead form، category/service/source/status، filters، → Client، WhatsApp link، PDF/PNG |
| 14 | Budget | `tabs/BudgetTab.tsx` | 297 | Expense category budgets، suggestions، monthly savings |
| 15 | Queries | `tabs/QueriesTab.tsx` | 71 | Team → management ticket inbox (realtime) |
| 16 | My Portal | `tabs/MyPortalTab.tsx` | 292 | Team member workspace: assigned work + chat، schedule، payouts، logs، queries |
| 17 | Settings + Users | `tabs/SettingsTab.tsx`, `UserManagement.tsx` | 82 + 185 | Logo/signature/bank QR، footer، user creation اور role change |
| 18 | Topbar | `components/app/Topbar.tsx` | 128 | Theme toggle، JSON Backup/Restore، Reset (`prompt()` کے ذریعے) |

Navigation میں router استعمال نہیں ہوتا۔ `MainApp.tsx` میں `activeTab` state اور `switch` ہے، اس لیے کسی module کا URL نہیں بنتا اور browser back button کام نہیں کرتا۔

## 2. مکمل (Working) Modules

یہ modules اپنے موجودہ دائرے میں کام کرتے ہیں:

- **Invoices:** A4 اور POS templates، QR، signature، WhatsApp share، partial payments اور wallet posting۔
- **Accounting، Khata، Accounts، Budget:** Ledger، wallets اور transfers۔
- **Assignments + My Portal + Queries:** Team work assignment اور per-task chat۔ یہ realtime ہیں کیونکہ صرف `assignments` اور `queries` پر `onSnapshot` لگا ہے۔
- **Team:** Payouts، certificates اور profile۔
- **Schedule اور Projects**۔

## 3. Partially Implemented

| Module | کیا موجود ہے | کیا کمی ہے |
|---|---|---|
| Leads | بنیادی fields، status، source، filters | Lead ID display، email، company، city، campaign/ad، assignee، priority، estimated value، tags، timeline/history، next follow-up logic، dedup |
| Dashboard | Finance KPIs | Lead KPIs، funnel، trends، team performance، campaign charts، date filters |
| Clients | Name، phone، status | Edit، email، address، services، client profile page، linked history |
| Team/Roles | 6 fixed roles | Granular permissions، custom roles، departments، designer/editor roles |
| Tasks | Assignments + Schedule + teamLogs (تین الگ جگہیں) | ایک unified task model، comments، attachments، activity history، overdue alerts |
| Design/Video | Assignment categories | Dedicated status flow (Review/Revision/Approved)، revision count، reference/raw/final files |
| Reports | Accounting CSV، print-to-PDF | Leads/Conversion/Team/WhatsApp/Campaign reports، Excel، اصل PDF generation |
| Settings | Logo، signature، footer | Lead statuses/sources، task statuses، tax، invoice numbering، integrations |
| Backup | Manual JSON download | Scheduled server-side backups، soft delete، restore |

## 4. Missing Functionality

WhatsApp Cloud API integration، WhatsApp inbox، automatic lead capture، lead deduplication، lead assignment اور round-robin، lead analytics (first response time وغیرہ)، campaigns/ads module، cost per lead اور attribution، notifications (in-app اور browser)، global search، granular permissions، audit log، soft delete، file storage (فی الحال base64 استعمال ہوتا ہے)، invoice tax/discount، invoice numbering sequence، Excel export، server-side APIs، webhooks، cron jobs، اور routing۔

## 5. Bugs اور Technical Issues

### Critical / High

| # | مسئلہ | جگہ | اثر |
|---|---|---|---|
| B1 | **ہٹایا گیا user واپس access حاصل کر لیتا ہے۔** "Remove" صرف `roles/{uid}` delete کرتا ہے۔ اگلے login پر `fetchOrCreateRole` نیا `assistant` role بنا دیتا ہے۔ | `UserManagement.tsx:78`, `AuthContext.tsx:77-101` | سابق ملازم کو Leads اور Schedule تک دوبارہ رسائی مل جاتی ہے |
| B2 | **کھلا Sign-Up:** Login page پر کوئی بھی account بنا سکتا ہے، اور اسے خود بخود admin کے workspace میں `assistant` role مل جاتا ہے | `Login.tsx:66`, `AuthContext.tsx:91-99` | کوئی بھی اجنبی تمام leads پڑھ اور بدل سکتا ہے |
| B3 | **Invoice پر signature یا bank QR upload کرنے سے app crash ہوتی ہے۔** `updateItem("settings", …)` settings object کو array سمجھ کر `.map()` چلاتا ہے، اور Firestore میں `settings/{random}` نام کا junk doc بنتا ہے۔ Default signature بھی save نہیں ہوتا۔ | `InvoicesTab.tsx:84-85`, `DataContext.tsx:85` | White screen آتی ہے اور default signature save نہیں ہوتا |
| B4 | **Team member کے browser میں پورا workspace load ہوتا ہے:** تمام invoices، accounting، wallets، leads اور clients۔ صرف UI tabs چھپائے جاتے ہیں۔ | `DataContext.tsx:40-46`, `db.ts:192` | DevTools سے تمام financial data دیکھا جا سکتا ہے |
| B5 | **User بنانے پر admin logout ہو جاتا ہے** (client-side `createUserWithEmailAndPassword`)۔ نئے user کا role doc نیا user خود لکھتا ہے، اس لیے Rules کو self-write کی اجازت دینی پڑتی ہے، جس سے privilege escalation ممکن ہو جاتی ہے۔ ساتھ ہی race condition ہے: `onAuthStateChanged` پہلے `assistant` doc بنا دیتا ہے۔ | `AuthContext.tsx:141-159` | Security اور UX دونوں متاثر |
| B6 | **Stored XSS:** User input (lead name، client name، notes، assignment description) بغیر escaping کے `document.write` / `dangerouslySetInnerHTML` میں جاتا ہے۔ `window.open("")` والی window same-origin ہوتی ہے۔ | `AssignmentsTab.tsx:487`، تمام `print*` / `export*PDF` functions، `AccountingTab.tsx:206` | ایک lead name میں script ڈال کر admin کا Firebase session چرایا جا سکتا ہے |
| B7 | **Lost updates / race conditions:** Wallet balance read-modify-write کے ذریعے client میں calculate ہوتا ہے، اور `updateItem` پورا doc overwrite کرتا ہے۔ صرف 2 collections realtime ہیں، باقی stale رہتی ہیں۔ | `AccountingTab`, `InvoicesTab`, `AccountsTab`, `TeamTab` | دو users ساتھ کام کریں تو balances غلط ہو جاتے ہیں |
| B8 | **Ledger drift:** Invoice edit یا delete ہونے پر متعلقہ accounting entry اور wallet balance reverse نہیں ہوتے | `InvoicesTab.tsx:46-69, 635` | Accounts غلط ہو جاتے ہیں |
| B9 | **Firestore 1 MB document limit:** Logo، signature اور bank QR base64 کی شکل میں settings **اور ہر invoice** میں copy ہوتے ہیں | `InvoicesTab.tsx:115`, `SettingsTab.tsx:21-23` | بڑی image پر save fail ہو گا اور ہر load پر اضافی MBs آئیں گے |

### Medium / Low

- Lead edit کرنے پر `date` آج کی تاریخ سے overwrite ہو جاتی ہے، یعنی creation date ضائع ہو جاتی ہے (`LeadsTab.tsx:48`)۔
- Lead کا "Status" button statuses میں cycle کرتا ہے۔ غلطی سے ایک click پر status "Converted" یا "Lost" ہو سکتا ہے (`LeadsTab.tsx:71`)۔
- Lead → Client conversion میں dedup صرف `phone && name` کے match پر ہوتا ہے، اور lead اور client کے درمیان کوئی link محفوظ نہیں ہوتا (`LeadsTab.tsx:76`)۔
- Legacy backfill کی logic غلط ہے: `data.role === "admin" ? uid : uid` کی وجہ سے non-admin کو اپنا خالی workspace مل جاتا ہے (`AuthContext.tsx:71`)۔
- Dashboard کی "Total Income" صرف `Invoice Paid` category گنتی ہے۔ Manual IN entries شامل نہیں ہوتیں (`DashboardTab.tsx:123`)۔
- Reset کا cutoff UTC `toISOString()` سے بنتا ہے جبکہ باقی dates local ہیں۔ Full reset client میں ایک ایک doc delete کرتا ہے اور کوئی undo نہیں۔
- Mark Paid میں wallet کا نام `prompt()` میں exact type کرنا پڑتا ہے۔ UX کمزور ہے اور typo کا خطرہ ہے۔
- `QueriesTab.tsx:55-57` میں dead code ہے۔ `Index.tsx`، `NotFound.tsx`، `NavLink.tsx`، تقریباً تمام shadcn `components/ui/*`، react-query، recharts، zod، react-hook-form، sonner اور next-themes installed ہیں مگر استعمال نہیں ہوتے۔
- `package-lock.json` اور `package.json` sync میں نہیں (`npm ci` fail ہوتا ہے: firebase اور testing-library کی versions lock file میں missing ہیں)۔ Repo میں `bun.lock` بھی ہے، یعنی دو package managers۔
- Bundle ایک ہی 1.24 MB JS chunk ہے۔ Code-splitting نہیں۔
- کوئی Error Boundary نہیں، اس لیے ایک error پر پوری app سفید ہو جاتی ہے۔
- `alert()`، `confirm()` اور `prompt()` ہر جگہ استعمال ہوتے ہیں۔ Mobile پر UX خراب ہے۔
- TypeScript `strict: false` ہے اور تمام data `any` ہے۔

## 6. Database: کہاں اور کیسے

**Firebase project:** `digital-target007` (Firestore)

```
roles/{uid}                          → { uid, email, role, workspaceUid, teamId?, createdAt }
users/{workspaceUid}/meta/settings   → { logo{name,data(base64)}, signature, bankQR, phone, exportName, footer, authorizedName, authorizedDesignation }
users/{workspaceUid}/{collection}/{id}
    collection ∈ clients, projects, invoices, accounting, khata, wallets, walletTransfers,
                 team, teamLogs, payouts, schedule, leads, budgets, assignments, queries
```

- `workspaceUid` = پہلے admin کا UID۔ تمام users ایک ہی data tree share کرتے ہیں (single-tenant)۔
- Startup پر `loadAllData` تمام 15 collections مکمل پڑھتا ہے۔ کوئی pagination، query، index یا filter نہیں۔
- Realtime (`onSnapshot`) صرف `assignments` اور `queries` پر ہے۔
- IDs client میں بنتی ہیں: `PREFIX-<base36 time>-<random>` (مثلاً `INV-…`, `LD-…`, `C-…`)۔
- Relations کے لیے string foreign keys ہیں (`clientId`, `projectId`, `memberId`, `walletId`)۔ Referential integrity نہیں۔
- Chat messages parent doc کے اندر array کی شکل میں ہیں (`assignments.messages[]`, `queries.messages[]`)۔ یہ unbounded ہیں اور 1 MB limit کا خطرہ ہے۔
- Files Firebase Storage کے بجائے base64 کی شکل میں Firestore docs کے اندر رکھی جاتی ہیں۔

## 7. Authentication

- Firebase Auth، صرف Email/Password۔ Password reset، email verification، MFA یا session management نہیں۔
- `onAuthStateChanged` کے بعد `roles/{uid}` پڑھا جاتا ہے۔ اگر doc نہ ملے تو نیا بنا دیا جاتا ہے: پہلا user admin بنتا ہے، باقی سب assistant (یہی B1 اور B2 کی وجہ ہے)۔
- Admin user بنائے تو خود logout ہو جاتا ہے (B5)۔
- Logout: `signOut(auth)`۔

## 8. Roles اور Permissions

`AuthContext.tsx` میں 6 hard-coded roles ہیں: `admin, manager, accountant, lead_manager, assistant, team_member`۔ `MainApp.tsx:45-52` میں `ROLE_TABS` طے کرتا ہے کہ کون سا tab نظر آئے:

| Role | Tabs |
|---|---|
| admin | سب |
| manager | سب (Settings اور User Management سمیت، اگرچہ label کہتا ہے "except role mgmt") |
| accountant | Dashboard, Invoices, Accounting, Khata, Accounts, Reports, Budget |
| lead_manager | Leads, Schedule, Queries |
| assistant | Leads, Schedule |
| team_member | My Portal |

- **Enforcement صرف UI میں ہے۔** Firestore Rules repo میں نہیں ہیں، اور code کے مطابق rules لازماً "ہر signed-in user workspace پڑھ/لکھ سکے" جیسے ہوں گے۔ ورنہ team member کا `loadAllData` اور self-role-write کام نہ کرتے۔
- Granular permissions (view/create/edit/delete)، custom roles یا per-user overrides موجود نہیں۔
- **Action required:** Firebase Console → Firestore → Rules کی موجودہ copy فراہم کریں تاکہ اصل exposure verify ہو سکے۔

## 9. APIs / Webhooks / Cron

**کوئی نہیں۔** Server code، Cloud Functions، REST endpoints، webhooks یا scheduled jobs موجود نہیں۔ تمام logic browser میں چلتی ہے۔ صرف یہ external calls ہیں: Firebase SDK، Google Fonts، اور `wa.me` / Google Drive links۔

## 10. WhatsApp Integration

**Official integration موجود نہیں۔** صرف click-to-chat ہے: `window.open("https://wa.me/<phone>?text=…")`۔ یہ 4 جگہ استعمال ہوتا ہے: Lead follow-up، Invoice share، Payment reminder اور Payment received۔ Incoming messages capture نہیں ہوتے، inbox یا session نہیں ہے۔ `qrcode` library صرف invoice QR کے لیے ہے۔

## 11. Backend: Firebase / Supabase؟

**صرف Firebase** (Auth + Firestore)۔ Analytics کا `measurementId` config میں ہے مگر Analytics initialize نہیں ہوتی۔ Firebase Storage، Functions یا Hosting استعمال نہیں ہوتے۔ Supabase کا کوئی نشان نہیں۔

## 12. Hosting / Deployment

- Lovable project ہے (`lovable-tagger`، README "Welcome to your Lovable project"، `index.html` میں Lovable کی og:image اور twitter tags)۔ غالب امکان ہے کہ Lovable کی hosting پر deployed ہے۔
- Repo میں `firebase.json`، `vercel.json`، `netlify.toml`، Dockerfile یا CI موجود نہیں۔
- Build: `vite build` → `dist/` (static SPA)۔ Environment variables استعمال نہیں ہوتے۔ Firebase config `src/lib/firebase.ts` میں hard-coded ہے۔
- ZIP میں `.workspace/.git/config` تھی جس میں Lovable git remote کا access token (JWT) موجود تھا۔ اسے repo میں commit **نہیں** کیا گیا۔ Token کی expiry جون 2026 ہے، پھر بھی Lovable میں اسے revoke کر دیں۔

## 13. Security Vulnerabilities (ترتیب: شدت کے لحاظ سے)

1. **Broken access control:** B1، B2، B4 اور B5۔ کوئی بھی sign up کر کے data پڑھ سکتا ہے، اور ہٹائے گئے users واپس آ جاتے ہیں۔ Rules repo میں نہیں۔
2. **Stored XSS** print/export HTML کے ذریعے (B6)، جس سے session token چوری ہو سکتا ہے۔
3. **Client-side financial logic:** Balances client میں calculate ہوتے ہیں۔ کوئی بھی writer کسی wallet کا balance سیدھا بدل سکتا ہے۔ Server-side validation نہیں۔
4. **Audit trail نہیں:** کسی نے کیا بدلا، اس کا کوئی ریکارڈ نہیں۔ Hard delete ہوتا ہے، restore نہیں۔
5. **Input validation نہیں:** Phone، email اور amount کی validation نہیں۔ File upload پر type یا size check نہیں (`accept="image/*"` صرف hint ہے)۔
6. **Rate limiting، App Check یا password policy نہیں**۔ Password field `type="text"` ہے (`UserManagement.tsx:97`)۔
7. **Backup JSON** میں تمام data بشمول signatures ہوتا ہے، اور یہ user کے device پر رہ جاتا ہے۔
8. Firebase web `apiKey` کا frontend میں ہونا بذاتِ خود secret leak نہیں۔ اصل حفاظت Rules اور App Check سے ہوتی ہے، اور یہی دونوں غائب ہیں۔

## 14. UI/UX: ضروری بہتریاں

- **Branding:** Primary `#6366f1` (indigo)، secondary `#8b5cf6` (violet)، accent gold `#d4a853` / `#f5e6c4`، dark navy sidebar `#0c1222`، fonts Inter (body) اور Playfair Display (headings)، radius 16px۔ یہ ایک اچھی بنیاد ہے اور design system میں tokens کے طور پر رکھی جائے گی۔
- **اصل logo اور پچھلی invoices ZIP میں نہیں ہیں۔** Logo صرف Firestore settings میں base64 کی شکل میں ہے، اور UI میں fallback "DT" text ہے۔ Branding extract کرنے کے لیے logo file (SVG/PNG) اور 2 سے 3 پرانی invoices (PDF یا image) درکار ہیں۔
- Forms اور lists ایک ہی لمبے page پر ہیں۔ انہیں list، drawer یا detail pages میں تقسیم کرنا چاہیے۔
- `alert`، `prompt` اور `confirm` کی جگہ dialogs اور toasts (shadcn پہلے سے installed ہے)۔
- Mobile: Sidebar 980px سے نیچے اوپر stack ہو جاتا ہے (15 buttons)۔ اس کی جگہ drawer یا bottom-nav ہونا چاہیے۔ Tables horizontal scroll ہوتی ہیں، mobile پر card view بہتر ہو گا۔
- Routing (deep links اور back button)، global search، empty states، loading skeletons، pagination۔
- زبان mixed ہے (Roman Urdu اور English)۔ ایک consistent i18n approach طے کرنا ہو گا۔
- Dark mode موجود ہے مگر charts theme بدلنے پر دوبارہ draw نہیں ہوتے۔

## 15. کون سا Code Preserve کیا جا سکتا ہے

- **Invoice templates** (A4 اور POS VIP design)، QR payload، WhatsApp message templates: logic اور look برقرار رکھیں، صرف data source بدلیں۔
- **Finance domain rules:** Paid/Partial logic، khata sync from invoices، wallet transfers، budget suggestions اور savings calculation۔
- **Assignment form** (PNG) اور **experience certificate** templates۔
- `lib/db.ts` کے date helpers (`todayISO`, `durationText`, `humanDuration`, `isLateProject`)۔
- CSS design tokens (`index.css :root`) اور dark mode palette۔
- shadcn/ui components (installed ہیں، نئے UI میں استعمال ہوں گے)۔

## 16. کون سا Code Refactor کرنا ضروری ہے

- `DataContext` اور `lib/db.ts`: "load everything" کی جگہ per-module queries، pagination اور realtime subscriptions (react-query + typed repository layer)۔
- `AuthContext`: server-side user creation، auto-role creation ختم، permissions-based `can()` helper۔
- `MainApp`: `switch` کی جگہ `react-router` routes، lazy loading، اور permission guards۔
- تمام print/export: shared, escaped template renderer + اصل PDF generation۔
- Financial writes: atomic transactions (DB function/RPC)، invoice edit/delete پر ledger reversal۔
- Leads tab: موجودہ fields برقرار رکھتے ہوئے پورا CRM model۔

## 17. نئے سرے سے بنانا بہتر

WhatsApp integration اور Inbox، Lead capture pipeline، Campaigns/Ads اور attribution، Notifications، Audit log، Permission system (roles × permissions matrix)، unified Task engine (Design اور Video workflows اس پر)، Analytics dashboard، Global search، Reports (CSV/Excel/PDF)، Settings (configurable statuses/sources)۔

---

## Current System vs Required System

| Area | Current | Required | Gap |
|---|---|---|---|
| Backend | Firebase client-only | Secure DB + server logic + webhooks | 🔴 بڑا |
| Auth | Email/pw، کھلا sign-up | Invite-only، reset، secure admin user creation | 🔴 |
| RBAC | 6 roles، UI-only | 10+ roles، custom roles، granular checkbox permissions، DB-enforced | 🔴 |
| Admin Dashboard | Finance KPIs | Lead/team/campaign/WhatsApp KPIs، funnel، trends، date filters | 🟠 |
| Leads CRM | بنیادی form | Full CRM، timeline، assignment، dedup، tags، value | 🟠 |
| WhatsApp | `wa.me` links | Cloud API، webhook، inbox، auto lead capture | 🔴 نیا |
| Lead Analytics | کچھ نہیں | Response times، conversion ratios، per-member funnel | 🔴 نیا |
| Team Mgmt | Team records + payouts | Users + departments + performance | 🟠 |
| Team Workspace | My Portal (assignments) | My Leads/Tasks/Follow-ups/Messages/Performance | 🟠 |
| Design/Video | Assignment categories | Dedicated workflows، revisions، files | 🟠 |
| Tasks | 3 الگ جگہیں | Unified tasks، comments، attachments، history | 🟠 |
| Clients | Name/phone | Full CRM profile + history | 🟠 |
| Campaigns/Ads | Projects category "Ads Run" | Campaigns، ad sets، spend، CPL، attribution | 🔴 نیا |
| Notifications | کچھ نہیں | In-app + browser، optional email/WhatsApp | 🔴 نیا |
| Invoices | اچھے templates | + tax، discount، numbering، payment method، terms، PDF | 🟢 چھوٹا |
| Accounting/Khata/Wallets | موجود | Atomic + audited | 🟢 preserve |
| Search | Per-tab filters | Global search | 🔴 نیا |
| Reports | Accounting CSV + print | 8 reports × CSV/Excel/PDF | 🟠 |
| Audit log | کچھ نہیں | تمام اہم actions | 🔴 نیا |
| Backup/Soft delete | Manual JSON | Automated backups، soft delete، restore | 🔴 |
| Realtime | 2 collections | Messages، leads، tasks، notifications، counters | 🟠 |
| Performance | سب کچھ ایک بار load، 1.2 MB bundle | Pagination، indexes، code-split | 🟠 |
| Mobile | Basic breakpoints | Proper responsive shell | 🟠 |
| Tests | 1 placeholder | Unit + integration + RLS tests | 🔴 |

---

## 21. Database: Recommendation (Phase D کا خلاصہ)

**سفارش: Supabase (Postgres) پر phased migration۔**

**وجوہات:**
- Requirements بنیادی طور پر relational ہیں: lead → campaign → ad → client → invoice → payment، اور funnel/CPL/per-member analytics کے لیے `JOIN`، `GROUP BY` اور date ranges۔ Firestore میں یہ مہنگے یا client-side ہیں، اور یہی مسئلہ آج بھی ہے۔
- **Row Level Security** کی مدد سے permissions database level پر enforce ہوتی ہیں۔ یہ موجودہ سب سے بڑی کمزوری (B1–B5) کا براہِ راست حل ہے۔
- **Edge Functions** WhatsApp webhook اور admin user creation کے لیے، **Realtime** inbox اور notifications کے لیے، **Storage** files کے لیے (base64 کی جگہ)، اور **pg_cron** follow-up reminders کے لیے۔ یہ سب ایک platform پر ہیں۔
- Firebase پر رہ کر بھی یہ سب ممکن ہے (Cloud Functions + Rules + BigQuery)، مگر اس کے لیے Blaze plan، analytics کے لیے الگ pipeline، اور تمام existing rules نئے سرے سے لکھنے ہوں گے۔ یعنی اتنی ہی محنت، اور reporting کمزور۔

**Migration strategy (existing data destroy نہیں ہو گا):**
1. Firestore کا مکمل export (JSON) اور Admin SDK سے snapshot لیں۔ Firestore کو read-only مان کر cutover تک برقرار رکھیں۔
2. Supabase schema بنائیں: `users/profiles, roles, permissions, role_permissions, user_roles, departments, leads, lead_activities, lead_sources, lead_statuses, clients, campaigns, ad_sets, ads, whatsapp_accounts, conversations, messages, tasks (type: general|design|video), task_comments, attachments, projects, invoices, invoice_items, payments, accounting_entries, khata_entries, wallets, wallet_transfers, budgets, payouts, notifications, audit_logs, settings`۔ ہر اہم table میں `deleted_at` (soft delete) اور `created_by/updated_by` ہوں گے۔
3. Idempotent migration script لکھیں: Firestore IDs کو `legacy_id` میں رکھیں، base64 images کو Storage میں منتقل کریں، اور `teamId ↔ uid` links map کریں۔
4. Reconciliation کریں: collection کے لحاظ سے counts، اور invoice/wallet totals کا Firestore سے موازنہ۔
5. Staging پر UAT، پھر cutover۔ Firebase Auth users کو Supabase Auth میں invite/reset کے ذریعے منتقل کریں (password hashes export ممکن ہے مگر scrypt params درکار ہوں گے)۔

## 26. WhatsApp: Architecture Recommendation

- **Production:** WhatsApp Business Platform (Cloud API) → Meta webhook → Supabase Edge Function (signature verification `X-Hub-Signature-256`) → `messages` + `conversations` → lead lookup/create (dedup on normalized E.164 phone) → assignment → Realtime → inbox اور notifications۔ Outbound replies server سے جائیں گے، token کبھی frontend میں نہیں ہو گا۔
- **"QR سے connect":** Meta کا **WhatsApp Business App coexistence** onboarding (Embedded Signup) موجودہ Business App number کو QR scan کے ذریعے Cloud API سے جوڑتا ہے، اور App بھی چلتی رہتی ہے۔ یہ compliant طریقہ ہے اور "Connect WhatsApp" button اسی پر بنایا جا سکتا ہے۔ آپ کے ملک اور number کے لیے eligibility Meta پر verify کرنی ہو گی۔
- **Unofficial WhatsApp Web automation** (whatsapp-web.js / Baileys): WhatsApp کی Terms کے خلاف ہے، number ban کا خطرہ ہے، ایک ہمیشہ چلنے والا Node server اور session secrets درکار ہیں، اور WhatsApp کے ہر update پر ٹوٹ سکتی ہے۔ **Core architecture میں شامل نہیں کی جائے گی۔**
- **Cloud API کی حدود:** Customer کے آخری message کے 24 گھنٹے بعد صرف approved templates بھیجے جا سکتے ہیں۔ Business verification درکار ہے۔ Per-conversation pricing لاگو ہوتی ہے۔

---

## Verification (اس audit میں چلائی گئی checks)

| Check | نتیجہ |
|---|---|
| `npm ci` | ❌ Lock file اور `package.json` sync میں نہیں |
| `npm install` | ✓ |
| `tsc -p tsconfig.app.json` | ✓ (strict mode off ہے) |
| `vite build` | ✓ (1,237 KB JS، chunk size warning) |
| `eslint src` | ❌ 156 errors، 11 warnings (زیادہ تر `no-explicit-any`) |
| `vitest run` | ✓ 1/1 (صرف placeholder test) |
| Firestore Rules | ⚠️ Repo میں موجود نہیں، verify نہیں ہو سکے |

## آگے بڑھنے سے پہلے درکار معلومات

1. Backend کا فیصلہ: Supabase پر migration (سفارش) یا Firebase پر رہنا؟
2. موجودہ **Firestore Security Rules** کی copy، اور production data کا تقریباً حجم (leads، invoices کی تعداد)۔
3. **Logo file** اور 2 سے 3 **پرانی invoices** (PDF یا image)۔
4. WhatsApp: کیا Meta Business account verified ہے؟ کون سا number connect کرنا ہے؟ کیا وہ ابھی WhatsApp Business App پر ہے؟
5. Hosting target: Lovable پر رہنا ہے، یا Vercel / Netlify / Cloudflare Pages؟
