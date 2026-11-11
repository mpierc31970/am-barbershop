// Inbox data layer and CSV export (CONT-25, D236, D271; resolution g; invariant 1, TEN-03;
// T-07-15-01, T-07-15-10, T-07-15-13; 07-15 choices 11, 12, 15).
//
// Permissions (resolution g): content read lists, reads and sets read state (choice 11: it
// changes no content, so opening a message marks it read for Viewers too); content write
// deletes and marks Not spam. Every lookup is scoped to ctx.orgId with bound params; a foreign
// and an absent id are the same NotFound.
// Not spam (choice 12) clears the flag and performs the contact touch the visitor's send
// skipped (with the newsletter consent when it was ticked); it sends no email. The touch runs
// after run() returns: touchContact takes the same org lock, which is not re-entrant.
// WR-A07: the touch creates a contact and records consent, which is contacts write (Owner,
// Admin). An Editor may still clear the flag (content write), but the touch is skipped for a
// caller without contacts write, so Not spam is never a way around the Contacts gate.
// 10-38 (D234): a submission's file answers come back as `files` (id, label, name, size,
// type; never a storage key) for the drawer's Download links, and deleting the submission
// deletes its stored files.
import { Forbidden, ImpersonationDenied } from "@cds/core";
import { serializeCsv } from "@cds/core/csv";
import { isEmail } from "@cds/core/email";
import {
  DEFAULT_NEWSLETTER_WORDING,
  DISPLAY_TYPES,
  answersForDisplay,
  formatAnswer,
  isFileAnswer,
  type FormDefinition,
  type FormField,
} from "@cds/core/forms";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { touchContact } from "../contacts/touch";
import { commit, run, scopedGet } from "../content/shared";
import type { OrgContext } from "../context";
import { requirePermission } from "../repository";
import { FORMS, SUBMISSIONS, formFromRow, runFormsRead } from "./shared";
import { deleteFormFiles } from "./uploads";

const PER_PAGE = 50;
const MAX_PER_PAGE = 100;
const PREVIEW_CHARS = 80;
const MAX_QUERY = 100;

export type SubmissionRow = {
  id: string;
  form: string;
  formName: string;
  formDeleted: boolean;
  from: string;
  preview: string;
  unread: boolean;
  spam: boolean;
  /** 14-35 (P14-P40): sent from the launch review (a neutral "Test" badge; never hidden). */
  isTest: boolean;
  created: string;
};

