// Forms editor model (07-18; CONT-25, D231, D233, D271, D119; 07-UI-SPEC Forms).
//
// Pure TypeScript: the copy, the draft operations, the client-side checks, the list meta
// and the hrefs used by the Forms list, the template chooser and the form editor. Imports
// only @cds/core/forms (every 07-15 rule and copy, never re-typed here), the builder list
// helpers and the shared public-form projection. No React, no next/*, no database client.
import {
  BLOCKED_FIELD_COPY,
  CHOICE_TYPES,
  DISPLAY_TYPES,
  FIELDS_LIMIT_COPY,
  FILE_FIELD_PRO_COPY,
  FORM_FIELD_TYPES,
  FORM_FIELD_TYPE_LABELS,
  FORM_TEMPLATES,
  INPUT_TYPES,
  LABEL_REQUIRED_COPY,
  MAX_FIELD_OPTIONS,
  MAX_FORM_FIELDS,
  MAX_OPTION,
  NAME_REQUIRED_COPY,
  OPTIONS_REQUIRED_COPY,
  PLACEHOLDER_TYPES,
  PRO_TYPES,
  MAX_PRO_STEPS,
  PRO_RULE_OPS,
  RULE_FIELD_COPY,
  blockedFieldIds,
  emptyPro,
  type AfterSubmit,
  type FormDefinition,
  type FormField,
  type FormFieldType,
  type FormLayout,
  type FormNotifyRoute,
  type FormProSettings,
  type ProAutoReply,
  type ProRoute,
  type ProRule,
  type ProRuleOp,
  type ProStep,
} from "@cds/core/forms";
import { insertItemAt, moveInList } from "../../builder/editor-logic";

export { publicFormOf } from "../../site/items/public-form";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The editor's working copy: the definition plus the record's display-only state. */
export type FormDraft = FormDefinition & {
  template: string;
  inReview: boolean;
  deleted: boolean;
};

export type FormUsageView = {
  pages: { id: string; title: string }[];
  inVersions: boolean;
  inPopups: number;
};

/** One Forms list row: 07-15's FormListRow (structurally) plus its usage, null when unread. */
export type FormRowView = {
  id: string;
  name: string;
  template: string;
  fieldCount: number;
  unread: number;
  inReview: boolean;
  deleted: boolean;
  usage?: FormUsageView | null;
};

/** The "Send a copy to" reads: email routes as Settings › Email stores them. */
export type EmailRouteView = {
  purpose: string;
  address: string;
  status: string;
};

export type TemplateCard = {
  id: string;
  label: string;
  summary: string;
  fieldLabels: string[];
};

// ---------------------------------------------------------------------------
// Copy (07-UI-SPEC Forms; 07-18 choices 4, 5, 9, 10)
// ---------------------------------------------------------------------------

export const EMPTY_FORMS = Object.freeze({
  heading: "No forms yet",
  body: "Collect messages, quote requests and sign-ups. Start from a template and change anything.",
  helper: "Every message lands in your Inbox and we email you a copy.",
});
export const FORMS_HEADING = "Forms";
export const CREATE_FORM = "Create form";
export const TEMPLATE_HEADING = "Start from a template";
export const NO_FIELDS_YET = "No fields yet";
export const NAME_HELPER = "Only you see this name";
export const LIVE_NOTE = "Changes show on your site as soon as you save.";
export const PREVIEW_OFF = "Preview: sending is off";
export const CREATED_TOAST = "Form created.";
export const SAVED_TOAST = "Form saved. It's live on your site.";
export const HELD_TOAST =
  "Saved. The form shows on your site once it's reviewed, usually within 2 business days.";
export const DUPLICATED_TOAST = "Form duplicated.";
export const DELETED_TOAST = "Form deleted.";
export const FIELD_REMOVED_TOAST = "Field removed.";
export const IN_REVIEW = "In review";
export const PRO_BADGE = "Part of Builder Pro";
/** File upload's one-line description (10-17: the lock itself is FeatureInline, LOCK-INLINE). */
export const PRO_FIELD_HELPER = "Let visitors attach files.";
/** The entitlement key and display name behind the Forms Pro locks (BILL-14, D233). */
export const BUILDER_PRO_KEY = "builder-pro";
export const BUILDER_PRO_NAME = "Builder Pro";
export const NEWSLETTER_HELPER =
  "People who tick it are saved to Contacts. Nothing is sent until you have the Newsletter add-on, which asks them to confirm first.";
