// Staff price setting (ONB-06; CONTEXT A2-Q2; D181, D264, D299, D300; UI-SPEC "Staff CLI
// output"). Sets or clears one price_catalog row through setPrice, after a CDS staff MFA
// sign-in (prices_set: super_admin only). Audited with before and after (T-06-50).
// plan, care_plan, addon and pack are monthly (--monthly); build_fee, extra, service and
// setup_fee are one-time (--once). --unset marks the item "Price coming soon".
// P10 (10-11, BILL-18, D161): a changed amount also creates a new provider price (the old one
// is archived, so existing subscriptions keep their price). --sync-all creates the provider
// prices every priced row is missing (run once when CDS_PAYMENTS switches to stripe).
//
// Usage:
//   npm run prices:set -- --kind addon --key testimonials --path standard --monthly 900
//   npm run prices:set -- --kind extra --key copywriting --path studio --once 25000
//   npm run prices:set -- --kind addon --key credentials --path standard --unset
//   npm run prices:set -- --sync-all [--dry-run] [--yes]
//   npm run prices:set -- --help
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials, codes and provider price ids are never printed.
// Registers add-on manifests before the registry is read (add-on names, 05-04).
import "@cds/addon-registry/server";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { EXTRAS, PATHS } from "@cds/core/onboarding";
import type { CatalogItemKind, CatalogRow } from "@cds/core/pricing";
import {
  pendingPriceSyncs,
  priceCase,
  setPrice,
  syncAllPrices,
  type PendingPriceSync,
} from "../src/catalog";
import { getCdsBilling } from "../src/payments/factory";
import {
  ask,
  fail,
  parseArgs,
  requireEnv,
  runMain,
  signInStaffInteractive,
  table,
  wantsHelp,
} from "./staff-cli";

