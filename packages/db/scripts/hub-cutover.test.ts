// 15-25 (HUB-04, D62, A4-Q2/Q3, P15-P21): the hub:cutover CLI, spawned as a process. No
// network: every run below either touches nothing (--help, plan, --dry-run) or sets
// CDS_CUTOVER_FAKE, which swaps Coolify, DNS, HTTPS and ssh for in-memory fakes (refused
// outside vitest). State and run log go to a temp dir, never the repo's runbook.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  FAKE_SECRET_MARK,
  fakeSafePaths,
  resolveCoolifyUrl,
  runLogLine,
} from "./hub-cutover";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function temp() {
  const d = mkdtempSync(join(tmpdir(), "hub-cutover-"));
  dirs.push(d);
  return {
    state: join(d, "state.json"),
    log: join(d, "runbook.md"),
  };
}

function run(
  args: string[],
  env: Record<string, string | undefined> = {},
  input?: string,
) {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.startsWith("PB_") && k !== "CDS_CUTOVER_FAKE",
    ),
  );
  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      "--import",
      pathToFileURL(join(pkg, "scripts", "register-ts.mjs")).href,
      join(pkg, "scripts", "hub-cutover.ts"),
      ...args,
    ],
    {
      encoding: "utf8",
      timeout: 90_000,
      env: { ...base, ...env },
      input: input ?? "",
    },
  );
}

const out = (r: ReturnType<typeof run>) => `${r.stdout}\n${r.stderr}`;

