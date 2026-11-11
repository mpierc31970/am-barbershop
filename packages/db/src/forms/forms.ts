// Form writers and owner reads (CONT-25, D231, D233, D270; invariant 1, TEN-03; 07-15).
//
// forms is writes:"custom". Every write here:
//   - requires content:write; organization never from input; lookups scoped (NotFound)
//   - validates with @cds/core/forms validateFormDefinition (deny by default; blocked fields
//     and the Builder Pro file type refused)
//   - screens every visible string (forms are public records, D270): a held form is saved,
//     flagged and reads back inReview; readPublicForms and submitForm never serve it
//   - invalidates the org's live tag and pings once (afterLiveSave)
// Delete follows D275 (07-28, content/soft-delete.ts): a form any draft, kept version or
// pop-up uses is soft-deleted (stays rendered and keeps accepting messages, resolution f);
// an unused one is hard-deleted, and its messages keep their saved form name.
import { InvalidInput, NotFound } from "@cds/core";
import type { SectionRegistry } from "@cds/core/content";
import {
  FORM_LIMIT_COPY,
  MAX_FORMS_PER_ORG,
  MAX_FORM_NAME,
  PAGE_REQUIRED_COPY,
  FormErrors,
  formFromTemplate,
  isFormTemplateId,
  validateFormDefinition,
  type FormDefinition,
} from "@cds/core/forms";
import type PocketBase from "pocketbase";
import { liveTag, type ContentDeps } from "../content/ports";
import { findRefHolders } from "../content/references";
import { afterLiveSave, screen } from "../content/screen";
import {
  isReferenced,
  softOrHard,
  type DeleteOutcome,
} from "../content/soft-delete";
import {
  asInput,
  commit,
  own,
  rejectForeignOrg,
  run,
  scopedGet,
} from "../content/shared";
import type { OrgContext } from "../context";
import { hasEntitlement } from "../payments/entitlements";
import { assertId, newRecordId, requirePermission } from "../repository";
import {
  FORMS,
  SUBMISSIONS,
  fieldCountOf,
  heldFormIds,
  projectForm,
  runFormsRead,
  type FormRecord,
} from "./shared";

export type { FormRecord } from "./shared";

export type FormListRow = FormRecord & { fieldCount: number; unread: number };

/** Every owner-visible string of a form, for the content scanner. */
function textsOf(def: FormDefinition): string[] {
  const out = [
    def.name,
    def.after_submit.message,
    def.after_submit.button_text,
  ];
  if (def.newsletter_checkbox) out.push(def.newsletter_wording);
  for (const f of def.fields) {
    out.push(f.label, f.placeholder, f.help, f.content, ...f.options);
  }
  return out.filter((s) => s !== "");
}

function bodyOf(def: FormDefinition): Record<string, unknown> {
  return {
    name: def.name,
    layout: def.layout,
    fields: def.fields,
    after_submit: def.after_submit,
    notify_route: def.notify_route,
    newsletter_checkbox: def.newsletter_checkbox,
    newsletter_wording: def.newsletter_wording,
    // 10-36: Forms Pro settings (BILL-14); null = none.
    pro: def.pro ?? null,
  };
}

async function assertPageOwned(
  pb: PocketBase,
  ctx: OrgContext,
  def: FormDefinition,
): Promise<void> {
  if (def.after_submit.kind !== "page") return;
  try {
    await scopedGet(pb, ctx, "pages", def.after_submit.page);
  } catch (err) {
    if (err instanceof NotFound) {
      throw new FormErrors({ after_submit: PAGE_REQUIRED_COPY });
    }
    throw err;
  }
}

async function assertUnderLimit(
  pb: PocketBase,
  ctx: OrgContext,
): Promise<void> {
  const res = await pb.collection(FORMS).getList(1, 1, {
    filter: pb.filter("organization = {:org} && deleted_at = ''", {
      org: ctx.orgId,
    }),
    fields: "id",
  });
  if (res.totalItems >= MAX_FORMS_PER_ORG)
    throw new InvalidInput(FORM_LIMIT_COPY);
}

