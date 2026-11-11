// form-view: narrows a coreData.forms entry to the FormView a FormItem renders, and maps the
// no-JS status codes to copy (CONT-25, D231; 07-UI-SPEC "Public form"; 07-19 choices 1, 2, 6).
//
// Pure and hook-free; server- and client-safe. Reads own properties only; hostile entries
// (non-objects, prototype keys, a non-array `fields`, bad ids) narrow to null and render nothing.
// Status codes travel in the URL instead of answers: r = required, i = invalid, l = too long.
import {
  CHOICE_ANSWER_COPY,
  DATE_ANSWER_COPY,
  EMAIL_ANSWER_COPY,
  NUMBER_ANSWER_COPY,
  PHONE_ANSWER_COPY,
  TIME_ANSWER_COPY,
  TOO_LONG_ANSWER_COPY,
  PRO_RULE_OPS,
  requiredCopy,
  type FormField,
  type ProRule,
  type ProRuleOp,
  type ProStep,
  type PublicForm,
  type PublicFormPro,
} from "@cds/core/forms";
import { publicFormOf } from "./public-form";

export type FieldErrorCode = "r" | "i" | "l";

export type FormStatusView =
  | { itemId: string; kind: "sent" }
  // 10-40: a no-JS "Save and finish later" landed (?saved=1).
  | { itemId: string; kind: "saved" }
  | { itemId: string; kind: "rate" | "error" }
  | {
      itemId: string;
      kind: "fields";
      fields: Readonly<Record<string, FieldErrorCode>>;
    };

/**
 * 10-40 (BILL-14, D233): a "Finish your form" link on this page. `resumed` carries the token
 * so the island can post it back (the draft is deleted after a successful send); `expired`
 * shows the expired notice over an empty form.
 */
export type FormResumeView =
  { kind: "resumed"; token: string } | { kind: "expired" };

export interface FormView {
  /** `form.pro` is set only while Builder Pro is active (10-36); absent = the P7 free form. */
  form: PublicForm;
  /** The page the item renders on (posted as `_page`); null in previews. */
  pageId: string | null;
  status: FormStatusView | null;
  preview: boolean;
  /** 10-40: the visitor's saved answers from a resume link, pre-filled server-side. */
  values?: Readonly<Record<string, unknown>>;
  resume?: FormResumeView;
}

export const FORM_ID_RE = /^[a-z0-9]{1,32}$/i;
export const ITEM_ID_RE = /^[a-z0-9-]{1,40}$/;
const FIELD_ID_RE = /^[a-z0-9_-]{1,40}$/i;
/** A resume token: base64url of 32 bytes (10-37 choice 1). */
export const RESUME_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const CODES: readonly FieldErrorCode[] = ["r", "i", "l"];
const MAX_RULES = 50;
const MAX_STEPS = 10;

type Raw = Record<string, unknown>;

