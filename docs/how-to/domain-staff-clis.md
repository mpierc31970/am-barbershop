---
feature: Domain staff CLIs
phase: 14
route: /staff/sites (terminal: npm run domains:check, domains:run, domains:move, org:offboard)
---

# How to: Domain staff CLIs

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Four terminal commands sit behind the console's Domain and Offboarding tabs ([Domain moves and the zone gate](staff-domain-moves.md), [Offboarding a site](staff-offboarding.md)):

| Command | Who | What |
|---|---|---|
| `npm run domains:check -- --domain <domain>` | Anyone at CDS (no sign-in) | Read-only preview of a domain's DNS and the zone gate, from public DNS and RDAP |
| `npm run domains:run [-- --dry-run]` | The job (prod: `POST /api/jobs/domains`, every 5 minutes) | Advances moves, sending identities, DNS handbacks and ended notices; domain health once a day after 06:00 UTC |
| `npm run domains:move -- --org <id> --to <domain> --reason "…"` | Super Admin (staff email, password, emailed code) | Moves a **live** site to a new domain |
| `npm run org:offboard -- --org <id> status\|start\|cancel` | `status`: Super Admin or Support agent; `start`, `cancel`: Super Admin | Inspects, starts or cancels a site's Leaving CDS notice |

Every command takes `--help`. Launch moves are never started here: a site goes live only through **Approve launch** in the pipeline ([Pipeline and launch approval](staff-pipeline.md)).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal at the repo root | Make sure `.env.local` has `PB_URL`, `PB_SUPERUSER_EMAIL` and `PB_SUPERUSER_PASSWORD` (not needed for `domains:check`), then run `npm run domains:move -- --help` | The usage text prints, ending "super_admin only. Prompts for staff email, password and the emailed sign-in code." |
| 2 | Same terminal | Run a signed-in command (for example `npm run org:offboard -- --org <id> status`) and answer the prompts: staff email, password, then the code emailed to you | The command runs as you; every write is audited with your name. A Support agent running `start` or `cancel` reads "Refused: starting an offboarding needs super_admin." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal | Run `npm run domains:check -- --domain riverabakery.com` | "riverabakery.com · registrar GoDaddy · expires 2027-03-03 · DNSSEC off", then the **Email** line ("7 records · provider Google Workspace (MX, SPF, 2 DKIM, DMARC, 2 verification)"), "Verification 3 · Site 2 · Other 4 · wildcard no", the **Gate** line ("G2 pass · G3 pass · G4 none · G5 none · G6 pass (1 SPF)") and "Read-only: nothing was written." Add `--json` for the raw report |
| 2 | Terminal | Run `npm run domains:run -- --dry-run` | "DRY RUN" lines for each step, then "domains:run (dry run) · moves 3 advanced, 1 waiting on owner · handbacks 0 · offboarding 0 · health skipped (ran 06:00) · 1.2s" and "DRY RUN nothing written" |
| 3 | Terminal | Run `npm run domains:run` | One line like "domains:run · moves 3 advanced, 1 waiting on owner · handbacks 0 · offboarding 0 · health skipped (ran 06:00) · 1.2s" (plus "preview addresses N", "sending N" or "failed N" when non-zero). If a run is already going: "Another domains run is in progress. Nothing done." |
| 4 | Terminal (Super Admin) | Run `npm run domains:move -- --org <id> --to riverabakery.net --reason "Owner rebranded to riverabakery.net"` (reason 10 to 500 characters), sign in, read the case, answer `Start move? [y/N]` with `y` | "Move M-14 started · step 1 snapshot · owner emailed." Follow it on Site › Domain. `--dry-run` prints the case and "DRY RUN would start the move; nothing changed"; `--yes` skips the question |
| 5 | Same command, a site that can't move | Run it for a site in review, with no custom domain, or with an open move | "Refused: this site isn't live. It connects its domain with a launch (Approve launch).", "Refused: this site has no custom domain yet. It connects one with a launch." or "Refused: M-13 (launch) is still open. Finish or cancel it first." Nothing changes |
| 6 | Terminal | Run `npm run org:offboard -- --org <id> status` | "Rivera Bakery · leaving · requested by owner 15 Oct", "Notice ends 2026-11-14 (23 days)", then one line per step with `[done]`, `[open]`, `[locked]` or `[n/a]` (system steps marked "(system)"), the DNS handback line ("DNS handback riverabakery.com · waiting for the nameserver change · to the registrar's DNS (…)") and the owner's note. A site with no notice: "Rivera Bakery isn't leaving." |
| 7 | Terminal (Super Admin) | Run `npm run org:offboard -- --org <id> start --reason "Owner asked by phone to close the site"`, sign in, answer `Start offboarding? [y/N]` with `y` | The case prints first (Notice ends · DNS handback · Billing · "The owner is emailed the checklist."), then "Offboarding started. The owner was emailed the checklist." and the status lines |
| 8 | Terminal (Super Admin) | Run `npm run org:offboard -- --org <id> cancel --reason "Owner decided to stay"`, answer `Cancel offboarding? [y/N]` with `y` | "Cancel Rivera Bakery's offboarding? Their plan and price carry on." then "Offboarding cancelled. …". A site with no notice: "Refused: Rivera Bakery isn't leaving." |
