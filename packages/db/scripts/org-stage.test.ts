// 11-42 Task 2: the org:stage staff CLI (DASH-02, DASH-30, DASH-33; T-11-42-01). --help needs
// no PocketBase; --dry-run signs in, prints the planned move and writes nothing. Sign-in,
// the y/N prompt and the db module are mocked: setOrgStage / setBuildNote themselves are
// covered by test/org-stage.integration.test.ts.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  signIn: 0,
  role: "super_admin" as string,
  answer: "y",
  asked: [] as string[],
  stage: [] as unknown[],
  note: [] as unknown[],
  noteFails: false,
  launchMove: false,
  current: {
    orgName: "Rivera Bakery",
    stage: "being_built",
    launchedAt: null as string | null,
    buildNote: "",
    status: "active",
  },
}));

vi.mock("./staff-cli", async (orig) => {
  const real = await orig<typeof import("./staff-cli")>();
  return {
    ...real,
    signInStaffInteractive: async () => {
      calls.signIn++;
      return { actor: "staff", staffRole: calls.role, ip: "cli" };
    },
    ask: async (prompt: string) => {
      calls.asked.push(prompt);
      return calls.answer;
    },
  };
});

vi.mock("../src/org-stage", async (orig) => {
  const real = await orig<typeof import("../src/org-stage")>();
  return {
    ...real,
    staffOrgStage: async () => ({ ...calls.current }),
    setOrgStage: async (_ctx: unknown, orgId: string, to: string) => {
      calls.stage.push({ orgId, to });
      return {
        changed: true,
        launchedAt: to === "live" ? "2026-10-11 19:02:00.000Z" : null,
      };
    },
    setBuildNote: async (_ctx: unknown, orgId: string, note: string) => {
      if (calls.noteFails) {
        const { InvalidInput } = await import("@cds/core");
        throw new InvalidInput("the build note is at most 280 characters");
      }
      calls.note.push({ orgId, note });
    },
  };
});

// 14-36: the launch-move read behind the `--to live` refusal (covered for real by
// test/launch-approval.integration.test.ts).
vi.mock("../src/staff/pipeline", () => ({
  staffHasLaunchMove: async () => calls.launchMove,
}));

const { main, launchedLine, LIVE_VIA_APPROVE } = await import("./org-stage");
const { CliFail } = await import("./staff-cli");

const ORG = "org000000000001";
let out: string[] = [];

beforeEach(() => {
  calls.signIn = 0;
  calls.role = "super_admin";
  calls.answer = "y";
  calls.asked = [];
  calls.stage = [];
  calls.note = [];
  calls.noteFails = false;
  calls.launchMove = false;
  calls.current = {
    orgName: "Rivera Bakery",
    stage: "being_built",
    launchedAt: null,
    buildNote: "",
    status: "active",
  };
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
});
afterEach(() => vi.restoreAllMocks());

