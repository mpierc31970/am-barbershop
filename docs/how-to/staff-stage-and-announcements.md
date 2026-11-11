---
feature: Staff stage, build note and announcements
phase: 11
route: terminal: npm run org:stage (also npm run announce:set, npm run tenants:seed-dev -- --stage; screens in P13)
---

# How to: Staff stage, build note and announcements

Operator feature with no screen yet. Re-record when P13 (staff console) adds the stage, note and announcement screens; they call the same functions.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Two terminal tools for CDS staff while there is no staff console, plus a dev-only seed option:

- **`org:stage`**: move a site's stage forward (`intake < fit_review < ready_for_build < being_built < ready_for_review < live`) and set the "What CDS is doing now" note the owner reads on Today while CDS builds. Moving a stage is super admin only; a support agent can set or clear the note. Stages only move forward, and `live` is final: it sets the launch date. A site in `fit_review`, or a held or closed site, is refused: `fit:review` clears or declines a held site. Moving to `ready_for_review` or `live` alerts the site's team.
- **`announce:set`**: set the one CDS announcement owners see in the **From CDS** card on Today, or end it. Super admin only. A new announcement replaces the one showing now.
- **`tenants:seed-dev -- --stage <stage>`** (dev only): put the seeded `demo` tenant in any stage, so a walk or human check can see each stage's Today.

Every tool asks for the staff email, password and the emailed sign-in code (not the dev seed), and every change is written to the audit log.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Repo root, file `.env.local` | Make sure it has `PB_URL`, `PB_SUPERUSER_EMAIL` and `PB_SUPERUSER_PASSWORD` for the target PocketBase | The tools can reach the database. A missing value stops with `FAIL PB_URL is not set` (or the name of the missing value) |
| 2 | Terminal at the repo root | Run `npm run org:stage -- --help`, then `npm run announce:set -- --help` | Each prints its usage and exits. Nothing is signed in or changed |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal | Run `npm run org:stage -- --org <org-id>` and sign in (email, password, then the emailed code) | Two lines: `Rivera Bakery · being_built` and `Build note: (none)` (or the current note in quotes). Nothing changes |
| 2 | Terminal | Run `npm run org:stage -- --org <org-id> --build-note "Adding your menu photos."` and sign in | `Build note: (none) -> "Adding your menu photos."`, then `Done. The owner sees the new note under What CDS is doing now on Today.` The owner's Today shows the note under **What CDS is doing now** |
| 3 | Terminal | Run `npm run org:stage -- --org <org-id> --to ready_for_review --dry-run` and sign in | `Rivera Bakery · being_built -> ready_for_review`, the note line, then `DRY RUN would move to ready_for_review; nothing changed` |
| 4 | Terminal | Run `npm run org:stage -- --org <org-id> --to ready_for_review` (super admin), sign in, type `y` at `Set? [y/N]` | `Stage moved: being_built -> ready_for_review.`, then `Done. The owner sees "Ready for your review" on Today.` The team gets the alert "Your site is ready for your review." |
| 5 | Terminal | Run `npm run org:stage -- --org <org-id> --to live`, sign in, type `y` | A `launched_at: 2026-10-11 14:02 America/Chicago` line, `Stage moved: ready_for_review -> live.`, then `Done. The owner sees "Your site is live" on Today.` If `--build-note` was given too and the note fails, the stage still moved: `Stage moved to live; the build note was NOT saved: <why>. Rerun with --build-note (or --clear-note) only.` (exit 1) |
| 6 | Terminal | Run `npm run org:stage -- --org <org-id> --to being_built` on a live site | `Refused: live is final. Use the launch tools in P14 to undo a launch.` (exit 1). Any other backward move prints `Refused: <from> -> <to> goes backwards. A stage only moves forward.` |
| 7 | Terminal | As a support agent, run `npm run org:stage -- --org <org-id> --to live` | `Refused: moving a stage needs super_admin. Support agents can set the build note only.` Nothing changes |
| 8 | Terminal | Run `npm run org:stage -- --org <org-id> --clear-note` | The note is removed; `Done. Today shows the default line again.` |
| 9 | Terminal | Run `npm run announce:set -- --title "New: Grow your social" --body "Link your accounts in Marketing." --href /hub/marketing?tab=social --days 14` and sign in | The card prints as owners will see it (`From CDS`, the title, body and link, `Shown to:  every site`, `Until:     31 Oct (14 days)`), then `Publish? [y/N]`. Type `y`: `Announcement live until 31 Oct. Owners see it in From CDS.` Every owner's Today shows it in **From CDS** |
| 10 | Terminal | Add `--paths studio` (or `standard`, `shop`, comma-separated) to step 9 | `Shown to:  studio sites`: only those sites see it |
| 11 | Terminal | Run `npm run announce:set -- --clear` and sign in | `Announcement ended. From CDS shows no announcement now.` (or `No announcement was showing. Nothing changed.`) |
| 12 | Terminal (dev database only) | Run `npm run tenants:seed-dev` once, then `CDS_ENV=dev npm run tenants:seed-dev -- --stage ready_for_review` | `PASS demo: org <id> being_built -> ready_for_review: moved forward`. Signed in as `owner@demo.test`, Today shows the review stage. A stage before the current one prints `reset backwards (dev only)`; `--stage bogus` prints `FAIL --stage must be one of intake, …` |
