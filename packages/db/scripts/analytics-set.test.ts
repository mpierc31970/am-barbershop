// 11-32 Task 1: the analytics:set staff CLI (DASH-13, D196). --help needs no PocketBase;
// --dry-run signs in, prints old -> new and writes nothing. Sign-in and the db module are
// mocked: the setter itself is covered by src/reports/analytics.test.ts.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  signIn: 0,
  set: [] as unknown[],
  read: [] as unknown[],
}));

vi.mock("./staff-cli", async (orig) => {
  const real = await orig<typeof import("./staff-cli")>();
  return {
    ...real,
    signInStaffInteractive: async () => {
      calls.signIn++;
      return { actor: "staff", staffRole: "support_agent", ip: "cli" };
    },
  };
});

vi.mock("../src/reports/analytics", async (orig) => {
  const real = await orig<typeof import("../src/reports/analytics")>();
  return {
    ...real,
    staffOrgAnalytics: async (_ctx: unknown, orgId: string) => {
      calls.read.push(orgId);
      return {
        orgName: "Rivera Bakery",
        analytics: { ga4_measurement_id: "G-OLD1" },
      };
    },
    setOrgAnalytics: async (_ctx: unknown, orgId: string, input: unknown) => {
      calls.set.push({ orgId, input });
      return {
        orgName: "Rivera Bakery",
        before: { ga4_measurement_id: "G-OLD1" },
        after: { ga4_measurement_id: "G-NEW123" },
        changed: true,
      };
    },
  };
});

const { main } = await import("./analytics-set");

const ORG = "org000000000001";
let out: string[] = [];

beforeEach(() => {
  calls.signIn = 0;
  calls.set = [];
  calls.read = [];
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
});
afterEach(() => vi.restoreAllMocks());

describe("analytics:set", () => {
  it("--help prints usage and signs nobody in", async () => {
    await main(["--help"]);
    expect(out.join("\n")).toContain("analytics:set");
    expect(calls.signIn).toBe(0);
  });

  it("--help exits 0 as a process (no PB env needed)", () => {
    const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
    const r = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings=ExperimentalWarning",
        "--import",
        pathToFileURL(join(pkg, "scripts", "register-ts.mjs")).href,
        join(pkg, "scripts", "analytics-set.ts"),
        "--help",
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--ga4-measurement");
  });

  it("--dry-run prints old -> new and changes nothing", async () => {
    await main(["--org", ORG, "--ga4-measurement", "G-NEW123", "--dry-run"]);
    expect(calls.set).toHaveLength(0);
    expect(calls.read).toEqual([ORG]);
    const text = out.join("\n");
    expect(text).toContain("G-OLD1 -> G-NEW123");
    expect(text).toContain("DRY RUN");
  });

  it("refuses a bad measurement id before sign-in", async () => {
    await expect(
      main(["--org", ORG, "--ga4-measurement", "UA-123"]),
    ).rejects.toThrow(/measurement/i);
    expect(calls.signIn).toBe(0);
  });

  it("refuses nothing-to-set", async () => {
    await expect(main(["--org", ORG])).rejects.toThrow();
  });

  it("saves and prints the UI-SPEC last line", async () => {
    await main(["--org", ORG, "--ga4-measurement", "G-NEW123"]);
    expect(calls.set).toEqual([
      { orgId: ORG, input: { ga4MeasurementId: "G-NEW123" } },
    ]);
    expect(out.at(-1)).toBe(
      "Saved. Rivera Bakery's Site Report shows Google data from tomorrow.",
    );
  });
});
