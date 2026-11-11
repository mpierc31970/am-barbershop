// 07-18 Task 1: the pure forms editor model (CONT-25, D231, D233, D119; 07-UI-SPEC Forms).
import {
  BLOCKED_FIELD_COPY,
  DEFAULT_BUTTON_TEXT,
  FORM_FIELD_ID,
  type FormField,
} from "@cds/core/forms";
import { describe, expect, it } from "vitest";
import { publicFormOf as sitePublicFormOf } from "../../site/items/public-form";
import {
  addField,
  canSave,
  changeFieldType,
  clientFieldErrors,
  draftFromRecord,
  draftToInput,
  fieldMeta,
  formCountLabel,
  formMetaLine,
  formsHref,
  hasBlocked,
  inboxHref,
  moveField,
  newField,
  optionsFromLines,
  publicFormOf,
  removeField,
  routeOptions,
  serverErrorTarget,
  templateCards,
  unreadLabel,
  type FormDraft,
} from "./form-logic";

function draft(
  fields: FormField[] = [],
  over: Partial<FormDraft> = {},
): FormDraft {
  return {
    name: "Contact",
    layout: "1",
    fields,
    after_submit: { kind: "message", message: "", page: "", button_text: "" },
    notify_route: "inquiries",
    newsletter_checkbox: false,
    newsletter_wording: "",
    template: "contact",
    inReview: false,
    deleted: false,
    ...over,
  };
}

const named = (label: string, type: FormField["type"] = "short_text") => ({
  ...newField(type),
  label,
});

describe("list meta", () => {
  const row = { template: "contact", fieldCount: 6 };
  it("names the template, the field count and the pages", () => {
    expect(
      formMetaLine(row, {
        pages: [
          { id: "p1", title: "Home" },
          { id: "p2", title: "Contact" },
        ],
        inVersions: false,
        inPopups: 0,
      }),
    ).toBe("Contact template · 6 fields · On Home, Contact");
  });
  it("says Not on any page yet when unused", () => {
    expect(
      formMetaLine(row, { pages: [], inVersions: true, inPopups: 0 }),
    ).toBe("Contact template · 6 fields · Not on any page yet");
  });
  it("singular field and pop-ups", () => {
    expect(
      formMetaLine(
        { template: "contact", fieldCount: 1 },
        { pages: [{ id: "p", title: "Home" }], inVersions: false, inPopups: 1 },
      ),
    ).toBe("Contact template · 1 field · On Home · in 1 pop-up");
  });
  it("drops the usage part when the read failed", () => {
    expect(formMetaLine(row, null)).toBe("Contact template · 6 fields");
  });
  it("unread and count labels", () => {
    expect(unreadLabel(0)).toBeNull();
    expect(unreadLabel(4)).toBe("4 unread");
    expect(formCountLabel(1)).toBe("1 form");
    expect(formCountLabel(3)).toBe("3 forms");
  });
  it("six template cards in order; Blank has no fields", () => {
    const cards = templateCards();
    expect(cards.map((c) => c.id)).toEqual([
      "blank",
      "contact",
      "quote-request",
      "client-intake",
      "feedback",
      "job-application",
    ]);
    expect(cards[0]!.fieldLabels).toEqual([]);
    expect(cards[1]!.fieldLabels).toEqual([
      "Name",
      "Email",
      "Phone",
      "Message",
    ]);
  });
});

