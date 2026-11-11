// Form definition validator, blocked-field rule and medical tip (CONT-25, D231, D233; 07-15).
//
// Deny by default: validateFormDefinition builds a fresh object field by field from own
// properties only; raw input is never spread. Every problem is collected into one FormErrors
// keyed by field id (never stop at the first). Pure and Edge-safe: no node:*, no @cds/db.
import { InvalidInput } from "../errors";
import {
  CHOICE_TYPES,
  CONTENT_REQUIRED_COPY,
  DEFAULT_AFTER_MESSAGE,
  DEFAULT_BUTTON_TEXT,
  DEFAULT_NEWSLETTER_WORDING,
  DISPLAY_TYPES,
  FIELDS_LIMIT_COPY,
  FIELD_ID_DUPLICATE_COPY,
  FILE_FIELD_PRO_COPY,
  FORM_FIELD_ID,
  FORM_FIELD_TYPES,
  FORM_MALFORMED_COPY,
  FormErrors,
  INPUT_TYPES,
  LABEL_REQUIRED_COPY,
  MAX_AFTER_MESSAGE,
  MAX_BUTTON_TEXT,
  MAX_CONTENT,
  MAX_FIELD_OPTIONS,
  MAX_FORM_FIELDS,
  MAX_FORM_NAME,
  MAX_HELP,
  MAX_HIDDEN_VALUE,
  MAX_LABEL,
  MAX_NEWSLETTER_WORDING,
  MAX_OPTION,
  MAX_PLACEHOLDER,
  NAME_REQUIRED_COPY,
  OPTIONS_DUPLICATE_COPY,
  OPTIONS_LIMIT_COPY,
  OPTIONS_REQUIRED_COPY,
  PAGE_REQUIRED_COPY,
  PLACEHOLDER_TYPES,
  PRO_TYPES,
  TYPE_REQUIRED_COPY,
  BLOCKED_FIELD_COPY,
  AUTO_REPLY_EMAIL_COPY,
  AUTO_REPLY_TEXT_COPY,
  MAX_AUTO_REPLY_BODY,
  MAX_AUTO_REPLY_SUBJECT,
  MAX_PRO_ROUTES,
  MAX_PRO_RULES,
  MAX_PRO_STEPS,
  MAX_RULE_VALUE,
  MAX_STEP_TITLE,
  PRO_RULE_OPS,
  PRO_SETTINGS_COPY,
  ROUTE_FIELD_COPY,
  ROUTE_UNKNOWN_COPY,
  ROUTES_LIMIT_COPY,
  RULE_FIELD_COPY,
  RULE_TARGET_COPY,
  RULE_VALUE_COPY,
  RULES_LIMIT_COPY,
  STEP_FIELDS_COPY,
  STEP_TITLE_COPY,
  STEPS_LIMIT_COPY,
  capCopy,
  type AfterSubmit,
  type FormProSettings,
  type ProRule,
  type ProRuleOp,
  type ProRoute,
  type ProStep,
  type FormDefinition,
  type FormField,
  type FormFieldType,
  type FormLayout,
  type FormNotifyRoute,
} from "./model";
import { emptyPro } from "./pro";

/**
 * Field text that asks for secrets (D231): refused, never stored. Checked against every
 * visitor-facing string of a field: label, placeholder, help and content.
 */
