// CONT-25, D231, D233 (07-15): the form definition validator, blocked fields, medical tip.
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import {
  BLOCKED_FIELD_COPY,
  BLOCKED_FIELD_RE,
  DEFAULT_AFTER_MESSAGE,
  DEFAULT_BUTTON_TEXT,
  DEFAULT_NEWSLETTER_WORDING,
  AUTO_REPLY_EMAIL_COPY,
  FILE_FIELD_PRO_COPY,
  FORM_FIELD_ID,
  PRO_SETTINGS_COPY,
  ROUTE_UNKNOWN_COPY,
  RULE_FIELD_COPY,
  RULE_TARGET_COPY,
  RULE_VALUE_COPY,
  STEP_FIELDS_COPY,
  STEPS_LIMIT_COPY,
  FormErrors,
  blockedFieldIds,
  formErrorsSummary,
  medicalHint,
  validateFormDefinition,
} from "./index";

function field(over: Record<string, unknown> = {}) {
  return { id: "f1", type: "short_text", label: "Your answer", ...over };
}

function errorsOf(raw: unknown): Record<string, string> {
  try {
    validateFormDefinition(raw);
  } catch (e) {
    if (e instanceof FormErrors) return { ...e.errors };
    throw e;
  }
  throw new Error("expected FormErrors");
}

