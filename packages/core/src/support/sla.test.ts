import { describe, expect, it } from "vitest";
import {
  SLA_BUSINESS_DAYS,
  businessDeadline,
  businessMsBetween,
  slaApplies,
  slaState,
} from "./sla";

const H = 3_600_000;
const d = (iso: string) => new Date(iso);

describe("businessDeadline (2 business days, America/Chicago)", () => {
  it.each([
    // Fri 16:00 CDT -> Tue 16:00 CDT
    ["2026-10-09T21:00:00Z", "2026-10-13T21:00:00Z"],
    // Sat 10:00 CDT -> Mon 00:00 + 2 -> Wed 00:00 CDT
    ["2026-10-10T15:00:00Z", "2026-10-14T05:00:00Z"],
    // Sun 23:30 CDT -> Wed 00:00 CDT
    ["2026-10-12T04:30:00Z", "2026-10-14T05:00:00Z"],
    // Mon 09:00 CDT -> Wed 09:00 CDT
    ["2026-10-12T14:00:00Z", "2026-10-14T14:00:00Z"],
    // Fall back 2026-11-01: Fri 10:00 CDT -> Tue 10:00 CST (keeps wall time)
    ["2026-10-30T15:00:00Z", "2026-11-03T16:00:00Z"],
    // Sat 31 Oct 10:00 CDT -> Wed 4 Nov 00:00 CST
    ["2026-10-31T15:00:00Z", "2026-11-04T06:00:00Z"],
    // Spring forward 2027-03-14: Fri 10:00 CST -> Tue 10:00 CDT
    ["2027-03-12T16:00:00Z", "2027-03-16T15:00:00Z"],
    // Thu 23:30 CST before the change -> Mon 23:30 CDT
    ["2027-03-12T05:30:00Z", "2027-03-16T04:30:00Z"],
  ])("%s -> %s", (start, due) => {
    expect(businessDeadline(d(start), SLA_BUSINESS_DAYS).toISOString()).toBe(
      new Date(due).toISOString(),
    );
  });

  it("refuses a bad day count", () => {
    expect(() => businessDeadline(d("2026-10-12T14:00:00Z"), -1)).toThrow();
  });
});

describe("businessMsBetween", () => {
  it("counts only Mon-Fri local time", () => {
    // Fri 17:00 CDT -> Mon 09:00 CDT = 7 h + 9 h
    expect(
      businessMsBetween(d("2026-10-09T22:00:00Z"), d("2026-10-12T14:00:00Z")),
    ).toBe(16 * H);
  });

  it("is zero for a reversed or weekend-only range", () => {
    expect(
      businessMsBetween(d("2026-10-12T14:00:00Z"), d("2026-10-09T22:00:00Z")),
    ).toBe(0);
    expect(
      businessMsBetween(d("2026-10-10T15:00:00Z"), d("2026-10-11T15:00:00Z")),
    ).toBe(0);
  });

  it("handles the 25-hour fall-back Sunday and the Monday after", () => {
    // Fri 30 Oct 12:00 CDT -> Mon 2 Nov 12:00 CST = 12 h + 12 h
    expect(
      businessMsBetween(d("2026-10-30T17:00:00Z"), d("2026-11-02T18:00:00Z")),
    ).toBe(24 * H);
  });
});

describe("slaState", () => {
  const due = d("2026-10-09T22:00:00Z"); // Fri 17:00 CDT

  it("applies to problem and question only", () => {
    expect(slaApplies("problem")).toBe(true);
    expect(slaApplies("question")).toBe(true);
    expect(slaApplies("change")).toBe(false);
    expect(slaApplies("billing")).toBe(false);
    expect(slaApplies("suggestion")).toBe(false);
  });

  it("none without a due date", () => {
    expect(slaState({ dueAt: null, repliedAt: null, now: due })).toBe("none");
  });

  it("due_soon at 3 business hours left, on_track at 5", () => {
    expect(
      slaState({ dueAt: due, repliedAt: null, now: d("2026-10-09T19:00:00Z") }),
    ).toBe("due_soon");
    expect(
      slaState({ dueAt: due, repliedAt: null, now: d("2026-10-09T17:00:00Z") }),
    ).toBe("on_track");
  });

  it("counts business hours across a weekend", () => {
    // Fri 22:00 CDT -> Mon 01:00 CDT = 2 h + 1 h business
    expect(
      slaState({
        dueAt: d("2026-10-12T06:00:00Z"),
        repliedAt: null,
        now: d("2026-10-10T03:00:00Z"),
      }),
    ).toBe("due_soon");
  });

  it("met when replied before due, missed when late or past due", () => {
    expect(
      slaState({
        dueAt: due,
        repliedAt: d("2026-10-09T21:00:00Z"),
        now: d("2026-10-20T00:00:00Z"),
      }),
    ).toBe("met");
    expect(
      slaState({
        dueAt: due,
        repliedAt: d("2026-10-09T23:00:00Z"),
        now: d("2026-10-20T00:00:00Z"),
      }),
    ).toBe("missed");
    expect(
      slaState({ dueAt: due, repliedAt: null, now: d("2026-10-09T22:00:01Z") }),
    ).toBe("missed");
  });

  it("accepts ISO strings", () => {
    expect(
      slaState({
        dueAt: due.toISOString(),
        repliedAt: "",
        now: d("2026-10-09T17:00:00Z"),
      }),
    ).toBe("on_track");
  });
});