export const BLOCKED_FIELD_RE =
  /\b(?:(?:credit|debit) card|card (?:number|no\b|#)|cvv|cvc|security code|ssn|social security|password|passcode|pin\b|bank account|routing number)/i;

type BlockableField = Pick<FormField, "label" | "placeholder"> &
  Partial<Pick<FormField, "help" | "content">>;

/** Whether any visitor-facing text of a field asks for card, password or SSN data. */
export function asksForSecrets(f: BlockableField): boolean {
  return [f.label, f.placeholder, f.help, f.content].some(
    (s) => typeof s === "string" && BLOCKED_FIELD_RE.test(s),
  );
}

/** Labels or help text that look medical (D231 HEALTH-TIP). */
export const MEDICAL_RE =
  /\b(?:diagnos(?:is|es|ed)|medications?|medicines?|symptoms?|prescriptions?|allerg(?:y|ies)|medical history|health history|insurance (?:id|number)|member id)\b/gi;

const NOTIFY_ROUTES: readonly FormNotifyRoute[] = [
  "default",
  "inquiries",
  "newsletter",
  "billing",
  "account",
];
const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

type Raw = Record<string, unknown>;

function isRecord(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function own(raw: Raw, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
}

function str(raw: Raw, key: string): string {
  const v = own(raw, key);
  return typeof v === "string" ? v.trim() : "";
}

function newFieldId(): string {
  return globalThis.crypto.randomUUID();
}

export function isInputField(field: Pick<FormField, "type">): boolean {
  return INPUT_TYPES.has(field.type);
}

function isKnownType(v: unknown): v is FormFieldType {
  return (
    typeof v === "string" && (FORM_FIELD_TYPES as readonly string[]).includes(v)
  );
}

/** Ids of fields whose label, placeholder, help or content asks for secrets (D231). */
export function blockedFieldIds(
  fields: readonly (Pick<FormField, "id"> & BlockableField)[],
): string[] {
  return fields.filter((f) => asksForSecrets(f)).map((f) => f.id);
}

/** Whether to show HEALTH-TIP, and the words that triggered it (lower-cased, unique). */
export function medicalHint(
  fields: readonly Pick<FormField, "label" | "help">[],
): { show: boolean; words: string[] } {
  const words = new Set<string>();
  for (const f of fields) {
    for (const s of [f.label ?? "", f.help ?? ""]) {
      for (const m of s.matchAll(MEDICAL_RE)) words.add(m[0].toLowerCase());
    }
  }
  return { show: words.size > 0, words: [...words] };
}

function validateField(
  raw: unknown,
  seen: Set<string>,
  errors: Record<string, string>,
  index: number,
): FormField | null {
  if (!isRecord(raw)) {
    errors.fields ??= FORM_MALFORMED_COPY;
    return null;
  }
  const rawId = own(raw, "id");
  let id: string;
  if (typeof rawId === "string" && FORM_FIELD_ID.test(rawId)) {
    if (seen.has(rawId)) {
      errors[`fields.${index}`] ??= FIELD_ID_DUPLICATE_COPY;
      return null;
    }
    id = rawId;
  } else {
    id = newFieldId();
  }
  seen.add(id);

  const fail = (msg: string) => {
    errors[id] ??= msg;
  };
  const capped = (key: string, max: number): string => {
    const s = str(raw, key);
    if (s.length > max) {
      fail(capCopy(max));
      return s.slice(0, max);
    }
    return s;
  };

  const rawType = own(raw, "type");
  const type: FormFieldType = isKnownType(rawType) ? rawType : "short_text";
  if (!isKnownType(rawType)) fail(TYPE_REQUIRED_COPY);

  const label = capped("label", MAX_LABEL);
  const placeholder = PLACEHOLDER_TYPES.has(type)
    ? capped("placeholder", MAX_PLACEHOLDER)
    : "";
  const help = DISPLAY_TYPES.has(type) ? "" : capped("help", MAX_HELP);
  const required = INPUT_TYPES.has(type) && own(raw, "required") === true;
  const full_width = own(raw, "full_width") === true;

  let options: string[] = [];
  if (CHOICE_TYPES.has(type)) {
    const rawOpts = own(raw, "options");
    const list = Array.isArray(rawOpts) ? rawOpts : [];
    if (list.length > MAX_FIELD_OPTIONS * 2) {
      fail(OPTIONS_LIMIT_COPY);
    } else {
      options = list
        .filter((o): o is string => typeof o === "string")
        .map((o) => o.trim())
        .filter((o) => o !== "");
      if (options.some((o) => o.length > MAX_OPTION)) {
        fail(capCopy(MAX_OPTION));
        options = options.map((o) => o.slice(0, MAX_OPTION));
      }
      if (options.length === 0) fail(OPTIONS_REQUIRED_COPY);
      else if (options.length > MAX_FIELD_OPTIONS) fail(OPTIONS_LIMIT_COPY);
      else if (new Set(options).size !== options.length)
        fail(OPTIONS_DUPLICATE_COPY);
    }
  }

  const content =
    DISPLAY_TYPES.has(type) || type === "agreement"
      ? capped("content", MAX_CONTENT)
      : "";
  if (DISPLAY_TYPES.has(type) && content === "") fail(CONTENT_REQUIRED_COPY);
  const value = type === "hidden" ? capped("value", MAX_HIDDEN_VALUE) : "";

  if ((INPUT_TYPES.has(type) || type === "hidden") && label === "") {
    fail(LABEL_REQUIRED_COPY);
  }
  if (asksForSecrets({ label, placeholder, help, content })) {
    errors[id] = BLOCKED_FIELD_COPY;
  }

  return {
    id,
    type,
    label,
    placeholder,
    help,
    required,
    full_width,
    options,
    content,
    value,
  };
}

function validateAfterSubmit(
  raw: unknown,
  errors: Record<string, string>,
): AfterSubmit {
  const r = isRecord(raw) ? raw : {};
  const kind = own(r, "kind") === "page" ? "page" : "message";
  let message = str(r, "message");
  if (message.length > MAX_AFTER_MESSAGE) {
    errors.after_submit ??= capCopy(MAX_AFTER_MESSAGE);
    message = message.slice(0, MAX_AFTER_MESSAGE);
  }
  if (message === "") message = DEFAULT_AFTER_MESSAGE;
  let button_text = str(r, "button_text");
  if (button_text.length > MAX_BUTTON_TEXT) {
    errors.button_text ??= capCopy(MAX_BUTTON_TEXT);
    button_text = button_text.slice(0, MAX_BUTTON_TEXT);
  }
  if (button_text === "") button_text = DEFAULT_BUTTON_TEXT;
  let page = "";
  if (kind === "page") {
    page = str(r, "page");
    if (!PAGE_ID.test(page)) {
      page = "";
      errors.after_submit ??= PAGE_REQUIRED_COPY;
    }
  }
  return { kind, message, page, button_text };
}

/** JSON with object keys sorted, for "unchanged" comparisons. */
function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) =>
    isRecord(val)
      ? Object.fromEntries(
          Object.keys(val)
            .sort()
            .map((k) => [k, val[k]]),
        )
      : val,
  );
}

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function answerable(f: FormField): boolean {
  return INPUT_TYPES.has(f.type) || f.type === "hidden";
}