describe("validateFormDefinition", () => {
  it("builds a fresh object with defaults and drops unknown keys", () => {
    const def = validateFormDefinition({
      name: "  Contact  ",
      fields: [field()],
      extra: "nope",
    });
    expect(def).toEqual({
      name: "Contact",
      layout: "1",
      fields: [
        {
          id: "f1",
          type: "short_text",
          label: "Your answer",
          placeholder: "",
          help: "",
          required: false,
          full_width: false,
          options: [],
          content: "",
          value: "",
        },
      ],
      after_submit: {
        kind: "message",
        message: DEFAULT_AFTER_MESSAGE,
        page: "",
        button_text: DEFAULT_BUTTON_TEXT,
      },
      notify_route: "inquiries",
      newsletter_checkbox: false,
      newsletter_wording: "",
    });
    expect(def).not.toHaveProperty("extra");
  });

  it("keeps layout 2, a valid route and the newsletter default wording", () => {
    const def = validateFormDefinition({
      name: "N",
      layout: "2",
      notify_route: "billing",
      newsletter_checkbox: true,
    });
    expect(def.layout).toBe("2");
    expect(def.notify_route).toBe("billing");
    expect(def.newsletter_wording).toBe(DEFAULT_NEWSLETTER_WORDING);
    expect(
      validateFormDefinition({ name: "N", notify_route: "x" }).notify_route,
    ).toBe("inquiries");
  });

  it("after_submit page needs a page id; button text is kept", () => {
    expect(
      errorsOf({ name: "N", after_submit: { kind: "page" } }).after_submit,
    ).toBe("Choose a page.");
    const def = validateFormDefinition({
      name: "N",
      after_submit: { kind: "page", page: "abc123", button_text: "Book" },
    });
    expect(def.after_submit).toEqual({
      kind: "page",
      message: DEFAULT_AFTER_MESSAGE,
      page: "abc123",
      button_text: "Book",
    });
  });

  it("mints an id for a missing one and keeps valid ids", () => {
    const def = validateFormDefinition({
      name: "N",
      fields: [{ type: "email", label: "Email" }],
    });
    expect(def.fields[0]!.id).toMatch(FORM_FIELD_ID);
  });

  it("requires a name, labels, options and display content", () => {
    const errs = errorsOf({
      name: " ",
      fields: [
        field({ id: "a", label: "" }),
        field({ id: "b", type: "dropdown", options: ["", " "] }),
        field({ id: "c", type: "heading", label: "", content: "" }),
      ],
    });
    expect(errs).toEqual({
      name: "Add a name for this form.",
      a: "Add a label.",
      b: "Add at least one option.",
      c: "Add the text to show.",
    });
  });

  it("refuses duplicate options and more than 30", () => {
    expect(
      errorsOf({
        name: "N",
        fields: [field({ type: "radio", options: ["A", "A"] })],
      }).f1,
    ).toBe("Each option needs different wording.");
    expect(
      errorsOf({
        name: "N",
        fields: [
          field({
            type: "checkboxes",
            options: Array.from({ length: 31 }, (_, i) => `o${i}`),
          }),
        ],
      }).f1,
    ).toMatch(/30 options/);
  });

  it("refuses blocked labels and placeholders with BLOCKED-FIELD", () => {
    for (const label of [
      "Card number",
      "CVV",
      "cvc code",
      "SSN",
      "Social Security",
      "Password",
      "Passcode",
    ]) {
      expect(errorsOf({ name: "N", fields: [field({ label })] }).f1).toBe(
        BLOCKED_FIELD_COPY,
      );
    }
    expect(
      errorsOf({
        name: "N",
        fields: [field({ label: "Note", placeholder: "your password" })],
      }).f1,
    ).toBe(BLOCKED_FIELD_COPY);
    expect(BLOCKED_FIELD_RE.test("Business name")).toBe(false);
  });

  it("checks help and content too, and common phrasings (WR-B02)", () => {
    for (const label of [
      "Credit card",
      "Debit card",
      "Card #",
      "Card no.",
      "Security code",
      "PIN",
      "Bank account",
      "Routing number",
    ]) {
      expect(errorsOf({ name: "N", fields: [field({ label })] }).f1).toBe(
        BLOCKED_FIELD_COPY,
      );
    }
    expect(
      errorsOf({
        name: "N",
        fields: [
          field({ label: "Payment details", help: "Type your CVV here" }),
        ],
      }).f1,
    ).toBe(BLOCKED_FIELD_COPY);
    expect(
      errorsOf({
        name: "N",
        fields: [
          field({
            type: "paragraph",
            label: "",
            content: "Write your card number below.",
          }),
        ],
      }).f1,
    ).toBe(BLOCKED_FIELD_COPY);
    expect(
      errorsOf({
        name: "N",
        fields: [
          field({
            type: "agreement",
            label: "I agree",
            content: "I agree to share my password",
          }),
        ],
      }).f1,
    ).toBe(BLOCKED_FIELD_COPY);
    for (const ok of [
      "Pinterest handle",
      "Spinning class",
      "Gift card message",
    ])
      expect(BLOCKED_FIELD_RE.test(ok)).toBe(false);
  });

  it("refuses a file field with the Pro copy and an unknown type", () => {
    expect(errorsOf({ name: "N", fields: [field({ type: "file" })] }).f1).toBe(
      FILE_FIELD_PRO_COPY,
    );
    expect(errorsOf({ name: "N", fields: [field({ type: "card" })] }).f1).toBe(
      "Choose a field type.",
    );
  });

  it("refuses more than 40 fields", () => {
    const fields = Array.from({ length: 41 }, (_, i) => field({ id: `f${i}` }));
    expect(errorsOf({ name: "N", fields })).toEqual({
      fields: "Forms hold up to 40 fields.",
    });
  });

  it("FormErrors carries the summary and code", () => {
    try {
      validateFormDefinition({ name: "", fields: [field({ label: "" })] });
    } catch (e) {
      expect(e).toBeInstanceOf(FormErrors);
      expect(e).toBeInstanceOf(InvalidInput);
      expect((e as FormErrors).code).toBe("form_errors");
      expect((e as FormErrors).message).toBe("2 fields need attention");
    }
    expect(formErrorsSummary(1)).toBe("1 field needs attention");
  });

  describe("hostile input", () => {
    it("non-object input is InvalidInput", () => {
      for (const raw of [null, "x", 1, []]) {
        expect(() => validateFormDefinition(raw)).toThrow(InvalidInput);
      }
    });

    it("prototype keys and inherited values are ignored", () => {
      const raw = JSON.parse(
        '{"name":"N","__proto__":{"layout":"2","newsletter_checkbox":true}}',
      );
      const def = validateFormDefinition(raw);
      expect(def.layout).toBe("1");
      expect(def.newsletter_checkbox).toBe(false);
      expect(({} as Record<string, unknown>).layout).toBeUndefined();
    });

    it("wrong shapes are refused or coerced, never crash", () => {
      expect(errorsOf({ name: "N", fields: { a: 1 } }).fields).toBeTruthy();
      expect(errorsOf({ name: "N", fields: ["x"] }).fields).toBeTruthy();
      const def = validateFormDefinition({
        name: "N",
        fields: [field({ label: 5, required: "yes" })].map((f) => ({
          ...f,
          label: "Ok",
        })),
        after_submit: [1, 2],
      });
      expect(def.fields[0]!.required).toBe(false);
      expect(def.after_submit.kind).toBe("message");
    });

    it("duplicate ids are refused", () => {
      const errs = errorsOf({
        name: "N",
        fields: [field({ id: "a" }), field({ id: "a" })],
      });
      expect(errs["fields.1"]).toBe("Each field needs its own id.");
    });

    it("over-long strings are refused with the cap copy", () => {
      expect(
        errorsOf({ name: "N", fields: [field({ label: "x".repeat(121) })] }).f1,
      ).toBe("Keep this under 120 characters.");
      expect(errorsOf({ name: "x".repeat(81) }).name).toBe(
        "Keep this under 80 characters.",
      );
    });
  });
});

