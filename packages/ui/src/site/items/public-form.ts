// publicFormOf: an editor draft or a stored form -> the PublicForm a visitor's browser gets
// (07-18 choice 2; CONT-25, D231). 07-18 owns this file and FormMarkup.tsx; 07-19's FormItem
// reuses both (it wraps FormMarkup with the <form>, honeypot, start time and success panel).
//
// Pure, hook-free, server- and client-safe: imports only @cds/core/forms. Reads own
// properties only, so unknown keys, prototype keys or a non-array `fields` never throw.
// Hidden fields (and every field's stored value) never reach the result.
import {
  DEFAULT_AFTER_MESSAGE,
  DEFAULT_BUTTON_TEXT,
  DEFAULT_NEWSLETTER_WORDING,
  FORM_FIELD_TYPES,
  type FormField,
  type FormFieldType,
  type PublicForm,
} from "@cds/core/forms";

type Raw = Record<string, unknown>;

function isRecord(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function own(raw: Raw, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
}

function str(raw: Raw, key: string): string {
  const v = own(raw, key);
  return typeof v === "string" ? v : "";
}

function isType(v: unknown): v is FormFieldType {
  return (
    typeof v === "string" && (FORM_FIELD_TYPES as readonly string[]).includes(v)
  );
}

function fieldOf(raw: unknown, index: number): FormField | null {
  if (!isRecord(raw)) return null;
  const type = own(raw, "type");
  if (!isType(type) || type === "hidden") return null;
  const id = str(raw, "id") || `field-${index}`;
  const opts = own(raw, "options");
  return {
    id,
    type,
    label: str(raw, "label"),
    placeholder: str(raw, "placeholder"),
    help: str(raw, "help"),
    required: own(raw, "required") === true,
    full_width: own(raw, "full_width") === true,
    options: Array.isArray(opts)
      ? opts.filter((o): o is string => typeof o === "string" && o !== "")
      : [],
    content: str(raw, "content"),
    value: "",
  };
}

/** Project a draft or a stored form (FormRecord) to what the public form renders. */
export function publicFormOf(source: unknown, id: string): PublicForm {
  const raw: Raw = isRecord(source) ? source : {};
  const rawFields = own(raw, "fields");
  const fields = Array.isArray(rawFields)
    ? rawFields
        .map((f, i) => fieldOf(f, i))
        .filter((f): f is FormField => f !== null)
    : [];
  const after = own(raw, "after_submit");
  const a: Raw = isRecord(after) ? after : {};
  const newsletter = own(raw, "newsletter_checkbox") === true;
  return {
    id,
    name: str(raw, "name"),
    layout: own(raw, "layout") === "2" ? "2" : "1",
    fields,
    after_submit: {
      kind: own(a, "kind") === "page" ? "page" : "message",
      message: str(a, "message").trim() || DEFAULT_AFTER_MESSAGE,
      button_text: str(a, "button_text").trim() || DEFAULT_BUTTON_TEXT,
    },
    newsletter_checkbox: newsletter,
    newsletter_wording:
      str(raw, "newsletter_wording").trim() || DEFAULT_NEWSLETTER_WORDING,
  };
}