const VALUE_OPS: ReadonlySet<ProRuleOp> = new Set<ProRuleOp>([
  "is",
  "is_not",
  "contains",
]);

function cappedStr(
  raw: Raw,
  key: string,
  max: number,
  errKey: string,
  errors: Record<string, string>,
): string {
  const s = str(raw, key);
  if (s.length > max) {
    errors[errKey] ??= capCopy(max);
    return s.slice(0, max);
  }
  return s;
}

function validateRules(
  raw: unknown,
  fields: readonly FormField[],
  errors: Record<string, string>,
): ProRule[] {
  const K = "pro.rules";
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors[K] ??= FORM_MALFORMED_COPY;
    return [];
  }
  if (raw.length > MAX_PRO_RULES) {
    errors[K] ??= RULES_LIMIT_COPY;
    return [];
  }
  const index = new Map(fields.map((f, i) => [f.id, i]));
  const out: ProRule[] = [];
  for (const r of raw) {
    if (!isRecord(r)) {
      errors[K] ??= FORM_MALFORMED_COPY;
      continue;
    }
    const target = str(r, "target");
    const action = own(r, "action") === "hide" ? "hide" : "show";
    const w = own(r, "when");
    const when: Raw = isRecord(w) ? w : {};
    const field = str(when, "field");
    const rawOp = own(when, "op");
    const op = (PRO_RULE_OPS as readonly unknown[]).includes(rawOp)
      ? (rawOp as ProRuleOp)
      : null;
    const value =
      op !== null && VALUE_OPS.has(op)
        ? cappedStr(when, "value", MAX_RULE_VALUE, K, errors)
        : "";
    const ti = index.get(target);
    const fi = index.get(field);
    if (ti === undefined) {
      errors[K] ??= RULE_TARGET_COPY;
      continue;
    }
    const source = fi === undefined ? undefined : fields[fi];
    if (fi === undefined || fi >= ti || !source || !answerable(source)) {
      errors[K] ??= RULE_FIELD_COPY;
      continue;
    }
    if (op === null) {
      errors[K] ??= FORM_MALFORMED_COPY;
      continue;
    }
    if (VALUE_OPS.has(op) && value === "") {
      errors[K] ??= RULE_VALUE_COPY;
      continue;
    }
    out.push({ target, action, when: { field, op, value } });
  }
  return out;
}

