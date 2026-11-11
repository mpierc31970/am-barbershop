// CONT-25, D271, Pitfall 8 (07-15): payload parsing, answer validation, spam signals, format.
import { describe, expect, it } from "vitest";
import {
  FormErrors,
  answersForDisplay,
  formatAnswer,
  payloadFromEntries,
  spamSignals,
  validateSubmission,
  type FormField,
  type FormFieldType,
} from "./index";

function f(
  id: string,
  type: FormFieldType,
  over: Partial<FormField> = {},
): FormField {
  return {
    id,
    type,
    label: over.label ?? id,
    placeholder: "",
    help: "",
    required: false,
    full_width: false,
    options: [],
    content: "",
    value: "",
    ...over,
  };
}

function errorsOf(fields: FormField[], payload: unknown) {
  try {
    validateSubmission(fields, payload);
  } catch (e) {
    if (e instanceof FormErrors) return { ...e.errors };
    throw e;
  }
  throw new Error("expected FormErrors");
}

describe("payloadFromEntries", () => {
  it("folds repeated keys and dotted address parts", () => {
    const p = payloadFromEntries([
      ["name", "Maria"],
      ["topics", "a"],
      ["topics", "b"],
      ["addr.line1", "1 Main"],
      ["addr.city", "Austin"],
    ]);
    expect(JSON.parse(JSON.stringify(p))).toEqual({
      name: "Maria",
      topics: ["a", "b"],
      addr: { line1: "1 Main", city: "Austin" },
    });
    expect(Object.getPrototypeOf(p)).toBeNull();
    expect(Object.getPrototypeOf(p.addr)).toBeNull();
  });

  it("drops prototype segments, deep keys and non-string values", () => {
    const p = payloadFromEntries([
      ["__proto__", "x"],
      ["a.__proto__", "x"],
      ["constructor.prototype", "x"],
      ["a.b.c", "x"],
      ["file", { name: "f.txt" }],
      ["ok", "1"],
    ]);
    expect(Object.keys(p)).toEqual(["ok"]);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe("validateSubmission", () => {
  const contact = [
    f("name", "name", { label: "Name", required: true }),
    f("email", "email", { label: "Email", required: true }),
    f("phone", "phone", { label: "Phone" }),
    f("msg", "long_text", { label: "Message", required: true }),
    f("h", "heading", { content: "Hi" }),
  ];

  it("returns data, labels and the contact details", () => {
    const v = validateSubmission(contact, {
      name: " Maria ",
      email: "Maria@Example.com",
      phone: "",
      msg: "Hello",
      unknown: "dropped",
      h: "dropped",
      _newsletter: "on",
    });
    expect(v).toEqual({
      data: { name: "Maria", email: "maria@example.com", msg: "Hello" },
      labels: { name: "Name", email: "Email", msg: "Message" },
      email: "maria@example.com",
      name: "Maria",
      phone: null,
      newsletter: true,
    });
  });

  it("collects required and format errors with exact copy", () => {
    expect(errorsOf(contact, { email: "maria@", phone: "12" })).toEqual({
      name: "Fill in Name.",
      email: "Enter an email address, like name@example.com.",
      phone: "Enter a phone number, like 512 555 0142.",
      msg: "Fill in Message.",
    });
  });

  it("checks number, date, time, choices, yes/no and agreement", () => {
    const fields = [
      f("n", "number"),
      f("d", "date"),
      f("t", "time"),
      f("dd", "dropdown", { options: ["A", "B"] }),
      f("cb", "checkboxes", { options: ["X", "Y", "Z"] }),
      f("yn", "yes_no"),
      f("ag", "agreement", { required: true, label: "Terms" }),
    ];
    expect(
      errorsOf(fields, {
        n: "12abc",
        d: "2026-02-30",
        t: "24:00",
        dd: "C",
        cb: ["X", "Q"],
        yn: "maybe",
      }),
    ).toEqual({
      n: "Enter a number.",
      d: "Enter a date.",
      t: "Enter a time.",
      dd: "Choose one of the options.",
      cb: "Choose one of the options.",
      yn: "Choose one of the options.",
      ag: "Fill in Terms.",
    });
    const v = validateSubmission(fields, {
      n: "-3.5",
      d: "2026-02-28",
      t: "23:59",
      dd: "B",
      cb: ["Z", "X", "X"],
      yn: "yes",
      ag: "on",
    });
    expect(v.data).toEqual({
      n: "-3.5",
      d: "2026-02-28",
      t: "23:59",
      dd: "B",
      cb: ["X", "Z"],
      yn: "yes",
      ag: true,
    });
    expect(validateSubmission(fields.slice(4, 5), { cb: "Y" }).data).toEqual({
      cb: ["Y"],
    });
  });

  it("hidden fields take the stored value, never the payload", () => {
    const v = validateSubmission(
      [f("src", "hidden", { label: "Source", value: "spring-ad" })],
      { src: "forged" },
    );
    expect(v.data).toEqual({ src: "spring-ad" });
  });

  it("address answers are capped objects", () => {
    const fields = [f("addr", "address", { label: "Address", required: true })];
    expect(errorsOf(fields, { addr: { line1: "" } })).toEqual({
      addr: "Fill in Address.",
    });
    const v = validateSubmission(fields, {
      addr: { line1: "1 Main", city: "Austin", evil: "x" },
    });
    expect(v.data.addr).toEqual({
      line1: "1 Main",
      line2: "",
      city: "Austin",
      region: "",
      postal_code: "",
    });
    expect(errorsOf(fields, { addr: { line1: "x".repeat(201) } }).addr).toMatch(
      /200/,
    );
  });

  it("newsletter is false unless ticked", () => {
    expect(validateSubmission([], {}).newsletter).toBe(false);
    expect(validateSubmission([], { _newsletter: "true" }).newsletter).toBe(
      true,
    );
  });

  describe("hostile input", () => {
    it("10 001-character and 10 KB answers are too long", () => {
      const fields = [f("m", "long_text")];
      const copy = "This answer is too long. Keep it under 10,000 characters.";
      expect(errorsOf(fields, { m: "x".repeat(10_001) }).m).toBe(copy);
      expect(errorsOf(fields, { m: "é".repeat(6000) }).m).toBe(copy);
      expect(
        validateSubmission(fields, { m: "x".repeat(10_000) }).data.m,
      ).toHaveLength(10_000);
    });

    it("prototype keys, arrays and numbers never crash", () => {
      const fields = [f("a", "short_text"), f("b", "email")];
      const payload = JSON.parse('{"__proto__":{"a":"x"},"b":["m@x.com"]}');
      const v = validateSubmission(fields, payload);
      expect(v.data).toEqual({});
      expect(v.email).toBeNull();
      expect(({} as Record<string, unknown>).a).toBeUndefined();
    });

    it("non-object payloads read as empty", () => {
      for (const p of [null, "x", 5, []]) {
        expect(validateSubmission([f("a", "short_text")], p).data).toEqual({});
      }
      expect(
        validateSubmission([f("a", "short_text")], { a: 42 }).data,
      ).toEqual({
        a: "42",
      });
    });
  });
});

describe("spamSignals", () => {
  const now = 1_000_000_000_000;
  it("flags honeypot, missing, future and too-fast start times", () => {
    expect(
      spamSignals({ honeypot: "", started: String(now - 5000), now }),
    ).toEqual([]);
    expect(
      spamSignals({ honeypot: "http://x", started: String(now - 5000), now }),
    ).toEqual(["honeypot"]);
    expect(
      spamSignals({ honeypot: undefined, started: undefined, now }),
    ).toEqual(["no-start"]);
    expect(spamSignals({ honeypot: "", started: "12.5", now })).toEqual([
      "no-start",
    ]);
    expect(
      spamSignals({ honeypot: "", started: String(now + 61_000), now }),
    ).toEqual(["future"]);
    expect(
      spamSignals({ honeypot: "", started: String(now - 1000), now }),
    ).toEqual(["too-fast"]);
    expect(
      spamSignals({
        honeypot: "",
        started: String(now - 86_400_000),
        now: new Date(now),
      }),
    ).toEqual([]);
  });
});

describe("formatAnswer / answersForDisplay", () => {
  it("formats every answer shape", () => {
    expect(formatAnswer(f("c", "checkboxes"), ["A", "B"])).toBe("A, B");
    expect(formatAnswer(f("y", "yes_no"), "yes")).toBe("Yes");
    expect(formatAnswer(f("y", "yes_no"), "no")).toBe("No");
    expect(formatAnswer(f("g", "agreement"), true)).toBe("Agreed");
    expect(
      formatAnswer(f("a", "address"), {
        line1: "1 Main",
        line2: "",
        city: "Austin",
        region: "TX",
        postal_code: "",
      }),
    ).toBe("1 Main\nAustin\nTX");
    expect(formatAnswer(f("s", "short_text"), "hi")).toBe("hi");
  });

  it("lists current fields first, then orphans by label snapshot, skipping _ keys", () => {
    const out = answersForDisplay(
      [
        f("b", "short_text", { label: "B now" }),
        f("a", "short_text", { label: "A" }),
      ],
      { a: "1", b: "2", gone: "3", _newsletter: true, empty: "" },
      { a: "A", b: "B then", gone: "Old question" },
    );
    expect(out.map((x) => [x.label, x.value])).toEqual([
      ["B now", "2"],
      ["A", "1"],
      ["Old question", "3"],
    ]);
  });
});

describe("validateSubmission with Forms Pro rules (10-34)", () => {
  const fields = [
    f("service", "dropdown", { options: ["Wedding", "Portrait"] }),
    f("details", "long_text", { required: true, label: "Details" }),
  ];
  const def = {
    fields,
    pro: {
      rules: [
        {
          target: "details",
          action: "show" as const,
          when: { field: "service", op: "is" as const, value: "Wedding" },
        },
      ],
      steps: [],
      auto_reply: { enabled: false, subject: "", body: "" },
      routing: [],
      save_resume: false,
    },
  };

  it("a required field hidden by a rule is not required and its answer is dropped", () => {
    const v = validateSubmission(
      def,
      { service: "Portrait", details: "smuggled" },
      { proActive: true },
    );
    expect(v.data).toEqual({ service: "Portrait" });
    expect(v.labels).not.toHaveProperty("details");
  });

  it("a visible field stays required", () => {
    try {
      validateSubmission(def, { service: "Wedding" }, { proActive: true });
      throw new Error("expected FormErrors");
    } catch (e) {
      expect(e).toBeInstanceOf(FormErrors);
      expect((e as FormErrors).errors.details).toBe("Fill in Details.");
    }
  });

  it("inactive Pro ignores rules: every required field is required", () => {
    expect(() =>
      validateSubmission(def, { service: "Portrait" }, { proActive: false }),
    ).toThrow(FormErrors);
    expect(() => validateSubmission(def, { service: "Portrait" })).toThrow(
      FormErrors,
    );
  });
});
