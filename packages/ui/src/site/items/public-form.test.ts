// 07-18 Task 2: publicFormOf (choice 2; shared with 07-19's FormItem).
import {
  DEFAULT_AFTER_MESSAGE,
  DEFAULT_BUTTON_TEXT,
  DEFAULT_NEWSLETTER_WORDING,
} from "@cds/core/forms";
import { describe, expect, it } from "vitest";
import { publicFormOf } from "./public-form";

const field = (over: Record<string, unknown>) => ({
  id: "a",
  type: "short_text",
  label: "A",
  placeholder: "",
  help: "",
  required: false,
  full_width: false,
  options: [],
  content: "",
  value: "",
  ...over,
});

describe("publicFormOf", () => {
  it("projects a draft: hidden removed, defaults filled, page dropped", () => {
    const p = publicFormOf(
      {
        name: "Contact",
        layout: "2",
        fields: [
          field({ id: "a", label: "Name" }),
          field({ id: "h", type: "hidden", value: "secret" }),
        ],
        after_submit: {
          kind: "page",
          message: "",
          page: "p1",
          button_text: "",
        },
        notify_route: "inquiries",
        newsletter_checkbox: true,
        newsletter_wording: "",
        template: "contact",
      },
      "f1",
    );
    expect(p).toEqual({
      id: "f1",
      name: "Contact",
      layout: "2",
      fields: [field({ id: "a", label: "Name" })],
      after_submit: {
        kind: "page",
        message: DEFAULT_AFTER_MESSAGE,
        button_text: DEFAULT_BUTTON_TEXT,
      },
      newsletter_checkbox: true,
      newsletter_wording: DEFAULT_NEWSLETTER_WORDING,
    });
    expect(JSON.stringify(p)).not.toContain("secret");
  });

  it("keeps the owner's button text and message", () => {
    const p = publicFormOf(
      {
        fields: [],
        after_submit: { kind: "message", message: "Ta", button_text: "Go" },
      },
      "x",
    );
    expect(p.after_submit).toEqual({
      kind: "message",
      message: "Ta",
      button_text: "Go",
    });
  });

  it("accepts a stored FormRecord (extra keys ignored)", () => {
    const p = publicFormOf(
      {
        id: "f9",
        name: "Q",
        layout: "1",
        fields: [field({ value: "leak" })],
        deleted: false,
        inReview: true,
        organization: "org",
      },
      "f9",
    );
    expect(Object.keys(p).sort()).toEqual(
      [
        "after_submit",
        "fields",
        "id",
        "layout",
        "name",
        "newsletter_checkbox",
        "newsletter_wording",
      ].sort(),
    );
    expect(p.fields[0]!.value).toBe("");
  });

  it("never throws on hostile input", () => {
    const hostile = JSON.parse(
      '{"__proto__":{"fields":[1]},"fields":"no","layout":{}}',
    );
    expect(publicFormOf(hostile, "z").fields).toEqual([]);
    expect(publicFormOf(null, "z").fields).toEqual([]);
    expect(
      publicFormOf({ fields: [null, { type: "evil" }, 7, field({})] }, "z")
        .fields,
    ).toHaveLength(1);
  });
});
