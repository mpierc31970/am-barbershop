# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state: design approved, unattended build (2026-09-26)

The design is **reviewed and approved**. On 2026-09-26 the user directed an **unattended
build of milestone v1.0** through the GSD workflow, driven by `scripts/runner/run.ps1`.
See **Unattended build mode** below. The prior CDS marketing site is preserved on
`archive/marketing-site-v1`.

**`PLATFORM-DESIGN.md` is the source of truth.** Read it before any work here. Its
numbered decisions are settled and must not be silently re-litigated. Cite them by number
(`D5`, `D32`) when a choice traces back to one.

See **Commands** below.

## What the platform is

CDS owns and operates a multi-tenant website platform. Tenants sign up; each gets its
own website hosted by CDS. Site components (booking, testimonials, credentials, events,
newsletter, store) are **installable add-on products** — the "component picker" model, priced
as a build fee plus a monthly base platform fee per path (support included) plus per-add-on
recurring; the Care Plan is an optional upgrade (D299, D300). CDS is never a payment
processor: tenants' customers pay on the tenant's own gateway (D296).

This is **not greenfield invention.** It is the extraction of a pattern that already
converged across ~12 live Next.js + PocketBase client sites. Target scale is **10–50
tenants** — a productized agency, not a mass-market SaaS. Prefer simplicity over fleet
automation accordingly.

## Decided stack

Next.js (App Router) + TypeScript, one shared PocketBase instance, monorepo, deployed by
Coolify. One Next.js application routes by hostname: the platform domain serves the hub,
onboarding and dashboards; a tenant hostname serves that tenant's site.

```
apps/web/               the single Next.js app
packages/db/            collections, migrations
packages/core/          tenancy resolution, auth, roles, entitlements
packages/ui/            shared design system
packages/templates/     site templates with named slots
packages/addons/<slug>/ one package per add-on
```

## Commands

Run from the repo root. Target Node 22 (`>=22.12`); Node 24 also works.