describe("fields", () => {
  it("newField mints an id and a readable label", () => {
    const f = newField("email");
    expect(f.id).toMatch(FORM_FIELD_ID);
    expect(f.label).toBe("Email");
    expect(f.required).toBe(false);
    expect(newField("dropdown").options).toEqual(["Option 1", "Option 2"]);
    expect(newField("agreement").label).toBe("I agree to the terms.");
    expect(newField("heading").content).toBe("Heading");
    expect(newField("paragraph").content).toBe("Add your text.");
    expect(newField("email").id).not.toBe(f.id);
  });
  it("newField makes a file field (the lock is the entitlement, 10-17)", () => {
    const f = newField("file");
    expect(f.type).toBe("file");
    expect(f.label).toBe("File upload");
  });
  it("changeFieldType keeps label and required, seeds and drops options", () => {
    const base = { ...named("Pick one"), required: true };
    const radio = changeFieldType(base, "radio");
    expect(radio).toMatchObject({
      label: "Pick one",
      required: true,
      type: "radio",
    });
    expect(radio.options).toEqual(["Option 1", "Option 2"]);
    const kept = changeFieldType({ ...radio, options: ["A", "B"] }, "dropdown");
    expect(kept.options).toEqual(["A", "B"]);
    const back = changeFieldType(radio, "short_text");
    expect(back.options).toEqual([]);
    expect(back.label).toBe("Pick one");
  });
  it("optionsFromLines trims, drops blanks and duplicates", () => {
    expect(optionsFromLines("A\n\n b \nA\nC")).toEqual(["A", "b", "C"]);
    expect(optionsFromLines("Yes\r\nyes\rNo")).toEqual(["Yes", "No"]);
  });
  it("optionsFromLines caps at 30 options of 120 characters", () => {
    const lines = Array.from({ length: 31 }, (_, i) => `Option ${i}`).join(
      "\n",
    );
    expect(optionsFromLines(lines)).toHaveLength(30);
    expect(optionsFromLines("x".repeat(200))[0]).toHaveLength(120);
  });
  it("fieldMeta names the type and Required", () => {
    expect(fieldMeta({ ...named("Name", "name"), required: true })).toBe(
      "Name · Required",
    );
    expect(fieldMeta(newField("heading"))).toBe("Heading");
  });
});

describe("draft operations", () => {
  const a = named("A");
  const b = named("B");
  const c = named("C");
  it("moveField reorders without mutating", () => {
    const d = draft([a, b, c]);
    const moved = moveField(d, 0, 1);
    expect(moved.fields.map((f) => f.label)).toEqual(["B", "A", "C"]);
    expect(d.fields.map((f) => f.label)).toEqual(["A", "B", "C"]);
    expect(moveField(d, 0, 5)).toBe(d);
  });
  it("removeField returns a restore that puts it back at its index", () => {
    const d = draft([a, b, c]);
    const r = removeField(d, b.id);
    expect(r.index).toBe(1);
    expect(r.draft.fields.map((f) => f.label)).toEqual(["A", "C"]);
    const restored = r.restore(r.draft);
    expect(restored.fields.map((f) => f.label)).toEqual(["A", "B", "C"]);
    expect(r.restore(restored)).toBe(restored);
  });
  it("addField appends and returns the id", () => {
    const r = addField(draft([a]), "phone");
    expect(r.limitReached).toBe(false);
    expect(r.draft.fields).toHaveLength(2);
    expect(r.draft.fields[1]!.id).toBe(r.id);
  });
  it("addField stops at 40 fields", () => {
    const full = draft(
      Array.from({ length: 40 }, () => newField("short_text")),
    );
    const r = addField(full, "email");
    expect(r.limitReached).toBe(true);
    expect(r.draft).toBe(full);
    expect(r.id).toBeNull();
  });
});