const USAGE = `prices:set - set one catalog price (super_admin, MFA)

  npm run prices:set -- --kind <kind> --key <key> --path <path> --monthly <cents> [--dry-run] [--yes]
  npm run prices:set -- --kind <kind> --key <key> --path <path> --once <cents> [--dry-run]
  npm run prices:set -- --kind <kind> --key <key> --path <path> --unset [--dry-run]
  npm run prices:set -- --sync-all [--dry-run] [--yes]
  npm run prices:set -- --help

--kind     monthly: plan (key base), care_plan (key care), addon (an add-on slug),
                    pack (media-5gb, media-25gb, pages-5)
           one-time: build_fee (key base), extra (copywriting, logo-design, sourced-photos,
                    rush-launch), service (polish-hour), setup_fee (key addon)
--path     standard or studio
--monthly  monthly price in cents (900 = $9.00/mo)
--once     one-time price in cents (150000 = $1,500.00)
--unset    show "Price coming soon" instead of a price
--sync-all create the payment provider prices every priced row is missing
           (run once after switching CDS_PAYMENTS to stripe)
--dry-run  check the arguments and print what would be set (or synced), without signing in
--yes      skip the y/N confirm (--sync-all, or an add-on price going to or from $0)
An add-on at $0/mo is included free for every site on that path: setting one to $0, or
moving it off $0, prints how many sites it affects and asks y/N first.
Studio Booking keys (studio-booking-*) are priced on --path studio only.
A changed amount also creates a new payment provider price; existing subscribers keep
their old price. Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

const SAVED = "Saved. The configurator shows the new price on its next load.";
const KINDS: readonly CatalogItemKind[] = [
  "plan",
  "build_fee",
  "care_plan",
  "addon",
  "extra",
  "pack",
  "service",
  "setup_fee",
];
const MONTHLY: readonly CatalogItemKind[] = [
  "plan",
  "care_plan",
  "addon",
  "pack",
];
/** P10 pack keys (D185, D225). */
const PACKS: Readonly<Record<string, string>> = {
  "media-5gb": "Media pack, 5 GB",
  "media-25gb": "Media pack, 25 GB",
  "pages-5": "Page pack, 5 pages",
};
/** P10 service keys (D297). */
const SERVICES: Readonly<Record<string, string>> = {
  "polish-hour": "Design polish, per hour",
};
/** Catalog-only add-on rows whose packages ship later (BILL-10, D180; v1.1). */
const CATALOG_ONLY_ADDONS: Readonly<Record<string, string>> = {
  "studio-booking-solo": "Studio Booking, Solo (1 staff)",
  "studio-booking-team": "Studio Booking, Team (2-5 staff)",
  "studio-booking-large-team": "Studio Booking, Large team (6+ staff)",
  newsletter: "Newsletter",
  "landing-pages": "Landing pages",
};
const PRICED_PATHS = ["standard", "studio"] as const;
type PricedPath = (typeof PRICED_PATHS)[number];
const CENTS_RE = /^\d{1,8}$/;
const DOLLARS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fromMap(map: Readonly<Record<string, string>>, key: string): string {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key]! : "";
}

/** The item's display name; unknown keys are refused so a typo never creates a row. */
function labelOf(kind: CatalogItemKind, key: string): string {
  switch (kind) {
    case "plan":
      if (key !== "base") fail("--kind plan uses --key base");
      return "Base platform fee";
    case "build_fee":
      if (key !== "base") fail("--kind build_fee uses --key base");
      return "Build fee";
    case "care_plan":
      if (key !== "care") fail("--kind care_plan uses --key care");
      return "Care Plan";
    case "addon": {
      const m = ADDON_REGISTRY.get(key);
      if (m) return m.name;
      const label = fromMap(CATALOG_ONLY_ADDONS, key);
      if (!label) fail(`unknown add-on ${key.slice(0, 64)}`);
      return label;
    }
    case "extra": {
      const e = EXTRAS.find((x) => x.key === key);
      if (!e) fail(`unknown extra ${key.slice(0, 64)}`);
      return e.label;
    }
    case "pack": {
      const label = fromMap(PACKS, key);
      if (!label) fail(`unknown pack ${key.slice(0, 64)}`);
      return label;
    }
    case "service": {
      const label = fromMap(SERVICES, key);
      if (!label) fail(`unknown service ${key.slice(0, 64)}`);
      return label;
    }
    case "setup_fee":
      if (key !== "addon") fail("--kind setup_fee uses --key addon");
      return "Add-on setup fee";
  }
}

/** WR-A03: a $0 add-on row is plan-included for every org on its path. */
function freeImpact(
  label: string,
  pathLabel: string,
  toFree: boolean,
  orgs: number | null,
): string {
  const count =
    orgs === null ? "" : ` (${orgs} ${orgs === 1 ? "site" : "sites"})`;
  return toFree
    ? `This makes ${label} included free for every ${pathLabel} site${count}.`
    : `This ends ${label} being included free for every ${pathLabel} site${count}; sites that have not installed it lose it.`;
}

function money(cents: number | null, monthly: boolean): string {
  if (cents === null) return "Price coming soon";
  return `${DOLLARS.format(cents / 100)}${monthly ? "/mo" : ""}`;
}

function centsOf(row: CatalogRow | null, monthly: boolean): number | null {
  if (!row) return null;
  return monthly ? row.monthlyCents : row.oneTimeCents;
}

function providerWord(): string {
  return getCdsBilling().provider === "stripe" ? "Stripe" : "test";
}

function intervalLabel(p: PendingPriceSync): string {
  const amount = DOLLARS.format(p.cents / 100);
  if (p.interval === "month") return `${amount}/mo`;
  if (p.interval === "year") return `${amount}/yr`;
  return `${amount} once`;
}

async function syncAll(dryRun: boolean, yes: boolean): Promise<void> {
  requireEnv();
  const pending = await pendingPriceSyncs();
  if (pending.length === 0) {
    console.log("Every priced item already has its payment provider prices.");
    return;
  }
  console.log(
    table(
      ["Kind", "Key", "Path", "Price"],
      pending.map((p) => [p.kind, p.key, p.path, intervalLabel(p)]),
    ),
  );
  if (dryRun) {
    console.log(
      `DRY RUN would create ${pending.length} provider prices; nothing saved`,
    );
    return;
  }
  const ctx = await signInStaffInteractive();
  if (!yes) {
    const answer = await ask(
      `Create ${pending.length} ${providerWord()} prices? (y/N) `,
    );
    if (!/^y(es)?$/i.test(answer)) {
      console.log("Cancelled. Nothing was created.");
      return;
    }
  }
  const { created, skipped } = await syncAllPrices(ctx);
  console.log(
    `Created ${created} ${providerWord()} prices (${skipped} already in place).`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), {
    known: [
      "--kind",
      "--key",
      "--path",
      "--monthly",
      "--once",
      "--unset",
      "--sync-all",
      "--dry-run",
      "--yes",
    ],
    withValue: ["--kind", "--key", "--path", "--monthly", "--once"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  if (args.has("--sync-all")) {
    const conflicting = [
      "--kind",
      "--key",
      "--path",
      "--monthly",
      "--once",
      "--unset",
    ].filter((f) => args.has(f));
    if (conflicting.length > 0) {
      fail(`--sync-all takes no ${conflicting.join(", ")}`);
    }
    await syncAll(args.has("--dry-run"), args.has("--yes"));
    return;
  }
  const kind = args.get("--kind");
  const key = args.get("--key");
  const path = args.get("--path");
  if (typeof kind !== "string" || !KINDS.includes(kind as CatalogItemKind)) {
    fail(`--kind must be one of ${KINDS.join(", ")}`);
  }
  if (typeof key !== "string" || key === "") fail("--key <key> is required");
  if (
    typeof path !== "string" ||
    !(PRICED_PATHS as readonly string[]).includes(path)
  ) {
    fail(`--path must be one of ${PRICED_PATHS.join(", ")}`);
  }
  const itemKind = kind as CatalogItemKind;
  const label = labelOf(itemKind, key);
  const pathLabel =
    PATHS.find((p) => p.id === path)?.label ?? String(path).slice(0, 20);

  const given = ["--monthly", "--once", "--unset"].filter((f) => args.has(f));
  if (given.length !== 1) {
    fail("give exactly one of --monthly <cents>, --once <cents> or --unset");
  }
  const monthly = MONTHLY.includes(itemKind);
  let cents: number | null = null;
  if (!args.has("--unset")) {
    const flag = monthly ? "--monthly" : "--once";
    const raw = args.get(flag);
    if (typeof raw !== "string") {
      fail(
        `${itemKind} is priced ${monthly ? "monthly" : "one-time"}; use ${flag} <cents>`,
      );
    }
    if (!CENTS_RE.test(raw)) fail(`${flag} must be whole cents, like 900`);
    cents = Number(raw);
  }
  if (
    itemKind === "addon" &&
    key.startsWith("studio-booking") &&
    path !== "studio"
  ) {
    fail(
      "Studio Booking is offered on the Studio path only; use --path studio",
    );
  }

  if (args.has("--dry-run")) {
    if (itemKind === "addon" && cents === 0) {
      console.log(freeImpact(label, pathLabel, true, null));
    }
    console.log(
      `DRY RUN would set ${label}, ${pathLabel} to ${money(cents, monthly)}; nothing saved`,
    );
    return;
  }

  const ctx = await signInStaffInteractive();
  if (itemKind === "addon") {
    const c = await priceCase(ctx, {
      kind: itemKind,
      key,
      path: path as PricedPath,
    });
    const toFree = cents === 0 && c.currentCents !== 0;
    const fromFree = c.currentCents === 0 && cents !== 0;
    if (toFree || fromFree) {
      console.log(
        `${label}, ${pathLabel}: ${money(c.currentCents, true)} -> ${money(cents, true)}`,
      );
      console.log(freeImpact(label, pathLabel, toFree, c.pathOrgs));
      if (!args.has("--yes")) {
        const answer = await ask("Save this price? (y/N) ");
        if (!/^y(es)?$/i.test(answer)) {
          console.log("Cancelled. Nothing was saved.");
          return;
        }
      }
    }
  }
  const { before, after, synced } = await setPrice(ctx, {
    kind: itemKind,
    key,
    path: path as PricedPath,
    ...(monthly ? { monthlyCents: cents } : { oneTimeCents: cents }),
  });
  console.log(
    `${label}, ${pathLabel}: ${money(centsOf(before, monthly), monthly)} -> ${money(centsOf(after, monthly), monthly)}`,
  );
  if (synced > 0) console.log(`${providerWord()} price updated.`);
  console.log(SAVED);
}

runMain(main);