describe("blockedFieldIds", () => {
  it("lists the offending ids", () => {
    expect(
      blockedFieldIds([
        { id: "a", label: "Name", placeholder: "" },
        { id: "b", label: "Card number", placeholder: "" },
        { id: "c", label: "PIN", placeholder: "your passcode" },
      ]),
    ).toEqual(["b", "c"]);
  });

  it("counts help and content (WR-B02)", () => {
    expect(
      blockedFieldIds([
        { id: "a", label: "Notes", placeholder: "", help: "Your SSN" },
        { id: "b", label: "Hi", placeholder: "", content: "Your password" },
        { id: "c", label: "Notes", placeholder: "", help: "Anything else" },
      ]),
    ).toEqual(["a", "b"]);
  });
});

describe("medicalHint", () => {
  it("shows for medical words in labels or help", () => {
    const h = medicalHint([
      { label: "Current medications", help: "" },
      { label: "Notes", help: "Any allergies or symptoms?" },
      { label: "Insurance ID", help: "" },
    ]);
    expect(h.show).toBe(true);
    expect(h.words).toEqual(
      expect.arrayContaining([
        "medications",
        "allergies",
        "symptoms",
        "insurance id",
      ]),
    );
    for (const label of [
      "Diagnosis",
      "Medical history",
      "Member ID",
      "Prescription",
    ]) {
      expect(medicalHint([{ label, help: "" }]).show).toBe(true);
    }
  });

  it("does not show for ordinary labels", () => {
    expect(
      medicalHint([
        { label: "Message", help: "" },
        { label: "Budget", help: "" },
        { label: "How was your visit?", help: "" },
      ]),
    ).toEqual({ show: false, words: [] });
  });
});

