// 15-08 (HUB-06, A2-Q5): the read-only hub:claims CLI. Spawned as a process (no PB env, no
// sign-in) for --help and the default table; the footer maths runs on an injected clock and
// claim list, so no test depends on today's date.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CLAIMS, type Claim } from "@cds/core/marketing";
import { describe, expect, it } from "vitest";
import { claimAgeDays, claimRows, claimsFooter } from "./hub-claims";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The parent env without any PocketBase variable: the CLI must never need one. */
function noPbEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("PB_")),
  );
}

function run(...args: string[]) {
  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      "--import",
      pathToFileURL(join(pkg, "scripts", "register-ts.mjs")).href,
      join(pkg, "scripts", "hub-claims.ts"),
      ...args,
    ],
    { encoding: "utf8", timeout: 60_000, env: noPbEnv() },
  );
}

// Each case spawns the CLI; a full parallel suite can push one spawn past the 5 s default.
describe("hub:claims", { timeout: 60_000 }, () => {
  it("--help exits 0 with usage", () => {
    const r = run("--help");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("hub:claims");
    expect(r.stdout).toContain("--json");
  });

  it("default run prints every claim id, the footer and the read-only line", () => {
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    for (const c of CLAIMS) expect(r.stdout).toContain(c.id);
    expect(r.stdout).toContain("verified on");
    expect(r.stdout).toContain(`${CLAIMS.length} claims · `);
    expect(r.stdout.trimEnd().endsWith("Read-only: nothing was written.")).toBe(
      true,
    );
  });

  it("--json prints rows and the read-only line; an unknown flag fails", () => {
    const r = run("--json");
    expect(r.status, r.stderr).toBe(0);
    const json = r.stdout.slice(0, r.stdout.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as { claims: { id: string }[] };
    expect(parsed.claims.map((c) => c.id)).toEqual(CLAIMS.map((c) => c.id));
    expect(r.stdout).toContain("Read-only: nothing was written.");
    expect(run("--write").status).toBe(1);
  });

  it("ages and the footer use the injected clock", () => {
    const now = new Date("2027-03-01T12:00:00Z");
    const all: Claim[] = [
      { ...CLAIMS[0]!, status: "verified", verifiedOn: "2026-09-24" },
      { ...CLAIMS[1]!, status: "verified", verifiedOn: "2027-01-01" },
      { ...CLAIMS[2]!, status: "draft" },
    ];
    expect(claimAgeDays(all[0]!, now)).toBe(158);
    expect(claimRows(all, now).map((r) => r.age_days)[1]).toBe(59);
    expect(claimsFooter(all, now)).toBe(
      "3 claims · 2 verified · 1 draft · oldest verified 158 days",
    );
    expect(claimsFooter([all[2]!], now)).toBe(
      "1 claim · 0 verified · 1 draft · oldest verified none",
    );
  });
});
