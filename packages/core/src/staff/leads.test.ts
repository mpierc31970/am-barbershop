// 13-14 (STAFF-01, D28): pure lead rules: abandoned, stage chips, masked email.
import { describe, expect, it } from "vitest";
import {
  LEAD_STAGE_CHIPS,
  abandonedKindOf,
  isAbandonedLead,
  leadStageChip,
  maskEmail,
} from "./leads";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const DAY = 86_400_000;

describe("isAbandonedLead", () => {
  it("a quote idle 7 days + 1 minute with no checkout is abandoned, days 7", () => {
    expect(
      isAbandonedLead(
        { kind: "quote", lastActivityAt: ago(7 * DAY + 60_000) },
        NOW,
      ),
    ).toEqual({ abandoned: true, days: 7 });
  });

  it("a started checkout resets it", () => {
    expect(
      isAbandonedLead(
        {
          kind: "quote",
          lastActivityAt: ago(7 * DAY + 60_000),
          checkoutStartedAt: ago(8 * DAY),
        },
        NOW,
      ).abandoned,
    ).toBe(false);
  });

  it("an intake active 6 days ago is not abandoned", () => {
    expect(
      isAbandonedLead({ kind: "intake", lastActivityAt: ago(6 * DAY) }, NOW),
    ).toEqual({ abandoned: false, days: 6 });
  });

  it("exactly 7 days is abandoned; just under is not", () => {
    expect(
      isAbandonedLead({ kind: "intake", lastActivityAt: ago(7 * DAY) }, NOW)
        .abandoned,
    ).toBe(true);
    expect(
      isAbandonedLead({ kind: "intake", lastActivityAt: ago(7 * DAY - 1) }, NOW)
        .abandoned,
    ).toBe(false);
  });

  it("orgs past intake are never abandoned; PB date strings parse", () => {
    expect(
      isAbandonedLead({ kind: "org", lastActivityAt: ago(30 * DAY) }, NOW)
        .abandoned,
    ).toBe(false);
    expect(
      isAbandonedLead(
        { kind: "quote", lastActivityAt: "2026-10-01 12:00:00.000Z" },
        NOW,
      ),
    ).toEqual({ abandoned: true, days: 14 });
  });

  it("unknown or future activity is 0 days, not abandoned", () => {
    expect(
      isAbandonedLead({ kind: "quote", lastActivityAt: null }, NOW),
    ).toEqual({ abandoned: false, days: 0 });
    expect(
      isAbandonedLead({ kind: "quote", lastActivityAt: ago(-DAY) }, NOW),
    ).toEqual({ abandoned: false, days: 0 });
  });
});

describe("leadStageChip", () => {
  it("maps each lead status to the chips in order", () => {
    const cases = [
      leadStageChip({ kind: "quote", status: "saved" }),
      leadStageChip({ kind: "org", status: "intake 3/7" }),
      leadStageChip({ kind: "org", status: "sent" }),
      leadStageChip({ kind: "org", status: "fit_review" }),
      leadStageChip({ kind: "org", status: "sent", paid: true }),
      leadStageChip({ kind: "org", status: "being built" }),
      leadStageChip({ kind: "org", status: "ready_for_review" }),
      leadStageChip({ kind: "org", status: "live" }),
    ];
    expect(cases).toEqual(LEAD_STAGE_CHIPS.map((c) => c.id));
  });

  it("every quote status is a saved quote", () => {
    for (const status of ["saved", "reminded 2", "expired"]) {
      expect(leadStageChip({ kind: "quote", status })).toBe("saved_quote");
    }
  });

  it("abandonedKindOf: quote, intake, org", () => {
    expect(abandonedKindOf({ kind: "quote", status: "saved" })).toBe("quote");
    expect(abandonedKindOf({ kind: "org", status: "intake 0/7" })).toBe(
      "intake",
    );
    expect(abandonedKindOf({ kind: "org", status: "sent" })).toBe("org");
  });
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("maria@rivera.com")).toBe("m•••@rivera.com");
    expect(maskEmail("a@b.co")).toBe("a•••@b.co");
  });

  it("malformed input is •••", () => {
    for (const v of ["", "nope", "a@b", "@b.co", "a b@c.co", null, 42]) {
      expect(maskEmail(v)).toBe("•••");
    }
  });
});
