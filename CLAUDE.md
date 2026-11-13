# CLAUDE.md

Guidance for Claude Code in this repository.

## What this is

**A&M Barber Studio's website.** A single-site fork of the CDS platform (`~/cds-website`),
copied once on 2026-11-10 and owned here from now on. CDS changes are **not** synced.

- Own repo (`github.com/mpierc31970/am-barbershop`), own PocketBase, own Coolify app.
  Shares nothing at runtime with CDS.
- The multi-tenant engine is kept as-is. A&M is the **only** organization in the database
  (Studio path, Builder Pro installed), seeded once.
- CDS-only surfaces are off: the marketing hub (`/`, `/pricing`, `/studio`, `/add-ons`, ...),
  the `/start` signup and quote flow, CDS billing (`/hub/checkout`, `/hub/settings/billing`),
  Stripe Connect (`/hub/settings/connect`) and the abuse `/report` page answer **404**
  (`isCdsOnlyPath` in `apps/web/middleware.ts`). `/privacy`, `/unsubscribe` stay.
- Branding: the public footer has no Report link; its one CDS mention is the "Website by
  Connections Design Studios" credit. Everything else users see says A&M Barber Studio.
- Payment is **in store only**: Settings › Payments and Billing tabs, their help articles and
  the payout/billing alert types are hidden (`HIDDEN_SETTINGS_TABS`, `HELP_HIDDEN`,
  `alertTypesFor`).
- CDS staff jobs (fit review, decline, prices, demo reset, indexing) are not scheduled.
- Sign-ins (`npm run am:roles`, passwords in `.env.local` `AM_*`): website admin
  matthew@metaphysicalevents.com = staff super_admin (`/staff/sign-in`, password + emailed
  code), not a shop member; shop owners (`/sign-in`): Miguel = pierce1970+BarberOwner@gmail.com and Mike = anmbarberstudio@gmail.com (`AM_COOWNER_*`, own Employee seat "Mike"); Miguel
  shop and his own Employee seat; barbers pierce1970+barber1-4@gmail.com (`AM_BARBER_EMAIL`) (renter seats, own seat only).
  Public contact email (site, privacy, form notifications) is the owner's, pierce1970+BarberOwner@gmail.com;
  matthew@ is only the admin sign-in and technical contact.

`PLATFORM-DESIGN.md` documents the inherited engine (decisions `D<n>`). Treat it as
reference, not as a roadmap for this site.

## Hosts

| Host | Serves |
|---|---|
| `barber.needtobeedgy.com` | The public site, plus `/sign-in`, `/hub/*`, `/staff/*`, `/invite/*` (`SITE_ADMIN_HOST`, middleware `SITE_ADMIN_PATHS`); `CDS_PLATFORM_URL` points here |
| `admin.barber.needtobeedgy.com` | `PLATFORM_HOSTS` (must stay set); its pages 301 to the site host, `/api/*` still answers |
| `api.barber.needtobeedgy.com` | PocketBase (admin `/_/`) |
| `am-barber.localhost:3000` | Local dev host for the site |

## Commands

Run from the repo root. Node 22 (`>=22.12`).

| Command | What it does |
|---|---|
| `npm ci` | Install every workspace |
| `npm run dev -w @cds/web` | Next dev server (hostname routing; `/api/health`) |
| `npm run build` | Typecheck, then `next build` (`NEXT_OUTPUT=standalone` in Docker) |
| `npm run lint` | eslint + prettier check + typecheck |
| `npm test` | Vitest: unit + PocketBase 0.39.11 migration round trip |
| `npx vitest run --project unit` | Unit tests only |
| `npm run db:migrations:assemble -- <dir>` | Core + add-on migrations into one folder (what PocketBase reads) |
| `npm run site:assemble -- --org <id>` | Assemble the site from its intake |
| `npm run lighthouse` | Lighthouse gate (needs Chrome and a build) |

Most other `npm run` scripts in `package.json` are CDS staff tools inherited from the
fork; they work against this PocketBase but are rarely needed here.

## Invariants (inherited, still enforced by lint and tests)

1. **One chokepoint owns all database access** (`packages/db`). Nothing else holds a
   PocketBase client; every query takes org context. Lint bans `pocketbase` imports elsewhere.
2. **Installing an add-on is never a migration.** Collections ship in the schema; install
   seeds rows and grants entitlement.
3. **Add-ons are isolated packages** under `packages/addons/<slug>`, reached only through
   the registry (`npm run addons:gen` after adding one).