| Command | What it does |
|---|---|
| `npm ci` | Install every workspace from the lockfile |
| `npm run dev -w @cds/web` | Next dev server (hostname routing; `/api/health`) |
| `npm run build` | Typecheck all workspaces, then `next build`. Standalone output only when `NEXT_OUTPUT=standalone` (Docker) |
| `npm run lint` | eslint (`--max-warnings 0`) + `prettier --check` + typecheck. Enforces the Invariant 1 `pocketbase` import ban |
| `npm run format` | `prettier --write .` |
| `npm run typecheck` | `tsc` in every workspace |
| `npm test` | Vitest: unit + PocketBase 0.39.11 migration round trip. First run downloads the binary to `.pocketbase/` |
| `npx vitest run --project unit` | Fast loop: unit tests only |
| `npx vitest run --project db-integration` | Migration round trip only |
| `npm run db:pb:fetch` | Fetch + sha256-verify the pinned PocketBase binary |
| `npm run db:migrate:dev` | Push migrations to dev PB **`pocketbase-cdsp` only** (scp + restart + self-verify; `--dry-run` available). Pushes the assembled set: core **and** every `packages/addons/*/migrations` |
| `npm run db:restore-rehearse [-- --zip <file> \| --from-ssh pocketbase-cds] [-- --dry-run]` | Restore rehearsal (STAFF-13, D154): copies the newest `/root/pocketbase-cdsp/backups/cdsp-*.zip` (read-only; never the `pocketbase-cds` container), restores it into a throwaway pinned PocketBase, prints `Restore rehearsal · <zip> · N collections · N rows · newest migration … · OK`, records `backup:restore_rehearsed_at` on `PB_URL` and a dated line in `docs/ops/restore-rehearsal.md` (monitor check 40; quarterly). `--keep`, `--help` |
| `npm run db:migrations:assemble -- <dir>` | Copy core + add-on migrations into one folder, in order (PocketBase reads one folder). Use it for the prod push |
| `npm run addons:gen` | Regenerate the add-on registry barrels after adding an add-on folder (also runs before `dev`). `npm run addons:check` runs before `typecheck`, `test`, `build` and the Docker build, and fails on drift |
| `npm run addons:install -- --org <id> --addon <slug> --reason "…" [--uninstall]` | Staff add or remove any add-on (private too) for one org, then staff email, password, emailed code (super_admin, MFA; audited; `--dry-run`, `--help`) |
| `npm run tenants:seed-dev` | Dev only (`CDS_ENV=dev`, `SEED_OWNER_PASSWORD`): seed the themed `demo` / `demo-b` tenants; `-- --intake both` (or `complete` / `minimal`) seeds P8's intake fixtures instead (add `--assemble`, e.g. `-- --intake both --assemble`, to also assemble them on `*.sites.localhost`); `-- --blocks` seeds the every-block tenant on `blocks.localhost` (custom host; P7 exit fixture and Lighthouse target; needs `CDS_VIDEO_TRANSCODER=fake` without ffmpeg); `-- --stage <stage>` moves the seeded `demo` tenant to any stage for walks (forward via `setOrgStage`, backward is a dev-only reset). `--dry-run`, `--help` |
| `npm run docs:fields` | Regenerate `docs/ops/export-field-lists.md` from the registry (LIFE-03; a drift test checks it) |
| `npm run tenants:export` | Nightly job: export every org to `[dev/]tenants/<org>/exports/` + prune > 90 days (TEN-12; `--dry-run`, `--help`) |
| `npm run tenants:restore` | Restore one org: `-- --org <id> --key <export-key>`, then staff email, password, emailed code (super_admin only) |
| `npm run quotes:run` | Hourly job: quote reminders (day 1, day 3), expiry, purges; prod runs it via `POST /api/jobs/quotes` (`CDS_JOB_TOKEN`). `--dry-run`, `--help` |
| `npm run alerts:run [-- --dry-run]` | Every-5-minutes job: releases held phone alerts after quiet hours (one summary), collapses bursts, sends the 7am summary email (skipped when empty), prunes old alerts. Prod runs it via `POST /api/jobs/alerts` (`CDS_JOB_TOKEN`). `--dry-run`, `--help` |
| `npm run reports:monthly [-- --dry-run] [-- --org <id>]` | Monthly job (1st, business time): 'Your site this month' email to every member who keeps it on in their profile (on by default), five lines and one tip; skipped before launch and in the first partial month. Prod runs it via `POST /api/jobs/reports` (`CDS_JOB_TOKEN`). `--dry-run`, `--org`, `--help` |
| `npm run retention:run [-- --dry-run]` | Daily job: delete closed sites 30 days after closure (max 5 per run; lapsed never), signatures and acks past keep-until, audit rows past 2 years; payment records (invoices, work orders) are kept 7 years after a site is deleted; prints org names in the terminal only. Prod runs it via `POST /api/jobs/retention` (`CDS_JOB_TOKEN`). `--help` |
| `npm run site:assemble -- --org <id> [--rerun] [--dry-run]` | Staff assemble or re-run one org's site from its intake and print the slot report (super_admin or support_agent; staff email, password, emailed code; audited). Edited pages are left alone; deleted pages are never recreated |
| `npm run leads:list [-- --since 7d]` | Staff list of leads: saved quotes + sites still in setup (super_admin or support_agent; staff email, password, emailed code; `--dry-run`, `--help`) |
| `npm run fit:review -- --org <id> --approve\|--decline --reason "…"` | Print a held site's fit case, then clear or decline it; owner emailed (super_admin, MFA; audited; `--dry-run` prints the case only; asks y/N before acting, `--yes` skips it; a `blocked` verdict needs `--override-blocked`) |
| `npm run prices:set -- --kind <kind> --key <key> --path <path> --monthly\|--once <cents>` | Set one catalog price, or `--unset` for "Price coming soon"; prints old -> new; a changed amount also creates a new provider price (old one archived, D161). `-- --sync-all` creates missing provider prices for every priced row (once, when switching `CDS_PAYMENTS=stripe`). An add-on going to or from $0 prints the sites affected and asks y/N (`--yes` skips) (super_admin, MFA; audited; `--dry-run`, `--help`) |
| `npm run media:usage [-- --over] [-- --org <id>]` | Staff list of media storage per site (and delivery once Bunny stats exist) (super_admin or support_agent; staff email, password, emailed code; `--dry-run`, `--help`) |
| `npm run media:takedown -- --org <id> --asset <id> --reason "…"` | Staff take-down of one media file (D249): prints the case, asks y/N (`--yes` skips), deletes the row, removes its objects and purges the CDN (super_admin, MFA; audited; `--dry-run` prints the case only) |
| `npm run legal:gen` | Compile the five policies, the e-sign consent and the site policy templates into `@cds/core/legal` with sha256. `npm run legal:check` runs before `typecheck`, `test`, `build` and the Docker build and fails on drift. Never edit a published version: publish `v<N+1>` |
| `npm run agreements:verify -- --org <id>` | Staff check of an org's signed agreements: recomputes the evidence and document hashes, prints MATCH/MISMATCH, exit 1 on any failure (super_admin or support_agent; staff email, password, emailed code; audited) |
| `npm run retention:run [-- --dry-run]` | Daily job: deletes closed sites 30 days after closing, expired signatures/acks after 7 years, audit rows after 2 years, orphan exports after 90 days; max 5 sites per run. Payment records (invoices, work orders) are kept 7 years after a site is deleted. Prod runs it via `POST /api/jobs/retention` (`CDS_JOB_TOKEN`) |
| `npm run billing:reconcile [-- --since 24h\|<ISO>] [-- --dry-run]` | Hourly billing reconcile (PAY-02): re-reads CDS billing and Connect accounts and applies missed events through the webhook processor; prints the per-kind report. Prod runs it via `POST /api/jobs/billing` (`CDS_JOB_TOKEN`). `--help` |
| `npm run work:quote -- --org <id> --kind <kind> --title "…" --scope-file <md> [--ticket <n>]` | Staff quote for paid work (super_admin or support_agent; staff email, password, emailed code; audited); prints it, asks `Send to the owner? [y/N]`. `--ticket <n>` links it to that site's paid-service ticket (shows as View quote; accepting moves the ticket to In progress). `--help` |
| `npm run work:deliver -- --quote <id> [--dry-run]` | Deliver paid work: balance invoice, maintenance added, add-on installed. Prints the case, asks y/N (`--yes` skips; `--dry-run` prints only) (super_admin, MFA; audited). `--help` |
| `npm run care:log -- --org <id> --minutes <n> --note "…" [--ticket <ref>]` | Log Care Plan minutes (super_admin or support_agent; staff email, password, emailed code; audited; `--dry-run`, `--help`). `--ticket <n>` (`1042` or `#1042`) must be one of that site's tickets; any other ref is kept as free text |
| `npm run support:list [-- --org <id>] [--status open\|in_progress\|waiting\|resolved\|closed\|all] [--type …] [--sla at-risk\|missed]` | Staff list of support tickets across sites, most urgent first: #, org, type, status, age, time to SLA, assignee, paid category; footer `3 tickets · 1 at risk · 0 missed` (super_admin or support_agent; staff email, password, emailed code; read-only; `--dry-run`, `--help`) |
| `npm run support:show -- --ticket <n> [--download <file-id> --out <path>]` | Staff view of one ticket: header block and the full thread, internal notes marked `[internal]`, attachments with scan state; `--download` saves one file (super_admin or support_agent; staff email, password, emailed code; read-only; `--dry-run`, `--help`) |
| `npm run support:reply -- --ticket <n> (--body "…"\|--body-file <md>) [--internal] [--status <s>] [--assign <staff\|me\|none>] [--priority <p>] [--paid <category>] [--file <path>]...` | Staff reply or internal note, plus status, assignee, priority, paid-service mark and files; prints the reply as the owner sees it ("Mara · CDS"), asks `Send? [y/N]` (`--yes` skips; `--dry-run` prints only). Public replies and status moves alert the filer, Owners and Admins (super_admin or support_agent; staff email, password, emailed code; audited; `--help`) |
| `npm run support:open -- --org <id> --type problem\|change\|question\|billing --subject "…" (--body "…"\|--body-file <md>) [--target page:<id>\|addon:<slug>\|part:<key>] [--file <path>]...` | Staff open a ticket on a site's behalf (D210): "Opened by CDS", already answered for SLA, Owners and Admins alerted; asks `Open? [y/N]` (`--yes` skips; `--dry-run` prints only) (super_admin or support_agent; staff email, password, emailed code; audited; `--help`) |
| `npm run support:sla [-- --month 2026-10] [-- --org <id>]` | First-reply SLA for one business month: `October 2026 · first replies 18 · met 17 · missed 1 (#1031, 3h late)` (Problem/Question tickets created that month; CDS-opened tickets left out) (super_admin or support_agent; staff email, password, emailed code; read-only; `--dry-run`, `--help`) |
| `npm run cds:post -- --org <id> (--message "…"\|--message-file <md>) [--internal] \| (--note "…"\|--note-file <md>) --title "…" [--pin] \| --document <path> --title "…" [--doc-note "…"]` | Post a CDS message (or internal note), a note (optionally pinned) or a shared document to one site; prints it as the owner sees it, naming the business, asks `Post? [y/N]` (`--yes` skips), then `Posted. Bell and email (logged) for 3 people.` (super_admin or support_agent; staff email, password, emailed code; audited; `--dry-run`, `--help`) |
| `npm run service:window -- create --scope platform\|addon\|organization\|page\|component [--org <id>] [--addon <slug>] [--page <id>] [--component header\|footer\|menus\|<slug>] [--from <ISO\|HH:MM>] --until <ISO\|HH:MM> --message "…" [--incident I-3]` | Planned-work window: pauses editing for its target and shows the owner a notice (HH:MM is America/Chicago); asks `Create? [y/N]`, prints `Window W-12 · Rivera Bakery · page "About us" · now → 4:00 pm America/Chicago · …`. `-- list [--all]`, `-- clear --id W-12`. Platform and add-on windows need super_admin (support_agent: `Refused: …`, exit 1) (staff email, password, emailed code; audited; `--dry-run`, `--help`) |
| `npm run incident:run -- open --title "…" --public "…" \| link --incident I-3 --ticket 1042 \| resolve --incident I-3 [--message "…"] \| list [--all]` | Known problems across sites: open `I-n`, link tickets from any site (owner sees "Linked to a known problem"), resolve (asks y/N; every linked open ticket moves to Resolved: `Resolved I-3. 4 linked tickets moved to Resolved, 4 alerts raised.`) (super_admin or support_agent; staff email, password, emailed code; audited; `--dry-run`, `--help`) |
| `npm run ideas:run -- list [--hidden] [--merged] \| status --idea <id> --to considering\|planned\|built\|suggested \| merge --idea <id> --into <id> \| hide\|unhide --idea <id> \| edit --idea <id> [--title "…"] [--description "…"]` | Curate the Suggest a feature board: status resolves linked suggestion tickets (Built alerts voting sites), merge prints `Merged "X" into "Y" · votes 7 + 5 → 10 (2 sites voted for both).`; status and merge ask y/N (super_admin or support_agent; staff email, password, emailed code; audited; `--dry-run`, `--help`) |
| `npm run support:run [-- --dry-run]` | Hourly job: closes tickets Resolved 7 days with no reply, sends SLA-at-risk staff emails once per ticket, alerts sites when a planned-work window starts, clears ended windows, rescans pending attachments (when a scanner is set), prunes held drafts and staged uploads; heartbeat `job:support:last_success` (monitor check 32). Prod runs it via `POST /api/jobs/support` (`CDS_JOB_TOKEN`). `--dry-run`, `--help` |
| `npm run indexing:run [-- --dry-run]` | Weekly job (STAFF-17, D190): resubmits every live, non-demo site through the search pinger (logged stand-in until IndexNow, P14), checks each site's sitemap, records both per site in `org_indexing`; heartbeat `job:indexing:last_success` (monitor check 35). Prod runs it Sundays 06:00 UTC via `POST /api/jobs/indexing` (`CDS_JOB_TOKEN`). `--help` |
| `npm run review:run [-- --dry-run]` | Hourly job (STAFF-23, STAFF-22, D248): rescans content queued during a scanner outage (clean resolves, held/unsure goes to the review queue), suspends sites whose hosting notice passed its fix-by, and on Mondays (America/Chicago) opens spot checks for 5 live sites once a week; heartbeat `job:review:last_success` (monitor check 33). Prod runs it via `POST /api/jobs/review` (`CDS_JOB_TOKEN`). `--help` |
| `npm run demo:reset [-- --now] [-- --dry-run]` | Nightly job (STAFF-18, D293): wipes and reseeds only the permanent demo tenant "Bella's Salon" (slug `demo`, `demo: true`, preview host only; created on the first run), keeping its id and host; acts at 3 am America/Chicago once a day (`--now` resets whatever the hour); heartbeat `job:demo:last_success` (monitor check 36). Prod runs it hourly via `POST /api/jobs/demo` (`CDS_JOB_TOKEN`). `--help` |
| `npm run health:run [-- --dry-run]` | Every-5-minutes job (STAFF-13, STAFF-14, D154): evaluates the monitor thresholds and emails staff (`CDS_STAFF_ALERT_EMAIL`) once per incident (opened, escalated to critical, resolved; state in platform_meta `health:incident:<check>`), pulls fail-safe requests (none until the capture service is deployed), prunes staff sessions older than 30 days; heartbeat `job:health:last_success` (monitor check 34). Prod runs it via `POST /api/jobs/health` (`CDS_JOB_TOKEN`). `--help` |
| `npm run domains:check -- --domain <d> [--json]` | Read-only check of a domain's DNS before a move (P14, DOM-05): sweeps its own nameservers + RDAP (always the real public resolver), prints the email / verification / site / other summary and gate G2-G6, ends `Read-only: nothing was written.` No sign-in. `--help` |
| `npm run domains:run [-- --dry-run]` | Every-5-minutes job (P14-P18): steps backfill (preview hosts), moves, sending (SES identities), handbacks, offboarding (notice end) and health (once per UTC day after 06:00, claim `domains:health:<YYYY-MM-DD>`); prints `domains:run · moves N advanced, M waiting on owner · handbacks N · offboarding N · health ran\|skipped · 1.2s`; heartbeat `job:domains:last_success` (monitor check 42). Prod runs it via `POST /api/jobs/domains` (`CDS_JOB_TOKEN`). `--help` |
| `npm run domains:move -- --org <id> --to <domain> --reason "…" [--dry-run] [--yes]` | Move a live site to a new domain (super_admin; staff email, password, emailed code; audited): prints the case, asks `Start move? [y/N]`, then `Move M-14 started · step 1 snapshot · owner emailed.`; the old domain then redirects while it stays on CDS DNS. Refuses a site that isn't live, has no custom domain, or has an open move. `--help` |
| `npm run org:offboard -- --org <id> start\|status\|cancel [--reason "…"] [--dry-run] [--yes]` | Offboard a site (LIFE-01, D282): `status` prints the Leaving CDS checklist (`[done] [open] [locked]`), `Notice ends …` and the DNS handback per domain (super_admin or support_agent); `start` / `cancel` print the case and ask y/N, `--reason` 3-500 (super_admin, MFA). Staff email, password, emailed code; audited; `--help` |
| `npm run hub:claims [-- --json]` | Read-only table of the hub's competitor claims (HUB-06): id, competitor, verified on, age (days), status, then `9 claims · 0 verified · 9 draft · oldest verified none` and `Read-only: nothing was written.` Re-verify every 6 months (monitor check 51 warns > 150 days, critical > 183; how-to `docs/how-to/staff-hub-claims.md`). No sign-in. `--help` |
| `npm run hub:cutover -- plan\|check\|apply\|rollback [--dry-run] [--yes] [--expect-sha <sha>] [--mailboxes-ready]` | Moves `connectionsdesignstudios.com` + `www` from the archived site's Coolify app to `cds-platform-prod` (HUB-04): `plan` / `--dry-run` touch nothing; `check` is read-only (Coolify GETs, public DNS, ssh read-only prod `_migrations`), one PASS/FAIL/WARN row each; `apply` asks you to type the apex, saves `.planning/tmp/cutover-state.json`, auto-rolls back on a failed deploy or verify, stops (never deletes) the old app; `rollback` reverses from the saved state. Runbook `docs/ops/hub-cutover.md`; never touches `pocketbase-cds`. `--help` |
| `npm run analytics:set -- --org <id> [--ga4-measurement G-…] [--ga4-property <n>] [--gsc-site <url\|sc-domain:host>] [--owner cds\|tenant] [--clear]` | Record a site's GA4 / Search Console ids (GA4 loads only after statistics consent); prints old -> new; `none` removes one field (super_admin or support_agent; staff email, password, emailed code; audited; `--dry-run`, `--help`). Runbook `docs/ops/ga4-search-console.md` |
| `npm run org:decline -- --org <id> --reason-category <fit\|capacity\|scope\|other> [--note "…"]` | Decline a paid order: full refund, site closed, owner emailed (super_admin, MFA; audited; asks y/N, `--yes` skips; `--dry-run`, `--help`) |
| `npm run org:stage -- --org <id> [--to <stage>] [--build-note "…"\|--clear-note]` | Move a site's stage forward (super_admin; asks y/N, `--yes` skips; backward refused, `live` final and sets `launched_at`) or set the "What CDS is doing now" note (support_agent too); no flags prints the stage and note (staff email, password, emailed code; audited; `--dry-run`, `--help`) |
| `npm run announce:set -- --title "…" [--body "…"] [--href <url>] [--paths standard,studio] [--days 14]` | Set the one CDS announcement owners see in From CDS on Today (prints the card, asks y/N, `--yes` skips; replaces the active one), or `-- --clear` to end it (super_admin, MFA; audited; `--dry-run`, `--help`) |
| `npm run lighthouse` | P7 Lighthouse gate (CONT-15; preview strip audited on the preview host, P14): throwaway PocketBase, every-block tenant on `blocks.localhost` (with Builder Pro since P10: a two-step Pro form on `/visit`, a Pro table on `/`) plus the assembled complete-intake Home on `intake-complete.sites.localhost` (P8), plus the public `/report` page on `localhost` (P13), plus the hub pages `/`, `/pricing`, `/studio`, `/add-ons`, one add-on, `/contact` at D314 thresholds (P15), `next start` on :3100, mobile perf ≥ 0.85, a11y ≥ 0.95, SEO ≥ 0.95, best practices ≥ 0.9. Needs Chrome (`CHROME_PATH`) and `npm run build` first (builds if missing). Reports in `.lighthouseci/`. `--keep`, `--help` |

