---
feature: Billing staff tools
phase: 10
route: terminal: npm run billing:reconcile, work:quote, work:deliver, care:log, org:decline, prices:set -- --sync-all (screens in P13)
---

# How to: Billing staff tools

Operator feature with no screen yet. Re-record when P13 (staff console) adds billing screens; they call the same functions.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Six terminal tools for CDS staff while there is no staff console:

- **`billing:reconcile`**: the hourly safety net. Re-reads CDS billing and the tenants' Stripe accounts and applies any event a webhook missed (PAY-02). Production runs it as `POST /api/jobs/billing`; the terminal tool is for checking by hand.
- **`work:quote`**: send an owner a quote for paid work: design polish in 3-hour blocks, a custom block, a private add-on or a premium add-on (BILL-20). The owner accepts and pays in Settings › Billing (see `accept-a-quote.md`).
- **`work:deliver`**: mark quoted work delivered: sends the balance invoice, adds the monthly maintenance and installs the add-on (super admin). It prints the case and asks y/N first.
- **`care:log`**: log Care Plan minutes against a site (BILL-19). The hour a month is a hard cap.
- **`org:decline`**: decline a paid order inside 5 business days, before build work starts: full refund, site closed, owner emailed (BILL-09; super admin).
- **`prices:set -- --sync-all`**: once, when switching `CDS_PAYMENTS=stripe`, create the Stripe price for every priced catalog row (super admin).

