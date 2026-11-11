// BILL-14, D233 (10-34): Forms Pro rule helpers.
import { describe, expect, it } from "vitest";
import {
  EMPTY_PRO,
  autoReplyFor,
  autoReplyName,
  emptyPro,
  formSteps,
  publicProOf,
  routeForAnswers,
  visibleFieldIds,
  type FormDefinition,
  type FormField,
  type FormFieldType,
  type FormProSettings,
  type ProRule,
} from "./index";

function f(id: string, type: FormFieldType = "short_text"): FormField {
  return {
    id,
    type,
    label: id,
    placeholder: "",
    help: "",
    required: false,
    full_width: false,
    options: [],
    content: "",
    value: "",
  };
}

function def(pro: Partial<FormProSettings> = {}): FormDefinition {
  return {
    name: "Booking enquiry",
    layout: "1",
    fields: [
      f("name", "name"),
      f("email", "email"),
      f("service", "dropdown"),
      f("details", "long_text"),
      f("extras", "checkboxes"),
      f("notes", "long_text"),
    ],
    after_submit: { kind: "message", message: "", page: "", button_text: "" },
    notify_route: "inquiries",
    newsletter_checkbox: false,
    newsletter_wording: "",
    pro: { ...emptyPro(), ...pro },
  };
}

const showDetails: ProRule = {
  target: "details",
  action: "show",
  when: { field: "service", op: "is", value: "Wedding" },
};
const ON = { proActive: true };
const OFF = { proActive: false };

describe("visibleFieldIds", () => {
  it("a show rule shows the field only when matched", () => {
    const d = def({ rules: [showDetails] });
    expect(visibleFieldIds(d, { service: "Wedding" }, ON).has("details")).toBe(
      true,
    );
    expect(visibleFieldIds(d, { service: "wedding" }, ON).has("details")).toBe(
      true,
    );
    expect(visibleFieldIds(d, { service: "Portrait" }, ON).has("details")).toBe(
      false,
    );
    expect(visibleFieldIds(d, {}, ON).has("details")).toBe(false);
  });

  it("a hide rule hides when matched", () => {
    const d = def({
      rules: [
        {
          target: "notes",
          action: "hide",
          when: { field: "service", op: "is_not", value: "Wedding" },
        },
      ],
    });
    expect(visibleFieldIds(d, { service: "Portrait" }, ON).has("notes")).toBe(
      false,
    );
    expect(visibleFieldIds(d, { service: "Wedding" }, ON).has("notes")).toBe(
      true,
    );
  });

  it("answered / not_answered treat '', [], false as unanswered", () => {
    const d = def({
      rules: [
        {
          target: "notes",
          action: "show",
          when: { field: "extras", op: "answered", value: "" },
        },
        {
          target: "details",
          action: "show",
          when: { field: "service", op: "not_answered", value: "" },
        },
      ],
    });
    for (const empty of ["", [], false, undefined]) {
      const v = visibleFieldIds(d, { extras: empty, service: empty }, ON);
      expect(v.has("notes")).toBe(false);
      expect(v.has("details")).toBe(true);
    }
    const v = visibleFieldIds(d, { extras: ["Album"], service: "x" }, ON);
    expect(v.has("notes")).toBe(true);
    expect(v.has("details")).toBe(false);
  });

  it("contains matches inside text and checkbox lists", () => {
    const d = def({
      rules: [
        {
          target: "notes",
          action: "show",
          when: { field: "extras", op: "contains", value: "album" },
        },
      ],
    });
    expect(
      visibleFieldIds(d, { extras: ["Photo album"] }, ON).has("notes"),
    ).toBe(true);
    expect(visibleFieldIds(d, { extras: ["Prints"] }, ON).has("notes")).toBe(
      false,
    );
  });

  it("a hidden field's answer never shows a later field", () => {
    const d = def({
      rules: [
        showDetails,
        {
          target: "notes",
          action: "show",
          when: { field: "details", op: "answered", value: "" },
        },
      ],
    });
    const v = visibleFieldIds(d, { service: "Portrait", details: "x" }, ON);
    expect(v.has("details")).toBe(false);
    expect(v.has("notes")).toBe(false);
  });

  it("inactive Pro: every field is visible", () => {
    const d = def({ rules: [showDetails] });
    expect([...visibleFieldIds(d, {}, OFF)]).toEqual(d.fields.map((x) => x.id));
  });
});

describe("formSteps", () => {
  const steps = [
    { id: "s1", title: "About you", fields: ["name", "email"] },
    {
      id: "s2",
      title: "Your event",
      fields: ["service", "details", "extras", "notes"],
    },
  ];

  it("returns the stored steps when active", () => {
    expect(formSteps(def({ steps }), ON)).toEqual(steps);
  });

  it("inactive or empty: one step with every field", () => {
    const all = def().fields.map((x) => x.id);
    expect(formSteps(def({ steps }), OFF)).toEqual([
      { id: "step-1", title: "", fields: all },
    ]);
    expect(formSteps(def(), ON)).toEqual([
      { id: "step-1", title: "", fields: all },
    ]);
  });

  it("with answers, leaves hidden fields out", () => {
    const s = formSteps(def({ steps, rules: [showDetails] }), {
      proActive: true,
      answers: { service: "Portrait" },
    });
    expect(s[1]?.fields).toEqual(["service", "extras", "notes"]);
  });
});