function validateSteps(
  raw: unknown,
  fields: readonly FormField[],
  errors: Record<string, string>,
): ProStep[] {
  const K = "pro.steps";
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors[K] ??= FORM_MALFORMED_COPY;
    return [];
  }
  if (raw.length === 0) return [];
  if (raw.length > MAX_PRO_STEPS) {
    errors[K] ??= STEPS_LIMIT_COPY;
    return [];
  }
  const known = new Set(fields.map((f) => f.id));
  const placed = new Set<string>();
  const ids = new Set<string>();
  const out: ProStep[] = [];
  for (const s of raw) {
    if (!isRecord(s)) {
      errors[K] ??= FORM_MALFORMED_COPY;
      continue;
    }
    const rawId = own(s, "id");
    let id =
      typeof rawId === "string" && FORM_FIELD_ID.test(rawId)
        ? rawId
        : newFieldId();
    if (ids.has(id)) id = newFieldId();
    ids.add(id);
    const title = cappedStr(s, "title", MAX_STEP_TITLE, K, errors);
    if (title === "") errors[K] ??= STEP_TITLE_COPY;
    const rawFields = own(s, "fields");
    const list: string[] = [];
    for (const fid of Array.isArray(rawFields) ? rawFields : []) {
      if (typeof fid !== "string" || !known.has(fid) || placed.has(fid)) {
        errors[K] ??= STEP_FIELDS_COPY;
        continue;
      }
      placed.add(fid);
      list.push(fid);
    }
    out.push({ id, title, fields: list });
  }
  if (placed.size !== known.size) errors[K] ??= STEP_FIELDS_COPY;
  return out;
}

function validateRouting(
  raw: unknown,
  fields: readonly FormField[],
  errors: Record<string, string>,
): ProRoute[] {
  const K = "pro.routing";
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors[K] ??= FORM_MALFORMED_COPY;
    return [];
  }
  if (raw.length > MAX_PRO_ROUTES) {
    errors[K] ??= ROUTES_LIMIT_COPY;
    return [];
  }
  const answerIds = new Set(fields.filter(answerable).map((f) => f.id));
  const out: ProRoute[] = [];
  for (const r of raw) {
    if (!isRecord(r)) {
      errors[K] ??= FORM_MALFORMED_COPY;
      continue;
    }
    const field = str(r, "field");
    const value = cappedStr(r, "value", MAX_RULE_VALUE, K, errors);
    const route = own(r, "route");
    if (!answerIds.has(field)) {
      errors[K] ??= ROUTE_FIELD_COPY;
      continue;
    }
    if (value === "") {
      errors[K] ??= RULE_VALUE_COPY;
      continue;
    }
    if (
      typeof route !== "string" ||
      !(NOTIFY_ROUTES as readonly string[]).includes(route)
    ) {
      errors[K] ??= ROUTE_UNKNOWN_COPY;
      continue;
    }
    out.push({ field, value, route: route as FormNotifyRoute });
  }
  return out;
}

/** Deny-by-default rebuild of the Forms Pro settings (10-34 choices 1-5). */
function validatePro(
  raw: unknown,
  fields: readonly FormField[],
  errors: Record<string, string>,
): FormProSettings {
  if (!isRecord(raw)) {
    errors.pro ??= FORM_MALFORMED_COPY;
    return emptyPro();
  }
  const ar = own(raw, "auto_reply");
  const a: Raw = isRecord(ar) ? ar : {};
  const enabled = own(a, "enabled") === true;
  const subject = cappedStr(
    a,
    "subject",
    MAX_AUTO_REPLY_SUBJECT,
    "pro.auto_reply",
    errors,
  );
  const body = cappedStr(
    a,
    "body",
    MAX_AUTO_REPLY_BODY,
    "pro.auto_reply",
    errors,
  );
  if (enabled) {
    if (!fields.some((f) => f.type === "email"))
      errors["pro.auto_reply"] ??= AUTO_REPLY_EMAIL_COPY;
    else if (subject === "" || body === "")
      errors["pro.auto_reply"] ??= AUTO_REPLY_TEXT_COPY;
  }
  return {
    rules: validateRules(own(raw, "rules"), fields, errors),
    steps: validateSteps(own(raw, "steps"), fields, errors),
    auto_reply: { enabled, subject, body },
    routing: validateRouting(own(raw, "routing"), fields, errors),
    save_resume: own(raw, "save_resume") === true,
  };
}

export type ValidateFormOpts = {
  /** Builder Pro is active for this org (hasEntitlement). Default false. */
  proEntitled?: boolean;
  /** The stored definition being edited (null for a new form). */
  previous?: FormDefinition | null;
};

