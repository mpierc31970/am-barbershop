# packages/addons

One package per add-on lives here, as `packages/addons/<slug>/` (Invariant 4). This is the
add-on authoring guide for the 05-04 contract. `testimonials/` and `credentials/` are the two
reference add-ons: copy one to start.

## Rules

- The registry (`packages/addon-registry`) discovers `packages/addons/*` at build time.
  Platform code imports add-ons **only** through the registry.
- An add-on never imports another add-on; it declares `requires` instead. It touches only
  its own collections and receives organization context as a parameter.
- Shared UI comes from `packages/ui`, never copied.
- Installing an add-on is never a migration (Invariant 3): its collections ship in the
  schema from day one and sit empty until installed.
- Removing an add-on disables and retains (Invariant 9). Adding it back restores everything.
- An add-on is not complete until someone can be taught to use it: `training/` plus a how-to
  (D110).

## Four entry points (and why)

Each add-on's `package.json` is named `@cds/addon-<slug>` and exports four entry points, so
server code never reaches a client bundle:

| Entry      | File             | Holds                                                                                                                    | Imported by                           |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `.`        | `index.ts`       | The manifest (`export default defineAddon({...})`). Pure and client-safe: no `@cds/db`, no `node:*`, no React components | The builder bundle, catalog, training |
| `./server` | `server.ts`      | Install/uninstall hooks, `blockData`, repo wiring. Node only                                                             | Tenant route, hub actions, scripts    |
| `./site`   | `site/index.ts`  | Visitor-side block renderers                                                                                             | The tenant site                       |
| `./admin`  | `admin/index.ts` | The hub `Panel` (client)                                                                                                 | The hub                               |

## Required files

| File                          | What it is                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                | Name `@cds/addon-<slug>`, the four `exports` above, `typecheck` script                                                                               |
| `tsconfig.json`               | Extends the workspace config                                                                                                                         |
| `addon.config.ts`             | Display constants: slug, name, summary, category, order, version. Never a price (D264)                                                               |
| `index.ts`                    | `defineAddon({...})` from `@cds/core/addons`                                                                                                         |
| `collections.ts`              | Each collection as a `CollectionSpec` with `feature: "addon:<slug>"` (checked at compose), `export` and `public` field lists (deny by default, D187) |
| `records.ts`                  | Owner-facing words and fields for each list (`singular`, `plural`, fields)                                                                           |
| `csv.ts`                      | Optional CSV import/export mapping (bulk import, D120)                                                                                               |
| `install.ts` / `uninstall.ts` | Seeded page and sections on install; what hides on removal                                                                                           |
| `sections/`                   | Block definitions (`section_type` is add-on-contributed, Invariant 5)                                                                                |
| `site/`, `admin/`             | The renderers and the admin `Panel`                                                                                                                  |
| `training/`                   | Title, video and steps (Invariant 4)                                                                                                                 |
| `migrations/*.js`             | The collection's PocketBase migrations (below)                                                                                                       |

## Migrations

- Migrations live in the add-on folder: `packages/addons/<slug>/migrations/*.js`.
- Each add-on owns one 100-block of timestamps: core `17900000xx`..`17900003xx`,
  testimonials `17900005xx`, credentials `17900006xx`, the next add-on the next free block.
  A duplicate basename or timestamp prefix is refused.
- PocketBase reads one migrations folder, so every consumer uses the assembled set:
  `npm run db:migrations:assemble -- <dir>` (tests, `db:migrate:dev` and the prod push).

## Registering a new add-on

1. Copy a reference add-on folder to `packages/addons/<slug>/` and rename.
2. Run `npm run addons:gen`. It regenerates `packages/addon-registry/src/generated/` (commit
   the output). `typecheck`, `test`, `build` and the Docker build run `npm run addons:check`
   first, which fails (and writes nothing) while the committed output is stale. `npm run dev`
   still regenerates it.
3. Add one line to the root `Dockerfile`:
   `COPY packages/addons/<slug>/package.json packages/addons/<slug>/`
   (`tests/structure.test.ts` checks it).
4. Run `npm ci` so the workspace links.

## Where it shows in the hub

- `nav: { placement: "tab", item: "website" }` with `records` (and optional `csv`) and an
  admin `Panel`: the add-on gets a Website tab automatically. No `apps/web` edit.
- `placement: "sidebar"`: the add-on needs its own `/hub/<slug>` route in `apps/web`.

## Lint rules (`packages/addons/**`)

- No `pocketbase` import: data goes through `@cds/db` (Invariant 1).
- From `@cds/db`, only `addonRepo` and types (`cds/addon-db-surface`). No `tenantRepo`,
  installer, publish or auth: an add-on touches only its own collections.
- No `@cds/addon-*` import: add-ons never import each other.
- From `next`, only `next/link` and `next/navigation`.
- No `process.env`, `process`, `globalThis`, `global`, `self` or `window`: org context is a
  parameter.
- No Node built-ins (`node:fs`, `node:process`, `path`, `http`, …) outside `*.test.ts`.
- React hooks rules (`rules-of-hooks`, `exhaustive-deps`) apply to every add-on file.

## Training and how-to

- `training/` holds the entry shown in the hub only while the add-on is on (ADDON-11).
- The how-to is `docs/how-to/addon-<slug>.md`, copied from `docs/how-to/TEMPLATE.md`.
  `addons:gen` bakes its **Use** steps into the bundle. `npm test` checks the structure.

## Premium add-ons (D154-D156)

A manifest with `premium` is refused at compose (build) unless:

- `premium.healthChecks` is non-empty. The monitor's `premium[]` entries come from these
  (`.planning/design/MONITOR-APP-BRIEF.md`).
- `premium.backups.collections` names declared collections and `premium.backups.offsite`
  is `true` (off-server backups).
- `externalDependencies` is listed. An empty list needs `premium.noExternalDependencies: true`.
- Every `externalDependencies` entry has a fallback and a `testedBy`, and every
  `premium.dependencies` key is a declared dependency.
- `premium.captureMode` describes the off-server capture mode with a `testedBy` (D155), or
  waives it with a reason (`{ waived: "..." }`) when the add-on takes no customer requests.
- `premium.runbook` is `docs/runbooks/<slug>.md` and that file exists.

Adding or renaming a premium add-on updates the monitor brief in the same commit (D174, D175).