describe("routeForAnswers", () => {
  const routing = [
    { field: "service", value: "Wedding", route: "billing" as const },
    { field: "service", value: "Portrait", route: "account" as const },
  ];

  it("first match wins, else notify_route", () => {
    const d = def({ routing });
    expect(routeForAnswers(d, { service: "Wedding" }, ON)).toBe("billing");
    expect(routeForAnswers(d, { service: "Portrait" }, ON)).toBe("account");
    expect(routeForAnswers(d, { service: "Other" }, ON)).toBe("inquiries");
  });

  it("inactive: notify_route", () => {
    expect(routeForAnswers(def({ routing }), { service: "Wedding" }, OFF)).toBe(
      "inquiries",
    );
  });
});

describe("autoReplyFor", () => {
  const auto_reply = {
    enabled: true,
    subject: "Thanks, {name}",
    body: "Hi {name}, we got your message.",
  };

  it("fills {name} in the body only and sends to the email answer (CR-B01)", () => {
    expect(
      autoReplyFor(
        def({ auto_reply }),
        { email: "maria@example.com", name: "Maria" },
        ON,
      ),
    ).toEqual({
      to: "maria@example.com",
      subject: "Thanks",
      body: "Hi Maria, we got your message.",
    });
  });

  it("falls back to 'there' without a name", () => {
    expect(
      autoReplyFor(def({ auto_reply }), { email: "a@b.co", name: null }, ON)
        ?.body,
    ).toBe("Hi there, we got your message.");
  });

  it("never puts visitor text in the subject; the body gets a bounded, link-free name (CR-B01)", () => {
    const CR = String.fromCharCode(13);
    const LF = String.fromCharCode(10);
    const LS = String.fromCharCode(0x2028);
    const evil = `Win $500${CR}${LF}Bcc: victim@example.com${LF}Claim at https://evil.example/x or www.evil.example now`;
    const r = autoReplyFor(
      def({
        auto_reply: {
          enabled: true,
          subject: "{name}, thanks for writing",
          body: "Hi {name}!",
        },
      }),
      { email: "victim@example.com", name: evil },
      ON,
    )!;
    expect(r.subject).toBe("thanks for writing");
    expect(r.subject).not.toContain("Win");
    for (const ch of [CR, LF, LS]) {
      expect(r.subject).not.toContain(ch);
      expect(r.body).not.toContain(ch);
    }
    expect(r.body).not.toContain("http");
    expect(r.body).not.toContain("www.");
    expect(r.body).not.toContain("evil.example");
    expect(r.body.length).toBeLessThanOrEqual("Hi !".length + 60);
  });

  it("autoReplyName strips controls, links and bare domains, caps at 60 (CR-B01)", () => {
    const LS = String.fromCharCode(0x2028);
    expect(autoReplyName(`  Maria${LS}Lopez  `)).toBe("Maria Lopez");
    expect(autoReplyName("Visit cheap-pills.com today")).toBe("Visit today");
    expect(autoReplyName("https://x.example")).toBe("there");
    expect(autoReplyName("x".repeat(500))).toHaveLength(60);
    expect(autoReplyName(undefined)).toBe("there");
  });

  it("null without an email answer, when disabled or inactive", () => {
    expect(
      autoReplyFor(def({ auto_reply }), { email: null, name: "M" }, ON),
    ).toBeNull();
    expect(
      autoReplyFor(
        def({ auto_reply: { ...auto_reply, enabled: false } }),
        { email: "a@b.co", name: "M" },
        ON,
      ),
    ).toBeNull();
    expect(
      autoReplyFor(def({ auto_reply }), { email: "a@b.co", name: "M" }, OFF),
    ).toBeNull();
  });
});

describe("publicProOf", () => {
  it("carries rules, steps and save flag only, and only when active", () => {
    const d = def({
      rules: [showDetails],
      save_resume: true,
      auto_reply: { enabled: true, subject: "s", body: "b" },
      routing: [{ field: "service", value: "x", route: "billing" }],
    });
    const pub = publicProOf(d, ON);
    expect(pub).toEqual({ rules: [showDetails], steps: [], save_resume: true });
    expect(pub).not.toHaveProperty("auto_reply");
    expect(pub).not.toHaveProperty("routing");
    expect(publicProOf(d, OFF)).toBeNull();
  });

  it("EMPTY_PRO is frozen and empty", () => {
    expect(Object.isFrozen(EMPTY_PRO)).toBe(true);
    expect(EMPTY_PRO.rules).toEqual([]);
  });
});