### Definition of done (every phase)

- `npm run lint`, `npm test` and `npm run build` are green on a clean checkout; a phase that
  changes tenant-facing render also runs `npm run lighthouse` green locally.
- **How-to written:** each shipped component or feature has a how-to in `docs/how-to/`,
  copied from `TEMPLATE.md` (D110, PLAT-07). `npm test` validates it.
- The monitor brief is updated when anything monitored changes (D174, D175).
- Human checks are listed in `.planning/HUMAN-CHECKS.md`, never blocking.

## Architectural invariants

These are the constraints most easily violated by code that looks correct in isolation.

**1 · One chokepoint owns all database access.** Every query goes through a repository
layer that takes organization context as a **required, non-optional argument**. No other
code may hold a PocketBase client. Tenant isolation lives here and nowhere else —
PocketBase writes go through a superuser client, so API rules do not protect tenants.
Every collection needs a test that attempts a cross-tenant read *and* write and asserts
failure. This layer is also the seam that keeps a future Postgres migration a swap
rather than a rewrite.

**2 · Never branch or version per tenant.** One codebase, one `main`, every tenant on
the same version. Tenant differences are **configuration and feature flags, never code**.
If a tenant "needs a code change," that is a signal it should become a setting or a new
add-on — built once, sellable to the next customer. Risky changes roll out behind a flag
to a canary organization first; the code is identical everywhere, only the flag differs.

