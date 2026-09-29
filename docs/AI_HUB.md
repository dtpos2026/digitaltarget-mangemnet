# AI Analysis (one place for all AI)

All AI analysis, suggestions and planning live in the **AI Analysis** tab (sidebar → Overview). Other pages stay clean.

Sections: **Suggestions** (urgent tasks, payment reminders, follow-ups, recommendations — Complete / Snooze / Dismiss) • **Targets** (monthly target and the service-wise plan) • **Schedule plan** (type a plan in words, or accept what the AI found: follow-ups, renewals, overdue payments) • **Profit & Growth** (growth analysis + category margin) • **Leads** (High / Medium / Low, next action, "analyze all") • **Work & Team** (projects needing action, team workload) • **Module analysis** (the per-module insights for every module) • **Reports** (margin and business report).

The switch *Doosre pages par bhi AI dikhayein* (top right of the tab) brings the old inline AI cards back on the other pages; it is off by default and remembered per browser.

# Audit log cleanup

*Settings → Audit Log → 🧹 Saaf karein* (administrator only): delete entries older than 7 / 30 / 90 days, or all. *Roz khud saaf* keeps only the last 7 / 14 / 30 / 90 days — it runs once a day when an administrator opens the portal. A "purged" entry is written so the cleanup itself stays on record. Business data is not touched. Deploy the updated `firestore.rules` (audit log delete for `history.manage`).

# Linking a login to a team member (My Portal)

*Settings → User Management → 🔗 Link karein* opens a picker (or creates a team member from the account). An administrator can also link **their own** account: from *My Portal* → *Apne aap ko team member se link karein*. Only the team link can be changed on your own account (rule in `firestore.rules`).