4. **Layout belongs to the container**: predefined blocks are full-width; only `columns`
   splits.
5. **Theme is data**: design tokens live in `organization.design` (`design.json` schema),
   authored under `design/tenants/<slug>/`, must pass the contrast solver.
6. **Snapshots are JSON with deny-by-default field lists**; secrets are never written.
7. **Two separate user populations** (platform users vs the site's own customers). Never merge.

## Infrastructure

| Piece | Value |
|---|---|
| Coolify | project `A&M Barbershop` (`sd4qjlj1iejgscgqpuwip2sq`), app `am-barbershop-web` (`nimbbo698focxngxsvbxiqoi`), builds `main` from the public GitHub repo with the repo `Dockerfile`; 1g / 1 CPU; env names mirror `.env.local` |
| PocketBase | container `pocketbase-ambarber`, pinned 0.39.11, loopback `127.0.0.1:8095`, `/root/pocketbase-ambarber/` on the data VPS `31.220.21.126`; superuser in `.env.local` `PB_SUPERUSER_*`, backup bot `PB_BOT_*` |
| Backups | `/root/pocketbase-ambarber/backup.sh`, cron 04:30, 14 days local + `wasabi:am-barbershop/db` |
| DNS | Hostinger zone `needtobeedgy.com`: `barber`, `admin.barber` → 82.180.132.176; `api.barber` → 31.220.21.126 |
| Proxy | `/root/edge-caddy/Caddyfile` on the data VPS (`api.barber` route) |

Access (same machine credentials as cds-website): `ssh pocketbase-cds` (data VPS),
`ssh -i ~/.ssh/pocketbase-cds root@82.180.132.176` (Coolify VPS), `~/.hostinger_token`,
`~/.coolify_api_token` (`http://82.180.132.176:8000/api/v1`; set `MSYS_NO_PATHCONV=1` in
Git Bash). Secrets live in `.env.local` only, never in chat.

- **Never touch** `pocketbase-cds`, `pocketbase-cdsp`, `pocketbase-cdsp-prod`, or any other
  Coolify app.
- Caddy: back up the Caddyfile, append with `>>` (never `sed -i`), `caddy validate` and
  `caddy reload` inside `supabase-caddy`. Add a route only after its DNS resolves.
- Migrations: `npm run db:migrations:assemble -- <tmpdir>`, scp that dir into
  `/root/pocketbase-ambarber/pb_data/pb_migrations/` and `packages/db/pb_hooks` into
  `/root/pocketbase-ambarber/pb_hooks/`, `docker restart pocketbase-ambarber`, check `_migrations`.
- Deploy: push `main`, then `POST /api/v1/deploy?uuid=<app>&force=true`.
- Storage: the app's local-disk object store (published pages, media) lives on the Coolify
  volume `nimbbo698focxngxsvbxiqoi-am-barbershop-data` mounted at `/data`
  (`CDS_STORAGE_DIR=/data/storage`, `CDS_PUBLIC_STORAGE_DIR=/data/storage-public`, set in the
  Dockerfile).

## Seeding the site

`npm run am:seed` (`packages/db/scripts/seed-am-barber.ts`) is idempotent: org, owner
(`AM_OWNER_EMAIL`, default pierce1970+BarberOwner@gmail.com), theme, intake, assembly, Builder Pro, booking form, pages,
service rows, primary host, stage live. Run against prod with
`CDS_ENV=production CDS_STORAGE_DIR=<dir>/storage CDS_PUBLIC_STORAGE_DIR=<dir>/storage-public
CDS_EMAIL_TRANSPORT= PLATFORM_HOSTS=admin.barber.needtobeedgy.com npm run am:seed`, then tar
`<dir>` and extract it into the volume's `_data` on the Coolify VPS (`chown -R 1001:1001`).
Live caches catch up within 5 minutes. Local dev: `AM_HOST=am-barber.localhost`.

Later site updates go through `npm run am:site` (`packages/db/scripts/seed-am-site.ts`): theme,
Gallery page, Home services/slider, About. Same env, but point the storage dirs at a fresh copy
of the live volume and copy back only the changed files (a fresh empty dir would overwrite the
live `published/index.json`).

## Git

`C:\Users\guypa` is itself a git repo. **Never use worktrees.** Run git with
`-C C:/Users/guypa/am-barbershop` and check `git rev-parse --show-toplevel` before committing.

## Working preferences

- Short, scannable answers. Lead with what's open.
- Use the Write tool for file content, never large bash heredocs (Windows `ENAMETOOLONG`).
- Confirm before anything that costs money.
