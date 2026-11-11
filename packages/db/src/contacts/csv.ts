// Contacts spreadsheet import / export (CONTACTS-01, D120, D-UI-P7-22, D132; invariant 1;
// T-07-11-05..09). The P5 engine (@cds/core/csv) as intake/list-import.ts uses it:
//   - the text is capped and parsed server-side on BOTH preview and commit; commit re-plans
//     from the raw text (never a client plan) and refuses while any row has an error
//   - columns are matched (aliases or the owner's choice) and remapped to Name / Email / Phone /
//     Tags; the id column is always dropped, so email inside the caller's org is the only key
//   - additive only: adds and updates, never removes anyone (no Replace all), and never writes
//     newsletter consent (there is no consent column; a new row starts at "none")
//   - in-file duplicates merge by email (first row wins name / phone, tags are unioned); a
//     blank cell never clears a stored value; tags = stored + row + "Tag everyone"
//   - writes go in chunks of at most MAX_ADDON_BATCH - 1 ops, each with its own
//     `contacts.import` audit row (counts only, no PII). Chunked rather than refused: the import
//     is additive and keyed by email, so a re-run after a partial failure converges (D119)
// Formula injection: the engine strips its own guard on read and guards every cell on export.
import { InvalidInput } from "@cds/core";
import {
  exportCsv,
  fileError,
  formatCount,
  MAX_IMPORT_BYTES,
  parseCsv,
  planImport,
  templateCsv,
  toImportPreview,
  validateRows,
  type ImportPlan,
  type ImportPreview,
  type ValidatedRow,
} from "@cds/core/csv";
import type PocketBase from "pocketbase";
import { MAX_ADDON_BATCH, sendAudited } from "../addons/backups";
import { MAX_IMPORT_CHARS } from "../addons/import";
import type { Op } from "../content/shared";
import type { OrgContext } from "../context";
import { newRecordId, requirePermission } from "../repository";
import { scopedContacts } from "./contacts";
import {
  CONTACTS_EXPORT_CSV,
  CONTACTS_IMPORT_CSV,
  needsMatch,
  remapToCanonical,
  suggestContactColumns,
  type ContactColumnMapping,
} from "./csv-map";
import { ensureHouseList } from "./lists";
import { normalizeTags, readTags, TAGS_MAX, unionTags } from "./model";
import { projectContact, runContactsRead, runContactsWrite } from "./shared";
import { DEFAULT_SUMMARIES } from "./touch";

export type ContactImportOptions = {
  mapping?: ContactColumnMapping;
  /** One tag added to everyone in the file ("Spring fair 2026"). */
  tagAll?: string;
};

export type ContactImportHeader = {
  header: string[];
  /** First non-empty value per column, at most 60 characters. */
  examples: string[];
  suggested: ContactColumnMapping;
  needsMatch: boolean;
};

const EXAMPLE_MAX = 60;

function checkText(text: unknown): string {
  if (typeof text !== "string") {
    throw new InvalidInput(fileError("not_csv").message);
  }
  if (
    text.length > MAX_IMPORT_CHARS ||
    new TextEncoder().encode(text).length > MAX_IMPORT_BYTES
  ) {
    throw new InvalidInput(fileError("too_big").message);
  }
  return text;
}

function parsed(text: string): { header: string[]; rows: string[][] } {
  const p = parseCsv(text);
  if (!p.ok) throw new InvalidInput(p.error.message);
  return { header: p.header, rows: p.rows };
}

/** The CSV as it reaches the planner, plus the headers that were not imported. */
function readRows(
  text: string,
  opts: ContactImportOptions,
): { rows: ValidatedRow[]; ignored: string[] } {
  const file = parsed(checkText(text));
  const mapping = opts.mapping ?? suggestContactColumns(file.header);
  const canon = remapToCanonical(file, mapping);
  if (!canon.ok) throw new InvalidInput(canon.message);
  const v = validateRows(canon, CONTACTS_IMPORT_CSV);
  if (!v.ok) throw new InvalidInput(v.error.message);
  const ignored = file.header
    .filter((h, i) => mapping[i] === "skip" && h.trim() !== "")
    .map((h) => h.trim());
  return { rows: v.rows, ignored };
}

