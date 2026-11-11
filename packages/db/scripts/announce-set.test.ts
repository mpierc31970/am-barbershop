// 11-42 Task 2: the announce:set staff CLI (DASH-23). --help needs no PocketBase; input is
// checked before sign-in; --clear calls clearAnnouncement. Sign-in, the y/N prompt and the
// announcements module are mocked: the writers are covered by src/today/announcements tests.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  signIn: 0,
  answer: "y",
  asked: [] as string[],
  set: [] as unknown[],
  cleared: 0,
  ended: ["a1"] as string[],
}));

vi.mock("./staff-cli", async (orig) => {
  const real = await orig<typeof import("./staff-cli")>();
  return {
    ...real,
    signInStaffInteractive: async () => {
      calls.signIn++;
      return { actor: "staff", staffRole: "super_admin", ip: "cli" };
    },
    ask: async (prompt: string) => {
      calls.asked.push(prompt);
      return calls.answer;
    },
  };
});

vi.mock("../src/today/announcements", async (orig) => {
  const real = await orig<typeof import("../src/today/announcements")>();
  return {
    ...real,
    setAnnouncement: async (_ctx: unknown, input: unknown) => {
      calls.set.push(input);
      return { id: "new", ended: [] };
    },
    clearAnnouncement: async () => {
      calls.cleared++;
      return { ended: calls.ended };
    },
  };
});

const { main, dayMonth } = await import("./announce-set");

const NOW = new Date("2026-10-17T15:00:00.000Z");
let out: string[] = [];

beforeEach(() => {
  calls.signIn = 0;
  calls.answer = "y";
  calls.asked = [];
  calls.set = [];
  calls.cleared = 0;
  calls.ended = ["a1"];
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
});
afterEach(() => vi.restoreAllMocks());

describe("announce:set", () => {
  it("--help prints usage and signs nobody in", async () => {
    await main(["--help"]);
    expect(out.join("\n")).toContain("announce:set");
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
        join(pkg, "scripts", "announce-set.ts"),
        "--help",
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--clear");
  });

  it("rejects a 90-character title before sign-in", async () => {
    await expect(main(["--title", "x".repeat(90)])).rejects.toThrow(
      "--title must be 1-80 characters",
    );
    expect(calls.signIn).toBe(0);
    expect(calls.set).toEqual([]);
  });

  it("rejects a bad link, path or day count before sign-in", async () => {
    await expect(
      main(["--title", "Hi", "--href", "http://example.com"]),
    ).rejects.toThrow("--href must be");
    await expect(
      main(["--title", "Hi", "--paths", "standard,salon"]),
    ).rejects.toThrow("--paths must be");
    await expect(main(["--title", "Hi", "--days", "91"])).rejects.toThrow(
      "--days must be a whole number 1-90",
    );
    await expect(main(["--clear", "--title", "Hi"])).rejects.toThrow(
      "--clear can't be combined with --title",
    );
    expect(calls.signIn).toBe(0);
  });

  it("prints the card, asks, publishes and names the end date", async () => {
    await main(
      [
        "--title",
        "New: Grow your social",
        "--body",
        "Link your accounts in Marketing.",
        "--href",
        "/hub/marketing?tab=social",
        "--paths",
        "studio",
      ],
      () => NOW,
    );
    expect(out.slice(0, 6)).toEqual([
      "From CDS",
      "  New: Grow your social",
      "  Link your accounts in Marketing.",
      "  Link: /hub/marketing?tab=social",
      "Shown to:  studio sites",
      "Until:     31 Oct (14 days)",
    ]);
    expect(calls.asked).toEqual(["Publish? [y/N] "]);
    expect(calls.set).toEqual([
      {
        title: "New: Grow your social",
        body: "Link your accounts in Marketing.",
        href: "/hub/marketing?tab=social",
        paths: ["studio"],
        startsAt: NOW,
        endsAt: new Date("2026-10-31T15:00:00.000Z"),
      },
    ]);
    expect(out.at(-1)).toBe(
      "Announcement live until 31 Oct. Owners see it in From CDS.",
    );
  });

  it("--dry-run prints the card and writes nothing", async () => {
    await main(["--title", "Hi", "--days", "1", "--dry-run"], () => NOW);
    expect(out).toContain("Shown to:  every site");
    expect(out).toContain("Until:     18 Oct (1 day)");
    expect(out.at(-1)).toBe(
      "DRY RUN would publish this announcement; nothing changed",
    );
    expect(calls.set).toEqual([]);
    expect(calls.asked).toEqual([]);
  });

  it("anything but y changes nothing", async () => {
    calls.answer = "";
    await main(["--title", "Hi"], () => NOW);
    expect(calls.set).toEqual([]);
    expect(out.at(-1)).toBe("Nothing changed.");
  });

  it("--clear calls clearAnnouncement", async () => {
    await main(["--clear"]);
    expect(calls.cleared).toBe(1);
    expect(out.at(-1)).toBe(
      "Announcement ended. From CDS shows no announcement now.",
    );
    calls.ended = [];
    await main(["--clear"]);
    expect(out.at(-1)).toBe("No announcement was showing. Nothing changed.");
    await main(["--clear", "--dry-run"]);
    expect(calls.cleared).toBe(2);
  });

  it("dayMonth never prints Sept", () => {
    expect(dayMonth(new Date("2026-09-15T18:00:00Z"))).toBe("15 Sep");
  });
});
