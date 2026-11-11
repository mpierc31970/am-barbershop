// LIFE-02, D283: the one retention table and the constants derived from it.
import { describe, expect, it } from "vitest";
import { lintLegalMarkdown } from "./markdown";
import {
  AGREEMENT_RETENTION_YEARS,
  AUDIT_LOG_RETENTION_DAYS,
  BACKUP_AGE_OUT_DAYS,
  CLOSED_ORG_DELETE_DAYS,
  EXPORT_RETENTION_DAYS,
  RETENTION,
  RETENTION_ORG_CAP_PER_RUN,
  retainUntil,
  retentionTableMarkdown,
} from "./retention";

const row = (id: string) => {
  const r = RETENTION.find((x) => x.id === id);
  if (!r) throw new Error(`missing row ${id}`);
  return r;
};

describe("RETENTION (LIFE-02, D283)", () => {
  it("has exactly the expected rows, in order", () => {
    expect(RETENTION.map((r) => r.id)).toEqual([
      "closed-tenant",
      "backups",
      "lapsed-tenant",
      "signed-agreements",
      "site-policy-acks",
      "audit-log",
      "live-media",
      "exports",
    ]);
  });

  it("holds the decided numbers", () => {
    expect(row("closed-tenant").days).toBe(30);
    expect(row("backups").days).toBe(90);
    expect(row("lapsed-tenant").days).toBeNull();
    expect(row("lapsed-tenant").rule).toContain("never deleted");
    expect(row("signed-agreements").years).toBe(7);
    expect(row("site-policy-acks").years).toBe(7);
    expect(row("audit-log").days).toBe(730);
    expect(row("live-media").days).toBeNull();
    expect(row("exports").days).toBe(90);
  });

  it("derived constants equal the rows", () => {
    expect(CLOSED_ORG_DELETE_DAYS).toBe(30);
    expect(BACKUP_AGE_OUT_DAYS).toBe(90);
    expect(AUDIT_LOG_RETENTION_DAYS).toBe(730);
    expect(EXPORT_RETENTION_DAYS).toBe(90);
    expect(AGREEMENT_RETENTION_YEARS).toBe(7);
    expect(RETENTION_ORG_CAP_PER_RUN).toBe(5);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(RETENTION)).toBe(true);
    for (const r of RETENTION) expect(Object.isFrozen(r)).toBe(true);
  });
});

describe("retainUntil", () => {
  it("adds 7 UTC years, keeping the time", () => {
    expect(
      retainUntil(new Date("2026-10-08T19:14:03.123Z")).toISOString(),
    ).toBe("2033-10-08T19:14:03.123Z");
  });

  it("a leap day rolls forward to 1 March (never shortens the promise)", () => {
    expect(
      retainUntil(new Date("2028-02-29T12:00:00.000Z")).toISOString(),
    ).toBe("2035-03-01T12:00:00.000Z");
  });

  it("does not mutate its input", () => {
    const d = new Date("2026-01-01T00:00:00.000Z");
    retainUntil(d);
    expect(d.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("retentionTableMarkdown", () => {
  const md = retentionTableMarkdown();

  it("one '- **' line per row, deterministic", () => {
    const lines = md.split("\n").filter((l) => l.startsWith("- **"));
    expect(lines).toHaveLength(RETENTION.length);
    expect(retentionTableMarkdown()).toBe(md);
  });

  it("states the numbers in words", () => {
    expect(md).toContain("30 days");
    expect(md).toContain("7 years");
    expect(md).toContain("90 days");
  });

  it("passes the legal markdown lint", () => {
    expect(lintLegalMarkdown(md)).toEqual([]);
  });
});