function tagAllOf(raw: unknown): string[] {
  if (raw === undefined || raw === null || raw === "") return [];
  if (typeof raw !== "string") throw new InvalidInput("Tags must be text.");
  return normalizeTags([raw]);
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const tooManyTags = (n: number) =>
  `Row ${n}: This contact would have more than ${TAGS_MAX} tags. Remove some.`;

/** Merge rows that share an email: first row wins name / phone where blank, tags unioned. */
function mergeInFile(rows: ValidatedRow[]): {
  rows: ValidatedRow[];
  merged: number;
} {
  const out: ValidatedRow[] = [];
  const byEmail = new Map<string, ValidatedRow>();
  let merged = 0;
  for (const row of rows) {
    const email = str(row.values.email);
    if (row.errors.length > 0 || email === "") {
      out.push(row);
      continue;
    }
    const first = byEmail.get(email);
    if (!first) {
      const copy: ValidatedRow = {
        ...row,
        values: { ...row.values },
        errors: [],
      };
      byEmail.set(email, copy);
      out.push(copy);
      continue;
    }
    merged++;
    if (str(first.values.name) === "" && str(row.values.name) !== "") {
      first.values.name = row.values.name;
    }
    if (str(first.values.phone) === "" && str(row.values.phone) !== "") {
      first.values.phone = row.values.phone;
    }
    first.values.tags = unionTags(
      readTags(first.values.tags),
      readTags(row.values.tags),
    );
  }
  return { rows: out, merged };
}

type Existing = {
  id: string;
  name: string;
  email: string;
  phone: string;
  tags: string[];
};

async function existingContacts(
  pb: PocketBase,
  orgId: string,
): Promise<Existing[]> {
  const recs = await pb.collection("contacts").getFullList({
    filter: pb.filter("organization = {:org}", { org: orgId }),
    fields: "id,name,email_norm,phone,tags",
    sort: "id",
  });
  return recs.map((r) => ({
    id: r.id,
    name: str(r.name),
    email: str(r.email_norm),
    phone: str(r.phone),
    tags: readTags(r.tags),
  }));
}

type ContactPlan = { plan: ImportPlan; merged: number; ignored: string[] };

async function planContacts(
  pb: PocketBase,
  ctx: OrgContext,
  text: string,
  opts: ContactImportOptions,
): Promise<ContactPlan> {
  const o = (opts ?? {}) as ContactImportOptions;
  const tagAll = tagAllOf(o.tagAll);
  const { rows: read, ignored } = readRows(text, o);
  const { rows, merged } = mergeInFile(read);
  const existing = await existingContacts(pb, ctx.orgId);
  const byEmail = new Map(existing.map((e) => [e.email, e]));
  // Additive pre-merge: a blank cell takes the stored value; tags only grow.
  for (const row of rows) {
    if (row.errors.length > 0) continue;
    const stored = byEmail.get(str(row.values.email));
    const tags = unionTags(
      stored?.tags ?? [],
      readTags(row.values.tags),
      tagAll,
    );
    if (tags.length > TAGS_MAX) {
      row.errors.push(tooManyTags(row.rowNumber));
      continue;
    }
    row.values = {
      name: str(row.values.name) || (stored?.name ?? ""),
      email: row.values.email,
      phone: str(row.values.phone) || (stored?.phone ?? ""),
      tags,
    };
  }
  const plan = planImport({
    rows,
    existing: existing.map((e) => ({
      id: e.id,
      values: { name: e.name, email: e.email, phone: e.phone, tags: e.tags },
    })),
    spec: CONTACTS_IMPORT_CSV,
    mode: "update",
  });
  return { plan, merged, ignored };
}

function titleOf(values: Record<string, unknown>): string {
  return str(values.name) || str(values.email);
}

function rowCopy(n: number): string {
  return n === 1
    ? "1 row needs fixing. Nothing is imported until every row is fixed."
    : `${formatCount(n)} rows need fixing. Nothing is imported until every row is fixed.`;
}

/** Step 2 (Match columns): the header, an example per column and the suggested matches. */
export function readContactImportHeader(
  ctx: OrgContext,
  text: unknown,
): Promise<ContactImportHeader> {
  requirePermission(ctx, "contacts", "write");
  return Promise.resolve().then(() => {
    const file = parsed(checkText(text));
    const examples = file.header.map((_, i) => {
      for (const row of file.rows) {
        const v = (row[i] ?? "").trim();
        if (v !== "") return v.slice(0, EXAMPLE_MAX);
      }
      return "";
    });
    return {
      header: file.header,
      examples,
      suggested: suggestContactColumns(file.header),
      needsMatch: needsMatch(file.header),
    };
  });
}

/** Step 3 (Check): counts, row errors and how many rows merged by email. */
export function previewContactImport(
  ctx: OrgContext,
  text: unknown,
  opts: ContactImportOptions = {},
): Promise<ImportPreview & { merged: number }> {
  // Preview is part of an import, so it needs write (as list-import.ts).
  return runContactsWrite(ctx, async (pb) => {
    const { plan, merged, ignored } = await planContacts(
      pb,
      ctx,
      checkText(text),
      opts,
    );
    return {
      ...toImportPreview(plan, CONTACTS_IMPORT_CSV, titleOf, ignored),
      merged,
    };
  });
}

/** Step 4: re-plan from the raw text and write it. Refuses while any row has an error. */
export function commitContactImport(
  ctx: OrgContext,
  text: unknown,
  opts: ContactImportOptions = {},
): Promise<{ added: number; updated: number }> {
  return runContactsWrite(ctx, async (pb) => {
    const { plan } = await planContacts(pb, ctx, checkText(text), opts);
    if (plan.counts.errors > 0) {
      throw new InvalidInput(rowCopy(plan.counts.errors));
    }
    const counts = { added: plan.counts.new, updated: plan.counts.updated };
    if (counts.added + counts.updated === 0) return counts;

    const house = await ensureHouseList(pb, ctx.orgId);
    const onHouse = new Set(
      (
        await pb.collection("contact_list_members").getFullList({
          filter: pb.filter("organization = {:org} && list = {:list}", {
            org: ctx.orgId,
            list: house,
          }),
          fields: "contact",
        })
      ).map((m) => str(m.contact)),
    );
    const at = new Date().toISOString();
    const event = (contact: string): Op => ({
      collection: "contact_events",
      op: "create",
      id: newRecordId(),
      body: {
        organization: ctx.orgId,
        contact,
        kind: "import",
        ref: "",
        summary: DEFAULT_SUMMARIES.import,
        at,
      },
    });
    const member = (contact: string): Op => ({
      collection: "contact_list_members",
      op: "create",
      id: newRecordId(),
      body: { organization: ctx.orgId, list: house, contact, added_at: at },
    });

    // One group per row, so a contact and its membership / event share a batch.
    const groups: Op[][] = [];
    for (const row of plan.rows) {
      const v = row.values;
      const fields = {
        name: str(v.name),
        phone: str(v.phone),
        tags: readTags(v.tags),
      };
      if (row.status === "new") {
        const id = newRecordId();
        const email = str(v.email);
        groups.push([
          {
            collection: "contacts",
            op: "create",
            id,
            body: {
              organization: ctx.orgId,
              email,
              email_norm: email,
              ...fields,
              first_source: "import",
              last_seen_at: at,
              marketing_consent: { status: "none" },
            },
          },
          member(id),
          event(id),
        ]);
      } else if (row.status === "updated" && row.id !== null) {
        const ops: Op[] = [
          { collection: "contacts", op: "update", id: row.id, body: fields },
        ];
        if (!onHouse.has(row.id)) ops.push(member(row.id));
        ops.push(event(row.id));
        groups.push(ops);
      }
    }

    const chunks: Op[][] = [];
    let current: Op[] = [];
    for (const g of groups) {
      if (current.length + g.length > MAX_ADDON_BATCH - 1) {
        chunks.push(current);
        current = [];
      }
      current.push(...g);
    }
    if (current.length > 0) chunks.push(current);
    for (let i = 0; i < chunks.length; i++) {
      await sendAudited(pb, ctx, chunks[i]!, {
        action: "contacts.import",
        targetCollection: "contacts",
        targetId: "",
        meta: { ...counts, chunk: i + 1, chunks: chunks.length },
      });
    }
    return counts;
  });
}

/** Every visible contact of the scoped list as CSV, sorted by name (contacts read). */
export function exportContactsCsv(
  ctx: OrgContext,
  opts: { list?: string } = {},
): Promise<string> {
  return runContactsRead(ctx, async (pb) => {
    const recs = await scopedContacts(pb, ctx, opts.list);
    return exportCsv(
      CONTACTS_EXPORT_CSV,
      recs.map(projectContact).map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        tags: c.tags,
        newsletter: c.consent.status,
        source: c.first_source,
        last_seen_at: c.last_seen_at,
        created: c.created,
      })),
    );
  });
}

/** The downloadable template: header row plus one example row. No org data. */
export function contactsCsvTemplate(): string {
  return templateCsv(CONTACTS_IMPORT_CSV);
}