**3 · Installing an add-on is never a migration.** Every add-on's collections ship in
the schema from day one and sit empty until installed. Install = seed `page_sections`
rows, seed records, grant entitlement. This is what makes one-click install instant, and
it is the reason the database is shared rather than per-tenant.

**4 · Add-ons are isolated packages.** An add-on never imports from another add-on (it
declares a dependency instead), touches only its own collections, receives org context
as a parameter rather than reading global state, and takes shared UI from `packages/ui`
rather than copying it. The registry auto-discovers `packages/addons/*`; platform code
imports add-ons **only** through the registry.

Each package also ships a **`training/` module** — title, video, written steps — shown in
the dashboard only for add-ons a tenant has installed. Training is versioned with the
add-on rather than stored per organization, because it is identical for every tenant.
**An add-on is not complete until someone can be taught to use it.**

This applies to **every component and user-facing feature, core included** (D110). When
one is finished, write its **how-to**: the exact steps to **activate** it and then **use**
it, each step giving the screen/route, the action, and the expected result. These steps
are the script for the Remotion + Venice AI how-to and showcase videos made once the
system is built — so write them precisely enough to record from.

**Premium add-ons are monitored (D154).** Booking and **every future premium service** ship
with the same standard: per-tenant health checks, early-warning signals, alerts to CDS
staff, a health view in the staff console, off-server backups with a rehearsed restore,
and a recovery runbook — plus a **fail-safe capture mode** hosted off the main server so
no booking request is lost during an outage (D155). The principle behind it (D156):
**premium services never cost tenants money** — every premium add-on defines a tested
fallback for each dependency it relies on. **A premium add-on is not complete
without all of it.**

