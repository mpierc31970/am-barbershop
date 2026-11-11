---
feature: Monthly site email job (staff)
phase: 11
route: terminal: npm run reports:monthly (production: POST /api/jobs/reports, daily Coolify scheduled task); owner side /hub/profile#alerts
---

# How to: Run the monthly site email job (CDS staff)

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

**Staff only.** This how-to has no training entry, so it never shows in a tenant's Help. The owner's side (what arrives and how to turn it off) is [Monthly site email](monthly-site-email.md).

On the 1st of each month (the business's own time zone), every live site's team gets **"Your site this month: {October}"**: five lines (Visitors vs the month before, Top page, Top source, Messages, and a Speed or SEO change) and one tip, with a **See your Site Report** button (DASH-12, D189). It is skipped before launch and for the first partial month after launch (a site launched on 20 October gets its first email on 1 December, about November). Each site gets it at most once a month.

Who gets it: everyone on the team who can open Reports (Owner, Admin, Editor, Viewer) and keeps **Your site this month** on under **Your profile › Alerts**. It is on by default. Until real email is connected (SES), the email is logged, not sent (GO-LIVE).

The job is triggered once a day and acts only on days 1 to 7 of a month, so a missed day sends the email the next day instead.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Coolify, project **CDS Platform**, app `cds-platform-prod` (environment **live**), **Environment Variables** | Make sure `CDS_JOB_TOKEN` is set (the same value the other job tasks use), then redeploy if you added it | The variable is listed. Without it the route answers `404` to every call (fails closed) |
| 2 | Same app, **Scheduled Tasks**, click **+ Add** | Name `reports`, frequency `30 13 * * *` (13:30 UTC daily, morning in US time zones), container `app`, command `wget -q -O- --post-data= --header "Authorization: Bearer $CDS_JOB_TOKEN" http://127.0.0.1:3000/api/jobs/reports`, click **Save** | The task is listed. Its run log shows one JSON line such as `{"dryRun":false,"busy":false,"month":"October","orgsSent":0,"emailsSent":0,...,"failedOrgs":0}` and no names or addresses |
| 3 | Terminal at the repo root | Run `npm run reports:monthly -- --help` | The usage text prints and the command exits. Nothing is read or changed |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal at the repo root (`.env.local` has `PB_URL`, `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD`) | Run `npm run reports:monthly -- --dry-run` | Five `DRY RUN` lines, then one line like `Monthly reports (dry run) · October · sent 12 (4 sites) · skipped before launch 3 · skipped first partial month 1 · already sent 0 · nobody subscribed 0 · failed 0`, then `DRY RUN nothing written`. Outside days 1 to 7 of a month every count is 0 |
| 2 | Same terminal | Run `npm run reports:monthly -- --org <org id>` on the 1st | Only that site is checked. `sent 2 (1 site)` means two people got the email. Running it again the same month prints `already sent 1` and sends nothing |
| 3 | The logged email (outbox, until SES) | Open the newest `reports.monthly` email | Subject "Your site this month: October", preheader "1,284 visitors and 23 messages.", five lines such as "Visitors: 1,284, up 12% on September." and "Top page: Menu (412 visits).", then "One tip: …" and the **See your Site Report** button to `/hub/reports` |
| 4 | `/hub/profile#alerts` (as the person who does not want it) | Under **Alerts**, find **Your site this month** in the **Summary** group and switch **Email** off | "Saving…" then **Saved** shows next to the **Alerts** heading. The next month's run skips that person. If nobody on the team keeps it on, the CLI line counts the site under `nobody subscribed` |
| 5 | Monitor app (check 31, `jobs.reports`) | Read the job status | `last_success` moves every day. A warning shows after 36 h without a clean run, or when `send_failures` / `failed_orgs` is above 0 |
