import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assembleMigrationsDir } from "../scripts/migrations-dir.mjs";

// PLAT-03 proof: the pinned PocketBase 0.39.11 binary applies every repo migration, reverts
// them, and applies them again. PB 0.39 exits 0 even on failure (Research Pitfall 3), so
// every assertion is on the parsed output, never the exit code.
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const FETCH_SCRIPT = join(PKG_DIR, "scripts", "fetch-pocketbase.mjs");
const FIRST = "1790000000_create_platform_meta.js";
// P8 (08-02): the stage and assembly-ledger migrations ride the same round trip.
const P8 = [
  "1790000650_update_organizations_stage_p8.js",
  "1790000660_update_org_intake_assembly.js",
];
// P14 (14-08): host verification, zones, moves, offboardings and the fake DNS world.
const P14 = [
  "1790000890_update_org_hosts_p14.js",
  "1790000891_create_dns_zones.js",
  "1790000892_create_domain_moves.js",
  "1790000893_create_offboardings.js",
  "1790000894_create_dns_fake_state.js",
  // 14-09: tenant-side review marks, sending, sitemap submit and test-form fields.
  "1790000895_create_launch_review_marks.js",
  "1790000896_update_business_profile_sending.js",
  "1790000897_update_org_indexing_submit.js",
  "1790000898_update_form_submissions_test.js",
];
// P15 (15-03): the hub /contact inquiries platform collection.
const P15 = ["1790000900_create_hub_inquiries.js"];
const SKIP_MESSAGE =
  "PocketBase binary not available offline; migration round-trip SKIPPED";
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const FAILURE = /error|failed|panic/i;

let binPath = "";
let dataDir = "";
// Core + add-on migrations, assembled into the temp dir (ADDON-03).
let migrationsDir = "";
let migrationCount = 0;

function runPb(
  args: string[],
  input?: string,
  dirs: { data: string; migrations: string } = {
    data: dataDir,
    migrations: migrationsDir,
  },
): string {
  const result = spawnSync(
    binPath,
    [
      "migrate",
      ...args,
      `--dir=${dirs.data}`,
      `--migrationsDir=${dirs.migrations}`,
      "--automigrate=false",
    ],
    { encoding: "utf8", input, timeout: 60_000 },
  );
  if (result.error) throw result.error;
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.replace(ANSI, "");
}

