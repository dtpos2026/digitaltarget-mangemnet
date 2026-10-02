# Monthly Closing & Administrator History

Sidebar → **Admin History** (permission *Administrator History & Monthly Closing*, `history.manage`; admins have it by default).

## Closing a month

1. **Pick the month.** Any month up to the current one that is not closed yet.
2. **Read the preview.** It shows income, business and personal expenses, net saving, target achievement, what carries forward, what gets archived, and warnings. Warnings include: the month has not ended, the previous month is still open, or no target was set.
3. **Confirm.** The dialog reads: *"Are you sure you want to close this month? All historical financial and operational data will remain available in Administrator History."*

What closing does, in order (`src/lib/closing.ts`, `src/lib/closingStore.ts`):

| Step | What happens | If it fails |
|---|---|---|
| 1 | A full snapshot is written to `users/{ws}/monthlyArchives/{YYYY-MM}` with status `closing` | Nothing else has changed; try again |
| 2 | Finished records are stamped `archivedMonth: YYYY-MM`, in batches of 400: paid invoices, completed projects, finished tasks and done schedule items up to the month end | The month shows **Adhoori** with a **Retry** button. Retrying is idempotent and re-uses the snapshot that was confirmed |
| 3 | The snapshot is marked `closed` | — |

**Nothing is deleted.** Archived records leave the active workspace, so lists and dashboards show the new month clean. The Firestore rules then make them **read-only for everyone except the administrator**.

### Never reset (carried forward)

- **Clients.** They also can't be deleted from the normal portal; that is enforced by the rules.
- **Accounts / wallets** and their balances.
- **Outstanding balances:** unpaid and partial invoices stay active, and team dues and khata stay as they are.
- Services, team, settings, leads and the accounting ledger.
- Open work: running projects and pending tasks and schedule items.

## The snapshot (A–Z history of the month)

Each snapshot holds:
- **Accountability:** target, actual income, business expense, personal expense, net saving, saving margin, achievement %, outstanding and marketing spend.
- **Invoices** of the month, **income** and **expense** rows, and **expenses by category** (business / personal).
- **Clients:** billed and received per client.
- **Services:** revenue per service line.
- **Leads:** new, converted, lost and conversion, by status, source and service. WhatsApp campaigns are included too.
- **Work:** completed projects, finished tasks, and done / pending schedule items.
- **Team:** tasks done, leads assigned and leads converted per member.
- **Money at close:** wallet balances at closing time, and outstanding invoices.
- **AI analysis** of the month (health score, insights, actions).
- **Next-month plan:**
  - revenue target (+15% on history, or the owner's number);
  - daily and weekly run-rate;
  - expense limit and saving target;
  - leads needed;
  - service-wise targets with unit price and the number of sales needed;
  - the reasoning behind each number.

  **Set target** writes it to `targets/{next month}`, after asking before it replaces an existing target.

Snapshots are capped at 1,500 rows per list, so they stay under Firestore's 1 MB document limit.

## Administrator controls

| Control | Effect |
|---|---|
| **Open** | Browse the month section by section |
| **Report** | Branded print / PDF / PNG of the accountability page |
| **JSON** | Download the complete snapshot |
| **Reopen** | Un-stamps the archived records (they come back to the active workspace) and removes the snapshot. The month can then be closed again |
| **Delete** | **Permanent.** It deletes the snapshot **and** every record archived under it from the database. It needs the confirmation *"This action will permanently delete the selected historical data from the database. This cannot be undone."* and the month typed in |
| Record delete | Inside a month, single archived invoices, projects and tasks can be permanently deleted |

Even the administrator cannot delete the audit log or chat data. The rules only allow these deletes on business collections.

## Performance

- Archive snapshots live in their own collection and are **not** loaded at login. They are read only when Admin History is opened.
- Active screens filter out archived records.


## Accounting: day close, month close, clean-up (update)

- **Month close** now also archives every accounting entry dated up to the month end. **Day close** (Accounting → 📅 Din close karein, administrator) archives entries up to a chosen day. Either way the Accounting screen and dashboard start again from zero.
- **Account balances never change on a close** — the balance in each account is the closing balance and carries forward. Accounts shows the balance at the last close next to the current one.
- Closed entries are read-only (only the administrator can change them, also enforced in `firestore.rules`). A closed day can be reopened by the administrator.
- Deleting an open entry no longer changes the account balance automatically: a second question asks whether the entry was a mistake and its money should be put back.
- Deleting an invoice never reverses payments that are in a closed day / month.
- An account that still has money or entries cannot be deleted (transfer the balance first).
- **🧹 Close shuda data saaf karein** (administrator) permanently deletes archived entries of months that have a closed snapshot in Administrator History; balances are untouched.
