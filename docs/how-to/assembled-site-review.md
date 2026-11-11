---
feature: Review and polish an assembled site
phase: 08
route: terminal: npm run site:assemble (email in dev/mail; screens in P13)
---

# How to: Review and polish an assembled site

Operator feature with no screen yet. Re-record when P13 (staff console) adds the build report screen; it reads the same slot report.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

When an owner clicks **Send to CDS**, the platform builds a first version of their site from the template for their path: a published **Home** and **About** page (TMPL-02). CDS staff then review it and polish it before launch (TMPL-04). Until the staff console exists, staff work from three things:

- **The email** `Site assembled: <Business> (N to polish)` with the slot report and the preview links. If a build fails three times, the email is `Site didn't assemble: <Business>` instead.
- **`site:assemble`**: run, re-run or preview (dry run) one site's build and print the slot report. Super admin or support agent.
- **`leads:list`**: the **ASSEMBLED** column shows where every sent site is.

Every tool asks for the staff email, password and the emailed sign-in code. Every write is in the audit log under your name, acting for the owner.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Nothing to switch on | When an owner clicks **Send to CDS** at `/hub/setup`, the site assembles at once (or within the hour, on the hourly job). A site cleared by `fit:review` after it was sent also assembles within the hour | A `Site assembled: <Business> (N to polish)` email reaches the staff inbox (`CDS_STAFF_ALERT_EMAIL`). Until the email account exists it is logged, not sent: in dev the full message is in the object store under `dev/mail/` |
| 2 | Terminal at the repo root | Run `npm run site:assemble -- --help` | The usage prints: `--org`, `--rerun`, `--dry-run`, "super_admin or support_agent" and "Prompts for staff email, password and the emailed sign-in code." Nothing is signed in or changed |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Staff inbox (dev: object store `dev/mail/`) | Open the `Site assembled: Rivera Bakery (3 to polish)` email | It names the business, path and template, links the preview of **Home** and **About**, and lists the slot report: **To polish** first, then **Filled** and **Left out** |
| 2 | Same email | Read **To polish** | Each line is one thing to fix, for example `Hero · Default used · No main photo: text-only hero`, `Questions and answers · Default used · 2 of 3 need answers (hidden until answered)`, `Photos · 1 need a reviewed description`, `Logo · None: business name shown instead` and `Theme: import the impeccable theme (D45)` |
| 3 | Browser, the **Home** preview link (for example `https://<slug>.sites.connectionsdesignstudios.com/`) | Open it, then the **About** link | Both pages render in the site's theme, with a thin "in development" strip at the top. **Home** and **About** are in the menu |
| 4 | Terminal at the repo root | Print the report again any time: `npm run site:assemble -- --org <org-id> --dry-run`, then sign in (staff email, password not shown, the 6-digit code; in dev the code is in the PocketBase log line `OTP_STANDIN users <user-id> <otp-id> <code>`) | First line `Dry run: nothing was written.`, then `Rivera Bakery · standard · standard-v1 (v1)`, a table `PAGE  SLOT  RESULT  NOTE` (one row per slot: `Filled`, `Default used` or `Left out`), `To polish: 3 · …`, and last `Would assemble 2 pages.` Nothing changes |
| 5 | Staff impersonation (see the **Staff impersonation** how-to, `impersonation.md`) | Start an impersonation of the site owner with a reason, for example "Polish assembled site" | You see the owner's hub as the owner would. The start is in the audit log |
| 6 | `/hub/website?tab=pages` (as the owner, impersonated) | Open **Home** (`/hub/website/pages/<page-id>`), fix each **To polish** item in the page builder (replace the text-only hero with a photo hero, answer the FAQ starters, describe the flagged photos), then click **Publish** | The preview shows the change. The page is now "edited": a later re-run leaves it alone |
| 7 | Terminal at the repo root | Import the site's theme (D45): `npm run theme:import -- --org <org-id> --dir design/tenants/<slug>` (see the **Theme import** how-to) | Both pages render in the imported theme. The next report no longer lists `Theme: import the impeccable theme (D45)` |
| 8 | Terminal at the repo root | After a template fix ships, rebuild the pages nobody touched: `npm run site:assemble -- --org <org-id> --rerun` and sign in | The report prints, then one line per page: `Home   unchanged, rebuilt.`, `About  edited since it was assembled, left alone.` (or `About  deleted, not recreated.`), and last `Re-run done: 1 page rebuilt, 1 left alone.` Edited pages are never overwritten and deleted pages never come back |
| 9 | Terminal at the repo root | Without `--rerun`, an already assembled site gives `Already assembled on 7 Oct. Use --rerun to rebuild untouched pages.` A site that was never sent gives `This site hasn't been sent to CDS yet, so there's nothing to assemble.` A wrong id, or an account that isn't staff, gives `Org <org-id> not found, or this account isn't CDS staff.` | Nothing changes in any of these cases |
| 10 | Terminal at the repo root | Check progress across all sites: `npm run leads:list` and sign in | The table has an **ASSEMBLED** column after **STATUS**: `-` (not started), `queued`, `running`, `done 7 Oct` or `failed 3/3`. Sent sites show STATUS `sent`; assembled ones `being built`. The last line adds `, 2 assembled` when any are done |
| 11 | Staff inbox | If a `Site didn't assemble: <Business>` email arrives, read the error code, the page it stopped on and the pages already finished | It means three tries failed. Look up the code in the app log (`[assembly] <CODE>`), fix the cause, then run `npm run site:assemble -- --org <org-id>`. It picks up where it stopped and never duplicates a page; the run ends with `Assembled <Business>: 2 pages, …` and a `Preview:` line |
| 12 | PB admin UI `/_/`, collection **audit_log** | Filter `organization = "<org-id>" && action = "site.assembled"` | One row per finished build. A build you ran from the terminal has you as `impersonator`; the automatic build is a system-job row |
