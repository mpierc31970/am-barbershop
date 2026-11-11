// Forms Pro rules (BILL-14, D233; 10-34): which fields are visible, the steps, the notify
// route and the auto-reply for a submission. One rule set shared by the server, the site
// island and the hub preview.
//
// Every helper takes `proActive`: when Builder Pro is inactive (never bought or lapsed) the
// form behaves as a free form; the stored settings are kept but ignored (invariant 9).
// Helpers tolerate stale ids (a rule naming a deleted field never matches or hides).
// Pure and Edge/browser safe: no node:*, no @cds/db.
import type { EmailPurpose } from "../email/types";
import {
  ADDRESS_PARTS,
  type FormDefinition,
  type FormField,
  type FormProSettings,
  type ProRule,
  type ProStep,
  type PublicFormPro,
  type ValidatedSubmission,
} from "./model";

export {
  FORM_DRAFT_TTL_DAYS,
  MAX_AUTO_REPLY_BODY,
  MAX_AUTO_REPLY_SUBJECT,
  MAX_PRO_ROUTES,
  MAX_PRO_RULES,
  MAX_PRO_STEPS,
  MAX_RULE_VALUE,
  MAX_STEP_TITLE,
  PRO_RULE_OPS,
  PRO_SETTINGS_COPY,
} from "./model";
export type {
  FormProSettings,
  ProAutoReply,
  ProRoute,
  ProRule,
  ProRuleOp,
  ProStep,
  PublicFormPro,
} from "./model";

/** A fresh, empty Pro settings object (no rules, no steps, auto-reply off). */
export function emptyPro(): FormProSettings {
  return {
    rules: [],
    steps: [],
    auto_reply: { enabled: false, subject: "", body: "" },
    routing: [],
    save_resume: false,
  };
}

/** The empty Pro settings (frozen; use emptyPro() for a mutable copy). */
export const EMPTY_PRO: Readonly<FormProSettings> = (() => {
  const p = emptyPro();
  Object.freeze(p.rules);
  Object.freeze(p.steps);
  Object.freeze(p.routing);
  Object.freeze(p.auto_reply);
  return Object.freeze(p);
})();

export type ProOpts = { proActive: boolean };

type ProSource = Pick<FormDefinition, "fields"> & {
  pro?: FormProSettings | PublicFormPro | null;
};
type Answers = Readonly<Record<string, unknown>>;

function own(raw: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(raw, key)
    ? (raw as Record<string, unknown>)[key]
    : undefined;
}

function activePro(def: ProSource, opts: ProOpts): ProSource["pro"] | null {
  return opts.proActive && def.pro ? def.pro : null;
}

/** An answer as comparable strings ("" / [] / false / blank address = none). */
function answerStrings(v: unknown): string[] {
  if (typeof v === "string") return v.trim() === "" ? [] : [v.trim()];
  if (typeof v === "number" && Number.isFinite(v)) return [String(v)];
  if (v === true) return ["yes"];
  if (Array.isArray(v)) return v.flatMap(answerStrings);
  if (typeof v === "object" && v !== null) {
    const parts = ADDRESS_PARTS.map((p) => own(v, p))
      .filter((s): s is string => typeof s === "string" && s.trim() !== "")
      .map((s) => s.trim());
    return parts.length === 0 ? [] : [parts.join(", ")];
  }
  return [];
}

function ruleMatches(rule: ProRule, answers: Answers): boolean {
  const got = answerStrings(own(answers, rule.when.field));
  const want = rule.when.value.trim().toLowerCase();
  switch (rule.when.op) {
    case "answered":
      return got.length > 0;
    case "not_answered":
      return got.length === 0;
    case "is":
      return got.some((s) => s.toLowerCase() === want);
    case "is_not":
      return !got.some((s) => s.toLowerCase() === want);
    case "contains":
      return want !== "" && got.some((s) => s.toLowerCase().includes(want));
    default:
      return false;
  }
}

/**
 * Whether one field is visible, given the answers of the fields before it. A field with
 * show rules is visible only when one matches; any matching hide rule hides it.
 */
export function isFieldVisible(
  rules: readonly ProRule[],
  fieldId: string,
  answers: Answers,
): boolean {
  const mine = rules.filter((r) => r.target === fieldId);
  if (mine.length === 0) return true;
  const shows = mine.filter((r) => r.action === "show");
  if (shows.length > 0 && !shows.some((r) => ruleMatches(r, answers)))
    return false;
  return !mine.some((r) => r.action === "hide" && ruleMatches(r, answers));
}

/**
 * The ids of the visible fields, in form order. Rules only reference earlier fields, so the
 * walk is one pass; a hidden field's answer never makes a later field visible.
 */