/**
 * Validate a whole form definition. Returns a fresh object; throws FormErrors with every
 * problem keyed by field id (or `name`, `fields`, `after_submit`, `button_text`,
 * `newsletter_wording`, `pro`, `pro.rules`, `pro.steps`, `pro.auto_reply`, `pro.routing`).
 * A non-object input is InvalidInput.
 *
 * Builder Pro (BILL-14, D233, invariant 9): with `proEntitled` the `pro` settings and file
 * fields are validated. Without it nothing new is accepted: `pro` must equal
 * `previous.pro` (omitted = copied from `previous`) and file fields must already exist,
 * unchanged, in `previous`. A lapse keeps the data and switches the features off.
 */
export function validateFormDefinition(
  raw: unknown,
  opts: ValidateFormOpts = {},
): FormDefinition {
  if (!isRecord(raw)) throw new InvalidInput(FORM_MALFORMED_COPY);
  const errors: Record<string, string> = {};

  let name = str(raw, "name");
  if (name === "") errors.name = NAME_REQUIRED_COPY;
  else if (name.length > MAX_FORM_NAME) {
    errors.name = capCopy(MAX_FORM_NAME);
    name = name.slice(0, MAX_FORM_NAME);
  }

  const layout: FormLayout = own(raw, "layout") === "2" ? "2" : "1";
  const rawRoute = own(raw, "notify_route");
  const notify_route: FormNotifyRoute =
    typeof rawRoute === "string" &&
    (NOTIFY_ROUTES as readonly string[]).includes(rawRoute)
      ? (rawRoute as FormNotifyRoute)
      : "inquiries";

  const rawFields = own(raw, "fields");
  const fields: FormField[] = [];
  if (
    rawFields !== undefined &&
    rawFields !== null &&
    !Array.isArray(rawFields)
  ) {
    errors.fields = FORM_MALFORMED_COPY;
  } else if (Array.isArray(rawFields)) {
    if (rawFields.length > MAX_FORM_FIELDS) {
      errors.fields = FIELDS_LIMIT_COPY;
    } else {
      const seen = new Set<string>();
      rawFields.forEach((f, i) => {
        const v = validateField(f, seen, errors, i);
        if (v) fields.push(v);
      });
    }
  }

  const after_submit = validateAfterSubmit(own(raw, "after_submit"), errors);
  const newsletter_checkbox = own(raw, "newsletter_checkbox") === true;
  let newsletter_wording = str(raw, "newsletter_wording");
  if (newsletter_wording.length > MAX_NEWSLETTER_WORDING) {
    errors.newsletter_wording = capCopy(MAX_NEWSLETTER_WORDING);
    newsletter_wording = newsletter_wording.slice(0, MAX_NEWSLETTER_WORDING);
  }
  if (newsletter_checkbox && newsletter_wording === "") {
    newsletter_wording = DEFAULT_NEWSLETTER_WORDING;
  }

  const proEntitled = opts.proEntitled === true;
  const previous = opts.previous ?? null;
  if (!proEntitled) {
    const prevFields = new Map((previous?.fields ?? []).map((f) => [f.id, f]));
    for (const f of fields) {
      if (!PRO_TYPES.has(f.type)) continue;
      const prev = prevFields.get(f.id);
      if (!prev || stableJson(prev) !== stableJson(f)) {
        errors[f.id] ??= FILE_FIELD_PRO_COPY;
      }
    }
  }

  const rawPro = own(raw, "pro");
  const sentPro = rawPro !== undefined && rawPro !== null;
  let pro: FormProSettings | undefined;
  if (!sentPro) {
    // Omitted = unchanged: the stored settings are kept as they are (the rule helpers
    // tolerate ids of fields removed since).
    if (previous?.pro) pro = cloneJson(previous.pro);
  } else if (proEntitled) {
    pro = validatePro(rawPro, fields, errors);
  } else if (previous?.pro) {
    if (stableJson(rawPro) === stableJson(previous.pro))
      pro = cloneJson(previous.pro);
    else errors.pro = PRO_SETTINGS_COPY;
  } else {
    // No stored settings and no entitlement: only an empty settings object passes.
    const rebuilt = validatePro(rawPro, fields, {});
    if (stableJson(rebuilt) !== stableJson(emptyPro()))
      errors.pro = PRO_SETTINGS_COPY;
  }

  if (Object.keys(errors).length > 0) throw new FormErrors(errors);
  const def: FormDefinition = {
    name,
    layout,
    fields,
    after_submit,
    notify_route,
    newsletter_checkbox,
    newsletter_wording,
  };
  if (pro) def.pro = pro;
  return def;
}
