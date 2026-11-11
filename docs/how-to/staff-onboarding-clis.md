---
feature: Staff onboarding tools
phase: 06
route: terminal: npm run leads:list (also npm run fit:review, npm run prices:set; screens in P13)
---

# How to: Staff onboarding tools

Operator feature with no screen yet. Re-record when P13 (staff console) adds the Leads, Fit review and Prices screens; they call the same functions.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Three terminal tools for CDS staff while there is no staff console:

- **`leads:list`**: who configured a site and did not finish. Saved quotes (saved, reminded, expired) and sites still in setup (intake not sent, or held for review). Since P8 it also lists sites already sent to CDS (`sent`) and assembled (`being built`), with an **ASSEMBLED** column, so staff see assembly progress (RESEARCH R-6). Super admin or support agent (ONB-07).
- **`fit:review`**: clear or decline a site the fit check held for review. The owner is emailed either way. Super admin only (ONB-12). The check runs at Submit and again whenever the owner changes the business name, type or public text, and at **Send to CDS**; a new flagged reason (one you have not already approved) puts the site back in `fit_review`. An approve covers only the case printed in that run: if the owner changes a screened field before you confirm, nothing is approved and you run `fit:review` again. A never-hosted match (`Verdict: blocked`) needs `--override-blocked` to approve.
- **`prices:set`**: set or clear one price in the catalog the `/start` configurator reads. Super admin only (ONB-06). An add-on at $0/mo is included free for every site on that path, so moving an add-on to or from $0 prints how many sites it affects and asks `Save this price? (y/N)` first (`--yes` skips it). Studio Booking keys are priced on `--path studio` only.

Every tool asks for the staff email, password and the emailed sign-in code, and every change is written to the audit log.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | PB admin UI `https://api.cds.needtobeedgy.com/_/`, collection **users** | Only if no super admin exists yet: open the staff member's record, set **staff_role** to `super_admin`, click **Save changes**. A support agent gets `support_agent` | The record shows the staff role. That person can now sign in to the tools |
| 2 | Repo root, file `.env.local` | Make sure it has `PB_URL`, `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD` and `PB_APP_KEY` for the target PocketBase | The tools can reach the database. A missing value stops with `FAIL PB_URL is not set` (or the name of the missing value) |
| 3 | Terminal at the repo root | Run `npm run leads:list -- --help`, then `npm run fit:review -- --help` and `npm run prices:set -- --help` | Each prints its usage and exits. Nothing is signed in or changed |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal at the repo root | Run `npm run leads:list -- --since 7d` | The tool asks for **Staff email** |
| 2 | Same terminal | Type your staff email, press Enter, type the password (not shown), press Enter | `Sign-in OTP sent to the staff email. Enter it below.` In dev with `CDS_OTP_STANDIN=1` the 6-digit code is in the PocketBase log line `OTP_STANDIN users <user-id> <otp-id> <code>` |
| 3 | Same terminal | Type the 6-digit code and press Enter | `PASS signed in`, then a table with columns `KIND EMAIL PATH TYPE ITEMS STATUS ASSEMBLED LAST CHANGE`, newest first. `STATUS` is `saved`, `reminded 1`, `reminded 2`, `expired`, `intake 3/7` (stages saved of 7), `fit_review`, `sent` (sent to CDS) or `being built` (assembled). Last line, for example: `12 leads: 8 saved quotes, 4 sites in setup.` Leave out `-- --since 7d` to list every lead |
| 4 | Same table, column **ASSEMBLED** | Read where each sent site is in assembly | `-` (not started, and always for quotes and sites still in setup), `queued`, `running`, `done 7 Oct` or `failed 3/3` (three failed tries: staff got a `Site didn't assemble` email). When any are done the last line adds it: `14 leads: 8 saved quotes, 6 sites in setup, 2 assembled.` See the **Review and polish an assembled site** how-to (`assembled-site-review.md`) |
| 5 | Terminal at the repo root | For a `fit_review` lead, copy its org id from the PB admin UI (collection **organizations**, filter `stage = "fit_review"`), then run `npm run fit:review -- --org <org-id> --decline --reason "Checking first" --dry-run` and sign in as in steps 2 and 3 (super admin) | The case prints: `Org:`, `Stage: fit_review`, `Verdict:`, `Matched:` (for example `keyword: ...`) and `Screened fields:` (every field the check read that has text: `org_name`, `business_type`, `description`, `about`, ...), then `DRY RUN would decline org <org-id>; nothing changed` |
| 6 | Same terminal | To clear the site, run `npm run fit:review -- --org <org-id> --approve --reason "Tea shop, fits the AUP"` and sign in | The case prints again, then `Approve this site? [y/N]`. Type `y` (or pass `--yes` to skip the question). The last line is `Approved. The owner can go to checkout when it opens.` The org moves to stage `intake` (or `ready_for_build` if its intake was already sent; then one more line reads `Assembly runs within the hour. To run it now: npm run site:assemble -- --org <org-id>`) and the owner gets the "cleared" email (logged, not sent, until the email account exists) |
| 7 | Same terminal | To decline instead, run `npm run fit:review -- --org <org-id> --decline --reason "Outside the AUP"`, sign in and answer `y` | Last line `Declined. The owner was emailed and the site is held.` The org's status is `held`. A support agent, or a wrong id, gets `Org <org-id> not found, or this account isn't CDS staff.` and nothing changes |
| 8 | PB admin UI `/_/`, collection **audit_log** | Filter `organization = "<org-id>" && action ~ "fit."` | One `fit.approve` or `fit.decline` row with you as actor and your reason in `meta` (an approve also lists the `reasons` it cleared). Rows from the check itself are `fit.hold`, with `trigger` `profile` or `send` after Submit |
| 9 | Terminal at the repo root | Set the v1.0 add-on prices, once per add-on and path: `npm run prices:set -- --kind addon --key testimonials --path standard --monthly 900`, then the same for `--path studio`, and for `--key credentials` on both paths. Sign in as a super admin | `Testimonials, Standard: Price coming soon -> $9.00/mo`, then `Saved. The configurator shows the new price on its next load.` (`900` is cents: $9.00) |
| 10 | Same terminal | Set each extra (one-time price, `--once`): `npm run prices:set -- --kind extra --key copywriting --path standard --once 25000`, and the same for `logo-design`, `sourced-photos` and `rush-launch`, on `standard` and `studio` | `Copywriting, Standard: Price coming soon -> $250.00`, then the `Saved.` line. Using `--monthly` for an extra gives `FAIL extra is priced one-time; use --once <cents>` |
| 11 | Same terminal | To change a base price: `--kind plan --key base` or `--kind care_plan --key care` with `--monthly`; `--kind build_fee --key base` with `--once`. To hide a price again, use `--unset` instead of an amount | `Base platform fee, Standard: $39.00/mo -> $45.00/mo` (for example). `--unset` shows `-> Price coming soon`. Setting an add-on to `--monthly 0` first prints `This makes <add-on> included free for every <path> site (N sites).` and asks `Save this price? (y/N)`; anything but `y` prints `Cancelled. Nothing was saved.` |
| 12 | Browser, `https://cds.needtobeedgy.com/start` | Reload the configurator and pick the path you priced | The add-on or extra shows the new price instead of "Price coming soon" |
| 13 | PB admin UI `/_/`, collection **audit_log** | Filter `action = "price_catalog.set"` | One row per change, with you as actor and the `before` and `after` prices in `meta`. A support agent who tries `prices:set` gets `FAIL forbidden` and nothing changes |
