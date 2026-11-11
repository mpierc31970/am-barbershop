// 12-06 choice 6: SUPPORT_UI_COPY carries every UI-SPEC copy ID used by P12 screens, and the
// CONTEXT anchors are the @cds/core/support strings themselves (one source, never retyped).
import { SUPPORT_COPY } from "@cds/core/support";
import { describe, expect, it } from "vitest";
import { SUPPORT_UI_COPY } from "./copy";

const IDS = [
  "MSG_EMPTY_H",
  "MSG_EMPTY_B",
  "TICKETS_EMPTY_H",
  "TICKETS_EMPTY_B",
  "DOCS_EMPTY",
  "IDEAS_INTRO",
  "IDEAS_EMPTY",
  "IDEAS_NOMATCH",
  "SIMILAR_HEAD",
  "IDEA_PUBLIC",
  "SLA_LINE",
  "CONTEXT_NOTE",
  "PAID_RULE",
  "PAID_ASK_OWNER",
  "RESOLVED_NOTE",
  "CLOSED_NOTE",
  "HELD_KEPT",
  "HELD_APPLY_NOTE",
  "LOCKED_BODY",
  "NOTICE_ACTIVE",
  "NOTICE_PLANNED",
  "ATTACH_HINT",
  "FILE_RULES",
  "FILE_TOO_BIG",
  "FILE_TYPE",
  "FILE_REFUSED",
  "FILE_TOO_MANY",
  "FILE_FAILED",
  "MSG_REQUIRED",
  "TYPE_REQUIRED",
  "SUBJECT_REQUIRED",
  "BODY_REQUIRED",
  "RATE_TICKETS",
  "RATE_MESSAGES",
  "RATE_UPLOADS",
  "ERR_SEND",
  "ERR_VOTE",
  "ERR_LOAD",
  "ERR_SECTION",
  "ERR_SAVE",
  "LINK_EXPIRED",
  "VIEWER_READONLY",
  "IMPERSONATING_SUPPORT",
  "SUPPORT_EMAIL_FALLBACK",
  "NO_REPLY_FOOTER",
] as const;

describe("SUPPORT_UI_COPY", () => {
  it("has every Copywriting Contract ID", () => {
    for (const id of IDS) expect(SUPPORT_UI_COPY).toHaveProperty(id);
  });

  it("re-exports the CONTEXT anchors from @cds/core/support", () => {
    for (const k of [
      "SLA_LINE",
      "PAID_RULE",
      "PAID_ASK_OWNER",
      "RESOLVED_NOTE",
      "CLOSED_NOTE",
      "HELD_KEPT",
      "IDEA_PUBLIC",
      "NO_REPLY_FOOTER",
      "NOTICE_ACTIVE",
      "NOTICE_PLANNED",
    ] as const) {
      expect(SUPPORT_UI_COPY[k]).toBe(SUPPORT_COPY[k]);
    }
  });

  it("fills templates", () => {
    expect(SUPPORT_UI_COPY.FILE_TOO_BIG("shot.png")).toBe(
      "shot.png is larger than 10 MB. Try a smaller file or a screenshot.",
    );
    expect(SUPPORT_UI_COPY.IDEAS_NOMATCH("gift cards")).toBe(
      'No ideas match "gift cards".',
    );
    expect(SUPPORT_UI_COPY.BUTTONS.remove("a.pdf")).toBe("Remove a.pdf");
    expect(SUPPORT_UI_COPY.SUPPORT_EMAIL_FALLBACK("support@example.com")).toBe(
      "Can't use your hub right now? Email support@example.com.",
    );
  });
});