describe("org:stage", () => {
  it("--help prints usage and signs nobody in", async () => {
    await main(["--help"]);
    expect(out.join("\n")).toContain("org:stage");
    expect(out.join("\n")).toContain("--build-note");
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
        join(pkg, "scripts", "org-stage.ts"),
        "--help",
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--to");
  });

  it("missing --org fails plainly before sign-in", async () => {
    await expect(main(["--to", "live"])).rejects.toThrow(
      "--org <org-id> is required",
    );
    await expect(main(["--org", "nope"])).rejects.toThrow(
      "--org is not a valid organization id",
    );
    expect(calls.signIn).toBe(0);
  });

  it("an unknown stage or an over-long note fails before sign-in", async () => {
    await expect(main(["--org", ORG, "--to", "launched"])).rejects.toThrow(
      "--to must be one of",
    );
    await expect(
      main(["--org", ORG, "--build-note", "x".repeat(281)]),
    ).rejects.toThrow("--build-note must be 1-280 characters");
    await expect(
      main(["--org", ORG, "--build-note", "a", "--clear-note"]),
    ).rejects.toThrow("can't be combined");
    expect(calls.signIn).toBe(0);
  });

  it("--dry-run --to live prints the planned move and changes nothing", async () => {
    await main(["--org", ORG, "--to", "live", "--dry-run"]);
    expect(out[0]).toBe("Rivera Bakery · being_built -> live");
    expect(out).toContain("Build note: (none)");
    expect(out.at(-1)).toBe("DRY RUN would move to live; nothing changed");
    expect(calls.signIn).toBe(1);
    expect(calls.stage).toEqual([]);
    expect(calls.note).toEqual([]);
    expect(calls.asked).toEqual([]);
  });

  it("moves forward after y and says what the owner sees", async () => {
    await main([
      "--org",
      ORG,
      "--to",
      "ready_for_review",
      "--build-note",
      "Final checks on your menu page.",
    ]);
    expect(out[0]).toBe("Rivera Bakery · being_built -> ready_for_review");
    expect(out[1]).toBe(
      'Build note: (none) -> "Final checks on your menu page."',
    );
    expect(calls.asked).toEqual(["Set? [y/N] "]);
    expect(calls.stage).toEqual([{ orgId: ORG, to: "ready_for_review" }]);
    expect(calls.note).toEqual([
      { orgId: ORG, note: "Final checks on your menu page." },
    ]);
    expect(out.at(-1)).toBe(
      'Done. The owner sees "Ready for your review" on Today.',
    );
  });

  it("a note that fails after the stage moved says the stage moved (WR-A03)", async () => {
    calls.noteFails = true;
    const err = await main([
      "--org",
      ORG,
      "--to",
      "live",
      "--yes",
      "--build-note",
      "Launch day.",
    ]).catch((e: unknown) => e);
    expect(calls.stage).toEqual([{ orgId: ORG, to: "live" }]);
    expect(out).toContain(
      `launched_at: ${launchedLine("2026-10-11 19:02:00.000Z")}`,
    );
    expect(out).toContain("Stage moved: being_built -> live.");
    expect(err).toBeInstanceOf(CliFail);
    expect((err as Error).message).toBe(
      "Stage moved to live; the build note was NOT saved: the build note is at most 280 characters. Rerun with --build-note (or --clear-note) only.",
    );
  });

  it("anything but y changes nothing", async () => {
    calls.answer = "n";
    await main(["--org", ORG, "--to", "live"]);
    expect(calls.stage).toEqual([]);
    expect(out.at(-1)).toBe("Nothing changed.");
  });

  it("--to live --yes skips the prompt and prints launched_at", async () => {
    await main(["--org", ORG, "--to", "live", "--yes"]);
    expect(calls.asked).toEqual([]);
    expect(out).toContain(
      `launched_at: ${launchedLine("2026-10-11 19:02:00.000Z")}`,
    );
    expect(launchedLine("2026-10-11 19:02:00.000Z")).toBe(
      "2026-10-11 14:02 America/Chicago",
    );
  });

  it("14-36: --to live is refused while the site has a launch move (Use Approve launch)", async () => {
    calls.launchMove = true;
    calls.current.stage = "ready_for_review";
    await expect(main(["--org", ORG, "--to", "live", "--yes"])).rejects.toThrow(
      LIVE_VIA_APPROVE,
    );
    expect(calls.stage).toEqual([]);
    expect(calls.asked).toEqual([]);
    // Other forward moves are untouched by the check.
    calls.current.stage = "being_built";
    await main(["--org", ORG, "--to", "ready_for_review", "--yes"]);
    expect(calls.stage).toEqual([{ orgId: ORG, to: "ready_for_review" }]);
  });

  it("a backward move is refused plainly; live is final", async () => {
    calls.current.stage = "live";
    const err = await main(["--org", ORG, "--to", "being_built"]).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CliFail);
    expect((err as InstanceType<typeof CliFail>).plain).toBe(true);
    expect((err as Error).message).toBe(
      "Refused: live is final. Use the launch tools in P14 to undo a launch.",
    );
    calls.current.stage = "ready_for_review";
    await expect(main(["--org", ORG, "--to", "intake"])).rejects.toThrow(
      "Refused: ready_for_review -> intake goes backwards. A stage only moves forward.",
    );
    expect(calls.stage).toEqual([]);
  });

  it("a site in fit review, held or closed is refused before the prompt (WR-A01)", async () => {
    calls.current.stage = "fit_review";
    await expect(main(["--org", ORG, "--to", "live", "--yes"])).rejects.toThrow(
      "Refused: this site is in fit review. Use fit:review",
    );
    expect(out[0]).toBe("Rivera Bakery · fit_review -> live");
    calls.current.stage = "being_built";
    calls.current.status = "held";
    await expect(main(["--org", ORG, "--to", "live"])).rejects.toThrow(
      "Refused: this site is held.",
    );
    calls.current.status = "disabled";
    await expect(
      main(["--org", ORG, "--to", "live", "--dry-run"]),
    ).rejects.toThrow("Refused: this site is closed or disabled.");
    expect(calls.asked).toEqual([]);
    expect(calls.stage).toEqual([]);
    // The note alone is still allowed on a held site.
    calls.current.status = "held";
    await main(["--org", ORG, "--build-note", "Waiting on fit review."]);
    expect(calls.note).toHaveLength(1);
  });

  it("a support agent may set the note but never move a stage (T-11-42-01)", async () => {
    calls.role = "support_agent";
    await expect(main(["--org", ORG, "--to", "live"])).rejects.toThrow(
      "Refused: moving a stage needs super_admin.",
    );
    expect(calls.stage).toEqual([]);
    await main(["--org", ORG, "--build-note", "Adding your photos."]);
    expect(calls.asked).toEqual([]);
    expect(calls.note).toEqual([{ orgId: ORG, note: "Adding your photos." }]);
    expect(out.at(-1)).toContain("Done.");
  });

  it("--clear-note clears; no flags only prints the status", async () => {
    calls.current.buildNote = "Old note";
    await main(["--org", ORG, "--clear-note"]);
    expect(calls.note).toEqual([{ orgId: ORG, note: "" }]);
    out = [];
    await main(["--org", ORG]);
    expect(out).toEqual([
      "Rivera Bakery · being_built",
      'Build note: "Old note"',
    ]);
  });
});
