import { describe, expect, it } from "vitest";
import { NotFound } from "../errors";
import {
  TICKET_NUMBER_START,
  formatTicketNumber,
  parseTicketNumber,
} from "./numbers";
import { SUPPORT_COPY, replySubject, statusSubject } from "./copy";
import {
  PAID_CATEGORIES,
  paidAccepted,
  paidAwaitingChoice,
  paidBlocksProgress,
} from "./paid";

describe("parseTicketNumber", () => {
  it("parses a valid number", () => {
    expect(parseTicketNumber("1042")).toBe(1042);
    expect(parseTicketNumber("#1042")).toBe(1042);
    expect(parseTicketNumber(String(TICKET_NUMBER_START))).toBe(1001);
  });

  it.each([
    "abc",
    "999",
    "1000",
    "-5",
    "1e3",
    "",
    " ",
    "1042.0",
    "01042",
    "0x400",
  ])("throws NotFound (never InvalidInput) for %j", (raw) => {
    expect(() => parseTicketNumber(raw)).toThrow(NotFound);
  });

  it("throws NotFound for non-strings", () => {
    expect(() => parseTicketNumber(undefined)).toThrow(NotFound);
    expect(() => parseTicketNumber({})).toThrow(NotFound);
  });

  it("formats", () => {
    expect(formatTicketNumber(1042)).toBe("#1042");
  });
});

describe("SUPPORT_COPY", () => {
  it("keeps the CONTEXT anchors verbatim", () => {
    expect(SUPPORT_COPY.SLA_LINE).toBe(
      "Support replies within 2 business days.",
    );
    expect(SUPPORT_COPY.NO_REPLY_FOOTER).toBe(
      "Replies to this email aren't read. Reply in your hub.",
    );
    expect(SUPPORT_COPY.CLOSED_NOTE).toBe(
      "This ticket is closed. Open a new one.",
    );
  });

  it("builds email subjects", () => {
    expect(replySubject(1042)).toBe("Support replied to ticket #1042");
    expect(statusSubject(1042, "waiting_on_you")).toBe(
      "Ticket #1042 is now Waiting on you",
    );
  });
});

describe("paid", () => {
  const marked = {
    category: "design" as const,
    marked_at: "2026-10-01T00:00:00Z",
  };

  it("has nine categories, each with a label and help id", () => {
    expect(PAID_CATEGORIES).toHaveLength(9);
    for (const c of PAID_CATEGORIES) {
      expect(c.label).not.toBe("");
      expect(c.helpId).not.toBe("");
    }
  });

  it("blocks progress until accepted", () => {
    expect(paidBlocksProgress(null)).toBe(false);
    expect(paidBlocksProgress(marked)).toBe(true);
    expect(paidAwaitingChoice(marked)).toBe(true);
    const quoted = { ...marked, accepted_at: "2026-10-02T00:00:00Z" };
    expect(paidAccepted(quoted)).toBe(true);
    expect(paidBlocksProgress(quoted)).toBe(false);
    const care = { ...marked, care_chosen_at: "2026-10-02T00:00:00Z" };
    expect(paidAccepted(care)).toBe(true);
    expect(paidBlocksProgress(care)).toBe(false);
  });
});