**The monitor app reads this repo (D174, D175).** A separate CDS monitor web app, built
later, watches the platform from outside. Its spec for the platform side is
**`.planning/design/MONITOR-APP-BRIEF.md`**. Any change that adds, removes or renames
something worth monitoring (a premium add-on, an external dependency, a host, a backup
job, a field of `GET /api/monitor/status`) **updates that brief in the same commit.**

**Booking terminology is fixed (D176–D178).** Two paths: **Standard** (practitioners,
stores, coaches) and **Studio** (salons, spas, barbers, any staff-based service business).
Use these words exactly, in docs and in code:

| Word | Add-on (package) | Path | Meaning |
|---|---|---|---|
| **Appointment** | Appointments (`appointments`) | Standard | Pick a person from an owner-labeled list, then an open fixed-length slot |
| **Booking** | Studio Booking (`studio-booking`) | Studio only | A service with a qualified staff member, within schedules, resources, renters (D144–D168) |
| **Registration** | Events (`events`) | Standard | Many people sign up for one scheduled event |

Appointments and Studio Booking **share no logic** and are **never offered on the same
path**. If a feature seems to belong to both, it is two features.

**5 · `section_type` is add-on-contributed.** In the donor repos it is a fixed union in
`types/content.ts`. Here the registry extends it at build time. This is the one
deliberate change to the inherited content model.

