// npm run lighthouse: the P7 Lighthouse gate (CONT-15, D237, D188 (8), 07-CONTEXT resolution h;
// 07-33 choices 7, 8, 12). Boots a throwaway PocketBase (bootPb: assembled core + add-on
// migrations), seeds the every-block tenant on blocks.localhost with seedBlocksTenant (the same
// fixture the CLI --blocks flag and the exit test use), then seeds and assembles the complete
// intake fixture with seedAssembledIntake (P8, 08-20; the same helper as the seed CLI's
// --intake complete --assemble and the phase exit test) so the assembled complete-intake Home
// on intake-complete.sites.localhost is audited too, builds the app when no build exists,
// then runs the local `lhci autorun --config=lighthouserc.json` against `next start` on :3100.
//
// Preview hosts are noindex,nofollow by design (D170), so Lighthouse's is-crawlable audit
// always fails there and caps the SEO category near 0.69. lighthouserc.json therefore uses an
// assertMatrix: blocks.localhost keeps the four category gates; *.sites.localhost keeps the
// performance, accessibility and best-practices gates and asserts every other SEO audit at 1.
// P13 (13-51): the public /report page on the platform host (localhost is in PLATFORM_HOSTS)
// is audited too. It is noindex (13-30), so it gets the same rule as the preview host. The
// Turnstile widget uses Cloudflare's public always-pass test site key when
// NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset, so no key is passed here.
// P15 (15-28, P15-P22, D314): the CDS hub pages on localhost (/, /pricing, /studio, /add-ons,
// /add-ons/testimonials, /contact) are audited too, with the D314 thresholds (performance
// 0.90, accessibility 0.95, best practices 0.95; SEO per audit at 1, is-crawlable excluded
// because the hub is noindex outside production). The seeded catalog leaves some rows
// unpriced ("Price coming soon"), so every unpriced active price_catalog row gets a fixed
// demo amount first and the price runs render real figures, as they will in production.
//
// Safety (T-07-33-02/03/04): no --env-file. The app and the seed get an explicit env that
// points only at the throwaway PocketBase and temp storage dirs, so the real dev or prod
// database is never written. Passwords are random and held in memory only, never printed.
// Reports go to .lighthouseci/ (filesystem upload only; never temporary-public-storage).
//
// Usage:
//   npm run lighthouse              boot, seed, run lhci, print per-URL scores, clean up
//   npm run lighthouse -- --keep    leave PocketBase and the temp dirs running for debugging
//   npm run lighthouse -- --help
//
// Needs Chrome: CHROME_PATH, else the standard install paths. No Chrome -> exit 1 (never a
// silent pass). Exit code is lhci's.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const USAGE = `lighthouse - Lighthouse gate (CONT-15, D314): every-block tenant, assembled Home, /report, CDS hub

  npm run lighthouse              throwaway PocketBase + seed + lhci autorun (next start :3100)
  npm run lighthouse -- --keep    leave PocketBase and the temp dirs for debugging
  npm run lighthouse -- --help    this text