// Each case spawns the CLI; under a full parallel suite one spawn can take well over the
// 5 s default, so the block gets the same budget as spawnSync.
describe("hub:cutover CLI", { timeout: 90_000 }, () => {
  it("--help exits 0 with every subcommand", () => {
    const r = run(["--help"]);
    expect(r.status, r.stderr).toBe(0);
    for (const s of [
      "plan",
      "check",
      "apply",
      "rollback",
      "--dry-run",
      "--yes",
      "--expect-sha",
      "--coolify-url",
      "--insecure-http",
    ]) {
      expect(r.stdout).toContain(s);
    }
  });

  it("plan lists the eight steps and changes nothing", () => {
    const r = run(["plan"]);
    expect(r.status, r.stderr).toBe(0);
    const keys = [
      "preflight",
      "save-state",
      "free-old",
      "redeploy-old",
      "assign-prod",
      "deploy-prod",
      "verify",
      "stop-old",
    ];
    keys.forEach((k, i) => expect(r.stdout).toContain(`${i + 1}. ${k}:`));
    expect(r.stdout).not.toContain("9. ");
    expect(r.stdout.trimEnd().endsWith("Dry run: nothing was changed.")).toBe(
      true,
    );
  });

  it("apply --dry-run prints the plan and makes no request", () => {
    const t = temp();
    const r = run(
      ["apply", "--dry-run", "--state", t.state, "--log-file", t.log],
      { CDS_CUTOVER_FAKE: "1" },
    );
    expect(r.status, out(r)).toBe(0);
    expect(r.stdout).toContain("8. stop-old:");
    expect(r.stdout).toContain("Dry run: nothing was changed.");
    expect(r.stdout).toContain("[fake] coolify calls: 0 (writes 0)");
    expect(() => readFileSync(t.log, "utf8")).toThrow();
  });

  it("rejects a missing or unknown subcommand and unknown flags", () => {
    expect(run([]).status).toBe(1);
    expect(run(["launch"]).status).toBe(1);
    expect(run(["plan", "--force"]).status).toBe(1);
  });

  it("the fake hook is refused outside vitest", () => {
    const r = run(["check"], { CDS_CUTOVER_FAKE: "1", VITEST: "" });
    expect(r.status).toBe(1);
    expect(out(r)).toContain("test hook");
  });

  it("--confirm is refused without the fake hook", () => {
    const r = run(["apply", "--confirm", "x"]);
    expect(r.status).toBe(1);
    expect(out(r)).toContain("--confirm is a test hook");
  });

  it("check on the placeholder world: FAIL rows, key names only, read-only, one log line", () => {
    const t = temp();
    const r = run(["check", "--state", t.state, "--log-file", t.log], {
      CDS_CUTOVER_FAKE: "placeholder",
    });
    expect(r.status).toBe(1);
    const o = out(r);
    for (const id of [
      "dns",
      "prod-source",
      "prod-env",
      "prod-health",
      "hub-marker",
      "prod-migrations",
      "old-app",
      "ready-mailboxes",
    ]) {
      expect(o).toContain(id);
    }
    expect(o).toContain("FAIL");
    expect(o).toContain("PLATFORM_HOSTS");
    expect(o).toContain("Read-only: nothing was written.");
    expect(o).toContain("(writes 0)");
    expect(o).not.toContain(FAKE_SECRET_MARK);
    const log = readFileSync(t.log, "utf8");
    expect(log).toContain("## Run log");
    expect(log).toMatch(
      /^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC · check · \d+ PASS, \d+ WARN, \d+ FAIL · failed$/m,
    );
    expect(log).not.toContain(FAKE_SECRET_MARK);
  });

  it("apply --yes with a wrong typed domain refuses before any write", () => {
    const t = temp();
    const r = run(
      [
        "apply",
        "--yes",
        "--confirm",
        "connectionsdesignstudios.co",
        "--state",
        t.state,
        "--log-file",
        t.log,
      ],
      { CDS_CUTOVER_FAKE: "1" },
    );
    expect(r.status).toBe(1);
    expect(out(r)).toContain("Refused");
    expect(out(r)).toContain("(writes 0)");
    expect(out(r)).not.toContain(FAKE_SECRET_MARK);
  });

  it("apply refuses on a preflight FAIL and never prompts", () => {
    const t = temp();
    const r = run(["apply", "--yes", "--state", t.state, "--log-file", t.log], {
      CDS_CUTOVER_FAKE: "placeholder",
    });
    expect(r.status).toBe(1);
    expect(out(r)).toContain("Refused: preflight has");
    expect(out(r)).not.toContain("Type the domain");
    expect(out(r)).toContain("(writes 0)");
    expect(readFileSync(t.log, "utf8")).toMatch(
      /· apply · preflight · failed$/m,
    );
  });

  it("apply --yes on the ready world cuts over, saves state, logs each step; rollback reverses", () => {
    const t = temp();
    writeFileSync(t.log, "# Runbook\n\n## Run log\n\n");
    const r = run(
      [
        "apply",
        "--yes",
        "--mailboxes-ready",
        "--state",
        t.state,
        "--log-file",
        t.log,
      ],
      { CDS_CUTOVER_FAKE: "1" },
    );
    expect(r.status, out(r)).toBe(0);
    expect(r.stdout).toContain("Cutover done.");
    expect(out(r)).not.toContain(FAKE_SECRET_MARK);
    const saved = JSON.parse(readFileSync(t.state, "utf8")) as {
      oldFqdn: string;
    };
    expect(saved.oldFqdn).toContain("https://connectionsdesignstudios.com");
    const log = readFileSync(t.log, "utf8");
    for (const step of [
      "preflight",
      "save-state",
      "free-old",
      "redeploy-old",
      "assign-prod",
      "deploy-prod",
      "verify",
      "stop-old",
    ]) {
      expect(log).toMatch(
        new RegExp(
          `^- \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} UTC · apply · ${step} · ok$`,
          "m",
        ),
      );
    }
    expect(log.match(/## Run log/g)?.length).toBe(1);

    const rb = run(
      ["rollback", "--yes", "--state", t.state, "--log-file", t.log],
      {
        CDS_CUTOVER_FAKE: "1",
      },
    );
    expect(rb.status, out(rb)).toBe(0);
    expect(rb.stdout).toContain("Rolled back.");
    const rbLog = readFileSync(t.log, "utf8");
    for (const step of [
      "rollback-prod-domains",
      "rollback-redeploy-prod",
      "rollback-old-domains",
      "rollback-deploy-old",
      "rollback-verify-old",
    ]) {
      expect(rbLog).toMatch(new RegExp(`· rollback · ${step} · ok$`, "m"));
    }
  });

  it("WR-B04: fake mode never reaches the real saved state or runbook", () => {
    const repo = join(pkg, "..", "..");
    const runbook = join(repo, "docs", "ops", "hub-cutover.md");
    const realState = join(repo, ".planning", "tmp", "cutover-state.json");
    const before = readFileSync(runbook, "utf8");
    const stateBefore = existsSync(realState)
      ? readFileSync(realState, "utf8")
      : null;

    const r = run(["apply", "--yes", "--mailboxes-ready"], {
      CDS_CUTOVER_FAKE: "1",
    });
    expect(r.status, out(r)).toBe(0);
    expect(r.stdout).toContain("Cutover done.");
    expect(r.stdout).not.toContain(realState);
    expect(readFileSync(runbook, "utf8")).toBe(before);
    expect(existsSync(realState) ? readFileSync(realState, "utf8") : null).toBe(
      stateBefore,
    );

    const refused = run(["apply", "--yes", "--state", realState], {
      CDS_CUTOVER_FAKE: "1",
    });
    expect(refused.status).toBe(1);
    expect(out(refused)).toContain("never writes the real saved state");
    const refusedLog = run(["check", "--log-file", runbook], {
      CDS_CUTOVER_FAKE: "1",
    });
    expect(refusedLog.status).toBe(1);
    expect(out(refusedLog)).toContain("never writes the real runbook");
    expect(readFileSync(runbook, "utf8")).toBe(before);
  });

  it("WR-B04: fakeSafePaths defaults to a temp dir and keeps real paths outside fake mode", () => {
    const real = fakeSafePaths(null, null, null);
    expect(real.statePath).toMatch(/cutover-state\.json$/);
    expect(real.logPath).toMatch(/hub-cutover\.md$/);
    expect(real.tempDir).toBeNull();
    const f = fakeSafePaths("ready", null, null);
    dirs.push(f.tempDir!);
    expect(f.tempDir).toContain(tmpdir());
    expect(f.statePath.startsWith(f.tempDir!)).toBe(true);
    expect(f.logPath.startsWith(f.tempDir!)).toBe(true);
    expect(() => fakeSafePaths("ready", real.statePath, null)).toThrow(
      /real saved state/,
    );
  });

  it("WR-B05: --coolify-url refuses plain http to a public host before anything runs", () => {
    const t = temp();
    const r = run(
      [
        "check",
        "--coolify-url",
        "http://82.180.132.176:8000/api/v1",
        "--state",
        t.state,
        "--log-file",
        t.log,
      ],
      { CDS_CUTOVER_FAKE: "1" },
    );
    expect(r.status).toBe(1);
    expect(out(r)).toContain("refusing plain http to 82.180.132.176");
    expect(out(r)).toContain("ssh -i ~/.ssh/pocketbase-cds -N -L 8000");
    expect(() => readFileSync(t.log, "utf8")).toThrow();
  });

  it("WR-B05: resolveCoolifyUrl keeps the tunnel default, allows https and an explicit opt-in", () => {
    expect(resolveCoolifyUrl(undefined, false)).toBe(
      "http://127.0.0.1:8000/api/v1",
    );
    expect(resolveCoolifyUrl("https://coolify.example/api/v1/", false)).toBe(
      "https://coolify.example/api/v1",
    );
    expect(() =>
      resolveCoolifyUrl("http://82.180.132.176:8000/api/v1", false),
    ).toThrow(/cleartext/);
    expect(resolveCoolifyUrl("http://82.180.132.176:8000/api/v1", true)).toBe(
      "http://82.180.132.176:8000/api/v1",
    );
    expect(() => resolveCoolifyUrl("ftp://x", true)).toThrow(
      /must be http\(s\)/,
    );
    expect(() => resolveCoolifyUrl(true, false)).toThrow(/needs a URL/);
  });

  it("rollback without saved state refuses", () => {
    const t = temp();
    const r = run(
      ["rollback", "--yes", "--state", t.state, "--log-file", t.log],
      {
        CDS_CUTOVER_FAKE: "1",
      },
    );
    expect(r.status).toBe(1);
    expect(out(r)).toContain("nothing to roll back");
  });

  it("runLogLine reshapes a planner line", () => {
    expect(runLogLine("apply", "2026-10-17 20:00 UTC · verify · ok")).toBe(
      "- 2026-10-17 20:00 UTC · apply · verify · ok",
    );
  });

  it("names the production PocketBase file, read-only, and no conflict override", () => {
    const src = readFileSync(join(pkg, "scripts", "hub-cutover.ts"), "utf8");
    expect(src).toContain("/root/pocketbase-cdsp-prod/pb_data/data.db");
    expect(src).toContain("mode=ro");
    const adapter = readFileSync(join(pkg, "src", "ops", "coolify.ts"), "utf8");
    expect(adapter).not.toMatch(/force_domain_override/);
    expect(adapter).not.toMatch(/method:\s*"DELETE"|"DELETE"/);
  });
});