**6 · Layout belongs to the container, not the content.** Inherited from the donor page
builder and worth preserving: every predefined section block is full-width only. Only
the `columns` block chooses a split, so there is exactly one place layout is picked.

**7 · Tenants build within the theme (D183, revised 2026-09-24).** CDS builds the first
version: a laid-out home page plus one more page. After launch, **every page is
tenant-editable** in the page builder: add pages, add, reorder and remove **predefined
blocks**. The theme is fixed per site, and every block renders from it, so tenants cannot
go off-brand. Never a free-form canvas, never raw styling. Suggested blocks cover common
layouts, and add-on blocks are data-bound (Our Team fills from Studio Booking staff).
Every page keeps its last 10 versions with restore (D184). 10 pages are included, then
+5 for $10/mo (D185).

**Snapshots are JSON in Wasabi, never database rows (D187).** Page versions, add-on
backups and tenant exports are written as JSON to `cds-platform/tenants/<org-id>/…`, and
published pages are served from their JSON. Every snapshot uses an **approved field
list per collection (deny by default)**. Passwords, hashes, tokens, API keys, credentials
and auth collections are **never** written, and a test proves it.

**8 · Theme is data, not a deploy.** Per-organization design tokens live in
`organization.design` (the `impeccable` `design.json` schema). Authored as files, then
synced into the org record.

**9 · Uninstall disables and retains.** Reinstalling restores. A billing lapse disables
an add-on; it never deletes tenant data.

**10 · Two separate user populations.** Platform users (CDS staff + org members, roles
Owner/Admin/Editor/Viewer plus per-add-on grants) and tenant end users (the tenant's own
customers) live in **different auth collections**. Never merge them. Staff access to a
tenant is impersonation, always written to the audit log.

## Donor repositories

Components are ported from existing private repos under `github.com/mpierc31970`. The
port baseline is **`DCR-Website`** — the newest, and the one that already replaced
hardcoded section components with the columns page builder.

| Repo | What comes from it |
|---|---|
| `DCR-Website` | Page builder, `lib/pb/*` data access, rich text, media, admin shell, SES, credentials |
| `palm-science` | Booking admin suite (12 components) |
| `barutispa` | Fuller `MediaLibrary`, SEO schema components |
| `texas-ceu-app` | LMS — a later phase |
| `tarotafterdark` | Passwordless auth flow, email capture |
| ~~`cds-website` (pre-reset)~~ | **Nothing.** The old marketing-site code is discarded; newsletter ports from `DCR-Website` instead |

