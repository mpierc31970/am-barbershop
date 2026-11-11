// CONT-25, D231 (07-15): the six form templates.
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import {
  FORM_TEMPLATES,
  blockedFieldIds,
  formFromTemplate,
  medicalHint,
  validateFormDefinition,
} from "./index";

describe("FORM_TEMPLATES", () => {
  it("has the six forms.template ids in UI-SPEC order", () => {
    expect(FORM_TEMPLATES.map((t) => t.id)).toEqual([
      "blank",
      "contact",
      "quote-request",
      "client-intake",
      "feedback",
      "job-application",
    ]);
    expect(FORM_TEMPLATES.map((t) => t.summary)).toEqual([
      "Add your own fields",
      "Name, email, phone, message",
      "What they need, when, budget",
      "Details for a first visit, without health records",
      "How was it, and what to improve",
      "Contact details, role, experience, links",
    ]);
  });

  it.each(FORM_TEMPLATES.map((t) => t.id))(
    "%s validates, trips no blocked field and no medical tip",
    (id) => {
      const def = formFromTemplate(id);
      expect(validateFormDefinition(def)).toEqual(def);
      expect(blockedFieldIds(def.fields)).toEqual([]);
      expect(medicalHint(def.fields).show).toBe(false);
      expect(def.notify_route).toBe("inquiries");
    },
  );

  it("contact has name, email, phone, message", () => {
    const def = formFromTemplate("contact");
    expect(def.name).toBe("Contact");
    expect(def.fields.map((f) => [f.type, f.label, f.required])).toEqual([
      ["name", "Name", true],
      ["email", "Email", true],
      ["phone", "Phone", false],
      ["long_text", "Message", true],
    ]);
  });

  it("blank has no fields", () => {
    expect(formFromTemplate("blank").fields).toEqual([]);
  });

  it("mints fresh field ids on every call", () => {
    const a = formFromTemplate("contact").fields.map((f) => f.id);
    const b = formFromTemplate("contact").fields.map((f) => f.id);
    expect(new Set([...a, ...b]).size).toBe(8);
  });

  it("an unknown id throws InvalidInput", () => {
    expect(() => formFromTemplate("nope")).toThrow(InvalidInput);
    expect(() => formFromTemplate("__proto__")).toThrow(InvalidInput);
  });
});
