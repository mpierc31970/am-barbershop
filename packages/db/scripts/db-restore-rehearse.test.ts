// 13-05: pure helpers of the restore rehearsal CLI (STAFF-13; T-13-05-01, T-13-05-02). The
// restore itself (scp, unzip, throwaway PocketBase) is exercised by the real dev run recorded
// in docs/ops/restore-rehearsal.md.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertBackupPath,
  DEFAULT_SSH_ALIAS,
  formatCount,
  formatRehearsal,
  newestBackup,
  parseRehearseArgs,
  rehearsalLogLine,
  RUNBOOK,
  USAGE,
} from "./db-restore-rehearse";

describe("parseRehearseArgs", () => {
  it("--help returns help", () => {
    expect(parseRehearseArgs(["--help"]).help).toBe(true);
    expect(USAGE).toContain("--from-ssh");
  });

  it("refuses --zip and --from-ssh together", () => {
    expect(() =>
      parseRehearseArgs(["--zip", "a.zip", "--from-ssh", "x"]),
    ).toThrow(/not both/);
  });

  it("refuses an unknown flag", () => {
    expect(() => parseRehearseArgs(["--from-ssh", "--force"])).toThrow(
      /unknown argument --force/,
    );
  });

  it("needs a source", () => {
    expect(() => parseRehearseArgs([])).toThrow(/pick a backup/);
  });

  it("defaults the SSH alias and records unless --dry-run", () => {
    const a = parseRehearseArgs(["--from-ssh"]);
    expect(a.fromSsh).toBe(DEFAULT_SSH_ALIAS);
    expect(a.record).toBe(true);
    const d = parseRehearseArgs(["--zip", "b.zip", "--dry-run", "--keep"]);
    expect(d).toMatchObject({
      zip: "b.zip",
      dryRun: true,
      record: false,
      keep: true,
    });
  });

  it("refuses --record with --dry-run and an alias that looks like an option", () => {
    expect(() =>
      parseRehearseArgs(["--zip", "b.zip", "--record", "--dry-run"]),
    ).toThrow();
    expect(() => parseRehearseArgs(["--from-ssh", "-oProxyCommand=x"])).toThrow(
      /alias/,
    );
  });
});

describe("newestBackup", () => {
  it("picks the newest cdsp zip by name and ignores others", () => {
    expect(
      newestBackup([
        "cdsp-20261012-041001.zip",
        "cdsp-20261013-041001.zip",
        "other.zip",
      ]),
    ).toBe("cdsp-20261013-041001.zip");
  });

  it("returns null when nothing matches", () => {
    expect(newestBackup(["other.zip", "cdsp-latest.zip", ""])).toBeNull();
  });
});

describe("assertBackupPath", () => {
  it("accepts a dev backup", () => {
    expect(() =>
      assertBackupPath(
        "/root/pocketbase-cdsp/backups/cdsp-20261013-041001.zip",
      ),
    ).not.toThrow();
  });

  it.each([
    "/root/pocketbase-cds/backups/cdsp-20261013-041001.zip",
    "/root/pocketbase-cdsp/pb_data/data.db",
    "/root/pocketbase-cdsp/backups/cdsp-20261013-041001.zip/../../../etc/passwd",
    "/root/pocketbase-cdsp/backups/cdsp-x.zip",
  ])("refuses %s", (p) => {
    expect(() => assertBackupPath(p)).toThrow(/refused/);
  });
});

describe("formatRehearsal", () => {
  const r = {
    zip: "cdsp-20261013-041001.zip",
    collections: 63,
    rows: 1204,
    newestMigration: "1790000862",
    ok: true,
  };

  it("prints counts only", () => {
    expect(formatRehearsal(r)).toBe(
      "Restore rehearsal · cdsp-20261013-041001.zip · 63 collections · 1 204 rows · newest migration 1790000862 · OK",
    );
    expect(formatCount(1234567)).toBe("1 234 567");
  });

  it("dates the runbook line", () => {
    expect(rehearsalLogLine(r, new Date("2026-10-13T12:00:00Z"))).toMatch(
      /^- 2026-10-13 · Restore rehearsal · /,
    );
  });

  it("the runbook has a Rehearsals section to append to", () => {
    expect(readFileSync(RUNBOOK, "utf8")).toContain("## Rehearsals");
  });
});
