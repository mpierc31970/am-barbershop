// The six form templates (CONT-25, D231; 07-UI-SPEC "Template chooser"; 07-15).
//
// Ids match the forms.template select. Client intake asks nothing medical (D231): health
// records belong in a HIPAA service behind an External form button. Pure and Edge-safe.
import { InvalidInput } from "../errors";
import { validateFormDefinition } from "./definition";
import type { FormDefinition, FormField, FormFieldType } from "./model";

export const FORM_TEMPLATE_IDS = Object.freeze([
  "blank",
  "contact",
  "quote-request",
  "client-intake",
  "feedback",
  "job-application",
] as const);

export type FormTemplateId = (typeof FORM_TEMPLATE_IDS)[number];

type TemplateField = {
  readonly type: FormFieldType;
  readonly label: string;
  readonly required?: boolean;
  readonly options?: readonly string[];
  readonly help?: string;
};

export type FormTemplate = {
  readonly id: FormTemplateId;
  readonly label: string;
  /** The card text. */
  readonly summary: string;
  /** The default name of a form made from this template. */
  readonly formName: string;
  readonly fields: readonly TemplateField[];
};

const NAME: TemplateField = { type: "name", label: "Name", required: true };
const EMAIL: TemplateField = { type: "email", label: "Email", required: true };
const PHONE: TemplateField = { type: "phone", label: "Phone" };

export const FORM_TEMPLATES: readonly FormTemplate[] = Object.freeze([
  {
    id: "blank",
    label: "Blank",
    summary: "Add your own fields",
    formName: "New form",
    fields: [],
  },
  {
    id: "contact",
    label: "Contact",
    summary: "Name, email, phone, message",
    formName: "Contact",
    fields: [
      NAME,
      EMAIL,
      PHONE,
      { type: "long_text", label: "Message", required: true },
    ],
  },
  {
    id: "quote-request",
    label: "Quote request",
    summary: "What they need, when, budget",
    formName: "Quote request",
    fields: [
      { type: "name", label: "Name" },
      EMAIL,
      PHONE,
      { type: "long_text", label: "What do you need?", required: true },
      { type: "date", label: "When do you need it?" },
      {
        type: "dropdown",
        label: "Budget",
        options: [
          "Under $500",
          "$500 to $2,000",
          "Over $2,000",
          "Not sure yet",
        ],
      },
    ],
  },
  {
    id: "client-intake",
    label: "Client intake",
    summary: "Details for a first visit, without health records",
    formName: "Client intake",
    fields: [
      NAME,
      EMAIL,
      { type: "phone", label: "Phone", required: true },
      {
        type: "dropdown",
        label: "How did you hear about us?",
        options: ["Search", "Social media", "A friend", "Other"],
      },
      {
        type: "radio",
        label: "Best way to reach you",
        options: ["Email", "Phone", "Text"],
      },
      {
        type: "long_text",
        label: "Anything we should know before your first visit?",
        help: "Please don't include health details here.",
      },
    ],
  },
  {
    id: "feedback",
    label: "Feedback",
    summary: "How was it, and what to improve",
    formName: "Feedback",
    fields: [
      { type: "name", label: "Name" },
      { type: "email", label: "Email" },
      {
        type: "radio",
        label: "How was it?",
        required: true,
        options: ["Great", "Good", "Okay", "Not good"],
      },
      { type: "long_text", label: "What could we do better?" },
    ],
  },
  {
    id: "job-application",
    label: "Job application",
    summary: "Contact details, role, experience, links",
    formName: "Job application",
    fields: [
      NAME,
      EMAIL,
      PHONE,
      {
        type: "short_text",
        label: "Which role are you applying for?",
        required: true,
      },
      {
        type: "long_text",
        label: "Tell us about your experience",
        required: true,
      },
      {
        type: "short_text",
        label: "Links",
        help: "Portfolio, LinkedIn or résumé link",
      },
    ],
  },
]);

export function isFormTemplateId(v: unknown): v is FormTemplateId {
  return (
    typeof v === "string" &&
    (FORM_TEMPLATE_IDS as readonly string[]).includes(v)
  );
}

/** A fresh, valid definition from a template; field ids are minted on every call. */
export function formFromTemplate(id: unknown): FormDefinition {
  const t = FORM_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new InvalidInput("Choose a template.");
  const fields: FormField[] = t.fields.map((f) => ({
    id: globalThis.crypto.randomUUID(),
    type: f.type,
    label: f.label,
    placeholder: "",
    help: f.help ?? "",
    required: f.required === true,
    full_width: f.type === "long_text",
    options: f.options ? [...f.options] : [],
    content: "",
    value: "",
  }));
  return validateFormDefinition({
    name: t.formName,
    layout: "1",
    fields,
    notify_route: "inquiries",
    after_submit: { kind: "message" },
    newsletter_checkbox: false,
    newsletter_wording: "",
  });
}
