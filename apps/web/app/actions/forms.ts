"use server";
// Forms actions for Website › Forms and the Form item editor (07-18; CONT-25, D231, D233,
// D270, D275; T-07-18-01..04, T-07-18-10). Public POST endpoints: every argument is
// untrusted. The tenant and role come only from the session cookie via runAction; no action
// takes an org id. Save keys are allowlisted here (template, organization and deleted_at are
// never forwarded), shapes and sizes are checked before the chokepoint, and record ids are
// shape-checked (a bad id is the GONE copy with no chokepoint call). The @cds/db chokepoint
// validates and screens again: a held save is a success with held: true (D270). Field-keyed
// validation errors come back as data so the editor can mark the right field. Nothing here
// logs a form name, a label, an answer or an address.
import { InvalidInput } from "@cds/core";
import {
  FIELDS_LIMIT_COPY,
  FormErrors,
  MAX_AUTO_REPLY_BODY,
  MAX_AUTO_REPLY_SUBJECT,
  MAX_FORM_FIELDS,
  MAX_FORM_NAME,
  MAX_PRO_ROUTES,
  MAX_PRO_RULES,
  MAX_PRO_STEPS,
  MAX_RULE_VALUE,
  MAX_STEP_TITLE,
  isFormTemplateId,
} from "@cds/core/forms";
import {
  createForm,
  deleteForm,
  duplicateForm,
  formUsedOn,
  saveForm,
  type FormRecord,
  type FormUsedOn,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";
import { contentDeps } from "../../lib/content";

const ID = /^[a-z0-9]{1,32}$/i;
const GONE = "This was removed or moved. Reload the page to see the latest.";
const MAX_INPUT_BYTES = 256 * 1024;
const SHAPE_COPY = "This form couldn't be read. Reload the page and try again.";
const TOO_BIG_COPY =
  "This form is too big to save. Remove some fields or shorten the text.";
const TEMPLATE_COPY = "Choose a template.";
const NAME_LONG_COPY = `Keep this under ${MAX_FORM_NAME} characters.`;
const PRO_SHAPE_COPY =
  "These Builder Pro settings couldn't be read. Reload the page and try again.";
/** Field ids, step ids, ops, actions and route names: short tokens. */
const ID_TEXT = 64;

const SAVE_KEYS = [
  "name",
  "layout",
  "fields",
  "after_submit",
  "notify_route",
  "newsletter_checkbox",
  "newsletter_wording",
] as const;

export type SaveFormResult = ActionResult<
  | { saved: { form: FormRecord; held: boolean } }
  | { invalid: { errors: Record<string, string>; message: string } }
>;

function record(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function idOf(raw: unknown): string {
  if (typeof raw !== "string" || !ID.test(raw)) throw new InvalidInput(GONE);
  return raw;
}

function refreshHub(): void {
  try {
    revalidatePath("/hub/website");
  } catch (err) {
    console.error("[forms] revalidate failed", err);
  }
}

function isBag(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function proShape(): never {
  throw new InvalidInput(PRO_SHAPE_COPY);
}

function capped(v: unknown, max: number): string {
  if (typeof v !== "string" || v.length > max) proShape();
  return v;
}

function list(v: unknown, max: number): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max) proShape();
  return v;
}

function bag(v: unknown): Record<string, unknown> {
  if (!isBag(v)) proShape();
  return v;
}

function flag(v: unknown): boolean {
  if (v === undefined) return false;
  if (typeof v !== "boolean") proShape();
  return v;
}

/**
 * Forms Pro settings: types and caps mirror 10-34 (MAX_PRO_RULES, MAX_PRO_STEPS,
 * MAX_PRO_ROUTES, MAX_STEP_TITLE, MAX_RULE_VALUE, MAX_AUTO_REPLY_*). Deny by default: only
 * known keys survive. Field ids, ops and routes are checked against the form by the
 * chokepoint's validateFormDefinition (T-10-39-02).
 */
function cleanPro(raw: unknown) {
  const p = bag(raw);
  const ar = p.auto_reply === undefined ? {} : bag(p.auto_reply);
  return {
    rules: list(p.rules, MAX_PRO_RULES).map((r) => {
      const rule = bag(r);
      const when = bag(rule.when);
      return {
        target: capped(rule.target, ID_TEXT),
        action: capped(rule.action, ID_TEXT),
        when: {
          field: capped(when.field, ID_TEXT),
          op: capped(when.op, ID_TEXT),
          value: capped(when.value ?? "", MAX_RULE_VALUE),
        },
      };
    }),
    steps: list(p.steps, MAX_PRO_STEPS).map((s) => {
      const step = bag(s);
      return {
        id: capped(step.id, ID_TEXT),
        title: capped(step.title, MAX_STEP_TITLE),
        fields: list(step.fields, MAX_FORM_FIELDS).map((f) =>
          capped(f, ID_TEXT),
        ),
      };
    }),
    auto_reply: {
      enabled: flag(ar.enabled),
      subject: capped(ar.subject ?? "", MAX_AUTO_REPLY_SUBJECT),
      body: capped(ar.body ?? "", MAX_AUTO_REPLY_BODY),
    },
    routing: list(p.routing, MAX_PRO_ROUTES).map((r) => {
      const route = bag(r);
      return {
        field: capped(route.field, ID_TEXT),
        value: capped(route.value, MAX_RULE_VALUE),
        route: capped(route.route, ID_TEXT),
      };
    }),
    save_resume: flag(p.save_resume),
  };
}

function byteLength(v: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(v) ?? "").length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** A new form from one of the six templates; returns its id and name. */
export async function createFormAction(
  input: unknown,
): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async (s) => {
    const raw = record(input);
    const template = Object.hasOwn(raw, "template") ? raw.template : undefined;
    if (!isFormTemplateId(template)) throw new InvalidInput(TEMPLATE_COPY);
    const clean: { template: string; name?: string } = { template };
    if (Object.hasOwn(raw, "name") && raw.name !== undefined) {
      const name = str(raw.name);
      if (name.length > MAX_FORM_NAME) throw new InvalidInput(NAME_LONG_COPY);
      if (name.trim() !== "") clean.name = name;
    }
    const { form } = await createForm(s.ctx, contentDeps(), clean);
    refreshHub();
    return { id: form.id, name: form.name };
  });
}