Do **not** port from `metaphysicalevents` (it is Supabase-backed, with hardcoded
feature-flag and tier literals). Astrology/advice/directory and the TxLEC
legislative-watch components are explicitly dropped.

## Repo history — the reset is done

`mpierc31970/cds-website` was emptied and reused as the platform repo on 2026-09-23.

| Ref | Holds |
|---|---|
| `main` | This platform project |
| `archive/marketing-site-v1` | The complete prior marketing site, at `2374b6f3` |
| `archive-marketing-site-v1` (tag) | The same commit, immutable |

**Nothing from the prior site is carried forward.** The user directed explicitly that no
previously written CDS-website material influence this project — old code, docs and
planning are all discarded rather than ported. They remain on the archive branch only as
a safety net. **Do not mine them for design input.**

The old site's Coolify app (`CDS Website deploy`, uuid `vok4o448cw0ggws08cg40048`) now
builds from `archive/marketing-site-v1` (switched 2026-09-24), so a redeploy is safe.

## Infrastructure and access

**Check your own access before asking the user for anything.** You have SSH to both
VPSes, a Hostinger API token and a Coolify API token on this machine. Ask only after
searching and coming up empty, and say where you looked.

| Access | Where |
|---|---|
| SSH, data VPS `31.220.21.126` | `ssh pocketbase-cds` (alias in `~/.ssh/config`) |
| SSH, Coolify VPS `82.180.132.176` | `ssh -i ~/.ssh/pocketbase-cds root@82.180.132.176` |
| Hostinger API (DNS, VPS; whole account) | token in `~/.hostinger_token`; DNS at `https://developers.hostinger.com/api/dns/v1/zones/<domain>` |
| Coolify API | token in `.env.local` `COOLIFY_API_TOKEN` (**value is single-quoted: strip `'`**; same token unquoted in `~/.coolify_api_token`); `http://82.180.132.176:8000/api/v1` |
| PB superuser | `.env.local` `PB_SUPERUSER_EMAIL` / `PB_SUPERUSER_PASSWORD` |

Secrets never go into chat output. Write them straight to files.

**Dev environment (built 2026-09-24, same shape as DCR-Website):**

| Piece | Value |
|---|---|
| App | `https://cds.needtobeedgy.com`: Coolify project `CDS Platform`, app `cds-platform-dev` (uuid `aasywyddkdqysddgwjlgikmt`). **Placeholder nginx page from an inline Dockerfile** until P1, then switch to the repo's Dockerfile |
| PocketBase | `https://api.cds.needtobeedgy.com` (admin `/_/`): container **`pocketbase-cdsp`**, pinned `0.39.11`, loopback `127.0.0.1:8093`, `/root/pocketbase-cdsp/` |
| Migrations | `npm run db:migrate:dev` (scps the assembled core + add-on migrations into `/root/pocketbase-cdsp/pb_data/pb_migrations/` and hooks, then `docker restart pocketbase-cdsp` and self-verifies) |
| Backups | `/root/pocketbase-cdsp/backup.sh`, cron 04:10, 14 days local + offsite `wasabi:cds-platform/dev/db` (90 days, D171) |
| DNS | Hostinger zone `needtobeedgy.com`: `cds` → 82.180.132.176, `api.cds` → 31.220.21.126. **No wildcard** |

**Production PocketBase (created 2026-09-27, empty until launch):**

