// 07-19 Task 2: Inbox URL params (choices 8 and 12).
import { describe, expect, it } from "vitest";
import {
  inboxHref,
  messageHref,
  parseInboxParams,
} from "../app/(platform)/hub/inbox/inbox-params";

describe("parseInboxParams", () => {
  it("defaults to messages", () => {
    expect(parseInboxParams({})).toEqual({ tab: "messages" });
    expect(parseInboxParams(null)).toEqual({ tab: "messages" });
  });

  it("reads tab, the view=filtered alias, form, q and message", () => {
    expect(parseInboxParams({ tab: "filtered" }).tab).toBe("filtered");
    expect(parseInboxParams({ view: "filtered" }).tab).toBe("filtered");
    expect(
      parseInboxParams({ form: "f1", q: "  hello ", message: "m1" }),
    ).toEqual({ tab: "messages", form: "f1", q: "hello", message: "m1" });
  });

  it("drops bad ids and caps q", () => {
    const p = parseInboxParams({
      form: "../x",
      message: "a b",
      q: "x".repeat(300),
    });
    expect(p.form).toBeUndefined();
    expect(p.message).toBeUndefined();
    expect(p.q).toHaveLength(100);
  });
});

describe("inboxHref", () => {
  it("builds from the closed key set", () => {
    expect(inboxHref({ tab: "messages", form: "f1" }, { q: "hi" })).toBe(
      "/hub/inbox?tab=messages&form=f1&q=hi",
    );
    expect(
      inboxHref({ tab: "filtered", form: "f1" }, { form: undefined }),
    ).toBe("/hub/inbox?tab=filtered");
    expect(messageHref("m1")).toBe("/hub/inbox?tab=messages&message=m1");
  });
});
