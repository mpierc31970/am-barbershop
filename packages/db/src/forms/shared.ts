// Shared internals of the forms engine (CONT-25, D231, D270; invariant 1; 07-15). Never
// exported from the forms barrel.
//   - runFormsRead(): content read (every org role), superuser client, PB error mapping
//   - formFromRow(): a stored row re-validated on read (a malformed row reads back empty)
//   - heldFormIds(): forms with an open "held" content flag (D270): never public
import {
  DEFAULT_AFTER_MESSAGE,
  DEFAULT_BUTTON_TEXT,
  DISPLAY_TYPES,
  FormErrors,
  MAX_AUTO_REPLY_BODY,
  MAX_AUTO_REPLY_SUBJECT,
  MAX_PRO_ROUTES,
  MAX_PRO_RULES,
  MAX_PRO_STEPS,
  MAX_RULE_VALUE,
  MAX_STEP_TITLE,
  PRO_RULE_OPS,
  validateFormDefinition,
  type FormDefinition,
  type FormProSettings,
  type ProRoute,
  type ProRule,
  type ProStep,
} from "@cds/core/forms";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import {
  mintSystemContext,
  type OrgContext,
  type SystemContext,
} from "../context";
import { mapError, requirePermission } from "../repository";

export const FORMS = "forms";
export const SUBMISSIONS = "form_submissions";

export type FormTemplateName =
  | "blank"
  | "contact"
  | "quote-request"
  | "client-intake"
  | "feedback"
  | "job-application";

/** One form as the owner hub sees it. */
export type FormRecord = FormDefinition & {
  id: string;
  template: FormTemplateName;
  /** Soft-deleted (07-15 choice 10): hidden from lists, still rendered and still accepting. */
  deleted: boolean;
  /** Held by the content scanner (D270): saved, never public until staff clear it. */
  inReview: boolean;
  created: string;
  updated: string;
};

export function mapped<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

/** Content read (every org role), no lock. Throws Forbidden synchronously. */
export function runFormsRead<T>(
  ctx: OrgContext,
  fn: (pb: PocketBase) => Promise<T>,
): Promise<T> {
  requirePermission(ctx, "content", "read");
  return mapped(withSuperuser(fn));
}

const TEMPLATES: readonly FormTemplateName[] = [
  "blank",
  "contact",
  "quote-request",
  "client-intake",
  "feedback",
  "job-application",
];

const ROUTES: readonly string[] = [
  "default",
  "inquiries",
  "newsletter",
  "billing",
  "account",
];

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (b: Bag, k: string, max: number): string => {
  const v = Object.prototype.hasOwnProperty.call(b, k) ? b[k] : undefined;
  return typeof v === "string" ? v.slice(0, max) : "";
};
const bags = (v: unknown, max: number): Bag[] =>
  Array.isArray(v) ? v.filter(isBag).slice(0, max) : [];

/**
 * 10-36: stored Pro settings that no longer pass the strict check (a lapsed org removed a field
 * a rule names; the save kept `pro` unchanged, 10-34 choice 6). Shape-only rebuild: the rule
 * helpers tolerate stale ids, and nothing stored is lost (invariant 9).
 */