function isRecord(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function own(raw: Raw, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
}

/** The wrapper id of one form item: `form-<itemId>` (choice 2: keyed by item, not form). */
export function FORM_ITEM_ANCHOR(itemId: string): string {
  return `form-${itemId}`;
}

/** The id prefix FormMarkup gets for one item: field ids are `f-<itemId>-<fieldId>`. */
export function fieldIdPrefix(itemId: string): string {
  return `f-${itemId}`;
}

export function fieldDomId(itemId: string, fieldId: string): string {
  return `${fieldIdPrefix(itemId)}-${fieldId}`;
}

/** The element an error-summary link should focus (first input of a group). */
export function fieldFocusId(itemId: string, field: FormField): string {
  const base = fieldDomId(itemId, field.id);
  if (field.type === "address") return `${base}-line1`;
  if (
    field.type === "radio" ||
    field.type === "checkboxes" ||
    field.type === "yes_no"
  )
    return `${base}-0`;
  return base;
}

/** The message under a field for a status code. */
export function fieldErrorCopy(field: FormField, code: FieldErrorCode): string {
  if (code === "r") return requiredCopy(field.label || "this field");
  if (code === "l") return TOO_LONG_ANSWER_COPY;
  switch (field.type) {
    case "email":
      return EMAIL_ANSWER_COPY;
    case "phone":
      return PHONE_ANSWER_COPY;
    case "number":
      return NUMBER_ANSWER_COPY;
    case "date":
      return DATE_ANSWER_COPY;
    case "time":
      return TIME_ANSWER_COPY;
    default:
      return CHOICE_ANSWER_COPY;
  }
}

function statusOf(v: unknown): FormStatusView | null {
  if (!isRecord(v)) return null;
  const itemId = own(v, "itemId");
  const kind = own(v, "kind");
  if (typeof itemId !== "string" || !ITEM_ID_RE.test(itemId)) return null;
  if (kind === "sent" || kind === "rate" || kind === "error")
    return { itemId, kind };
  if (kind === "saved") return { itemId, kind };
  if (kind !== "fields") return null;
  const raw = own(v, "fields");
  const fields: Record<string, FieldErrorCode> = {};
  if (isRecord(raw)) {
    for (const k of Object.keys(raw)) {
      const c = raw[k];
      if (FIELD_ID_RE.test(k) && CODES.includes(c as FieldErrorCode))
        fields[k] = c as FieldErrorCode;
    }
  }
  return { itemId, kind: "fields", fields };
}

function strings(v: unknown, max: number): string[] {
  return Array.isArray(v)
    ? v.filter((s): s is string => typeof s === "string").slice(0, max)
    : [];
}

function ruleOf(v: unknown): ProRule | null {
  if (!isRecord(v)) return null;
  const target = own(v, "target");
  const action = own(v, "action");
  const when = own(v, "when");
  if (typeof target !== "string" || !isRecord(when)) return null;
  if (action !== "show" && action !== "hide") return null;
  const field = own(when, "field");
  const op = own(when, "op");
  const value = own(when, "value");
  if (typeof field !== "string") return null;
  if (!(PRO_RULE_OPS as readonly unknown[]).includes(op)) return null;
  return {
    target,
    action,
    when: {
      field,
      op: op as ProRuleOp,
      value: typeof value === "string" ? value : "",
    },
  };
}

function stepOf(v: unknown): ProStep | null {
  if (!isRecord(v)) return null;
  const id = own(v, "id");
  const title = own(v, "title");
  if (typeof id !== "string") return null;
  return {
    id,
    title: typeof title === "string" ? title : "",
    fields: strings(own(v, "fields"), 40),
  };
}

/** The visitor-safe Pro part of a form (rules, steps, save flag), or null (10-40). */
export function proViewOf(v: unknown): PublicFormPro | null {
  if (!isRecord(v)) return null;
  const rules = own(v, "rules");
  const steps = own(v, "steps");
  return {
    rules: (Array.isArray(rules) ? rules.slice(0, MAX_RULES) : [])
      .map(ruleOf)
      .filter((r): r is ProRule => r !== null),
    steps: (Array.isArray(steps) ? steps.slice(0, MAX_STEPS) : [])
      .map(stepOf)
      .filter((s): s is ProStep => s !== null),
    save_resume: own(v, "save_resume") === true,
  };
}

function resumeOf(v: unknown): FormResumeView | null {
  if (!isRecord(v)) return null;
  const kind = own(v, "kind");
  if (kind === "expired") return { kind };
  const token = own(v, "token");
  if (
    kind === "resumed" &&
    typeof token === "string" &&
    RESUME_TOKEN_RE.test(token)
  )
    return { kind, token };
  return null;
}

/** coreData.forms[id] -> FormView, or null for anything that is not one. */
export function formViewOf(value: unknown): FormView | null {
  if (!isRecord(value)) return null;
  const form = own(value, "form");
  if (!isRecord(form)) return null;
  const id = own(form, "id");
  if (typeof id !== "string" || !FORM_ID_RE.test(id)) return null;
  if (!Array.isArray(own(form, "fields"))) return null;
  const pageId = own(value, "pageId");
  const pro = proViewOf(own(form, "pro"));
  const values = own(value, "values");
  const resume = resumeOf(own(value, "resume"));
  return {
    form: pro ? { ...publicFormOf(form, id), pro } : publicFormOf(form, id),
    pageId:
      typeof pageId === "string" && FORM_ID_RE.test(pageId) ? pageId : null,
    status: statusOf(own(value, "status")),
    preview: own(value, "preview") === true,
    ...(isRecord(values) ? { values } : {}),
    ...(resume ? { resume } : {}),
  };
}
