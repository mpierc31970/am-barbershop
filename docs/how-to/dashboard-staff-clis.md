---
feature: Owner dashboard staff tools
phase: 11
route: terminal: npm run org:stage, announce:set, analytics:set, alerts:run, reports:monthly (screens in P13)
---

# How to: Owner dashboard staff tools

Operator feature with no screen yet. Re-record when P13 (staff console) adds these screens; they call the same functions. **Staff only:** this how-to has no training entry, so it never appears in a tenant's Help (T-11-45-01).

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Five terminal tools behind the owner dashboard (P11) while there is no staff console:

| Tool | What it does | Who may run it | Detailed steps |
|---|---|---|---|
| **`org:stage`** | Moves a site's stage forward (intake < fit_review < ready_for_build < being_built < ready_for_review < live) and sets the "What CDS is doing now" note owners read on Today | Stage move: super admin. Build note: super admin or support agent | [staff-stage-and-announcements.md](staff-stage-and-announcements.md) |
| **`announce:set`** | Sets or clears the one announcement owners see in **From CDS** on Today, for every site or chosen paths, for 1-N days | Super admin | [staff-stage-and-announcements.md](staff-stage-and-announcements.md) |
| **`analytics:set`** | Records a site's GA4 measurement id, GA4 property id and Search Console property, and who owns them (DASH-13). GA4 loads on the site only after a visitor accepts statistics cookies | Super admin or support agent | Runbook [docs/ops/ga4-search-console.md](../ops/ga4-search-console.md) (creating the Google properties first) |
| **`alerts:run`** | The every-5-minutes alert job: releases pushes held by quiet hours, collapses bursts, retries failed pushes once, sends the 7am morning summary, prunes old alerts | A job: no staff sign-in (database env only) | This page |
| **`reports:monthly`** | The daily trigger for the monthly "Your site this month" email (DASH-12): on days 1-7 of each site's business month, sends last month's report once | A job: no staff sign-in (database env only) | [monthly-site-email-job.md](monthly-site-email-job.md) |