// ---- Forms Pro (BILL-14, D233; 10-34) ----
describe("validateFormDefinition: Forms Pro", () => {
  const baseFields = [
    { id: "name", type: "name", label: "Name" },
    { id: "email", type: "email", label: "Email" },
    {
      id: "service",
      type: "dropdown",
      label: "Service",
      options: ["Wedding", "Portrait"],
    },
    { id: "details", type: "long_text", label: "Details" },
  ];
  const goodPro = {
    rules: [
      {
        target: "details",
        action: "show",
        when: { field: "service", op: "is", value: "Wedding" },
      },
    ],
    steps: [
      { id: "s1", title: "About you", fields: ["name", "email"] },
      { id: "s2", title: "Your event", fields: ["service", "details"] },
    ],
    auto_reply: { enabled: true, subject: "Thanks {name}", body: "Got it." },
    routing: [{ field: "service", value: "Wedding", route: "billing" }],
    save_resume: true,
  };
  const ENT = { proEntitled: true };

  function proErrors(
    pro: unknown,
    fields: unknown[] = baseFields,
    opts: Parameters<typeof validateFormDefinition>[1] = ENT,
  ): Record<string, string> {
    try {
      validateFormDefinition({ name: "N", fields, pro }, opts);
    } catch (e) {
      if (e instanceof FormErrors) return { ...e.errors };
      throw e;
    }
    throw new Error("expected FormErrors");
  }

  it("entitled: valid rules, steps, auto-reply, routing, save_resume and file fields pass", () => {
    const def = validateFormDefinition(
      {
        name: "N",
        fields: [...baseFields, { id: "upload", type: "file", label: "Photo" }],
        pro: {
          ...goodPro,
          steps: [
            goodPro.steps[0],
            {
              id: "s2",
              title: "Your event",
              fields: ["service", "details", "upload"],
            },
          ],
          extra: "dropped",
        },
      },
      ENT,
    );
    expect(def.pro).toEqual({
      ...goodPro,
      steps: [
        goodPro.steps[0],
        {
          id: "s2",
          title: "Your event",
          fields: ["service", "details", "upload"],
        },
      ],
    });
    expect(def.pro).not.toHaveProperty("extra");
    expect(def.fields.map((x) => x.type)).toContain("file");
  });

  it("refuses a rule on a later or unknown field", () => {
    expect(
      proErrors({
        rules: [
          {
            target: "service",
            action: "show",
            when: { field: "details", op: "answered", value: "" },
          },
        ],
      })["pro.rules"],
    ).toBe(RULE_FIELD_COPY);
    expect(
      proErrors({
        rules: [
          {
            target: "nope",
            action: "hide",
            when: { field: "service", op: "answered", value: "" },
          },
        ],
      })["pro.rules"],
    ).toBe(RULE_TARGET_COPY);
    expect(
      proErrors({
        rules: [
          {
            target: "details",
            action: "show",
            when: { field: "service", op: "is", value: "" },
          },
        ],
      })["pro.rules"],
    ).toBe(RULE_VALUE_COPY);
  });

  it("refuses a step missing a field, listing one twice, or more than 10 steps", () => {
    expect(
      proErrors({ steps: [{ id: "s1", title: "A", fields: ["name"] }] })[
        "pro.steps"
      ],
    ).toBe(STEP_FIELDS_COPY);
    expect(
      proErrors({
        steps: [
          { id: "s1", title: "A", fields: ["name", "email", "service"] },
          { id: "s2", title: "B", fields: ["service", "details"] },
        ],
      })["pro.steps"],
    ).toBe(STEP_FIELDS_COPY);
    const many = Array.from({ length: 11 }, (_, i) => ({
      id: `s${i}`,
      title: "T",
      fields: [],
    }));
    expect(proErrors({ steps: many })["pro.steps"]).toBe(STEPS_LIMIT_COPY);
  });

  it("refuses an auto-reply without an email field and routing to an unknown route", () => {
    expect(
      proErrors(
        { auto_reply: { enabled: true, subject: "s", body: "b" } },
        baseFields.filter((x) => x.type !== "email"),
      )["pro.auto_reply"],
    ).toBe(AUTO_REPLY_EMAIL_COPY);
    expect(
      proErrors({
        routing: [{ field: "service", value: "Wedding", route: "sales" }],
      })["pro.routing"],
    ).toBe(ROUTE_UNKNOWN_COPY);
  });

  describe("not entitled (lapse-safe)", () => {
    const previous = validateFormDefinition(
      {
        name: "N",
        fields: [...baseFields, { id: "upload", type: "file", label: "Photo" }],
        pro: {
          ...goodPro,
          steps: [
            goodPro.steps[0],
            {
              id: "s2",
              title: "Your event",
              fields: ["service", "details", "upload"],
            },
          ],
        },
      },
      ENT,
    );

    it("refuses a new file field with FILE_FIELD_PRO_COPY", () => {
      expect(
        errorsOf({
          name: "N",
          fields: [{ id: "up2", type: "file", label: "File" }],
        }).up2,
      ).toBe(FILE_FIELD_PRO_COPY);
    });

    it("keeps unchanged pro and existing file fields byte-identical", () => {
      const again = validateFormDefinition(
        JSON.parse(JSON.stringify(previous)),
        { proEntitled: false, previous },
      );
      expect(JSON.stringify(again)).toBe(JSON.stringify(previous));
      const omitted = validateFormDefinition(
        { ...JSON.parse(JSON.stringify(previous)), pro: undefined },
        { previous },
      );
      expect(omitted.pro).toEqual(previous.pro);
    });

    it("refuses changed pro with PRO_SETTINGS_COPY and a changed file field", () => {
      const raw = JSON.parse(JSON.stringify(previous));
      raw.pro.save_resume = false;
      expect(proErrors(raw.pro, raw.fields, { previous }).pro).toBe(
        PRO_SETTINGS_COPY,
      );
      const raw2 = JSON.parse(JSON.stringify(previous));
      raw2.fields[4].label = "Renamed";
      expect(proErrors(raw2.pro, raw2.fields, { previous }).upload).toBe(
        FILE_FIELD_PRO_COPY,
      );
    });

    it("refuses new pro settings on a form without any", () => {
      expect(proErrors(goodPro, baseFields, {}).pro).toBe(PRO_SETTINGS_COPY);
      expect(
        validateFormDefinition(
          {
            name: "N",
            fields: baseFields,
            pro: {
              rules: [],
              steps: [],
              auto_reply: { enabled: false, subject: "", body: "" },
              routing: [],
              save_resume: false,
            },
          },
          {},
        ).pro,
      ).toBeUndefined();
    });
  });
});