async function unreadByForm(
  pb: PocketBase,
  orgId: string,
): Promise<Map<string, number>> {
  const rows = await pb.collection(SUBMISSIONS).getFullList({
    filter: pb.filter("organization = {:org} && spam = false && read_at = ''", {
      org: orgId,
    }),
    fields: "form",
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    const f = String(r.form ?? "");
    if (f !== "") out.set(f, (out.get(f) ?? 0) + 1);
  }
  return out;
}

/** The org's forms by name. Soft-deleted forms only with `includeDeleted`. */
export function listForms(
  ctx: OrgContext,
  opts: { includeDeleted?: boolean } = {},
): Promise<FormListRow[]> {
  return runFormsRead(ctx, async (pb) => {
    const filter =
      opts.includeDeleted === true
        ? "organization = {:org}"
        : "organization = {:org} && deleted_at = ''";
    const rows = await pb.collection(FORMS).getFullList({
      filter: pb.filter(filter, { org: ctx.orgId }),
      sort: "name,id",
    });
    const held = await heldFormIds(pb, ctx.orgId);
    const unread = await unreadByForm(pb, ctx.orgId);
    return rows.map((r) => {
      const form = projectForm(r, held);
      return {
        ...form,
        fieldCount: fieldCountOf(form),
        unread: unread.get(r.id) ?? 0,
      };
    });
  });
}

export function getForm(ctx: OrgContext, id: string): Promise<FormRecord> {
  return runFormsRead(ctx, async (pb) => {
    const row = await scopedGet(pb, ctx, FORMS, id);
    return projectForm(row, await heldFormIds(pb, ctx.orgId));
  });
}

async function writeNew(
  ctx: OrgContext,
  deps: ContentDeps,
  def: FormDefinition,
  template: string,
  action: string,
): Promise<{ form: FormRecord; held: boolean }> {
  const outcome = await screen(ctx, deps, textsOf(def), []);
  const id = await run(ctx, async (pb) => {
    await assertUnderLimit(pb, ctx);
    await assertPageOwned(pb, ctx, def);
    const newId = newRecordId();
    await commit(
      pb,
      ctx,
      [
        {
          collection: FORMS,
          op: "create",
          id: newId,
          body: { ...bodyOf(def), template, organization: ctx.orgId },
        },
      ],
      { action, targetCollection: FORMS, targetId: newId },
    );
    return newId;
  });
  await afterLiveSave(ctx, deps, outcome, { collection: FORMS, id });
  return { form: await getForm(ctx, id), held: outcome.verdict === "held" };
}

/** Builder Pro (Forms Pro, file upload) for this org: the server truth (BILL-14, T-10-17-01). */
function proEntitled(ctx: OrgContext): Promise<boolean> {
  return hasEntitlement(ctx, "builder-pro");
}

/** A new form from one of the six templates (optionally renamed). */
export async function createForm(
  ctx: OrgContext,
  deps: ContentDeps,
  raw: { template: unknown; name?: unknown },
): Promise<{ form: FormRecord; held: boolean }> {
  requirePermission(ctx, "content", "write");
  const input = asInput(raw, "form input");
  rejectForeignOrg(ctx, input);
  const template = own(input, "template");
  if (!isFormTemplateId(template)) throw new InvalidInput("Choose a template.");
  let def = formFromTemplate(template);
  const name = own(input, "name");
  if (typeof name === "string" && name.trim() !== "") {
    def = validateFormDefinition(
      { ...def, name },
      { proEntitled: await proEntitled(ctx), previous: null },
    );
  }
  return writeNew(ctx, deps, def, template, `${FORMS}.create`);
}

/** Save a whole form definition. The stored template never changes. */
export async function saveForm(
  ctx: OrgContext,
  deps: ContentDeps,
  raw: { id: string } & Record<string, unknown>,
): Promise<{ form: FormRecord; held: boolean }> {
  requirePermission(ctx, "content", "write");
  const input = asInput(raw, "form input");
  rejectForeignOrg(ctx, input);
  const id = own(input, "id");
  assertId(id);
  // Previous = the stored form, so a lapsed org keeps its existing Pro settings and file
  // fields unchanged (10-34 choice 6, invariant 9); new Pro parts need Builder Pro.
  const previous = await getForm(ctx, id);
  const def = validateFormDefinition(input, {
    proEntitled: await proEntitled(ctx),
    previous,
  });
  const outcome = await screen(ctx, deps, textsOf(def), []);
  await run(ctx, async (pb) => {
    await scopedGet(pb, ctx, FORMS, id);
    await assertPageOwned(pb, ctx, def);
    await commit(
      pb,
      ctx,
      [{ collection: FORMS, op: "update", id, body: bodyOf(def) }],
      { action: `${FORMS}.update`, targetCollection: FORMS, targetId: id },
    );
  });
  await afterLiveSave(ctx, deps, outcome, { collection: FORMS, id });
  return { form: await getForm(ctx, id), held: outcome.verdict === "held" };
}

/** "Copy of <name>" with the same fields and settings (screened again). */
export async function duplicateForm(
  ctx: OrgContext,
  deps: ContentDeps,
  id: string,
): Promise<{ form: FormRecord; held: boolean }> {
  requirePermission(ctx, "content", "write");
  const source = await getForm(ctx, id);
  const def = validateFormDefinition(
    {
      name: `Copy of ${source.name}`.slice(0, MAX_FORM_NAME),
      layout: source.layout,
      fields: source.fields,
      after_submit: source.after_submit,
      notify_route: source.notify_route,
      newsletter_checkbox: source.newsletter_checkbox,
      newsletter_wording: source.newsletter_wording,
      ...(source.pro ? { pro: source.pro } : {}),
    },
    { proEntitled: await proEntitled(ctx), previous: source },
  );
  return writeNew(ctx, deps, def, source.template, `${FORMS}.create`);
}

/** D275 delete (07-28): soft when referenced, else hard. Never refused for being in use. */
export async function deleteForm(
  ctx: OrgContext,
  deps: ContentDeps,
  id: string,
): Promise<DeleteOutcome> {
  requirePermission(ctx, "content", "write");
  const outcome = await run(ctx, async (pb) => {
    const row = await scopedGet(pb, ctx, FORMS, id);
    const referenced = await isReferenced(
      pb,
      ctx,
      deps.sections,
      "forms",
      row.id,
    );
    return softOrHard(pb, ctx, FORMS, row, referenced, { name: row.name });
  });
  deps.invalidator.invalidate([liveTag(ctx.orgId)]);
  return outcome;
}

export type FormUsedOn = {
  pages: { id: string; title: string }[];
  inVersions: boolean;
  inPopups: number;
};

/** Where a form is placed: draft pages, saved versions and pop-ups (07-12 findRefHolders). */
export function formUsedOn(
  ctx: OrgContext,
  registry: SectionRegistry,
  id: string,
): Promise<FormUsedOn> {
  return runFormsRead(ctx, async (pb) => {
    await scopedGet(pb, ctx, FORMS, id);
    const h = await findRefHolders(pb, ctx, registry, "forms", id);
    return {
      pages: h.draftPages,
      inVersions: h.versionPages.length > 0,
      inPopups: h.popups.length,
    };
  });
}
