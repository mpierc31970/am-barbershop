# @cds/db

The platform's database package. It is the **only** place allowed to hold the PocketBase
SDK (Invariant 1, D5). An ESLint rule and `tests/deps-boundary.test.ts` enforce it. It hosts
the repository chokepoint, which takes organization context as a required argument.

## Public API (`src/index.ts`)

Named exports only. The PocketBase client, the context minters and the asserts stay internal.

| Area             | Exports                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contexts (types) | `OrgContext`, `PlatformContext`                                                                                                                                        |
| Repository       | `tenantRepo`, `requirePermission` (+ types `ListOptions`, `ReadRepo`, `WriteRepo`, `RecordData`)                                                                       |
| Sign-in          | `signInStaff`, `completeStaffSignIn`, `platformContextFromToken`, `signInMember`, `orgContextFromToken`, `setStaffRole`                                                |
| Members          | `addMember`, `changeRole`, `setAddonGrants`, `removeMember`, `transferOwnership`                                                                                       |
| Impersonation    | `startImpersonation`, `endImpersonation`                                                                                                                               |
| Audit            | `listAuditLog`, `AUDIT_LOG_RETENTION_DAYS`                                                                                                                             |
| Registry         | `TENANT_COLLECTIONS`, `ORGANIZATION_EXPORT_FIELDS`, type `CollectionSpec`                                                                                              |
| Host resolution  | `resolveOrganization`, `clearResolverCache`                                                                                                                            |
| Object storage   | `getObjectStore`, `assertValidKey`, key helpers (`tenantExportKey`, `tenantExportPrefix`, `tenantVersionKey`, `tenantAddonBackupKey`, `envPrefix`, `platformDbPrefix`) |
| Snapshots        | `toSnapshot`, `fromSnapshotRecord`, `SnapshotForbidden`                                                                                                                |
| Export / restore | `exportTenant`, `restoreTenant` (+ types `TenantBundle`, `ExportResult`, `RestoreResult`, `RestoreSkip`)                                                               |

`runNightlyExports` and `pruneExports` are deliberately **not** public: the nightly job
(`scripts/tenants-export.ts`) imports them from `src/export.ts`, and only it mints the
system context.

## Registry rule

Every collection with an `organization` field is declared in `src/registry.ts`, gets a
TEN-03 cross-tenant seed in the isolation suite, and has an approved `export` field list
(deny by default, D187; auth collections are `"never"`). `registry.integration.test.ts`
fails when a collection is missing, and `npm run docs:fields` regenerates
`docs/ops/export-field-lists.md` (a drift test compares it).

## Migrations

Migrations live in `pb_migrations/` and run on PocketBase **0.39.11** (JSVM, goja).

- **Name:** `<10-digit unix timestamp>_<snake_name>.js`. PocketBase applies them in file
  name order, so a migration that alters a collection must sort after the one that creates it.
- **Format:** a plain ES5-style script with no `import` or `export`. It calls
  `migrate(up, down)` once.
- **`down` is mandatory** (D19, restore rehearsal). PocketBase treats it as optional, so
  `test/migrations.test.ts` fails any file without it.
- The first migration, `1790000000_create_platform_meta.js`, creates `platform_meta`. All
  of its API rules are `null`, so it is superuser only. Tenant collections arrive in P2.

## Commands

| Command                  | What it does                                                                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:pb:fetch`    | Downloads PocketBase 0.39.11 into `.pocketbase/` (git-ignored). The sha256 is checked against the release `checksums.txt` and the download is aborted on a mismatch. It is idempotent.                                                 |
| `npm test`               | Runs the unit suite and the `db-integration` project. The integration project runs the real binary: `migrate up`, `migrate down N`, then `migrate up` again, against a throwaway data dir.                                             |
| `npm run db:migrate:dev` | **Dev only.** Copies the migrations to the dev PocketBase container `pocketbase-cdsp`, restarts it, then verifies `/api/health` and the `platform_meta` collection as superuser. Add `--dry-run` to print the plan without running it. |

## Round-trip notes

- PocketBase 0.39 `migrate` **exits 0 even when it fails**. The test asserts on the parsed
  output (`Applied …` / `Reverted …`) and never on the exit code.
- The test runs `down N`, where N is the number of repo migrations. It never runs
  `down -1`, which would also revert PocketBase's system migrations.
- If the binary cannot be fetched (offline), the test is skipped and logs
  `PocketBase binary not available offline; migration round-trip SKIPPED`.

## Dev push safety

`migrate-dev.mjs` hard-codes the container `pocketbase-cdsp`. It refuses any other name
passed through `--container` or `CDS_PB_CONTAINER`. The same host runs
**`pocketbase-cds`, the old site's live database, which must never be touched.**
Superuser credentials are read from `.env.local` inside the script. They are never
printed and never put on a command line.

## Integration tests

`test/*.integration.test.ts` run in the `db-integration` Vitest project against a throwaway
PocketBase 0.39.11 (`test/pb-harness.ts`: fresh migrations, a per-boot superuser, a free
loopback port, the OTP stand-in on).

```sh
npx vitest run --project db-integration                          # all of them
npx vitest run --project db-integration packages/db/test/export-restore.integration.test.ts
```

Offline without the binary they skip with a warning; in CI (`CI` set) a missing binary fails.

## Tenant export and restore

`npm run tenants:export` (nightly, 90-day prune) and `npm run tenants:restore` (super admin
with MFA). Steps: `docs/how-to/tenant-export-restore.md`.