describe("PocketBase migration round trip (up -> down N -> up)", () => {
  beforeAll(() => {
    const fetched = spawnSync(
      process.execPath,
      [FETCH_SCRIPT, "--print-path"],
      {
        encoding: "utf8",
      },
    );
    if (fetched.status === 0 && fetched.stdout.trim()) {
      binPath = fetched.stdout.trim();
      dataDir = mkdtempSync(join(tmpdir(), "cds-pb-migrate-"));
      migrationsDir = join(dataDir, "migrations");
      migrationCount = assembleMigrationsDir(migrationsDir).length;
    } else {
      console.warn(SKIP_MESSAGE);
    }
  });

  afterAll(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it("applies, reverts and re-applies every repo migration", (ctx) => {
    if (!binPath) {
      // In CI the PLAT-03 proof must never vanish silently: fail instead of skipping.
      if (process.env.CI) {
        throw new Error(`${SKIP_MESSAGE} (CI is set, so this is a failure)`);
      }
      ctx.skip();
      return;
    }

    const up1 = runPb(["up"]);
    console.log(`[migrate up]\n${up1.trim()}`);
    expect(up1).toContain(`Applied ${FIRST}`);
    for (const f of [...P8, ...P14, ...P15])
      expect(up1).toContain(`Applied ${f}`);
    expect(up1).not.toMatch(FAILURE);

    // Count, never -1: "down -1" would also revert PocketBase's system migrations.
    const down = runPb(["down", String(migrationCount)], "y\n");
    console.log(`[migrate down ${migrationCount}]\n${down.trim()}`);
    expect(down).toContain(`Reverted ${FIRST}`);
    for (const f of [...P8, ...P14, ...P15]) {
      expect(down).toContain(`Reverted ${f}`);
    }
    expect(down).not.toMatch(/cancelled/i);
    expect(down).not.toMatch(FAILURE);

    // A leftover collection would fail here with "name must be unique".
    const up2 = runPb(["up"]);
    console.log(`[migrate up again]\n${up2.trim()}`);
    expect(up2).toContain(`Applied ${FIRST}`);
    expect(up2).not.toMatch(FAILURE);
  });
});

// 11-03 (DASH-14): the socials -> social_accounts data migration (1790000824), proven on the
// real binary. Two test-only migrations ride the assembled set: a seed ordered just before
// 824 (its down asserts 824's down removed the rows) and a check ordered just after it.
// PB exits 0 on a thrown migration, so each asserts by printing a marker or an error.
const SOCIALS_SEED = "1790000823_zz_test_seed_socials.js";
const SOCIALS_CHECK = "1790000824_zz_test_check_socials.js";
const SEED_JS = `
migrate((app) => {
  const orgs = app.findCollectionByNameOrId("organizations");
  const profiles = app.findCollectionByNameOrId("business_profile");
  const mk = (slug, socials) => {
    const o = new Record(orgs);
    o.set("name", slug); o.set("slug", slug); o.set("status", "active");
    app.save(o);
    const p = new Record(profiles);
    p.set("organization", o.id); p.set("socials", socials);
    app.save(p);
  };
  mk("socials-mig-a", [
    { platform: "instagram", url: "https://instagram.com/a" },
    { platform: "other", url: "https://ex.com" },
    { platform: "facebook", url: "not a url" },
  ]);
  mk("socials-mig-b", []);
}, (app) => {
  for (const slug of ["socials-mig-a", "socials-mig-b"]) {
    const o = app.findFirstRecordByData("organizations", "slug", slug);
    const left = app.findRecordsByFilter("social_accounts", "organization = {:o}", "", 0, 0, { o: o.id });
    if (left.length !== 0) throw new Error("SOCIALS_DOWN_LEFT " + left.length);
    for (const p of app.findRecordsByFilter("business_profile", "organization = {:o}", "", 0, 0, { o: o.id })) app.delete(p);
    app.delete(o);
  }
  console.log("SOCIALS_DOWN_OK");
});
`;
const CHECK_JS = `
migrate((app) => {
  const rows = (slug) => {
    const o = app.findFirstRecordByData("organizations", "slug", slug);
    return app.findRecordsByFilter("social_accounts", "organization = {:o}", "order", 0, 0, { o: o.id })
      .map((r) => [r.getString("platform"), r.getString("label"), r.getString("short_code"), r.getInt("order"), r.getString("url")].join("|"));
  };
  const a = rows("socials-mig-a").join(",");
  const want = "instagram||ig|0|https://instagram.com/a,custom|Other|go-1|1|https://ex.com";
  if (a !== want) throw new Error("SOCIALS_UP_MISMATCH " + a);
  if (rows("socials-mig-b").length !== 0) throw new Error("SOCIALS_UP_EMPTY_PROFILE_HAS_ROWS");
  console.log("SOCIALS_UP_OK");
}, (app) => {
  // Runs after 830's down (11-35): the accounts are copied back into the re-added field.
  const o = app.findFirstRecordByData("organizations", "slug", "socials-mig-a");
  const p = app.findFirstRecordByFilter("business_profile", "organization = {:o}", { o: o.id });
  const got = JSON.stringify(JSON.parse(p.getString("socials") || "null"));
  const want = JSON.stringify([
    { platform: "instagram", url: "https://instagram.com/a" },
    { platform: "other", url: "https://ex.com" },
  ]);
  if (got !== want) throw new Error("SOCIALS_RESTORE_MISMATCH " + got);
  console.log("SOCIALS_RESTORED_OK");
});
`;
// 11-35: after 1790000830 the business_profile.socials field is gone.
const SOCIALS_DROPPED = "1790000830_zz_test_check_socials_dropped.js";
const DROPPED_JS = `
migrate((app) => {
  const col = app.findCollectionByNameOrId("business_profile");
  if (col.fields.getByName("socials")) throw new Error("SOCIALS_FIELD_STILL_THERE");
  console.log("SOCIALS_DROPPED_OK");
}, () => {});
`;

describe("socials -> social_accounts data migration (11-03, DASH-14)", () => {
  let dir = "";
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("copies socials in order, maps other to custom/go-1, 830 drops the field, and down restores then removes them", (ctx) => {
    if (!binPath) {
      if (process.env.CI) throw new Error(`${SKIP_MESSAGE} (CI is set)`);
      ctx.skip();
      return;
    }
    dir = mkdtempSync(join(tmpdir(), "cds-pb-socials-"));
    const dirs = { data: dir, migrations: join(dir, "migrations") };
    assembleMigrationsDir(dirs.migrations);
    writeFileSync(join(dirs.migrations, SOCIALS_SEED), SEED_JS);
    writeFileSync(join(dirs.migrations, SOCIALS_CHECK), CHECK_JS);
    writeFileSync(join(dirs.migrations, SOCIALS_DROPPED), DROPPED_JS);

    const up = runPb(["up"], undefined, dirs);
    expect(up).toContain(
      "Applied 1790000824_migrate_socials_to_social_accounts.js",
    );
    expect(up).not.toMatch(FAILURE);
    expect(up).toContain("SOCIALS_UP_OK");
    expect(up).toContain(
      "Applied 1790000830_update_business_profile_drop_socials.js",
    );
    expect(up).toContain("SOCIALS_DROPPED_OK");

    // Revert back to (and including) the seed: everything from it to the end of the set.
    const names = readdirSync(dirs.migrations)
      .filter((f) => f.endsWith(".js"))
      .sort();
    const count = names.length - names.indexOf(SOCIALS_SEED);
    const down = runPb(["down", String(count)], "y\n", dirs);
    expect(down).toContain(
      "Reverted 1790000824_migrate_socials_to_social_accounts.js",
    );
    expect(down).not.toMatch(FAILURE);
    expect(down).toContain(
      "Reverted 1790000830_update_business_profile_drop_socials.js",
    );
    expect(down).toContain("SOCIALS_RESTORED_OK");
    expect(down).toContain("SOCIALS_DOWN_OK");
  });
});

// 14-08 (T-14-08-02, D13): 890 must keep existing custom hosts on the edge. A seed ordered
// just before 890 writes one custom and one preview host; a check just after it asserts the
// custom row got verified_at and the preview row did not, then writes a redirect row that
// 890's down must delete (the seed's down asserts it is gone and verified_at was removed).
const HOSTS_SEED = "1790000889_zz_test_seed_hosts.js";
const HOSTS_CHECK = "1790000890_zz_test_check_hosts.js";
const HOSTS_SEED_JS = `
migrate((app) => {
  const orgs = app.findCollectionByNameOrId("organizations");
  const hosts = app.findCollectionByNameOrId("org_hosts");
  const o = new Record(orgs);
  o.set("name", "hosts-mig"); o.set("slug", "hosts-mig"); o.set("status", "active");
  app.save(o);
  for (const [hostname, kind] of [["hosts-mig.example", "custom"], ["hosts-mig.sites.localhost", "preview"]]) {
    const h = new Record(hosts);
    h.set("hostname", hostname); h.set("organization", o.id); h.set("kind", kind); h.set("primary", kind === "custom");
    app.save(h);
  }
}, (app) => {
  const o = app.findFirstRecordByData("organizations", "slug", "hosts-mig");
  const rows = app.findRecordsByFilter("org_hosts", "organization = {:o}", "", 0, 0, { o: o.id });
  if (rows.length !== 2) throw new Error("HOSTS_DOWN_COUNT " + rows.length);
  const col = app.findCollectionByNameOrId("org_hosts");
  if (col.fields.getByName("verified_at")) throw new Error("HOSTS_DOWN_FIELD_LEFT");
  for (const r of rows) app.delete(r);
  app.delete(o);
  console.log("HOSTS_DOWN_OK");
});
`;
const HOSTS_CHECK_JS = `
migrate((app) => {
  const custom = app.findFirstRecordByData("org_hosts", "hostname", "hosts-mig.example");
  const preview = app.findFirstRecordByData("org_hosts", "hostname", "hosts-mig.sites.localhost");
  if (!custom.getString("verified_at")) throw new Error("HOSTS_CUSTOM_NOT_VERIFIED");
  if (preview.getString("verified_at")) throw new Error("HOSTS_PREVIEW_VERIFIED");
  const r = new Record(app.findCollectionByNameOrId("org_hosts"));
  r.set("hostname", "old-hosts-mig.example"); r.set("organization", custom.getString("organization"));
  r.set("kind", "redirect"); r.set("redirect_to", "hosts-mig.example");
  app.save(r);
  console.log("HOSTS_UP_OK");
}, () => {});
`;

describe("org_hosts P14 data fix (14-08)", () => {
  let dir = "";
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("verifies existing custom hosts, and down deletes redirect rows before narrowing kind", (ctx) => {
    if (!binPath) {
      if (process.env.CI) throw new Error(`${SKIP_MESSAGE} (CI is set)`);
      ctx.skip();
      return;
    }
    dir = mkdtempSync(join(tmpdir(), "cds-pb-hosts-"));
    const dirs = { data: dir, migrations: join(dir, "migrations") };
    assembleMigrationsDir(dirs.migrations);
    writeFileSync(join(dirs.migrations, HOSTS_SEED), HOSTS_SEED_JS);
    writeFileSync(join(dirs.migrations, HOSTS_CHECK), HOSTS_CHECK_JS);

    const up = runPb(["up"], undefined, dirs);
    expect(up).toContain("Applied 1790000890_update_org_hosts_p14.js");
    expect(up).not.toMatch(FAILURE);
    expect(up).toContain("HOSTS_UP_OK");

    const names = readdirSync(dirs.migrations)
      .filter((f) => f.endsWith(".js"))
      .sort();
    const count = names.length - names.indexOf(HOSTS_SEED);
    const down = runPb(["down", String(count)], "y\n", dirs);
    expect(down).toContain("Reverted 1790000890_update_org_hosts_p14.js");
    expect(down).not.toMatch(FAILURE);
    expect(down).toContain("HOSTS_DOWN_OK");
  });
});
