// Storage allowance helpers (07-10, 10-33; CONT-19, BILL-13, D225): level, GB labels, exact
// 10-UI-SPEC copy and the pure allowance check against any allowance. The PB-backed reads are in test/media-usage.integration.test.ts.
import { InvalidInput } from "@cds/core";
import { describe, expect, it } from "vitest";
import {
  AllowanceExceeded,
  MEDIA_ALLOWANCE_BYTES,
  USAGE_COPY,
  USAGE_WARN_RATIO,
  checkAllowance,
  formatGb,
  summarise,
  usageLabel,
  usageLevel,
} from "./usage";
import { allowanceFromAccount } from "./allowance";

const GB = 1024 ** 3;
const A = MEDIA_ALLOWANCE_BYTES;

describe("constants", () => {
  it("2 GB = 2 x 1024^3, warn at 80 %", () => {
    expect(A).toBe(2 * GB);
    expect(USAGE_WARN_RATIO).toBe(0.8);
  });
});

describe("usageLevel", () => {
  it("ok below 80 %, warn from 80 %, full at 100 %", () => {
    expect(usageLevel(0, A)).toBe("ok");
    expect(usageLevel(A * 0.799, A)).toBe("ok");
    expect(usageLevel(A * 0.8, A)).toBe("warn");
    expect(usageLevel(A * 0.99, A)).toBe("warn");
    expect(usageLevel(A, A)).toBe("full");
    expect(usageLevel(A * 1.5, A)).toBe("full");
  });
});

describe("formatGb / usageLabel", () => {
  it("one decimal, trailing .0 dropped", () => {
    expect(formatGb(1.2 * GB)).toBe("1.2 GB");
    expect(formatGb(0)).toBe("0 GB");
    expect(formatGb(2 * GB)).toBe("2 GB");
    expect(formatGb(1.74 * GB)).toBe("1.7 GB");
  });
  it("label matches the UsageMeter copy", () => {
    expect(usageLabel(1.2 * GB, A)).toBe("1.2 GB of 2 GB used");
    expect(usageLabel(1.2 * GB, 7 * GB)).toBe("1.2 GB of 7 GB used");
  });
});

describe("USAGE_COPY (10-UI-SPEC, exact)", () => {
  it("full (USAGE-FULL-PACKS) names the allowance and offers storage", () => {
    expect(USAGE_COPY.full(7 * GB)).toBe(
      "You've used all 7 GB of your media storage. Add more, or delete something to make room.",
    );
    expect(USAGE_COPY.full(A)).toContain(
      "Add more, or delete something to make room.",
    );
    expect(USAGE_COPY.full(A)).not.toMatch(/coming soon/i);
  });
  it("warn (USAGE-80-PACKS) carries the live figure and the allowance", () => {
    expect(USAGE_COPY.warn(1.7 * GB, A)).toBe(
      "You've used 1.7 GB of your 2 GB of media. Delete files you no longer use, or add more storage.",
    );
    const w = USAGE_COPY.warn(6.5 * GB, 7 * GB);
    expect(w).toContain("7 GB of media");
    expect(w).toContain("add more storage");
  });
  it("member (USAGE-FULL-MEMBER)", () => {
    expect(USAGE_COPY.member).toBe(
      "Media storage is full. Ask your site owner to add more, or delete something to make room.",
    );
  });
});

describe("a 7 GB allowance (one 5 GB pack)", () => {
  const SEVEN = 7 * GB;
  it("6.5 GB is warn, not full", () => {
    expect(usageLevel(6.5 * GB, SEVEN)).toBe("warn");
  });
  it("refuses 6.9 + 0.2 GB at 7 GB, passes at 12 GB", () => {
    const used = Math.round(6.9 * GB);
    const inc = Math.round(0.2 * GB);
    expect(() => checkAllowance(used, inc, SEVEN)).toThrow(AllowanceExceeded);
    try {
      checkAllowance(used, inc, SEVEN);
    } catch (e) {
      expect((e as Error).message).toBe(USAGE_COPY.full(SEVEN));
      expect((e as AllowanceExceeded).allowanceBytes).toBe(SEVEN);
    }
    expect(checkAllowance(used, inc, 12 * GB).level).toBe("ok");
  });
  it("summarise reports that allowance and ratio", () => {
    const u = summarise(
      [
        { kind: "video", bytes: 3 * GB },
        { kind: "library", bytes: 0.5 * GB },
      ],
      SEVEN,
    );
    expect(u.allowanceBytes).toBe(SEVEN);
    expect(u.ratio).toBe(0.5);
    expect(u.level).toBe("ok");
    expect(u.label).toBe("3.5 GB of 7 GB used");
    expect(u.byKind.video).toBe(3 * GB);
  });
});

describe("checkAllowance", () => {
  it("passes under 80 % with no warning", () => {
    expect(checkAllowance(0, 100, A)).toEqual({
      usedAfter: 100,
      level: "ok",
      warning: null,
    });
  });

  it("warns from 80 %", () => {
    const r = checkAllowance(Math.round(1.6 * GB), Math.round(0.1 * GB), A);
    expect(r.level).toBe("warn");
    expect(r.warning).toBe(USAGE_COPY.warn(1.7 * GB, A));
  });

  it("exactly at the allowance passes as full", () => {
    const r = checkAllowance(A - 10, 10, A);
    expect(r.level).toBe("full");
    expect(r.usedAfter).toBe(A);
  });

  it("refuses past the allowance with the exact full copy", () => {
    let err: unknown;
    try {
      checkAllowance(A - 10, 11, A);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AllowanceExceeded);
    expect(err).toBeInstanceOf(InvalidInput);
    expect((err as AllowanceExceeded).code).toBe("allowance_exceeded");
    expect((err as Error).message).toBe(USAGE_COPY.full(A));
  });

  it("refuses any upload once full; a zero-byte check still passes", () => {
    expect(() => checkAllowance(A, 1, A)).toThrow(AllowanceExceeded);
    expect(() => checkAllowance(A + 5, 1, A)).toThrow(AllowanceExceeded);
    expect(checkAllowance(A, 0, A).level).toBe("full");
  });

  it("rejects bad incoming sizes", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => checkAllowance(0, bad, A)).toThrow(InvalidInput);
      expect(() => checkAllowance(0, bad, A)).not.toThrow(AllowanceExceeded);
      expect(() => checkAllowance(0, 1, bad)).toThrow(InvalidInput);
    }
  });

  it("takes a custom allowance", () => {
    expect(() => checkAllowance(90, 11, 100)).toThrow(AllowanceExceeded);
    expect(checkAllowance(70, 10, 100).level).toBe("warn");
  });
});

describe("allowanceFromAccount (D225, CONTEXT A3)", () => {
  it("2 GB + 5 GB per small pack + 25 GB per large pack", () => {
    expect(allowanceFromAccount(null)).toBe(2 * GB);
    expect(
      allowanceFromAccount({
        status: "active",
        media_5gb_qty: 1,
        media_25gb_qty: 0,
      }),
    ).toBe(7 * GB);
    expect(
      allowanceFromAccount({
        status: "past_due",
        media_5gb_qty: 2,
        media_25gb_qty: 1,
      }),
    ).toBe(37 * GB);
  });
  it("packs read as 0 while lapsed or canceled (stored values untouched)", () => {
    for (const status of ["lapsed", "canceled"]) {
      expect(
        allowanceFromAccount({ status, media_5gb_qty: 3, media_25gb_qty: 1 }),
      ).toBe(2 * GB);
    }
  });
});