Every tool except `billing:reconcile` (a job, like `retention:run`, with no staff sign-in) asks for the staff email, password and the emailed sign-in code, and every change is written to the audit log. Payment records (invoices, work orders) are kept 7 years, even after a site is deleted.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | PB admin UI `https://api.cds.needtobeedgy.com/_/`, collection **users** | Make sure the staff member's **staff_role** is `super_admin` (every tool) or `support_agent` (`work:quote` and `care:log` only) | The record shows the staff role |
| 2 | Repo root, file `.env.local` | Make sure it has `PB_URL`, `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD` and `PB_APP_KEY` for the target PocketBase. Leave `CDS_PAYMENTS` unset (the fake adapter) until the Stripe test keys exist; then set `CDS_PAYMENTS=stripe` and `STRIPE_SECRET_KEY` (an `sk_test_` key) | The tools can reach the database. A missing value stops with `FAIL PB_URL is not set` (or the name of the missing value). An `sk_live_` key outside production is refused |
| 3 | Terminal at the repo root | Run `npm run billing:reconcile -- --help`, then the same `--help` for `work:quote`, `work:deliver`, `care:log`, `org:decline` and `prices:set` | Each prints its usage and exits. Nothing is signed in or changed |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal at the repo root | Run `npm run billing:reconcile -- --since 24h --dry-run` (no sign-in) | First line `Dry run: nothing was changed.`, then `Billing reconcile · 2026-10-08 05:00 UTC · since 2026-10-07 05:00 UTC` and aligned rows `Subscriptions read:`, `Invoices read:`, `Checkout sessions:`, `Stripe accounts:` with `would record: N`, and `Events already handled: N (skipped)`. A `Would record:` list names each event it would apply |
| 2 | Same terminal | Run `npm run billing:reconcile -- --since 24h` | Same report with the live verbs: `changed: 1`, `new: 2`, `completed but missed: 1`, `restricted: 1`. Leaving out `--since` reads back to the last run. `--since` takes `24h`, `2d` or an ISO date; a future date gives `FAIL --since is in the future` |
| 3 | Any text editor | Write the scope as a markdown file, for example `scope.md` with a heading and a list of what CDS will do | The file exists. It must be under 64 KB and not empty |
| 4 | Terminal at the repo root | Polish quote: `npm run work:quote -- --org <org-id> --kind polish --blocks 1 --title "Homepage polish" --scope-file scope.md` (add `--rate-cents 12000` only while the `polish-hour` catalog price is unset), then type your staff email, password and the 6-digit emailed code (in dev with `CDS_OTP_STANDIN=1` the code is in the PocketBase log line `OTP_STANDIN users <user-id> <otp-id> <code>`) | The quote prints as the owner will see it: `Quote for <org name> (<org-id>)`, `Kind:`, `Title:`, `What CDS will do:`, `Price:` lines and `Pay now:  $... (plus sales tax where applicable)`, then `Send to the owner? [y/N]` |
| 5 | Same terminal | Type `y` | `Quote <quote-id>, valid until <date>.` then `Sent. The owner sees it in Settings › Billing and by email.` Answering anything else prints `Nothing changed.` |
| 6 | Same terminal | Private add-on quote: `npm run work:quote -- --org <org-id> --kind private_addon --addon <slug> --total-cents 400000 --maintenance-cents 5000 --title "Online orders" --scope-file scope.md`, sign in, answer `y` | Same flow; the quote also shows `Add-on:   <slug>` and the monthly maintenance line. `--dry-run` prints the quote and `DRY RUN would create and send this quote to org <org-id>; nothing changed` |
| 7 | Browser, the owner's `/hub/settings/quotes/<quote-id>` | Owner accepts and pays (steps in `accept-a-quote.md`) | The quote shows Accepted, then Paid once the deposit (or the full price) is paid |
| 8 | Terminal at the repo root | When the work is done: `npm run work:deliver -- --quote <quote-id>`, sign in as a super admin, check the printed case and answer `y` at `Invoice $2,000.00 and deliver? [y/N]` (`--yes` skips the question) | First the case: `Quote <quote-id> for <site> (<org-id>)`, then `Kind`, `Title`, `Status`, `Balance`, `Maintenance` and `Add-on` lines. After `y`, one line, for example `Balance invoice sent: $2,000.00. Maintenance $50/mo added from 1 Nov. Add-on installed: rivera-orders.` (only the parts that apply). Any other answer prints `Nothing changed.` `--dry-run` prints the case, then `DRY RUN would deliver quote <quote-id>; nothing changed`. A quote not yet accepted and paid prints the case, then `Refused: ...`, and nothing changes |
| 9 | Same terminal | Log Care Plan time: `npm run care:log -- --org <org-id> --minutes 30 --note "Updated the hours block"` (optional `--ticket <ref>`) and sign in | `Logged 30 min. October: 55 of 60 minutes used.` The owner sees the entry and the meter in Settings › Billing › Care Plan |
| 10 | Same terminal | Try to log past the hour: `npm run care:log -- --org <org-id> --minutes 20 --note "More edits"` | `Refused: that would make 75 of 60 minutes. Over the hour: send a polish quote (work:quote --kind polish).` Exit code 1; nothing is written. Send a polish quote instead (step 4) |
| 11 | Same terminal | Decline a paid order, dry run first: `npm run org:decline -- --org <org-id> --reason-category capacity --dry-run` and sign in as a super admin | The case prints: `Org:`, `Paid:`, `Business days:`, `Build started:  no`, `To refund:      2 charges, $1,539.00`, `Reason:         capacity`, then `DRY RUN would decline org <org-id> and refund $1,539.00; nothing changed` |
| 12 | Same terminal | If the case cannot be declined | It stops after the case with one line and exit 1, for example `Refused: paid 7 business days ago (limit 5).` or `Refused: build work started on 9 Oct.` Nothing changes |
| 13 | Same terminal | Run it for real: `npm run org:decline -- --org <org-id> --reason-category capacity`, sign in, answer `y` at `Decline and refund $1,539.00? [y/N]` (or pass `--yes`) | `Declined and refunded $1,539.00. Owner emailed. Site data deletes on 8 Nov 2026.` The owner's hub now shows only the declined notice. `--reason-category other` needs `--note "<one sentence>"`. If Stripe fails part way, the tool stops with `Decline stopped at the <step> step …`: run the same command again, even days later. The case then shows `Resuming:` and the run finishes without refunding twice |
| 14 | Same terminal | Once, when switching to Stripe (`CDS_PAYMENTS=stripe` with the test key set): `npm run prices:set -- --sync-all --dry-run` | A table `Kind Key Path Price` of every priced row still missing its Stripe price, then `DRY RUN would create N provider prices; nothing saved`. If none are missing: `Every priced item already has its payment provider prices.` |
| 15 | Same terminal | Run `npm run prices:set -- --sync-all`, sign in as a super admin, answer `y` at `Create N Stripe prices? (y/N)` | `Created N Stripe prices (M already in place).` Unpriced rows (Price coming soon) are skipped; they still block checkout until `prices:set` sets them |
| 16 | PB admin UI `/_/`, collection **audit_log** | Filter `organization = "<org-id>"` | One row per action with you as actor: the work order created and sent, delivered, the Care Plan entry, the decline. A support agent who runs a super-admin tool gets `Org <org-id> not found, or this account isn't CDS staff.` (or `FAIL forbidden`) and nothing changes |
