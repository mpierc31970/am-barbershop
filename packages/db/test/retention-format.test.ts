// 09-21: the retention:run report text (UI-SPEC "retention:run"; choice 3).
import { describe, expect, it } from "vitest";
import type { RetentionJobResult } from "../src/jobs/retention";
import { formatRetentionRun } from "../src/jobs/retention-format";

const NOW = new Date("2026-10-08T04:30:00.000Z");

function result(over: Partial<RetentionJobResult> = {}): RetentionJobResult {
  return {
    dryRun: false,
    orgsDue: 1,
    orgsDeleted: 1,
    capHit: false,
    deletedOrgs: [
      {
        id: "abcdefghijklmno",
        name: "Rivera Bakery",
        reason: "cancelled",
        closedAt: "2026-09-07T10:00:00.000Z",
      },
    ],
    signaturesExpired: 0,
    acksExpired: 0,
    auditDeleted: 0,
    orphanExportsPruned: 0,
    formDraftsPurged: 0,
    dataDownloadsExpired: 0,
    dataDownloadsFailedDeleted: 0,
    dataDownloadsBuilt: 0,
    usersDeleted: 1,
    keptAgreementsForDeletedOrgs: 2,
    paymentRecordsExpired: 0,
    keptPaymentRecordsForDeletedOrgs: 0,
    zoneSkipped: 0,
    hubInquiriesDeleted: 0,
    failedSteps: [],
    ...over,
  };
}

describe("formatRetentionRun (09-21)", () => {
  it("prints the UI-SPEC lines for a real run", () => {
    expect(formatRetentionRun(result(), NOW)).toBe(
      [
        "Retention run · 2026-10-08 04:30 UTC",
        "Closed sites due (30 days):   1   deleted: Rivera Bakery (cancelled 7 Sep)",
        "Signatures past 7 years:      0",
        "Payment records past 7 years: 0",
        "Audit rows past 2 years:      0",
        "Hub inquiries past 2 years:   0",
        "Kept: 2 signed agreements for deleted sites (each 7 years from signing).",
        "Backups and exports age out on their own over 90 days.",
      ].join("\n"),
    );
  });

  it("dry run: leading line and 'would delete'", () => {
    const out = formatRetentionRun(
      result({ dryRun: true, orgsDeleted: 0 }),
      NOW,
    ).split("\n");
    expect(out[0]).toBe("Dry run: nothing was deleted.");
    expect(out[2]).toContain("would delete: Rivera Bakery");
  });

  it("no org due: count only, no Kept line", () => {
    const out = formatRetentionRun(
      result({
        orgsDue: 0,
        orgsDeleted: 0,
        deletedOrgs: [],
        keptAgreementsForDeletedOrgs: 0,
      }),
      NOW,
    );
    expect(out).toContain("Closed sites due (30 days):   0\n");
    expect(out).not.toContain("Kept:");
  });

  it("cap hit: the stop line with how many still wait", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({
      id: `org${i}aaaaaaaaaaa`,
      name: `Site ${i}`,
      reason: "cancelled" as const,
      closedAt: "2026-09-01T00:00:00.000Z",
    }));
    const out = formatRetentionRun(
      result({ orgsDue: 8, orgsDeleted: 5, capHit: true, deletedOrgs: five }),
      NOW,
    );
    expect(out).toContain(
      "Stopped at 5 sites this run; 3 more wait for the next run. Check why so many closed.",
    );
  });

  it("names failed steps", () => {
    expect(
      formatRetentionRun(result({ failedSteps: ["audit"] }), NOW),
    ).toContain("Not finished: audit.");
  });

  it("15-07: hub inquiries past 2 years", () => {
    expect(
      formatRetentionRun(result({ hubInquiriesDeleted: 4 }), NOW),
    ).toContain("Hub inquiries past 2 years:   4\n");
  });

  it("never prints an org id", () => {
    expect(formatRetentionRun(result(), NOW)).not.toContain("abcdefghijklmno");
  });

  it("10-28: payment records expired and kept for deleted sites", () => {
    const out = formatRetentionRun(
      result({ paymentRecordsExpired: 3, keptPaymentRecordsForDeletedOrgs: 4 }),
      NOW,
    );
    expect(out).toContain("Payment records past 7 years: 3\n");
    expect(out).toContain(
      "Kept: 4 invoices and quotes for deleted sites (7 years from deletion).",
    );
    expect(
      formatRetentionRun(result({ keptPaymentRecordsForDeletedOrgs: 1 }), NOW),
    ).toContain("Kept: 1 invoice or quote for deleted sites");
  });
});