function storedPro(raw: unknown): FormProSettings | undefined {
  if (!isBag(raw)) return undefined;
  const rules: ProRule[] = [];
  for (const r of bags(raw.rules, MAX_PRO_RULES)) {
    const when = isBag(r.when) ? r.when : {};
    const op = when.op;
    if (!(PRO_RULE_OPS as readonly unknown[]).includes(op)) continue;
    rules.push({
      target: text(r, "target", 64),
      action: r.action === "hide" ? "hide" : "show",
      when: {
        field: text(when, "field", 64),
        op: op as ProRule["when"]["op"],
        value: text(when, "value", MAX_RULE_VALUE),
      },
    });
  }
  const steps: ProStep[] = bags(raw.steps, MAX_PRO_STEPS).map((st) => ({
    id: text(st, "id", 64),
    title: text(st, "title", MAX_STEP_TITLE),
    fields: Array.isArray(st.fields)
      ? st.fields.filter((f): f is string => typeof f === "string")
      : [],
  }));
  const routing: ProRoute[] = [];
  for (const r of bags(raw.routing, MAX_PRO_ROUTES)) {
    if (typeof r.route !== "string" || !ROUTES.includes(r.route)) continue;
    routing.push({
      field: text(r, "field", 64),
      value: text(r, "value", MAX_RULE_VALUE),
      route: r.route as ProRoute["route"],
    });
  }
  const ar = isBag(raw.auto_reply) ? raw.auto_reply : {};
  return {
    rules,
    steps,
    auto_reply: {
      enabled: ar.enabled === true,
      subject: text(ar, "subject", MAX_AUTO_REPLY_SUBJECT),
      body: text(ar, "body", MAX_AUTO_REPLY_BODY),
    },
    routing,
    save_resume: raw.save_resume === true,
  };
}

/** A stored row's definition, re-validated; a malformed row reads back with no fields. */
export function formFromRow(row: RecordModel): FormDefinition {
  const base = {
    name: row.name,
    layout: row.layout,
    fields: Array.isArray(row.fields) ? row.fields : [],
    after_submit: row.after_submit,
    notify_route: row.notify_route,
    newsletter_checkbox: row.newsletter_checkbox,
    newsletter_wording: row.newsletter_wording,
  };
  // 10-17: a stored row already passed the write-time Builder Pro check; reading it back
  // grants nothing, and a lapsed org keeps its file fields and Pro settings (invariant 9).
  const read = { proEntitled: true } as const;
  try {
    // 10-36: the Forms Pro settings live in the `pro` json column.
    return validateFormDefinition(
      isBag(row.pro) ? { ...base, pro: row.pro } : base,
      read,
    );
  } catch (err) {
    if (err instanceof FormErrors && isBag(row.pro)) {
      try {
        const def = validateFormDefinition(base, read);
        const pro = storedPro(row.pro);
        if (pro) def.pro = pro;
        return def;
      } catch {
        // falls through to the empty read below
      }
    }
    return {
      name: typeof row.name === "string" ? row.name.slice(0, 80) : "",
      layout: row.layout === "2" ? "2" : "1",
      fields: [],
      after_submit: {
        kind: "message",
        message: DEFAULT_AFTER_MESSAGE,
        page: "",
        button_text: DEFAULT_BUTTON_TEXT,
      },
      notify_route: "inquiries",
      newsletter_checkbox: false,
      newsletter_wording: "",
    };
  }
}

export function projectForm(
  row: RecordModel,
  held: ReadonlySet<string>,
): FormRecord {
  const def = formFromRow(row);
  return {
    id: row.id,
    template: TEMPLATES.includes(row.template as FormTemplateName)
      ? (row.template as FormTemplateName)
      : "blank",
    ...def,
    deleted: typeof row.deleted_at === "string" && row.deleted_at !== "",
    inReview: held.has(row.id),
    created: String(row.created ?? ""),
    updated: String(row.updated ?? ""),
  };
}

/** Input + hidden fields (what the list's "6 fields" counts). */
export function fieldCountOf(def: FormDefinition): number {
  return def.fields.filter((f) => !DISPLAY_TYPES.has(f.type)).length;
}

/** Ids of this org's forms with an open "held" flag (bound params only). */
export async function heldFormIds(
  pb: PocketBase,
  orgId: string,
): Promise<Set<string>> {
  const rows = await pb.collection("content_flags").getFullList({
    filter: pb.filter(
      "organization = {:org} && target_collection = {:col} && verdict = 'held' && status = 'open'",
      { org: orgId, col: FORMS },
    ),
    fields: "target_id",
  });
  return new Set(rows.map((r) => String(r.target_id ?? "")));
}

export function systemCtx(job: string): SystemContext {
  return mintSystemContext({ job });
}
