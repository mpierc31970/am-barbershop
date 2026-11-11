import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import { TICKET_TYPES } from "../support/types";
import { QUEUE_MAP, queueFor } from "./queue-map";

describe("QUEUE_MAP (STAFF-26, D292, P13-P9)", () => {
  it("routes each kind to its queue", () => {
    expect(queueFor("dmca")).toBe("review_queue");
    expect(queueFor("problem")).toBe("ticket_inbox");
    expect(queueFor("polish")).toBe("staff_tooling");
    expect(queueFor("fit_hold")).toBe("review_queue");
    expect(queueFor("suggestion")).toBe("ticket_inbox");
  });

  it("throws InvalidInput for an unknown kind (T-13-02-03)", () => {
    expect(() => queueFor("nope")).toThrow(InvalidInput);
    expect(() => queueFor("")).toThrow(InvalidInput);
    expect(() => queueFor("toString")).toThrow(InvalidInput);
  });

  it("lists every value in exactly one queue", () => {
    const all = Object.values(QUEUE_MAP).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("the ticket inbox is exactly the P12 ticket types", () => {
    expect([...QUEUE_MAP.ticket_inbox].sort()).toEqual(
      [...TICKET_TYPES].sort(),
    );
  });
});
