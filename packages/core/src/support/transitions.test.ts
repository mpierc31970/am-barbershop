import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import { SUPPORT_COPY } from "./copy";
import {
  TICKET_EVENTS,
  TICKET_STATUSES,
  nextStatus,
  systemLineFor,
} from "./transitions";
import type { TicketEvent } from "./transitions";
import type { TicketStatus } from "./types";

// staff_set rows move to "waiting_on_you" (or "resolved" when already there); undo_solved rows
// pass "in_progress" as the stored previous status.
const T = "THROW" as const;
type Row = [
  TicketStatus,
  TicketEvent,
  TicketStatus | undefined,
  TicketStatus | typeof T,
];

const rows: Row[] = [
  ["open", "staff_set", "waiting_on_you", "waiting_on_you"],
  ["open", "tenant_reply", undefined, "open"],
  ["open", "tenant_solved", undefined, "resolved"],
  ["open", "undo_solved", "in_progress", T],
  ["open", "auto_close", undefined, T],
  ["in_progress", "staff_set", "waiting_on_you", "waiting_on_you"],
  ["in_progress", "tenant_reply", undefined, "in_progress"],
  ["in_progress", "tenant_solved", undefined, "resolved"],
  ["in_progress", "undo_solved", "in_progress", T],
  ["in_progress", "auto_close", undefined, T],
  ["waiting_on_you", "staff_set", "resolved", "resolved"],
  ["waiting_on_you", "tenant_reply", undefined, "in_progress"],
  ["waiting_on_you", "tenant_solved", undefined, "resolved"],
  ["waiting_on_you", "undo_solved", "in_progress", T],
  ["waiting_on_you", "auto_close", undefined, T],
  ["resolved", "staff_set", "waiting_on_you", "waiting_on_you"],
  ["resolved", "tenant_reply", undefined, "in_progress"],
  ["resolved", "tenant_solved", undefined, T],
  ["resolved", "undo_solved", "in_progress", "in_progress"],
  ["resolved", "auto_close", undefined, "closed"],
  ["closed", "staff_set", "waiting_on_you", T],
  ["closed", "tenant_reply", undefined, T],
  ["closed", "tenant_solved", undefined, T],
  ["closed", "undo_solved", "in_progress", T],
  ["closed", "auto_close", undefined, T],
];

describe("nextStatus", () => {
  it("covers every status x event pair", () => {
    expect(rows).toHaveLength(TICKET_STATUSES.length * TICKET_EVENTS.length);
    const keys = new Set(rows.map((r) => `${r[0]}/${r[1]}`));
    expect(keys.size).toBe(25);
  });

  it.each(rows)("%s + %s (%s) -> %s", (from, ev, to, expected) => {
    if (expected === T) {
      expect(() => nextStatus(from, ev, to)).toThrow(InvalidInput);
    } else {
      expect(nextStatus(from, ev, to)).toBe(expected);
    }
  });

  it("staff_set refuses no target, open, and the same status", () => {
    expect(() => nextStatus("in_progress", "staff_set")).toThrow(InvalidInput);
    expect(() => nextStatus("in_progress", "staff_set", "open")).toThrow(
      InvalidInput,
    );
    expect(() => nextStatus("in_progress", "staff_set", "in_progress")).toThrow(
      InvalidInput,
    );
    expect(nextStatus("open", "staff_set", "closed")).toBe("closed");
  });

  it("refuses In progress while a paid service awaits acceptance (SUPPORT-03)", () => {
    const paid = {
      category: "design" as const,
      marked_at: "2026-10-01T00:00:00Z",
    };
    expect(() =>
      nextStatus("waiting_on_you", "staff_set", "in_progress", { paid }),
    ).toThrow(InvalidInput);
    expect(
      nextStatus("waiting_on_you", "staff_set", "in_progress", {
        paid: { ...paid, accepted_at: "2026-10-02T00:00:00Z" },
      }),
    ).toBe("in_progress");
    expect(
      nextStatus("waiting_on_you", "staff_set", "resolved", { paid }),
    ).toBe("resolved");
    // 12-23: a tenant reply never opens In progress before acceptance either.
    expect(
      nextStatus("waiting_on_you", "tenant_reply", undefined, { paid }),
    ).toBe("waiting_on_you");
    expect(nextStatus("resolved", "tenant_reply", undefined, { paid })).toBe(
      "waiting_on_you",
    );
    expect(
      nextStatus("waiting_on_you", "tenant_reply", undefined, {
        paid: { ...paid, care_chosen_at: "2026-10-02T00:00:00Z" },
      }),
    ).toBe("in_progress");
  });

  it("undo_solved needs a valid previous status", () => {
    expect(() => nextStatus("resolved", "undo_solved")).toThrow(InvalidInput);
    expect(() => nextStatus("resolved", "undo_solved", "closed")).toThrow(
      InvalidInput,
    );
    expect(nextStatus("resolved", "undo_solved", "waiting_on_you")).toBe(
      "waiting_on_you",
    );
  });
});

describe("nextStatus refusals are UI copy (WR-B02)", () => {
  const COPY = new Set<string>(
    Object.values(SUPPORT_COPY as Record<string, unknown>).filter(
      (v): v is string => typeof v === "string",
    ),
  );
  const refusal = (fn: () => unknown): string => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidInput);
      return (e as Error).message;
    }
    throw new Error("expected a refusal");
  };

  it.each(rows.filter((r) => r[3] === T))(
    "%s + %s (%s) refuses with SUPPORT_COPY",
    (from, ev, to) => {
      const msg = refusal(() => nextStatus(from, ev, to));
      expect(COPY.has(msg), msg).toBe(true);
      expect(msg).toMatch(/^[A-Z].*.$/);
    },
  );

  it("names the tenant-reachable refusals", () => {
    expect(refusal(() => nextStatus("closed", "tenant_reply"))).toBe(
      SUPPORT_COPY.CLOSED_NOTE,
    );
    expect(refusal(() => nextStatus("resolved", "tenant_solved"))).toBe(
      SUPPORT_COPY.ALREADY_RESOLVED,
    );
    expect(refusal(() => nextStatus("open", "undo_solved", "open"))).toBe(
      SUPPORT_COPY.NOTHING_TO_UNDO,
    );
    expect(
      refusal(() =>
        nextStatus("waiting_on_you", "staff_set", "in_progress", {
          paid: { category: "design", marked_at: "2026-10-01T00:00:00Z" },
        }),
      ),
    ).toBe(SUPPORT_COPY.PAID_BLOCKS_PROGRESS);
  });
});

describe("systemLineFor", () => {
  it("labels the tenant and job moves", () => {
    expect(systemLineFor("waiting_on_you", "in_progress", "tenant_reply")).toBe(
      "Back to Support",
    );
    expect(systemLineFor("resolved", "in_progress", "tenant_reply")).toBe(
      "Reopened by your reply",
    );
    expect(systemLineFor("resolved", "closed", "auto_close")).toBe(
      "Closed after 7 days with no reply",
    );
    expect(systemLineFor("open", "resolved", "tenant_solved")).toBe(
      "Marked as solved",
    );
    expect(systemLineFor("in_progress", "waiting_on_you", "staff_set")).toBe(
      "Support changed the status to Waiting on you",
    );
  });

  it("returns null when nothing moved or for an undo", () => {
    expect(systemLineFor("open", "open", "tenant_reply")).toBeNull();
    expect(systemLineFor("resolved", "in_progress", "undo_solved")).toBeNull();
  });
});