/** Save a whole form definition (allowlisted keys); field errors come back as data. */
export async function saveFormAction(input: unknown): Promise<SaveFormResult> {
  return runAction(async (s) => {
    const raw = record(input);
    const id = idOf(raw.id);
    const clean: { id: string } & Record<string, unknown> = { id };
    for (const key of SAVE_KEYS) {
      if (Object.hasOwn(raw, key)) clean[key] = raw[key];
    }
    if (!Array.isArray(clean.fields)) throw new InvalidInput(SHAPE_COPY);
    if (clean.fields.length > MAX_FORM_FIELDS) {
      throw new InvalidInput(FIELDS_LIMIT_COPY);
    }
    // Forms Pro (10-39): shape-check and rebuild `pro` with only its known keys. Absent or
    // null = omitted, so the chokepoint keeps the stored settings (a paused org's save).
    // Whether pro may change at all is the chokepoint's call (hasEntitlement, T-10-39-01).
    if (
      Object.hasOwn(raw, "pro") &&
      raw.pro !== undefined &&
      raw.pro !== null
    ) {
      clean.pro = cleanPro(raw.pro);
    }
    if (byteLength(clean) > MAX_INPUT_BYTES)
      throw new InvalidInput(TOO_BIG_COPY);
    try {
      const saved = await saveForm(s.ctx, contentDeps(), clean);
      refreshHub();
      return { saved };
    } catch (err) {
      if (err instanceof FormErrors) {
        return { invalid: { errors: { ...err.errors }, message: err.message } };
      }
      throw err;
    }
  });
}

/** "Copy of <name>"; returns the copy's id and name. */
export async function duplicateFormAction(
  id: unknown,
): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async (s) => {
    const { form } = await duplicateForm(s.ctx, contentDeps(), idOf(id));
    refreshHub();
    return { id: form.id, name: form.name };
  });
}

/** Soft delete until 07-28 (pages keep showing it; its messages stay in the Inbox). */
export async function deleteFormAction(
  id: unknown,
): Promise<ActionResult<null>> {
  return runAction(async (s) => {
    await deleteForm(s.ctx, contentDeps(), idOf(id));
    refreshHub();
    return null;
  });
}

/** Where a form is placed; asked before the delete confirm to choose its copy. */
export async function formUsedOnAction(
  id: unknown,
): Promise<ActionResult<FormUsedOn>> {
  return runAction(async (s) => {
    const formId = idOf(id);
    return formUsedOn(s.ctx, contentDeps().sections, formId);
  });
}