Thresholds (lighthouserc.json, mobile): performance >= 0.85, accessibility >= 0.95,
SEO >= 0.95, best practices >= 0.9 on /, /gallery and /visit of blocks.localhost,
and the assembled complete-intake Home on intake-complete.sites.localhost (P8; a noindex
preview host, D170, so every SEO audit except is-crawlable must score 1 there), and the
public /report page on the platform host localhost (P13; noindex by design, same SEO rule).
CDS hub pages on localhost (P15, D314): /, /pricing, /studio, /add-ons,
/add-ons/testimonials and /contact need performance >= 0.90, accessibility >= 0.95,
best practices >= 0.95 and every SEO audit except is-crawlable at 1 (noindex off
production). Unpriced catalog rows get demo prices so price runs show figures.
Needs Chrome (CHROME_PATH or a standard install) and builds apps/web when no build exists.
Never reads .env.local; reports stay in .lighthouseci/.`;

const KNOWN_FLAGS = new Set(["--keep", "--help", "-h"]);
const ROOT = process.cwd();
const BUILD_ID = join(ROOT, "apps", "web", ".next", "BUILD_ID");
const LHCI_CLI = join(ROOT, "node_modules", "@lhci", "cli", "src", "cli.js");
const MANIFEST = join(ROOT, ".lighthouseci", "manifest.json");
const PREVIEW_SUFFIX = "sites.localhost";

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

/** CHROME_PATH, else the standard install paths, else google-chrome / chromium on PATH. */
export function findChrome(): string | null {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const candidates: string[] = [];
  if (process.platform === "win32") {
    const roots = [
      process.env["PROGRAMFILES"],
      process.env["PROGRAMFILES(X86)"],
      process.env["LOCALAPPDATA"],
    ].filter((r): r is string => Boolean(r));
    for (const r of roots) {
      candidates.push(join(r, "Google", "Chrome", "Application", "chrome.exe"));
    }
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    );
  }
  for (const c of candidates) if (existsSync(c)) return c;
  if (process.platform !== "win32") {
    for (const name of ["google-chrome", "google-chrome-stable", "chromium"]) {
      const r = spawnSync("which", [name], { encoding: "utf8" });
      const p = r.status === 0 ? r.stdout.trim() : "";
      if (p) return p;
    }
  }
  return null;
}

/** price_catalog kinds billed monthly (mirrors catalog.ts MONTHLY_KINDS); the rest are one-time. */
const MONTHLY_KINDS = new Set(["plan", "care_plan", "addon", "pack"]);
/** Fixed demo amounts (cents) for rows the migrations seed unpriced. */
const DEMO_CENTS: Record<string, number> = {
  plan: 4900,
  care_plan: 9900,
  addon: 1500,
  pack: 1000,
  build_fee: 150000,
  extra: 30000,
};

/**
 * P15: give every unpriced active price_catalog row on the throwaway PocketBase a demo price,
 * so the hub's price runs render figures (never "Price coming soon" everywhere). Writes only
 * the throwaway database; the rows the migrations already price keep their amounts.
 */
async function seedHubPrices(): Promise<number> {
  const { withSuperuser } = await import("../src/client");
  return withSuperuser(async (pb) => {
    const rows = await pb.collection("price_catalog").getFullList({
      filter: pb.filter("active = {:a} && priced = {:p}", {
        a: true,
        p: false,
      }),
    });
    for (const r of rows) {
      const kind = String(r.item_kind);
      const cents = DEMO_CENTS[kind] ?? 1500;
      const column = MONTHLY_KINDS.has(kind)
        ? "monthly_cents"
        : "one_time_cents";
      await pb
        .collection("price_catalog")
        .update(r.id, { priced: true, [column]: cents });
    }
    return rows.length;
  });
}

function run(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

type ManifestEntry = {
  url: string;
  isRepresentativeRun?: boolean;
  summary?: Record<string, number>;
};

function printScores(): void {
  if (!existsSync(MANIFEST)) {
    console.log("INFO no .lighthouseci/manifest.json written");
    return;
  }
  const entries = JSON.parse(readFileSync(MANIFEST, "utf8")) as ManifestEntry[];
  for (const e of entries.filter((x) => x.isRepresentativeRun)) {
    const s = e.summary ?? {};
    const fmt = (k: string) =>
      typeof s[k] === "number" ? s[k].toFixed(2) : "n/a";
    console.log(
      `SCORE ${e.url} performance ${fmt("performance")} accessibility ${fmt("accessibility")} seo ${fmt("seo")} best-practices ${fmt("best-practices")}`,
    );
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  for (const a of args) if (!KNOWN_FLAGS.has(a)) fail(`unknown flag ${a}`);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  const keep = args.includes("--keep");

  const chrome = findChrome();
  if (!chrome) {
    fail("Chrome not found: install Google Chrome or set CHROME_PATH");
  }
  if (!existsSync(LHCI_CLI)) fail("@lhci/cli is not installed: run npm ci");

  // Explicit env for the seed (this process) and the app (lhci's startServerCommand). Set
  // before any @cds/db module loads, so nothing can reach a real database.
  const privDir = mkdtempSync(join(tmpdir(), "cds-lh-storage-"));
  const pubDir = mkdtempSync(join(tmpdir(), "cds-lh-public-"));
  const tokenSecret = randomBytes(24).toString("hex"); // 48 chars
  process.env.CDS_ENV = "dev";
  process.env.CDS_VIDEO_TRANSCODER = "fake";
  process.env.CDS_STORAGE_DIR = privDir;
  process.env.CDS_PUBLIC_STORAGE_DIR = pubDir;
  process.env.CDS_MEDIA_TOKEN_SECRET = tokenSecret;
  process.env.CDS_PREVIEW_HOST_SUFFIX = PREVIEW_SUFFIX;
  delete process.env.CDS_MEDIA_CDN;

  const { bootPb } = await import("../test/pb-harness");
  const pb = await bootPb();
  if (!pb) {
    rmSync(privDir, { recursive: true, force: true });
    rmSync(pubDir, { recursive: true, force: true });
    fail("PocketBase binary missing: run npm run db:pb:fetch");
  }

  try {
    console.log(`PASS throwaway PocketBase on ${pb.url}`);
    const [{ importThemeDir }, { ADDON_REGISTRY }, blocks] = await Promise.all([
      import("@cds/core/theme/import"),
      import("@cds/addon-registry/server"),
      import("../src/dev-seed-blocks"),
    ]);
    const theme = importThemeDir("design/tenants/demo", { root: ROOT });
    const seeded = await blocks.seedBlocksTenant(
      {
        ownerPassword: randomBytes(18).toString("base64url"),
        pagePassword: randomBytes(18).toString("base64url"),
        design: theme.design,
      },
      { registry: ADDON_REGISTRY },
    );
    console.log(
      `PASS seeded "${blocks.BLOCKS_SLUG}" on ${seeded.host}: ${Object.keys(seeded.pages).join(", ")}`,
    );

    // P8: the assembled Home (CONTEXT A4-Q4). Random owner password, never printed.
    const { seedAssembledIntake } = await import("./seed-assembly");
    const assembled = await seedAssembledIntake("complete", {
      ownerPassword: randomBytes(18).toString("base64url"),
    });
    console.log(
      `PASS assembled "complete" intake on ${assembled.previewHost} (${assembled.result.status})`,
    );

    // P15: demo prices for the unpriced catalog rows, so the hub pages show figures.
    const priced = await seedHubPrices();
    console.log(
      `PASS priced ${priced} unpriced catalog rows for the hub pages`,
    );

    const appEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      Path: process.env.Path,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      TMPDIR: process.env.TMPDIR,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      PROGRAMFILES: process.env.PROGRAMFILES,
      CI: process.env.CI,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      CHROME_PATH: chrome,
      PB_URL: pb.url,
      PB_SUPERUSER_EMAIL: pb.email,
      PB_SUPERUSER_PASSWORD: pb.password,
      PB_APP_KEY: pb.appKey,
      CDS_ENV: "dev",
      CDS_STORAGE_DIR: privDir,
      CDS_PUBLIC_STORAGE_DIR: pubDir,
      CDS_MEDIA_TOKEN_SECRET: tokenSecret,
      CDS_VIDEO_TRANSCODER: "fake",
      CDS_PREVIEW_HOST_SUFFIX: PREVIEW_SUFFIX,
      PLATFORM_HOSTS: "localhost,cds.needtobeedgy.com",
    };
    for (const k of Object.keys(appEnv)) {
      if (appEnv[k] === undefined) delete appEnv[k];
    }

    if (!existsSync(BUILD_ID)) {
      console.log(
        "INFO no apps/web build found: building (npm run build -w @cds/web)",
      );
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      const code = await new Promise<number>((resolve, reject) => {
        // npm.cmd needs a shell on Windows; the arguments are fixed literals.
        const child = spawn(npm, ["run", "build", "-w", "@cds/web"], {
          env: appEnv,
          stdio: "inherit",
          shell: process.platform === "win32",
        });
        child.on("error", reject);
        child.on("exit", (c) => resolve(c ?? 1));
      });
      if (code !== 0) fail("build failed");
    }

    rmSync(join(ROOT, ".lighthouseci"), { recursive: true, force: true });
    const code = await run(
      process.execPath,
      [LHCI_CLI, "autorun", "--config=lighthouserc.json"],
      appEnv,
    );
    printScores();
    if (code === 0) console.log("PASS lighthouse thresholds met");
    else console.error(`FAIL lighthouse (lhci exit ${code})`);
    return code;
  } finally {
    if (keep) {
      console.log(
        `INFO --keep: PocketBase still on ${pb.url}; storage ${privDir}, ${pubDir}`,
      );
    } else {
      await pb.stop();
      rmSync(privDir, { recursive: true, force: true });
      rmSync(pubDir, { recursive: true, force: true });
    }
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    fail(err instanceof Error ? err.message : String(err));
  },
);