export type SubmissionPage = {
  items: SubmissionRow[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
};

export type SubmissionDetail = {
  id: string;
  form: string;
  formName: string;
  formDeleted: boolean;
  page: { id: string; title: string } | null;
  answers: { label: string; value: string }[];
  /** 10-38: uploaded files (download at /hub/api/forms/files/<id>). */
  files: SubmissionFile[];
  newsletter: boolean;
  email: string | null;
  contact: string | null;
  spam: boolean;
  /** 14-35 (P14-P40): sent from the launch review. */
  isTest: boolean;
  readAt: string | null;
  created: string;
};

export type SubmissionFile = {
  id: string;
  label: string;
  name: string;
  size: number;
  type: string;
};

/** File answers in form order (then removed fields), labelled from the field or snapshot. */
function filesOf(
  fields: readonly FormField[],
  data: Record<string, unknown>,
  labels: unknown,
): { files: SubmissionFile[]; keys: Set<string> } {
  const snap = isBag(labels) ? labels : {};
  const order = [
    ...fields.map((f) => f.id),
    ...Object.keys(data).filter((k) => !fields.some((f) => f.id === k)),
  ];
  const files: SubmissionFile[] = [];
  const keys = new Set<string>();
  for (const key of order) {
    const v = own(data, key);
    if (!isFileAnswer(v)) continue;
    keys.add(key);
    const field = fields.find((f) => f.id === key);
    const l = own(snap, key);
    files.push({
      id: v.file_id,
      label: field?.label ?? (typeof l === "string" && l !== "" ? l : key),
      name: v.name,
      size: v.size,
      type: v.type,
    });
  }
  return { files, keys };
}

type FormInfo = { def: FormDefinition; deleted: boolean };

function isBag(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function own(raw: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
}

async function formsById(
  pb: PocketBase,
  orgId: string,
): Promise<Map<string, FormInfo>> {
  const rows = await pb.collection(FORMS).getFullList({
    filter: pb.filter("organization = {:org}", { org: orgId }),
  });
  return new Map(
    rows.map((r) => [
      r.id,
      {
        def: formFromRow(r),
        deleted: typeof r.deleted_at === "string" && r.deleted_at !== "",
      },
    ]),
  );
}

function firstOfType(
  fields: readonly FormField[],
  data: Record<string, unknown>,
  type: FormField["type"],
): string | null {
  for (const f of fields) {
    if (f.type !== type) continue;
    const v = own(data, f.id);
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

/** The visitor's email: the first email field's answer, else any answer that is an address. */
function emailOf(
  fields: readonly FormField[],
  data: Record<string, unknown>,
): string | null {
  const byField = firstOfType(fields, data, "email");
  if (byField !== null && isEmail(byField)) return byField;
  for (const [k, v] of Object.entries(data)) {
    if (!k.startsWith("_") && typeof v === "string" && isEmail(v)) return v;
  }
  return null;
}

function fromOf(
  fields: readonly FormField[],
  data: Record<string, unknown>,
): string {
  return (
    firstOfType(fields, data, "name") ?? emailOf(fields, data) ?? "No name"
  );
}

function previewOf(
  fields: readonly FormField[],
  data: Record<string, unknown>,
  labels: unknown,
): string {
  const long = firstOfType(fields, data, "long_text");
  const text = long ?? answersForDisplay(fields, data, labels)[0]?.value ?? "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS
    ? `${flat.slice(0, PREVIEW_CHARS - 1)}…`
    : flat;
}

function toRow(r: RecordModel, forms: Map<string, FormInfo>): SubmissionRow {
  const formId = typeof r.form === "string" ? r.form : "";
  const info = forms.get(formId);
  const fields = info?.def.fields ?? [];
  const data = isBag(r.data) ? r.data : {};
  return {
    id: r.id,
    form: formId,
    formName: String(r.form_name ?? info?.def.name ?? ""),
    formDeleted: info === undefined || info.deleted,
    from: fromOf(fields, data),
    preview: previewOf(fields, data, r.labels),
    unread: typeof r.read_at !== "string" || r.read_at === "",
    spam: r.spam === true,
    isTest: r.is_test === true,
    created: String(r.created ?? ""),
  };
}

async function assertFormOwned(
  pb: PocketBase,
  ctx: OrgContext,
  formId: unknown,
): Promise<string> {
  const row = await scopedGet(pb, ctx, FORMS, formId);
  return row.id;
}

/** Messages (spam false) or Filtered (spam true), newest first, 50 per page. */
export function listSubmissions(
  ctx: OrgContext,
  opts: {
    form?: string;
    view?: "messages" | "filtered";
    q?: string;
    /** 11-13: unread messages only (the Needs-you inbox provider). */
    unread?: boolean;
    page?: number;
    perPage?: number;
  } = {},
): Promise<SubmissionPage> {
  return runFormsRead(ctx, async (pb) => {
    const params: Record<string, unknown> = {
      org: ctx.orgId,
      spam: opts.view === "filtered",
    };
    let filter = "organization = {:org} && spam = {:spam}";
    if (opts.unread === true) filter += " && read_at = ''";
    if (opts.form !== undefined) {
      params.form = await assertFormOwned(pb, ctx, opts.form);
      filter += " && form = {:form}";
    }
    const q =
      typeof opts.q === "string" ? opts.q.trim().slice(0, MAX_QUERY) : "";
    if (q !== "") {
      params.q = q;
      filter += " && (form_name ~ {:q} || data ~ {:q})";
    }
    const page =
      Number.isInteger(opts.page) && (opts.page as number) > 0
        ? (opts.page as number)
        : 1;
    const perPage =
      Number.isInteger(opts.perPage) && (opts.perPage as number) > 0
        ? Math.min(opts.perPage as number, MAX_PER_PAGE)
        : PER_PAGE;
    const res = await pb.collection(SUBMISSIONS).getList(page, perPage, {
      filter: pb.filter(filter, params),
      sort: "-created,-id",
    });
    const forms = await formsById(pb, ctx.orgId);
    return {
      items: res.items.map((r) => toRow(r, forms)),
      page: res.page,
      perPage: res.perPage,
      totalItems: res.totalItems,
      totalPages: res.totalPages,
    };
  });
}

/** Sidebar badge (unread messages) and the Filtered tab count. */
export function countSubmissions(
  ctx: OrgContext,
): Promise<{ unread: number; filtered: number }> {
  return runFormsRead(ctx, async (pb) => {
    const count = async (filter: string) =>
      (
        await pb.collection(SUBMISSIONS).getList(1, 1, {
          filter: pb.filter(filter, { org: ctx.orgId }),
          fields: "id",
        })
      ).totalItems;
    return {
      unread: await count(
        "organization = {:org} && spam = false && read_at = ''",
      ),
      filtered: await count("organization = {:org} && spam = true"),
    };
  });
}

export function getSubmission(
  ctx: OrgContext,
  id: string,
): Promise<SubmissionDetail> {
  return runFormsRead(ctx, async (pb) => {
    const r = await scopedGet(pb, ctx, SUBMISSIONS, id);
    const forms = await formsById(pb, ctx.orgId);
    const formId = typeof r.form === "string" ? r.form : "";
    const info = forms.get(formId);
    const fields = info?.def.fields ?? [];
    const data = isBag(r.data) ? r.data : {};
    let page: SubmissionDetail["page"] = null;
    if (typeof r.page === "string" && r.page !== "") {
      const p = await scopedGet(pb, ctx, "pages", r.page).catch(() => null);
      if (p) page = { id: p.id, title: String(p.title ?? "") };
    }
    const { files, keys } = filesOf(fields, data, r.labels);
    return {
      id: r.id,
      form: formId,
      formName: String(r.form_name ?? info?.def.name ?? ""),
      formDeleted: info === undefined || info.deleted,
      page,
      answers: answersForDisplay(fields, data, r.labels)
        .filter((a) => !keys.has(a.id))
        .map((a) => ({
          label: a.label,
          value: a.value,
        })),
      files,
      newsletter: own(data, "_newsletter") === true,
      email: emailOf(fields, data),
      contact:
        typeof r.contact === "string" && r.contact !== "" ? r.contact : null,
      spam: r.spam === true,
      isTest: r.is_test === true,
      readAt:
        typeof r.read_at === "string" && r.read_at !== "" ? r.read_at : null,
      created: String(r.created ?? ""),
    };
  });
}

/** Mark read or unread (content read, choice 11). */
export function setSubmissionRead(
  ctx: OrgContext,
  id: string,
  read: boolean,
): Promise<void> {
  return runFormsRead(ctx, async (pb) => {
    const r = await scopedGet(pb, ctx, SUBMISSIONS, id);
    await pb
      .collection(SUBMISSIONS)
      .update(r.id, { read_at: read === true ? new Date().toISOString() : "" });
  });
}

/** True when the caller passes the contacts write gate (WR-A07). */
function mayWriteContacts(ctx: OrgContext): boolean {
  try {
    requirePermission(ctx, "contacts", "write");
    return true;
  } catch (err) {
    if (err instanceof Forbidden || err instanceof ImpersonationDenied) {
      return false;
    }
    throw err;
  }
}

/**
 * Move a message out of Filtered and save its sender as a Contact (no email, choice 12). The
 * contact touch needs contacts write too (WR-A07); an Editor only clears the flag.
 */
export async function markNotSpam(ctx: OrgContext, id: string): Promise<void> {
  const found = await run(ctx, async (pb) => {
    const r = await scopedGet(pb, ctx, SUBMISSIONS, id);
    await commit(
      pb,
      ctx,
      [
        {
          collection: SUBMISSIONS,
          op: "update",
          id: r.id,
          body: { spam: false },
        },
      ],
      {
        action: `${SUBMISSIONS}.not_spam`,
        targetCollection: SUBMISSIONS,
        targetId: r.id,
      },
    );
    if (r.spam !== true) return null;
    const formId = typeof r.form === "string" ? r.form : "";
    const formRow =
      formId === ""
        ? null
        : await scopedGet(pb, ctx, FORMS, formId).catch(() => null);
    return { r, def: formRow ? formFromRow(formRow) : null, formId };
  });
  if (!found) return;
  if (!mayWriteContacts(ctx)) return;
  const { r, def, formId } = found;
  const fields = def?.fields ?? [];
  const data = isBag(r.data) ? r.data : {};
  const email = emailOf(fields, data);
  if (email === null) return;
  const name = firstOfType(fields, data, "name");
  const phone = firstOfType(fields, data, "phone");
  const formName = String(r.form_name ?? def?.name ?? "");
  const ticked = own(data, "_newsletter") === true;
  const { contactId } = await touchContact(ctx.orgId, {
    email,
    ...(name !== null ? { name } : {}),
    ...(phone !== null ? { phone } : {}),
    source: "form",
    ref: r.id,
    summary: `Sent the ${formName} form`,
    ...(ticked
      ? {
          consent: {
            wording:
              def && def.newsletter_wording !== ""
                ? def.newsletter_wording
                : DEFAULT_NEWSLETTER_WORDING,
            ...(formId !== "" ? { form: formId } : {}),
          },
        }
      : {}),
  });
  await withSuperuser((pb) =>
    pb.collection(SUBMISSIONS).update(r.id, { contact: contactId }),
  );
}

export async function deleteSubmission(
  ctx: OrgContext,
  id: string,
): Promise<void> {
  const gone = await run(ctx, async (pb) => {
    const r = await scopedGet(pb, ctx, SUBMISSIONS, id);
    await commit(
      pb,
      ctx,
      [{ collection: SUBMISSIONS, op: "delete", id: r.id }],
      {
        action: `${SUBMISSIONS}.delete`,
        targetCollection: SUBMISSIONS,
        targetId: r.id,
      },
    );
    const data = isBag(r.data) ? r.data : {};
    const hasFiles = Object.values(data).some(isFileAnswer);
    return hasFiles && typeof r.form === "string" && r.form !== ""
      ? { form: r.form, id: r.id }
      : null;
  });
  // D234: files are kept until the submission is deleted. After the row is gone, so a failed
  // delete never leaves a message whose files vanished; a leftover object is logged by id.
  if (gone) {
    try {
      await deleteFormFiles(ctx.orgId, gone.form, gone.id);
    } catch {
      console.error(`[forms] file delete failed for submission ${gone.id}`);
    }
  }
}

function slugOf(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s === "" ? "form" : s;
}

/**
 * One form's messages (spam excluded) as CSV (choice 15): Received, one column per current
 * field, then columns for answers whose field no longer exists, then Newsletter.
 */
export function exportSubmissionsCsv(
  ctx: OrgContext,
  formId: string,
): Promise<{ filename: string; csv: string }> {
  return runFormsRead(ctx, async (pb) => {
    const formRow = await scopedGet(pb, ctx, FORMS, formId);
    const def = formFromRow(formRow);
    const subs = await pb.collection(SUBMISSIONS).getFullList({
      filter: pb.filter(
        "organization = {:org} && form = {:form} && spam = false",
        { org: ctx.orgId, form: formRow.id },
      ),
      sort: "created,id",
    });
    const fields = def.fields.filter((f) => !DISPLAY_TYPES.has(f.type));
    const current = new Set(fields.map((f) => f.id));
    const orphans: { id: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const s of subs) {
      const data = isBag(s.data) ? s.data : {};
      const labels = isBag(s.labels) ? s.labels : {};
      for (const key of Object.keys(data)) {
        if (key.startsWith("_") || current.has(key) || seen.has(key)) continue;
        seen.add(key);
        const l = own(labels, key);
        orphans.push({
          id: key,
          label: typeof l === "string" && l !== "" ? l : key,
        });
      }
    }
    const header = [
      "Received",
      ...fields.map((f) => f.label),
      ...orphans.map((o) => o.label),
      "Newsletter",
    ];
    const rows = subs.map((s) => {
      const data = isBag(s.data) ? s.data : {};
      const created = new Date(String(s.created ?? "").replace(" ", "T"));
      return [
        Number.isNaN(created.getTime()) ? "" : created.toISOString(),
        ...fields.map((f) => formatAnswer(f, own(data, f.id))),
        ...orphans.map((o) => formatAnswer(null, own(data, o.id))),
        own(data, "_newsletter") === true ? "Agreed" : "",
      ];
    });
    const day = new Date().toISOString().slice(0, 10);
    return {
      filename: `${slugOf(def.name)}-messages-${day}.csv`,
      csv: serializeCsv(header, rows),
    };
  });
}