`org:stage`, `announce:set` and `analytics:set` ask for the staff email, password and the emailed sign-in code, and every change is written to the audit log. `alerts:run` and `reports:monthly` are jobs like `retention:run`: production runs them from Coolify scheduled tasks (`POST /api/jobs/alerts` every 5 minutes, `POST /api/jobs/reports` once a day, bearer `CDS_JOB_TOKEN`); the terminal tool is for checking by hand. Both write a heartbeat the monitor app reads (`job:alerts:last_success`, `job:reports:last_success`; MONITOR-APP-BRIEF checks 30 and 31).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | PB admin UI `https://api.cds.needtobeedgy.com/_/`, collection **users** | Make sure the staff member's **staff_role** is `super_admin` (every tool) or `support_agent` (`analytics:set`, and the build note in `org:stage`) | The record shows the staff role |
| 2 | Repo root, file `.env.local` | Make sure it has `PB_URL`, `PB_SUPERUSER_EMAIL` and `PB_SUPERUSER_PASSWORD` for the target PocketBase. For the jobs, `CDS_PLATFORM_URL` (links in emails), `CDS_EMAIL_TRANSPORT` (unset: emails are logged, not sent) and the `VAPID_*` keys (unset: the fake push sender records pushes, nothing leaves the server) are optional | The tools can reach the database. A missing value stops with `FAIL PB_URL is not set` (or the name of the missing value) |
| 3 | Terminal at the repo root | Run `npm run org:stage -- --help`, then the same `--help` for `announce:set`, `analytics:set`, `alerts:run` and `reports:monthly` | Each prints its usage and exits. Nothing is signed in or changed |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal at the repo root | Read a site's stage: `npm run org:stage -- --org <org-id>`, then type your staff email, password and the 6-digit emailed code (in dev with `CDS_OTP_STANDIN=1` the code is in the PocketBase log line `OTP_STANDIN users <user-id> <otp-id> <code>`) | `<site name> · being_built` and `Build note: (none)` (plus `Launched: <date time zone>` once live). Nothing changes |
| 2 | Same terminal | Set the build note: `npm run org:stage -- --org <org-id> --build-note "Writing your Services page"` (support agent or super admin) | `Build note: (none) -> "Writing your Services page"`, then `Done. The owner sees the new note under What CDS is doing now on Today.` (a note alone asks no question). `--clear-note` removes it: `Done. Today shows the default line again.` |
| 3 | Same terminal | Move the stage: `npm run org:stage -- --org <org-id> --to ready_for_review` (super admin), answer `y` at `Set? [y/N]` (`--yes` skips it) | `<site name> · being_built -> ready_for_review`, `Stage moved: being_built -> ready_for_review.`, then `Done. The owner sees "Ready for your review" on Today.` Going backwards prints `Refused: being_built -> intake goes backwards. A stage only moves forward.`; a support agent gets `Refused: moving a stage needs super_admin. Support agents can set the build note only.` Moving to `live` is final and prints the launch date |
| 4 | Same terminal | Preview an announcement: `npm run announce:set -- --title "New: Grow your social" --body "Free tips to help people find you." --href /hub/marketing?tab=social --days 14 --dry-run` (super admin) | The card prints as owners see it: `From CDS`, the title, body and `Link:` line, `Shown to:  every site`, `Until:     26 Oct (14 days)`, then `DRY RUN would publish this announcement; nothing changed` |
| 5 | Same terminal | Run it without `--dry-run`, answer `y` at `Publish? [y/N]` | `Announcement live until 26 Oct. Owners see it in From CDS.` A new announcement ends the one showing now (owners see one at a time). `--paths standard,studio` limits it to those paths; `--clear` ends it early |
| 6 | Google Analytics and Search Console | Create the site's GA4 property and verify it in Search Console (runbook [ga4-search-console.md](../ops/ga4-search-console.md) sections 1a-1b) | You have the `G-…` measurement id, the numeric property id and the Search Console property |
| 7 | Terminal at the repo root | `npm run analytics:set -- --org <org-id> --ga4-measurement G-ABC123XYZ --ga4-property 412345678 --gsc-site sc-domain:riverabakery.com --owner cds --dry-run`, then sign in | `<site name>` and aligned `old -> new` lines for **GA4 measurement**, **GA4 property**, **Search Console** and **Owner**, then `DRY RUN nothing changed` |
| 8 | Same terminal | Run it without `--dry-run` | The same lines, then `Saved. <site name>'s Site Report shows Google data from tomorrow.` Fields not named are kept; `none` removes one field, `--clear` removes all first. A tenant-owned property uses `--owner tenant` (runbook section 2) |
| 9 | Same terminal | Check the alert job: `npm run alerts:run -- --dry-run` (no sign-in) | `DRY RUN` lines for each step (release held pushes, retry failed pushes, morning summary, prune, heartbeat), then one line `Alerts (dry run) · 2026-10-12 07:00 UTC · push sent 0 · collapsed 0 · held for quiet hours 2 · held to collapse 0 · retried 0 · morning summaries 3 (skipped empty 1) · pruned 0 · failed 0` and `DRY RUN nothing written` |
| 10 | Same terminal | Run it for real: `npm run alerts:run` | The same one-line report without `(dry run)`. If another run holds the lock: `Another alerts run is in progress. Nothing done.` A failed step exits 1 with `FAIL steps failed: <steps>` |
| 11 | Same terminal | Check the monthly email: `npm run reports:monthly -- --dry-run` (or `-- --org <org-id> --dry-run` for one site) | `DRY RUN` step lines, then `Monthly reports (dry run) · September · sent 0 (0 sites) · skipped before launch 3 · skipped first partial month 1 · already sent 0 · nobody subscribed 0 · failed 0` and `DRY RUN nothing written`. Full steps and what owners receive: [monthly-site-email-job.md](monthly-site-email-job.md) |
| 12 | PB admin UI `/_/`, collection **platform_meta** | Open `job:alerts:last_success` and `job:reports:last_success` | Each holds the time of the last run that finished with no failed step; `job:alerts:last_counts` and `job:reports:last_counts` hold that run's counts |
| 13 | PB admin UI `/_/`, collection **audit_log** | Filter `organization = "<org-id>"` | One row per change with you as actor: the stage move, the build note, the analytics ids. An owner turning on the sensitive-practice switch shows as `business.sensitive_practice_set`. An account that isn't CDS staff gets `Org <org-id> not found, or this account …` and nothing changes |
