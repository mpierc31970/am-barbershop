// Nightly tenant export (TEN-12, D171, D187). Exports EVERY organization to object storage
// as one JSON bundle and prunes that organization's exports older than 90 days. Production
// runs it as a Coolify scheduled task (wired in the final milestone session).
//
// Usage:
//   npm run tenants:export              export every org, prune > 90 days
//   npm run tenants:export -- --dry-run list orgs and target keys, write nothing
//   npm run tenants:export -- --help
//
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script), CDS_ENV (unset = dev/ key prefix; "production" = no prefix),
// CDS_STORAGE_DIR (local-disk stand-in root, default <repo>/.storage),
// WASABI_ACCESS_KEY_ID / WASABI_SECRET_ACCESS_KEY / WASABI_REGION / WASABI_BUCKET (use Wasabi).
// Output is one STORE line (store and key prefix, WR-07), then PASS / FAIL lines only;
// credentials are never printed. A partial Wasabi config fails before any export. Exit 1 if
// any org failed.
// Registers add-on collections before anything reads the composed registry (05-04).
import "@cds/addon-registry/server";
import { listOrganizationIds, runNightlyExports } from "../src/export";
import { describeObjectStore, tenantExportKey } from "../src/storage";

const USAGE = `tenants:export - nightly per-tenant JSON export + 90-day prune (TEN-12)

  npm run tenants:export              export every organization, prune exports > 90 days
  npm run tenants:export -- --dry-run list organizations and target keys, write nothing
  npm run tenants:export -- --help    this text

Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)
     CDS_ENV (unset: dev/ prefix), CDS_STORAGE_DIR, WASABI_* (optional)`;

const REQUIRED_ENV = ["PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"];

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.name === "ClientResponseError" ? "database error" : err.message;
  }
  return "unknown error";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const unknown = args.filter((a) => a !== "--dry-run");
  if (unknown.length > 0) fail(`unknown argument ${unknown[0]}`);
  for (const name of REQUIRED_ENV) {
    if (!process.env[name]) fail(`${name} is not set`);
  }
  console.log(`STORE ${describeObjectStore()}`);

  if (args.includes("--dry-run")) {
    const now = new Date();
    const orgs = await listOrganizationIds();
    for (const orgId of orgs) {
      console.log(`DRY RUN ${orgId} -> ${tenantExportKey(orgId, now)}`);
    }
    console.log(`DRY RUN ${orgs.length} organization(s); nothing written`);
    return;
  }

  const res = await runNightlyExports();
  for (const { orgId, key } of res.exported) {
    console.log(`PASS exported ${orgId} -> ${key}`);
  }
  console.log(`PASS pruned ${res.pruned.length}`);
  for (const { orgId, error } of res.failed) {
    console.error(`FAIL export ${orgId}: ${error}`);
  }
  if (res.failed.length > 0) process.exit(1);
}

main().catch((err: unknown) => fail(describeError(err)));
