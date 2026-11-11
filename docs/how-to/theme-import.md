---
feature: Theme import
phase: 04
route: CLI: npm run theme:import (staff console button in P13)
---

# How to: Theme import

CDS staff feature with no screen yet. Re-record when P13 (staff console) adds an **Import theme** button.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

CDS authors each tenant's look (colours, fonts, corner radii, spacing) as an `impeccable` theme: a `DESIGN.md` plus `.impeccable/design.json` in `design/tenants/<slug>/`. One command imports it into that organization. Before anything is written it prints a report: every colour role, every contrast pair checked against WCAG AA, every colour the checker moved to pass, and the fonts. Owners never edit their theme; every block renders from it, so the site stays on brand (THEME-03, THEME-05, D44-D46).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | File explorer, repo folder `design/tenants/` | Open the tenant's folder, e.g. `design/tenants/demo-b/` | It holds `DESIGN.md` and `.impeccable/design.json`. `design/tenants/demo/` (Almanac) and `design/tenants/demo-b/` (Tidewater) are the worked examples; `design/presets/neutral/` is the starting point for a new tenant |
| 2 | Claude Code at the repo root, `impeccable` skill | To make a new theme, copy `design/presets/neutral/` to `design/tenants/<slug>/`, then ask the `impeccable` skill to author or revise it for the tenant's brand | `DESIGN.md` front matter lists the named colours, typography, rounded and spacing values; `design.json` maps each colour to a role under `extensions.roles`. Fonts must come from the curated catalog (e.g. Archivo, Public Sans, Fraunces, Source Serif 4) |
| 3 | PB admin UI `/_/`, collection **organizations** | Find the tenant's row and copy its **id** | A 15-character id such as `k3v9x2m7q1w8e4r`. Keep it for `--org` below |
| 4 | Repo root, file `.env.local` | Make sure it has `PB_URL`, `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD` and `PB_APP_KEY` for the target PocketBase (only a real import needs them; `--dry-run` does not) | Without them a real import stops after the report with `PB_URL is not set.` (naming the missing variable, never a value) |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal at the repo root | Run `npm run theme:import -- --org <org-id> --dir design/tenants/demo-b --dry-run` | The report prints: `Theme "Tidewater" for org <org-id> (demo-b)   [DRY RUN, nothing written]`, a `Source` line with an 8-character hash, then **Roles** (each role, its colour name and hex), **Contrast** (each pair, its ratio, `needs 4.5` or `needs 3.0`, `pass`), **Adjustments (1)** (`accent  #F06A4D -> #DE5A3E ... reason: accent on surface-raised 2.50 < 3.00`) and **Fonts** (`heading Archivo  body Public Sans  (catalog ok)`). The last line is `Result  Dry run finished. Nothing was written. Run again without --dry-run to import.` No sign-in is asked for |
| 2 | Same terminal, the tenant's `DESIGN.md` | Read **Adjustments**. If a moved colour looks wrong (e.g. the coral reads brown), re-author that colour in `DESIGN.md` with the `impeccable` skill, then run the `--dry-run` command from step 1 again | The changed colour shows in **Roles**; **Adjustments** shrinks or the move is smaller. A line ending `fallback: no in-hue value passes; re-author this colour.` means the checker had to use near-black or near-white: re-author it. An authoring mistake stops the run with one line and exit code 1, e.g. `Missing role: primary-contrast. Add it to extensions.roles in design.json, then run again.` or `"Playfair Display" is not in the font catalog. Nearest: Fraunces. Pick a catalog family or add one to the catalog (a deploy).` |
| 3 | Same terminal | Run the step 1 command without `--dry-run`: `npm run theme:import -- --org <org-id> --dir design/tenants/demo-b` | The same report prints (without `[DRY RUN, nothing written]`), then the tool asks for **Staff email** |
| 4 | Same terminal | Type your CDS staff email, press Enter, type the password (not shown), press Enter | `Sign-in code sent to the staff email (local dev: the OTP_STANDIN line in the PocketBase output). Enter it below.` In local dev with `CDS_OTP_STANDIN=1` the 6-digit code is in the PocketBase log line `OTP_STANDIN users <user-id> <otp-id> <code>` |
| 5 | Same terminal | Type the 6-digit code and press Enter | Last line: `Result  Imported. The site shows the new theme within a minute.` A wrong org id prints `Org <org-id> not found, or this account isn't CDS staff.`; a failed write prints `Import didn't finish. The site still shows its previous theme. Try again.` Both exit 1 and change nothing |
| 6 | Browser, the tenant's site (live domain, or its preview host) | Wait up to a minute, then reload the home page | The new colours, heading and body fonts and corner radii show on every block. No deploy was needed |
| 7 | Owner hub `/hub/website/pages/<page-id>/preview` (04-12) | Open any page's **Preview page** | The page renders in the same theme; the dark preview strip above it keeps the hub look |
| 8 | PB admin UI `/_/`, collection **audit_log** | Filter `organization = "<org-id>" && action = "theme.import"` | One new row with you as actor and the old and new theme hashes |
| 9 | Terminal at the repo root | To undo, restore the previous theme files from git (`git log -- design/tenants/<slug>` then `git checkout <commit> -- design/tenants/<slug>`) and repeat steps 3 to 5 | `Result  Imported. The site shows the new theme within a minute.` and within a minute the site shows the previous theme again |