export function visibleFieldIds(
  def: ProSource,
  answers: Answers,
  opts: ProOpts,
): Set<string> {
  const pro = activePro(def, opts);
  const ids = new Set<string>();
  if (!pro || pro.rules.length === 0) {
    for (const f of def.fields) ids.add(f.id);
    return ids;
  }
  const seen: Record<string, unknown> = Object.create(null);
  for (const f of def.fields) {
    if (!isFieldVisible(pro.rules, f.id, seen)) continue;
    ids.add(f.id);
    const v = own(answers, f.id);
    if (v !== undefined) seen[f.id] = v;
  }
  return ids;
}

/** The single step a free form (or a Pro form without steps) is shown as. */
function singleStep(fields: readonly FormField[]): ProStep {
  return { id: "step-1", title: "", fields: fields.map((f) => f.id) };
}

/**
 * The form's steps. Inactive or no steps: one synthetic step holding every field. With
 * `answers`, hidden fields are left out and steps with nothing visible are dropped.
 */
export function formSteps(
  def: ProSource,
  opts: ProOpts & { answers?: Answers },
): ProStep[] {
  const pro = activePro(def, opts);
  const known = new Set(def.fields.map((f) => f.id));
  let steps =
    pro && pro.steps.length > 0
      ? pro.steps.map((s) => ({
          id: s.id,
          title: s.title,
          fields: s.fields.filter((id) => known.has(id)),
        }))
      : [singleStep(def.fields)];
  if (opts.answers) {
    const visible = visibleFieldIds(def, opts.answers, opts);
    steps = steps
      .map((s) => ({ ...s, fields: s.fields.filter((id) => visible.has(id)) }))
      .filter((s) => s.fields.length > 0);
  }
  return steps;
}

/** The notify route: the first matching routing entry, else `notify_route`. */
export function routeForAnswers(
  def: Pick<FormDefinition, "fields" | "notify_route" | "pro">,
  answers: Answers,
  opts: ProOpts,
): EmailPurpose {
  const pro = opts.proActive ? def.pro : undefined;
  if (!pro || pro.routing.length === 0) return def.notify_route;
  const visible = visibleFieldIds(def, answers, opts);
  for (const r of pro.routing) {
    if (!visible.has(r.field)) continue;
    const want = r.value.trim().toLowerCase();
    if (
      answerStrings(own(answers, r.field)).some((s) => s.toLowerCase() === want)
    ) {
      return r.route;
    }
  }
  return def.notify_route;
}

/** Longest visitor name put into an auto-reply body (review CR-B01). */
export const AUTO_REPLY_NAME_MAX = 60;

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const LINK_RE = /(?:https?:\/\/|www\.)\S*/gi;
const BARE_DOMAIN_RE =
  /\S+\.(?:com|net|org|io|co|ru|cn|info|biz|xyz|top|link|click|me|app|site)\b\S*/gi;

/**
 * The visitor's Name answer made safe for an auto-reply body (review CR-B01): control and
 * line/paragraph separators become spaces, links and bare domains are removed, whitespace
 * collapses, and it is cut to AUTO_REPLY_NAME_MAX characters. Empty = "there".
 */
export function autoReplyName(raw: string | null | undefined): string {
  const s = (raw ?? "")
    .replace(CONTROL_RE, " ")
    .replace(LINK_RE, "")
    .replace(BARE_DOMAIN_RE, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, AUTO_REPLY_NAME_MAX)
    .trim();
  return s === "" ? "there" : s;
}

/** The owner's subject with {name} dropped, kept to one tidy line (review CR-B01). */
function autoReplySubject(subject: string): string {
  return subject
    .split("{name}")
    .join("")
    .replace(CONTROL_RE, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:]+|[\s,;:]+$/g, "")
    .trim();
}

/**
 * The auto-reply to send the submitter, or null (off, inactive, or no email answer).
 * CR-B01: the visitor writes the Name answer and picks the address, so the subject never
 * carries visitor input ({name} is dropped there) and the body gets only the sanitised name.
 */
export function autoReplyFor(
  def: Pick<FormDefinition, "pro">,
  submission: Pick<ValidatedSubmission, "email" | "name">,
  opts: ProOpts,
): { to: string; subject: string; body: string } | null {
  const ar = opts.proActive ? def.pro?.auto_reply : undefined;
  if (!ar || !ar.enabled) return null;
  const to = submission.email?.trim() ?? "";
  if (to === "") return null;
  return {
    to,
    subject: autoReplySubject(ar.subject),
    body: ar.body.split("{name}").join(autoReplyName(submission.name)),
  };
}

/** The visitor-safe part of the Pro settings, or null when inactive (T-10-34-03). */
export function publicProOf(
  def: Pick<FormDefinition, "pro">,
  opts: ProOpts,
): PublicFormPro | null {
  const pro = opts.proActive ? def.pro : undefined;
  if (!pro) return null;
  return {
    rules: pro.rules.map((r) => ({ ...r, when: { ...r.when } })),
    steps: pro.steps.map((s) => ({ ...s, fields: [...s.fields] })),
    save_resume: pro.save_resume,
  };
}