export const ROUTE_LINK = Object.freeze({
  label: "Change addresses in Settings › Email",
  href: "/hub/settings?tab=email",
});
export const PASTE_LIST_HELPER = "One option per line";
export const EMPTY_FIELDS = "Add your first field.";
export const NEEDS_ATTENTION = "Needs attention";
export const DELETE_FORM_COPY = Object.freeze({
  title: (name: string) => `Delete the ${name} form?`,
  used: "It leaves your forms list. Pages that show it keep working until you change them. Its messages stay in your Inbox.",
  unused: "It's deleted for good. Its messages stay in your Inbox.",
  confirm: "Delete form",
  keep: "Keep form",
});
export const DELETED_REF_COPY =
  "This form was deleted. It still shows here so nothing breaks; choose another form or remove this item.";
export const ITEM_NO_FORMS_COPY =
  "You don't have a form yet. Start one from a template here, or build it in Forms (opens in a new tab).";
export const ITEM_CREATED_TOAST = "Form created. Edit its fields in Forms.";
export const EXTERNAL_FORM_INTRO =
  "Add a Button item that links to your HIPAA intake form (IntakeQ, Jane, SimplePractice).";
export const FIELD_LIMIT_COPY = FIELDS_LIMIT_COPY;
export const READ_ONLY_LINE =
  "You can look at forms here. Ask an owner or admin to change them.";
export const NOT_ON_A_PAGE = "Not on any page yet";
export const GONE_COPY =
  "This was removed or moved. Reload the page to see the latest.";

const ROUTE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  inquiries: "Website inquiries",
  newsletter: "Newsletter",
  default: "Your main address",
  billing: "Billing from CDS",
  account: "Account and support",
});
const ROUTE_ORDER = ["inquiries", "newsletter", "default"] as const;

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function templateLabel(template: string): string {
  return FORM_TEMPLATES.find((t) => t.id === template)?.label ?? "Blank";
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** The parts of a row's meta line; the list renders page names as links. */
export function formMetaParts(
  row: Pick<FormRowView, "template" | "fieldCount">,
  usage: FormUsageView | null | undefined,
): {
  base: string;
  pages: { id: string; title: string }[];
  popups: string | null;
  notUsed: boolean;
} {
  const base = `${templateLabel(row.template)} template · ${plural(row.fieldCount, "field", "fields")}`;
  if (!usage) return { base, pages: [], popups: null, notUsed: false };
  const n = usage.inPopups;
  const popups =
    n > 0
      ? `${usage.pages.length > 0 ? "in" : "In"} ${plural(n, "pop-up", "pop-ups")}`
      : null;
  return {
    base,
    pages: usage.pages,
    popups,
    notUsed: usage.pages.length === 0 && n === 0,
  };
}

/** "Contact template · 6 fields · On Home, Contact" (or "· Not on any page yet"). */
export function formMetaLine(
  row: Pick<FormRowView, "template" | "fieldCount">,
  usage: FormUsageView | null | undefined,
): string {
  const p = formMetaParts(row, usage);
  const out = [p.base];
  if (p.pages.length > 0)
    out.push(`On ${p.pages.map((x) => x.title).join(", ")}`);
  if (p.popups) out.push(p.popups);
  if (p.notUsed) out.push(NOT_ON_A_PAGE);
  return out.join(" · ");
}

export function unreadLabel(n: number): string | null {
  return Number.isInteger(n) && n > 0
    ? `${n.toLocaleString("en-US")} unread`
    : null;
}

export function formCountLabel(n: number): string {
  return plural(n, "form", "forms");
}

export function templateCards(): TemplateCard[] {
  return FORM_TEMPLATES.map((t) => ({
    id: t.id,
    label: t.label,
    summary: t.summary,
    fieldLabels: t.fields.map((f) => f.label),
  }));
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS = ["Option 1", "Option 2"];
const DEFAULT_CONTENT: Partial<Record<FormFieldType, string>> = {
  heading: "Heading",
  paragraph: "Add your text.",
};
const AGREEMENT_LABEL = "I agree to the terms.";

function freshId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * A new field of `type` with a fresh id and a label that reads well in the preview. The file
 * type is offered only when Builder Pro is in the entitlement set (AddFieldMenu, 10-17); the
 * server refuses it on save otherwise (T-10-17-01).
 */
export function newField(type: FormFieldType): FormField {
  return {
    id: freshId(),
    type,
    label:
      type === "agreement" ? AGREEMENT_LABEL : FORM_FIELD_TYPE_LABELS[type],
    placeholder: "",
    help: "",
    required: false,
    full_width: type === "long_text",
    options: CHOICE_TYPES.has(type) ? [...DEFAULT_OPTIONS] : [],
    content: DEFAULT_CONTENT[type] ?? "",
    value: "",
  };
}

/** Change a field's type, keeping its label and required flag (choice 8). */
export function changeFieldType(
  field: FormField,
  type: FormFieldType,
): FormField {
  if (PRO_TYPES.has(type)) throw new Error(FILE_FIELD_PRO_COPY);
  const toChoice = CHOICE_TYPES.has(type);
  const toDisplay = DISPLAY_TYPES.has(type);
  return {
    ...field,
    type,
    placeholder: PLACEHOLDER_TYPES.has(type) ? field.placeholder : "",
    options: toChoice
      ? field.options.length > 0
        ? [...field.options]
        : [...DEFAULT_OPTIONS]
      : [],
    content: toDisplay
      ? field.content || DEFAULT_CONTENT[type] || ""
      : type === "agreement"
        ? field.content
        : "",
    value: type === "hidden" ? field.value : "",
  };
}

/** Paste a list: trimmed, blank and case-insensitive duplicate lines dropped, capped. */
export function optionsFromLines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of String(text ?? "").split(/\r\n|\r|\n/)) {
    const v = line.trim().slice(0, MAX_OPTION);
    if (v === "") continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= MAX_FIELD_OPTIONS) break;
  }
  return out;
}