| Piece | Value |
|---|---|
| PocketBase | `https://pb.connectionsdesignstudios.com` (admin `/_/`): container **`pocketbase-cdsp-prod`**, pinned `0.39.11`, loopback `127.0.0.1:8094`, 1 GB / 1 CPU, `/root/pocketbase-cdsp-prod/` |
| Credentials | superuser in `.env.local` `PB_PROD_SUPERUSER_EMAIL` / `PB_PROD_SUPERUSER_PASSWORD`; `PB_APP_KEY` only in `/root/pocketbase-cdsp-prod/.env` (copy it to the production app's env at launch) |
| Migrations | assemble with `npm run db:migrations:assemble -- <tmpdir>`, then `scp` **the assembled dir** (core + add-on migrations; never `packages/db/pb_migrations` alone, or add-on collections are skipped) into `/root/pocketbase-cdsp-prod/pb_data/pb_migrations/` and `packages/db/pb_hooks` into `/root/pocketbase-cdsp-prod/pb_hooks/`, then `docker restart pocketbase-cdsp-prod`. Deployed through P3 (15 migrations) on 2026-09-27; P5-P13's are pending (P11: `1790000810`-`1790000840`; P12: `1790000850`-`1790000862`; P13: `1790000870`-`1790000879`; HUMAN-CHECKS) |
| Backups | `/root/pocketbase-cdsp-prod/backup.sh`, cron 04:20, 14 days local + offsite `wasabi:cds-platform/platform/db` (D171) |
| DNS | Hostinger zone `connectionsdesignstudios.com`: `pb` → 31.220.21.126 |
| App | Coolify project `CDS Platform`, environment **`live`** (the project's older `production` environment holds the **dev** app), app **`cds-platform-prod`** (uuid `3l6gwamoblvy8znte9nsxbuv`), 1 GB / 1 CPU. **Placeholder nginx page** on its sslip.io address only; no real domain until cutover (the apex still serves the old site). Env set: `CDS_ENV=production`, `PB_URL`, `PB_APP_KEY`, `TRUSTED_PROXY_HOPS=1` |

- **`pocketbase-cds` is NOT ours.** It is the old marketing site's live database
  (`api.connectionsdesignstudios.com`). Never touch it.
- Caddy config is `/root/edge-caddy/Caddyfile`, a single-file bind mount. Back it up,
  append with `>>` (never `sed -i`), then `caddy validate` and `caddy reload` inside
  `supabase-caddy`. Add the route **after** DNS resolves, so Let's Encrypt doesn't fail.
- Coolify deploys are `POST /api/v1/deploy?uuid=…&force=true`. From Git Bash, set
  `MSYS_NO_PATHCONV=1`, or `/applications`-style arguments get rewritten into Windows paths.
- The by-hand sequence (DNS API → proxy route → cert → HTTPS check) is exactly what
  **D169** makes a one-click platform operation. Live tenants are on their own domains
  (D54). D57's `<tenant>.sites.connectionsdesignstudios.com` is **preview only**, marked
  by a thin "in development" strip and `noindex` (D170).

## Working preferences

- **User experience is the priority in every component discussion (D119).** Not a Wix —
  a curated set of components, each as easy and as flexible as it needs to be. Always ask
  "what makes this person's job a little easier?" and propose the small workflow
  innovation (e.g. bulk CSV import instead of one-by-one entry, D120).

- **Keep answers short and scannable.** The user has ADHD. Lead with the answer; cut
  justification to a line or omit it. Bullets and tables over paragraphs. Long-form
  content goes in a file, not chat.
- **Use the Write tool for file content, never bash heredocs.** Large heredocs fail
  outright on Windows (`ENAMETOOLONG: uv_spawn`).
- **Design discussion is closed** unless the user reopens it. The design was approved
  on 2026-09-26 and the build runs unattended (below).

## Planning workflow

This project uses GSD (`.planning/` with `PROJECT.md`, `ROADMAP.md`, `REQUIREMENTS.md`,
`STATE.md` and per-phase directories), matching the other repos in this fleet.
`PLATFORM-DESIGN.md` is the ingest input for that scaffolding.

The `impeccable` design skill (v0.1.5) is installed at the user level and is how
per-tenant design systems are authored.

## Unattended build mode (user direction 2026-09-26)

The user is not at the keyboard. The runner starts one headless session per phase.

- **Never wait on the user.** Where a GSD workflow would call AskUserQuestion (grey areas,
  human verification, verification gaps, blockers, milestone audit, cleanup), pick the
  **recommended option yourself** and record the choice in the phase's SUMMARY or CONTEXT.
  Decide details yourself; only a choice that **costs money** is not yours: take the free
  path and list the paid option in `.planning/GO-LIVE.md`.
- **Human checks are deferred, never blocking.** Anything that needs a person to look at or
  test goes into `.planning/HUMAN-CHECKS.md` (phase, what to check, where). The user does
  all visual checks after the whole milestone is built.
- **UI/UX uses the `impeccable` design standard.** Every tenant-facing, owner-hub, staff
  console and hub-site screen is designed and reviewed with the `impeccable` skill, and
  UI phases produce a UI-SPEC through it. Owner-hub navigation follows the DCR-Website
  admin pattern (D311).
- **External services use stand-ins until the user provides accounts.** Stripe test mode,
  logged-not-sent email, local disk backups, keyword-only screening, app-served media,
  **DRAFT**-marked legal text. Each stand-in sits behind the real interface and is listed
  in `.planning/GO-LIVE.md` with the account or key it needs. Never buy, sign up or accept
  terms on the user's behalf.
- **Usage and context limits.** Run `pwsh scripts/runner/usage.ps1` (or
  `powershell -File ...`) between plans. If `usage.ps1` reports OVER (session **95%** or weekly **93%**), or this
  session's context is past about **70%**, stop cleanly: commit, write a handoff to
  `.base/handoffs/` (`base handoff create --project cds-platform --doc <file>`), then exit.
  The runner waits for the limit to reset and resumes the same phase.
- One phase per session. **Commit after every plan (atomic commits), but never push.**
  The user wants **one push at the end**: the final milestone session runs
  `git push --follow-tags` once. Anything that needs the remote (e.g. P1's Coolify deploy
  check) is verified in that final session and, until then, listed in HUMAN-CHECKS.md.
  Never force-push, never rewrite history.

