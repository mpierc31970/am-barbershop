// 07-19 Task 1: formViewOf narrows hostile coreData.forms entries; fieldErrorCopy maps codes
// (CONT-25, D231; 07-UI-SPEC "Public form").
import {
  EMAIL_ANSWER_COPY,
  FORM_ERROR_COPY,
  FORM_RATE_COPY,
  TOO_LONG_ANSWER_COPY,
  requiredCopy,
  type FormField,
} from "@cds/core/forms";
import { describe, expect, it } from "vitest";
import { initialFormState } from "./FormShell";
import {
  FORM_ITEM_ANCHOR,
  fieldDomId,
  fieldErrorCopy,
  fieldFocusId,
  formViewOf,
} from "./form-view";

function field(
  id: string,
  type: FormField["type"],
  label = "Email",
): FormField {
  return {
    id,
    type,
    label,
    placeholder: "",
    help: "",
    required: true,
    full_width: false,
    options: ["A"],
    content: "",
    value: "",
  };
}

const form = {
  id: "form1",
  name: "Contact",
  layout: "1",
  fields: [field("email", "email"), field("secret", "hidden", "S")],
  after_submit: { kind: "message", message: "Thanks!", button_text: "Send" },
  newsletter_checkbox: false,
  newsletter_wording: "",
};

describe("formViewOf", () => {
  it("narrows a good entry and drops hidden fields", () => {
    const v = formViewOf({ form, pageId: "page1", status: null });
    expect(v?.form.id).toBe("form1");
    expect(v?.form.fields.map((f) => f.id)).toEqual(["email"]);
    expect(v?.pageId).toBe("page1");
    expect(v?.preview).toBe(false);
  });

  it.each([
    ["null", null],
    ["a string", "form1"],
    ["an array", [form]],
    ["no form", { pageId: "p" }],
    ["a bad form id", { form: { ...form, id: "../x" } }],
    ["non-array fields", { form: { ...form, fields: "x" } }],
    ["a prototype-only form", { ["__proto__"]: { form } }],
  ])("rejects %s", (_n, v) => {
    expect(formViewOf(v)).toBeNull();
  });

  it("drops a hostile page id and status", () => {
    const v = formViewOf({
      form,
      pageId: "//evil",
      status: { itemId: "<x>", kind: "sent" },
    });
    expect(v?.pageId).toBeNull();
    expect(v?.status).toBeNull();
  });

  it("keeps only valid field codes", () => {
    const v = formViewOf({
      form,
      status: {
        itemId: "it-1",
        kind: "fields",
        fields: { email: "r", bad: "zz", "a b": "r" },
      },
    });
    expect(v?.status).toEqual({
      itemId: "it-1",
      kind: "fields",
      fields: { email: "r" },
    });
  });
});

describe("ids and copy", () => {
  it("anchors by item id", () => {
    expect(FORM_ITEM_ANCHOR("it-1")).toBe("form-it-1");
    expect(fieldDomId("it-1", "email")).toBe("f-it-1-email");
    expect(fieldFocusId("it-1", field("q", "radio"))).toBe("f-it-1-q-0");
    expect(fieldFocusId("it-1", field("a", "address"))).toBe("f-it-1-a-line1");
  });

  it("maps codes to the per-type messages", () => {
    expect(fieldErrorCopy(field("e", "email"), "r")).toBe(
      requiredCopy("Email"),
    );
    expect(fieldErrorCopy(field("e", "email"), "i")).toBe(EMAIL_ANSWER_COPY);
    expect(fieldErrorCopy(field("e", "long_text"), "l")).toBe(
      TOO_LONG_ANSWER_COPY,
    );
  });

  it("builds the first state from a status for this item only", () => {
    const base = formViewOf({ form })!;
    expect(
      initialFormState({ ...base, status: { itemId: "a", kind: "sent" } }, "a"),
    ).toEqual({
      kind: "sent",
      message: "Thanks!",
    });
    expect(
      initialFormState({ ...base, status: { itemId: "b", kind: "sent" } }, "a")
        .kind,
    ).toBe("idle");
    expect(
      initialFormState({ ...base, status: { itemId: "a", kind: "rate" } }, "a"),
    ).toEqual({
      kind: "summary",
      summary: FORM_RATE_COPY,
    });
    expect(
      initialFormState(
        { ...base, status: { itemId: "a", kind: "error" } },
        "a",
      ),
    ).toEqual({
      kind: "summary",
      summary: FORM_ERROR_COPY,
    });
  });
});