/** The field row's title: its label, else its content, else its type name. */
export function fieldTitle(field: FormField): string {
  return (
    field.label.trim() ||
    field.content.trim() ||
    FORM_FIELD_TYPE_LABELS[field.type] ||
    "Field"
  );
}

/** "Short answer · Required" */
export function fieldMeta(field: FormField): string {
  const type = FORM_FIELD_TYPE_LABELS[field.type] ?? "Field";
  return field.required && INPUT_TYPES.has(field.type)
    ? `${type} · Required`
    : type;
}

// ---------------------------------------------------------------------------
// Draft operations (inputs never mutated)
// ---------------------------------------------------------------------------

export function addField(
  draft: FormDraft,
  type: FormFieldType,
): { draft: FormDraft; id: string | null; limitReached: boolean } {
  if (draft.fields.length >= MAX_FORM_FIELDS) {
    return { draft, id: null, limitReached: true };
  }
  const field = newField(type);
  return {
    draft: { ...draft, fields: [...draft.fields, field] },
    id: field.id,
    limitReached: false,
  };
}

export function moveField(
  draft: FormDraft,
  from: number,
  to: number,
): FormDraft {
  const next = moveInList(draft.fields, from, to);
  return next === draft.fields ? draft : { ...draft, fields: next };
}

export function updateField(
  draft: FormDraft,
  id: string,
  patch: Partial<Omit<FormField, "id">>,
): FormDraft {
  return {
    ...draft,
    fields: draft.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
  };
}

/** Remove a field; `restore` puts it back at its old index (Undo). */
export function removeField(
  draft: FormDraft,
  id: string,
): {
  draft: FormDraft;
  index: number;
  restore: (current: FormDraft) => FormDraft;
} {
  const index = draft.fields.findIndex((f) => f.id === id);
  if (index === -1) return { draft, index, restore: (d) => d };
  const field = draft.fields[index]!;
  return {
    draft: { ...draft, fields: draft.fields.filter((f) => f.id !== id) },
    index,
    restore: (current) =>
      current.fields.some((f) => f.id === field.id)
        ? current
        : { ...current, fields: insertItemAt(current.fields, index, field) },
  };
}

