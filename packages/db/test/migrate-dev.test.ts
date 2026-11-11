import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// T-01-10: the dev push must never reach pocketbase-cds (the old site's live database).
// Every case uses --dry-run, so nothing leaves this machine.
const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "migrate-dev.mjs",
);

function run(args: string[], container?: string) {
  const env = { ...process.env };
  delete env.CDS_PB_CONTAINER;
  if (container !== undefined) env.CDS_PB_CONTAINER = container;
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env,
    timeout: 30_000,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

describe("migrate-dev.mjs target guard", () => {
  it("dry run targets only pocketbase-cdsp and its migrations dir", () => {
    const { status, output } = run(["--dry-run"]);
    expect(status).toBe(0);
    expect(output).toContain("pocketbase-cdsp");
    expect(output).toContain("/root/pocketbase-cdsp/pb_data/pb_migrations/");
  });

  it("dry run shows every remote call is non-interactive and time-bounded", () => {
    const { status, output } = run(["--dry-run"]);
    expect(status).toBe(0);
    expect(output).toContain("-o BatchMode=yes -o ConnectTimeout=15");
    expect(output).toMatch(
      /DRY RUN scp -o BatchMode=yes -o ConnectTimeout=15 /,
    );
    expect(output).toMatch(
      /DRY RUN ssh -o BatchMode=yes -o ConnectTimeout=15 pocketbase-cds /,
    );
    expect(output).toContain("timeout 120s");
  });

  it("dry run also pushes pb_hooks/*.pb.js to the dev hooks dir, never .gitkeep", () => {
    const { status, output } = run(["--dry-run"]);
    expect(status).toBe(0);
    const hooksLine = output
      .split(/\r?\n/)
      .find(
        (l) =>
          l.startsWith("DRY RUN scp") &&
          l.includes("/root/pocketbase-cdsp/pb_hooks/"),
      );
    expect(hooksLine).toBeDefined();
    expect(hooksLine).toContain("otp_standin.pb.js");
    expect(hooksLine).toContain(
      "pocketbase-cds:/root/pocketbase-cdsp/pb_hooks/",
    );
    expect(output).not.toContain("pb_hooks/.gitkeep");
    expect(output).not.toContain(".gitkeep");
    // Hooks are copied before the restart, so the restart loads them.
    expect(output.indexOf("/root/pocketbase-cdsp/pb_hooks/")).toBeLessThan(
      output.indexOf("docker restart"),
    );
  });

  it("refuses --container pocketbase-cds", () => {
    const { status, output } = run([
      "--container",
      "pocketbase-cds",
      "--dry-run",
    ]);
    expect(status).not.toBe(0);
    expect(output).toContain("refusing");
  });

  it("refuses --container=<other>", () => {
    const { status, output } = run(["--container=something-else", "--dry-run"]);
    expect(status).not.toBe(0);
    expect(output).toContain("refusing");
  });

  it("refuses CDS_PB_CONTAINER naming another container", () => {
    const { status, output } = run(["--dry-run"], "pocketbase-cds");
    expect(status).not.toBe(0);
    expect(output).toContain("refusing");
  });
});