describe("client checks", () => {
  it("blocked, empty label, empty options and blank name", () => {
    const card = named("Card number");
    const empty = named("");
    const choice = { ...newField("radio"), options: [] };
    const errors = clientFieldErrors(
      draft([card, empty, choice], { name: " " }),
    );
    expect(errors[card.id]).toBe(BLOCKED_FIELD_COPY);
    expect(errors[empty.id]).toBe("Add a label.");
    expect(errors[choice.id]).toBe("Add at least one option.");
    expect(errors.name).toBe("Add a name for this form.");
  });
  it("a blocked placeholder counts too; hasBlocked only for blocked", () => {
    const pw = { ...named("Login"), placeholder: "Your password" };
    expect(hasBlocked(draft([pw]))).toBe(true);
    expect(hasBlocked(draft([named("")]))).toBe(false);
  });
  it("canSave: read-only, unchanged and blocked refuse", () => {
    const saved = draft([named("Name")]);
    const changed = { ...saved, name: "Other" };
    expect(canSave(changed, saved, false)).toBe(true);
    expect(canSave(changed, saved, true)).toBe(false);
    expect(canSave(saved, saved, false)).toBe(false);
    expect(canSave(draft([named("CVV")]), saved, false)).toBe(false);
    // Other errors still let Save run (the server answers them).
    expect(canSave(draft([named("")]), saved, false)).toBe(true);
  });
  it("serverErrorTarget prefers field order, then form keys", () => {
    const a = named("A");
    const b = named("B");
    expect(
      serverErrorTarget({ name: "x", [b.id]: "y", [a.id]: "z" }, [a, b]),
    ).toBe(a.id);
    expect(serverErrorTarget({ fields: "x", after_submit: "y" }, [a])).toBe(
      "after_submit",
    );
    expect(serverErrorTarget({}, [])).toBeNull();
  });
});

describe("record, input and preview", () => {
  it("draftFromRecord / draftToInput round-trip the allowlisted keys", () => {
    const rec = {
      id: "f1",
      ...draft([named("Name")]),
      organization: "org2",
      created: "x",
    };
    const d = draftFromRecord(rec);
    const input = draftToInput("f1", d);
    expect(Object.keys(input).sort()).toEqual(
      [
        "after_submit",
        "fields",
        "id",
        "layout",
        "name",
        "newsletter_checkbox",
        "newsletter_wording",
        "notify_route",
      ].sort(),
    );
    expect(draftFromRecord({ ...input, template: "contact" })).toEqual(d);
  });
  it("draftFromRecord survives hostile input", () => {
    const hostile = JSON.parse(
      '{"__proto__":{"polluted":true},"name":"X","fields":"nope","layout":"9"}',
    );
    const d = draftFromRecord(hostile);
    expect(d.fields).toEqual([]);
    expect(d.layout).toBe("1");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(draftFromRecord(null).name).toBe("");
    expect(
      draftFromRecord({
        fields: [null, 3, { type: "evil" }, { type: "email" }],
      }).fields,
    ).toHaveLength(1);
  });
  it("re-exports the shared publicFormOf", () => {
    expect(publicFormOf).toBe(sitePublicFormOf);
    const p = publicFormOf(draft([named("A"), newField("hidden")]), "f1");
    expect(p.fields).toHaveLength(1);
    expect(p.after_submit.button_text).toBe(DEFAULT_BUTTON_TEXT);
  });
});

describe("routes and hrefs", () => {
  const routes = [
    { purpose: "inquiries", address: "a@x.com", status: "confirmed" },
    { purpose: "inquiries", address: "b@x.com", status: "confirmed" },
    { purpose: "inquiries", address: "c@x.com", status: "waiting" },
    { purpose: "default", address: "me@x.com", status: "confirmed" },
  ];
  it("labels groups with the first confirmed address and +N more", () => {
    expect(routeOptions(routes, "inquiries")).toEqual([
      { value: "inquiries", label: "Website inquiries · a@x.com +1 more" },
      { value: "newsletter", label: "Newsletter" },
      { value: "default", label: "Your main address · me@x.com" },
    ]);
  });
  it("labels only without route access; keeps a stored billing value", () => {
    expect(routeOptions(null, "billing").map((o) => o.label)).toEqual([
      "Website inquiries",
      "Newsletter",
      "Your main address",
      "Billing from Support",
    ]);
  });
  it("hrefs are fixed paths with encoded ids", () => {
    expect(formsHref()).toBe("/hub/website?tab=forms");
    expect(formsHref("new")).toBe("/hub/website?tab=forms&form=new");
    expect(formsHref("abc")).toBe("/hub/website?tab=forms&form=abc");
    expect(formsHref("a&b")).toBe("/hub/website?tab=forms&form=a%26b");
    expect(inboxHref("f 1")).toBe("/hub/inbox?form=f%201");
  });
});