// ---------------------------------------------------------------------------
// Client checks
// ---------------------------------------------------------------------------

/**
 * Errors the editor can show before Save (the server answers the rest). With `proActive`,
 * a rule whose condition field no longer sits above its target marks the target (10-39).
 */
export function clientFieldErrors(
  draft: FormDraft,
  opts: { proActive?: boolean } = {},
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (opts.proActive && draft.pro) {
    const index = new Map(draft.fields.map((f, i) => [f.id, i]));
    for (const r of draft.pro.rules) {
      const ti = index.get(r.target);
      const fi = index.get(r.when.field);
      if (ti === undefined) continue;
      if (fi === undefined || fi >= ti) errors[r.target] = RULE_FIELD_COPY;
    }
  }
  if (draft.name.trim() === "") errors.name = NAME_REQUIRED_COPY;
  for (const f of draft.fields) {
    if (
      (INPUT_TYPES.has(f.type) || f.type === "hidden") &&
      f.label.trim() === ""
    ) {
      errors[f.id] = LABEL_REQUIRED_COPY;
    } else if (CHOICE_TYPES.has(f.type) && f.options.length === 0) {
      errors[f.id] = OPTIONS_REQUIRED_COPY;
    }
  }
  for (const id of blockedFieldIds(draft.fields))
    errors[id] = BLOCKED_FIELD_COPY;
  return errors;
}

export function hasBlocked(draft: FormDraft): boolean {
  return blockedFieldIds(draft.fields).length > 0;
}

export function isDirty(draft: FormDraft, saved: FormDraft): boolean {
  return JSON.stringify(draft) !== JSON.stringify(saved);
}

export function canSave(
  draft: FormDraft,
  saved: FormDraft,
  readOnly: boolean,
): boolean {
  if (readOnly) return false;
  if (!isDirty(draft, saved)) return false;
  return !hasBlocked(draft);
}

/** The key the editor jumps to: field ids in list order, then the form-level keys. */
export function serverErrorTarget(
  errors: Readonly<Record<string, string>>,
  fields: readonly Pick<FormField, "id">[] = [],
): string | null {
  const keys = Object.keys(errors);
  if (keys.length === 0) return null;
  for (const f of fields) if (Object.hasOwn(errors, f.id)) return f.id;
  for (const k of [
    "name",
    "after_submit",
    "button_text",
    "newsletter_wording",
    "fields",
  ]) {
    if (Object.hasOwn(errors, k)) return k;
  }
  return keys[0] ?? null;
}

// ---------------------------------------------------------------------------
// Record <-> draft <-> action input
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;

function isRecord(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function own(raw: Raw, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
}

function s(raw: Raw, key: string): string {
  const v = own(raw, key);
  return typeof v === "string" ? v : "";
}

function fieldFrom(raw: unknown): FormField | null {
  if (!isRecord(raw)) return null;
  const type = own(raw, "type");
  if (
    typeof type !== "string" ||
    !(FORM_FIELD_TYPES as readonly string[]).includes(type)
  ) {
    return null;
  }
  const opts = own(raw, "options");
  return {
    id: s(raw, "id") || freshId(),
    type: type as FormFieldType,
    label: s(raw, "label"),
    placeholder: s(raw, "placeholder"),
    help: s(raw, "help"),
    required: own(raw, "required") === true,
    full_width: own(raw, "full_width") === true,
    options: Array.isArray(opts)
      ? opts.filter((o): o is string => typeof o === "string")
      : [],
    content: s(raw, "content"),
    value: s(raw, "value"),
  };
}

const ROUTES: readonly FormNotifyRoute[] = [
  "default",
  "inquiries",
  "newsletter",
  "billing",
  "account",
];

/** A stored form (07-15 FormRecord) as an editor draft; hostile shapes degrade, never throw. */
export function draftFromRecord(record: unknown): FormDraft {
  const r: Raw = isRecord(record) ? record : {};
  const rawFields = own(r, "fields");
  const after = own(r, "after_submit");
  const a: Raw = isRecord(after) ? after : {};
  const route = own(r, "notify_route");
  const layout: FormLayout = own(r, "layout") === "2" ? "2" : "1";
  const after_submit: AfterSubmit = {
    kind: own(a, "kind") === "page" ? "page" : "message",
    message: s(a, "message"),
    page: s(a, "page"),
    button_text: s(a, "button_text"),
  };
  return {
    name: s(r, "name"),
    layout,
    fields: Array.isArray(rawFields)
      ? rawFields.map(fieldFrom).filter((f): f is FormField => f !== null)
      : [],
    after_submit,
    notify_route:
      typeof route === "string" && (ROUTES as readonly string[]).includes(route)
        ? (route as FormNotifyRoute)
        : "inquiries",
    newsletter_checkbox: own(r, "newsletter_checkbox") === true,
    newsletter_wording: s(r, "newsletter_wording"),
    template: s(r, "template") || "blank",
    inReview: own(r, "inReview") === true,
    deleted: own(r, "deleted") === true,
    ...proEntry(own(r, "pro")),
  };
}

function proEntry(raw: unknown): { pro?: FormProSettings } {
  const pro = proFrom(raw);
  return pro ? { pro } : {};
}

/** Stored Pro settings as a draft copy (shape only; the server validates). */
export function proFrom(raw: unknown): FormProSettings | undefined {
  if (!isRecord(raw)) return undefined;
  const list = (k: string): unknown[] => {
    const v = own(raw, k);
    return Array.isArray(v) ? v : [];
  };
  const rules: ProRule[] = [];
  for (const x of list("rules")) {
    if (!isRecord(x)) continue;
    const w = own(x, "when");
    const when: Raw = isRecord(w) ? w : {};
    const op = own(when, "op");
    rules.push({
      target: s(x, "target"),
      action: own(x, "action") === "hide" ? "hide" : "show",
      when: {
        field: s(when, "field"),
        op: (PRO_RULE_OPS as readonly unknown[]).includes(op)
          ? (op as ProRuleOp)
          : "is",
        value: s(when, "value"),
      },
    });
  }
  const steps: ProStep[] = [];
  for (const x of list("steps")) {
    if (!isRecord(x)) continue;
    const f = own(x, "fields");
    steps.push({
      id: s(x, "id") || freshId(),
      title: s(x, "title"),
      fields: Array.isArray(f)
        ? f.filter((v): v is string => typeof v === "string")
        : [],
    });
  }
  const routing: ProRoute[] = [];
  for (const x of list("routing")) {
    if (!isRecord(x)) continue;
    const route = own(x, "route");
    routing.push({
      field: s(x, "field"),
      value: s(x, "value"),
      route:
        typeof route === "string" &&
        (ROUTES as readonly string[]).includes(route)
          ? (route as FormNotifyRoute)
          : "inquiries",
    });
  }
  const ar = own(raw, "auto_reply");
  const a: Raw = isRecord(ar) ? ar : {};
  return {
    rules,
    steps,
    auto_reply: {
      enabled: own(a, "enabled") === true,
      subject: s(a, "subject"),
      body: s(a, "body"),
    },
    routing,
    save_resume: own(raw, "save_resume") === true,
  };
}

/** The save payload: exactly the allowlisted keys plus the id. */
export function draftToInput(
  id: string,
  draft: FormDraft,
  opts: { proActive?: boolean } = {},
): { id: string } & FormDefinition {
  const input: { id: string } & FormDefinition = {
    id,
    name: draft.name,
    layout: draft.layout,
    fields: draft.fields,
    after_submit: draft.after_submit,
    notify_route: draft.notify_route,
    newsletter_checkbox: draft.newsletter_checkbox,
    newsletter_wording: draft.newsletter_wording,
  };
  // Pro settings are sent only while Builder Pro is active. Omitted = unchanged, so a
  // paused (lapsed) org's save keeps its stored settings exactly (invariant 9, 10-34).
  if (opts.proActive && draft.pro) input.pro = cleanPro(draft);
  return input;
}

// ---------------------------------------------------------------------------
// Forms Pro draft helpers (10-39; BILL-14, D233). Pure; inputs never mutated.
// ---------------------------------------------------------------------------

/** The draft's Pro settings, or a fresh empty set. */
export function proOf(draft: Pick<FormDraft, "pro">): FormProSettings {
  return draft.pro ?? emptyPro();
}

/** Whether stored Pro settings hold anything (a lapsed org with these is "paused"). */
export function hasProContent(
  pro: FormProSettings | undefined | null,
): boolean {
  if (!pro) return false;
  return (
    pro.rules.length > 0 ||
    pro.steps.length > 0 ||
    pro.routing.length > 0 ||
    pro.auto_reply.enabled ||
    pro.save_resume
  );
}

function withPro(draft: FormDraft, patch: Partial<FormProSettings>): FormDraft {
  return { ...draft, pro: { ...proOf(draft), ...patch } };
}

/** The one rule on `target` (choice 1: one condition per field), or null. */
export function ruleFor(draft: FormDraft, target: string): ProRule | null {
  return draft.pro?.rules.find((r) => r.target === target) ?? null;
}

/** Set (or clear with null) the rule on `target`, keeping the other fields' rules. */
export function setRule(
  draft: FormDraft,
  target: string,
  rule: Omit<ProRule, "target"> | null,
): FormDraft {
  const rest = proOf(draft).rules.filter((r) => r.target !== target);
  return withPro(draft, {
    rules: rule
      ? [...rest, { target, action: rule.action, when: { ...rule.when } }]
      : rest,
  });
}

/** Fields a rule on `target` may look at: answerable fields above it (server rule). */
export function ruleSourceFields(
  fields: readonly FormField[],
  target: string,
): FormField[] {
  const out: FormField[] = [];
  for (const f of fields) {
    if (f.id === target) break;
    if (INPUT_TYPES.has(f.type) || f.type === "hidden") out.push(f);
  }
  return out;
}

/** Fields a routing rule may look at (any answerable field). */
export function answerableFields(fields: readonly FormField[]): FormField[] {
  return fields.filter((f) => INPUT_TYPES.has(f.type) || f.type === "hidden");
}

/** The answers a rule or route can pick from, or null when it takes free text. */
export function answerChoices(field: FormField | undefined): string[] | null {
  if (!field) return null;
  if (field.type === "yes_no") return ["Yes", "No"];
  if (CHOICE_TYPES.has(field.type)) return [...field.options];
  return null;
}

export const RULE_ACTION_LABELS = Object.freeze({
  none: "Always show",
  show: "Show this field only when",
  hide: "Hide this field when",
});
export const RULE_OP_LABELS: Readonly<Record<ProRuleOp, string>> =
  Object.freeze({
    is: "is",
    is_not: "is not",
    contains: "contains",
    answered: "is answered",
    not_answered: "is not answered",
  });
/** Ops that need an answer value. */
export const VALUE_RULE_OPS: ReadonlySet<ProRuleOp> = new Set<ProRuleOp>([
  "is",
  "is_not",
  "contains",
]);

/** "Shows when Service is Wedding." */
export function ruleSummary(
  rule: ProRule,
  fields: readonly FormField[],
): string {
  const src = fields.find((f) => f.id === rule.when.field);
  const name = src ? fieldTitle(src) : "a removed field";
  const verb = rule.action === "hide" ? "Hides" : "Shows";
  const op = RULE_OP_LABELS[rule.when.op];
  const value = VALUE_RULE_OPS.has(rule.when.op) ? ` ${rule.when.value}` : "";
  return `${verb} when ${name} ${op}${value}.`;
}

export function setSteps(draft: FormDraft, steps: ProStep[]): FormDraft {
  return syncSteps(withPro(draft, { steps }));
}

/** "Split into steps": on = one step holding every field; off = no steps. */
export function splitIntoSteps(draft: FormDraft, on: boolean): FormDraft {
  return setSteps(
    draft,
    on
      ? [
          {
            id: freshId(),
            title: "Step 1",
            fields: draft.fields.map((f) => f.id),
          },
        ]
      : [],
  );
}

export function addStep(draft: FormDraft): FormDraft {
  const steps = proOf(draft).steps;
  if (steps.length === 0 || steps.length >= MAX_PRO_STEPS) return draft;
  return setSteps(draft, [
    ...steps,
    { id: freshId(), title: `Step ${steps.length + 1}`, fields: [] },
  ]);
}

export function renameStep(
  draft: FormDraft,
  stepId: string,
  title: string,
): FormDraft {
  return withPro(draft, {
    steps: proOf(draft).steps.map((st) =>
      st.id === stepId ? { ...st, title } : st,
    ),
  });
}

/** Remove a step; its fields join the step above (or the next one for the first). */
export function removeStep(draft: FormDraft, stepId: string): FormDraft {
  const steps = proOf(draft).steps;
  const i = steps.findIndex((st) => st.id === stepId);
  if (i === -1 || steps.length <= 1) return draft;
  const gone = steps[i]!;
  const next = steps.filter((st) => st.id !== stepId);
  const into = i === 0 ? 0 : i - 1;
  const host = next[into]!;
  next[into] = {
    ...host,
    fields:
      i === 0
        ? [...gone.fields, ...host.fields]
        : [...host.fields, ...gone.fields],
  };
  return setSteps(draft, next);
}

/**
 * Keep steps consistent with the fields: unknown ids dropped, every field in exactly one
 * step (new fields join the last step), and the field order follows the steps.
 */
export function syncSteps(draft: FormDraft): FormDraft {
  const pro = draft.pro;
  if (!pro || pro.steps.length === 0) return draft;
  const byId = new Map(draft.fields.map((f) => [f.id, f]));
  const placed = new Set<string>();
  const steps = pro.steps.map((st) => {
    const fields: string[] = [];
    for (const id of st.fields) {
      if (!byId.has(id) || placed.has(id)) continue;
      placed.add(id);
      fields.push(id);
    }
    return { ...st, fields };
  });
  const missing = draft.fields
    .filter((f) => !placed.has(f.id))
    .map((f) => f.id);
  if (missing.length > 0) {
    const last = steps[steps.length - 1]!;
    steps[steps.length - 1] = { ...last, fields: [...last.fields, ...missing] };
  }
  const order = steps.flatMap((st) => st.fields);
  const fields = order.map((id) => byId.get(id)!);
  const same =
    JSON.stringify(steps) === JSON.stringify(pro.steps) &&
    fields.every((f, i) => f === draft.fields[i]);
  return same ? draft : { ...draft, fields, pro: { ...pro, steps } };
}

/** The step index of each field position (field order follows the steps). */
export function stepIndexes(draft: FormDraft): number[] {
  const steps = draft.pro?.steps ?? [];
  const at = new Map<string, number>();
  steps.forEach((st, i) => st.fields.forEach((id) => at.set(id, i)));
  return draft.fields.map((f) => at.get(f.id) ?? Math.max(0, steps.length - 1));
}

/**
 * Move a field with steps on. A button move at a step edge changes the step first (no
 * reorder: the first field moving up joins the end of the step above, the last moving down
 * joins the start of the next step). A drag takes the step of the row it lands on.
 */
export function moveFieldInSteps(
  draft: FormDraft,
  from: number,
  to: number,
  kind: "button" | "drag" = "drag",
): FormDraft {
  const steps = draft.pro?.steps ?? [];
  if (steps.length === 0) return moveField(draft, from, to);
  const synced = syncSteps(draft);
  const field = synced.fields[from];
  if (!field) return draft;
  const idx = stepIndexes(synced);
  const si = idx[from]!;
  const stepsNow = synced.pro!.steps;
  const ownStep = stepsNow[si]!;
  if (kind === "button" && Math.abs(to - from) === 1) {
    const dir = to < from ? -1 : 1;
    const first = ownStep.fields[0] === field.id;
    const last = ownStep.fields[ownStep.fields.length - 1] === field.id;
    if (
      (dir === -1 && first && si > 0) ||
      (dir === 1 && last && si < stepsNow.length - 1)
    ) {
      const target = si + dir;
      const next = stepsNow.map((st, i) => {
        if (i === si)
          return { ...st, fields: st.fields.filter((id) => id !== field.id) };
        if (i === target)
          return {
            ...st,
            fields:
              dir === -1 ? [...st.fields, field.id] : [field.id, ...st.fields],
          };
        return st;
      });
      return setSteps(synced, next);
    }
  }
  if (to < 0 || to >= synced.fields.length || to === from) return draft;
  const labels = idx.filter((_, i) => i !== from);
  const landing =
    to > from ? labels[to - 1]! : (labels[to] ?? labels[labels.length - 1]!);
  const moved = moveField(synced, from, to);
  const order = moved.fields.map((f) => f.id);
  const nextLabels = [...labels.slice(0, to), landing, ...labels.slice(to)];
  const next = stepsNow.map((st, i) => ({
    ...st,
    fields: order.filter((_, p) => nextLabels[p] === i),
  }));
  return setSteps(moved, next);
}

export function setAutoReply(
  draft: FormDraft,
  patch: Partial<ProAutoReply>,
): FormDraft {
  return withPro(draft, {
    auto_reply: { ...proOf(draft).auto_reply, ...patch },
  });
}

export function setRouting(draft: FormDraft, routing: ProRoute[]): FormDraft {
  return withPro(draft, { routing: routing.map((r) => ({ ...r })) });
}

export function setSaveResume(draft: FormDraft, on: boolean): FormDraft {
  return withPro(draft, { save_resume: on });
}

/**
 * The Pro settings to send: steps synced to the fields, rules and routes that name a
 * removed field dropped (the server would refuse them). Order problems are left for the
 * server to name (RULE_FIELD_COPY), and the editor shows them first.
 */
export function cleanPro(draft: FormDraft): FormProSettings {
  const synced = syncSteps(draft);
  const pro = proOf(synced);
  const ids = new Set(synced.fields.map((f) => f.id));
  return {
    rules: pro.rules
      .filter((r) => ids.has(r.target) && ids.has(r.when.field))
      .map((r) => ({
        ...r,
        when: {
          ...r.when,
          value: VALUE_RULE_OPS.has(r.when.op) ? r.when.value : "",
        },
      })),
    steps: pro.steps.map((st) => ({ ...st, fields: [...st.fields] })),
    auto_reply: { ...pro.auto_reply },
    routing: pro.routing.filter((r) => ids.has(r.field)).map((r) => ({ ...r })),
    save_resume: pro.save_resume,
  };
}

// ---------------------------------------------------------------------------
// "Send a copy to" (choice 7)
// ---------------------------------------------------------------------------

export function routeOptions(
  routes: readonly EmailRouteView[] | null,
  current: string,
): { value: string; label: string }[] {
  const purposes: string[] = [...ROUTE_ORDER];
  if (!purposes.includes(current) && Object.hasOwn(ROUTE_LABELS, current)) {
    purposes.push(current);
  }
  return purposes.map((p) => {
    const label = ROUTE_LABELS[p] ?? p;
    if (!routes) return { value: p, label };
    const confirmed = routes.filter(
      (r) => r.purpose === p && r.status === "confirmed" && r.address !== "",
    );
    if (confirmed.length === 0) return { value: p, label };
    const more = confirmed.length > 1 ? ` +${confirmed.length - 1} more` : "";
    return { value: p, label: `${label} · ${confirmed[0]!.address}${more}` };
  });
}

// ---------------------------------------------------------------------------
// Hrefs (fixed paths, encoded ids; T-07-18-09)
// ---------------------------------------------------------------------------

export function formsHref(form?: string): string {
  return form
    ? `/hub/website?tab=forms&form=${encodeURIComponent(form)}`
    : "/hub/website?tab=forms";
}

export function inboxHref(id: string): string {
  return `/hub/inbox?form=${encodeURIComponent(id)}`;
}

export function pageHref(id: string): string {
  return `/hub/website/pages/${encodeURIComponent(id)}`;
}
