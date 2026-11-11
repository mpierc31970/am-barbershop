// CDS notes and shared documents (12-16; COMM-02, COMM-04; T-12-16-01..03).
//
// Staff writes (`cds_post`): a note (pinned or dated) or a document goes to one org. The org
// must exist (NotFound), the row and its audit row (organization = that org, staff actor)
// commit in one batch, then `notifySupport` raises `cds.note` / `cds.document` for the org's
// members. A failed alert is logged by class name and never undoes the post. Removal is soft
// (`removed_at`), audited, and scoped to the org named by the caller.
//
// Tenant reads (`support:read`): org filter and `removed_at = ''` live in the pb.filter
// string. Projections never carry `created_by`, `shared_by` or `object_key`. Unread state is
// per person from `member_prefs.support_read`, under two reserved keys (see READ_KEYS).
import { InvalidInput, NotFound, authorizeStaff, can } from "@cds/core";
import type { CdsDocument, CdsNote } from "@cds/core/support";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import {
  assertOrgContext,
  assertPlatformContext,
  type OrgContext,
  type PlatformContext,
} from "../context";
import type { EmailTransport } from "../email/transport";
import { assertId, newRecordId, requirePermission } from "../repository";
import { getObjectStore, type ObjectStore } from "../storage";
import {
  SUPPORT_READ_DOCUMENTS_KEY,
  SUPPORT_READ_NOTES_KEY,
  readSupportRead,
  recordSupportRead,
} from "../today/prefs";
import { staffStoreCdsDocumentObject } from "./files";
import { CONVERSATION_HREF } from "./messages";
import { notifySupport, type SupportNotifyDeps } from "./notify";
import { errName, staffFirstName } from "./shared";

const NOTES = "cds_notes";

/** Note title and body limits (P12-P5; the 12-02 migration). */
export const CDS_NOTE_TITLE_MAX = 80;
export const CDS_NOTE_BODY_MAX = 5000;
/** At most this many notes are listed (pinned and earlier together). */
export const CDS_NOTES_LIST_MAX = 200;
/** The From CDS card shows at most 3 lines and 280 characters of a note. */
export const FROM_CDS_NOTE_LINES = 3;
export const FROM_CDS_NOTE_CHARS = 280;

/** Reserved `support_read` keys (defined in today/prefs.ts, which never evicts them). */
export { SUPPORT_READ_DOCUMENTS_KEY, SUPPORT_READ_NOTES_KEY };

export type NotesClock = { now(): Date };
const SYSTEM_CLOCK: NotesClock = { now: () => new Date() };

export type StaffNotesDeps = {
  clock?: NotesClock;
  transport?: EmailTransport;
  push?: SupportNotifyDeps["push"];
  types?: SupportNotifyDeps["types"];
};

/** A note as the hub lists it. */
export type CdsNoteItem = CdsNote & { unread: boolean };

export type CdsNotesList = {
  /** Pinned notes, newest first. */
  pinned: CdsNoteItem[];
  /** Dated (unpinned) notes, newest first ("Earlier notes"). */
  earlier: CdsNoteItem[];
};

/** The pinned note the Today From CDS card shows (12-29). */
export type FromCdsNote = {
  id: string;
  title: string;
  /** At most 3 lines and 280 characters. */
  text: string;
  created: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function nowOf(clock: NotesClock | undefined): Date {
  const d = (clock ?? SYSTEM_CLOCK).now();
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new InvalidInput("now must be a valid date");
  }
  return d;
}

function text(
  v: unknown,
  what: string,
  max: number,
  required: boolean,
): string {
  if (v !== undefined && v !== null && typeof v !== "string") {
    throw new InvalidInput(`${what} must be text`);
  }
  const t = str(v).trim();
  if (required && t.length === 0) throw new InvalidInput(`${what} is required`);
  if (t.length > max) {
    throw new InvalidInput(`${what} must be at most ${max} characters`);
  }
  return t;
}

/** PocketBase dates ("2026-10-12 15:00:00.000Z") and ISO strings, as epoch ms (NaN if bad). */
function msOf(v: string): number {
  return Date.parse(v.includes(" ") ? v.replace(" ", "T") : v);
}

function isUnread(created: string, readAt: string | undefined): boolean {
  if (!readAt) return true;
  const c = msOf(created);
  const r = msOf(readAt);
  if (Number.isNaN(c) || Number.isNaN(r)) return true;
  return c > r;
}

async function businessName(pb: PocketBase, orgId: string): Promise<string> {
  const org = await pb
    .collection("organizations")
    .getOne(orgId, { fields: "id,name" })
    .catch(() => {
      throw new NotFound();
    });
  return str(org.name) || "your site";
}

/** The row only when it is this org's (another org's id is the same NotFound). */
async function loadScoped(
  pb: PocketBase,
  collection: string,
  orgId: string,
  id: unknown,
): Promise<RecordModel> {
  if (typeof id !== "string" || !/^[a-z0-9]{15}$/.test(id))
    throw new NotFound();
  return pb
    .collection(collection)
    .getFirstListItem(
      pb.filter("id = {:id} && organization = {:org}", { id, org: orgId }),
    )
    .catch(() => {
      throw new NotFound();
    });
}

function readGuard(ctx: OrgContext): void {
  requirePermission(ctx, "support", "read");
}

// ---------------------------------------------------------------------------------------
// Notes: staff

/**
 * Posts a CDS note to one org (`cds_post`): title 1-80, body 1-5,000, pinned or dated. The
 * author name is the staff member's first name. Audited `support.note_posted` with the org;
 * raises `cds.note` ("New note from CDS: {title}", 300-character email excerpt) for the org's
 * members. `raised` is the number of bell rows.
 */
export async function staffPostNote(
  ctx: PlatformContext,
  input: { orgId: string; title: string; body: string; pinned?: boolean },
  deps: StaffNotesDeps = {},
): Promise<{ id: string; raised: number }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "cds_post");
  assertId(input?.orgId);
  const title = text(input.title, "title", CDS_NOTE_TITLE_MAX, true);
  const body = text(input.body, "body", CDS_NOTE_BODY_MAX, true);
  const pinned = input.pinned === true;
  const now = nowOf(deps.clock);
  const orgId = input.orgId;

  const posted = await withSuperuser(async (pb) => {
    const business = await businessName(pb, orgId);
    const authorName = await staffFirstName(pb, ctx.actor);
    const id = newRecordId();
    const batch = pb.createBatch();
    batch.collection(NOTES).create({
      id,
      organization: orgId,
      title,
      body,
      pinned,
      created_by: ctx.actor,
      author_name: authorName,
      removed_at: "",
    });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "support.note_posted",
        organization: orgId,
        targetCollection: NOTES,
        targetId: id,
        meta: { pinned, title },
      }),
    );
    await batch.send();
    return { id, business, authorName };
  });

  let raised = 0;
  try {
    const r = await notifySupport(
      {
        orgId,
        as: ctx,
        type: "cds.note",
        title: `New note from CDS: ${title}`,
        href: CONVERSATION_HREF,
        excerpt: body.slice(0, 300),
        authorFirstName: posted.authorName,
        businessName: posted.business,
        itemTitle: title,
      },
      { now, transport: deps.transport, push: deps.push, types: deps.types },
    );
    raised = r.raised;
  } catch (err) {
    // The note is saved; a failed alert never undoes it.
    console.error(`[support] cds.note alert failed ${errName(err)}`);
  }
  return { id: posted.id, raised };
}

/** Soft-removes one of the org's notes (`cds_post`); audited `support.note_removed`. */
export async function staffRemoveNote(
  ctx: PlatformContext,
  input: { orgId: string; id: string },
  clock: NotesClock = SYSTEM_CLOCK,
): Promise<void> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "cds_post");
  assertId(input?.orgId);
  const now = nowOf(clock);
  await withSuperuser(async (pb) => {
    const row = await loadScoped(pb, NOTES, input.orgId, input.id);
    if (str(row.removed_at) !== "") return;
    const batch = pb.createBatch();
    batch.collection(NOTES).update(row.id, { removed_at: now.toISOString() });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "support.note_removed",
        organization: input.orgId,
        targetCollection: NOTES,
        targetId: row.id,
        meta: { title: str(row.title) },
      }),
    );
    await batch.send();
  });
}

// ---------------------------------------------------------------------------------------
// Notes: tenant

function toNote(row: RecordModel, readAt: string | undefined): CdsNoteItem {
  const created = str(row.created);
  return {
    id: row.id,
    title: str(row.title),
    body: str(row.body),
    pinned: row.pinned === true,
    authorName: str(row.author_name) || "CDS",
    created,
    updated: str(row.updated),
    unread: isUnread(created, readAt),
  };
}

async function liveNotes(
  pb: PocketBase,
  orgId: string,
  extra = "",
  limit = CDS_NOTES_LIST_MAX,
): Promise<RecordModel[]> {
  const res = await pb.collection(NOTES).getList(1, limit, {
    filter:
      pb.filter("organization = {:org} && removed_at = ''", { org: orgId }) +
      extra,
    sort: "-created,-id",
    skipTotal: true,
  });
  return res.items;
}

/**
 * The org's notes for the Messages tab (`support:read`): pinned and earlier, newest first,
 * removed ones hidden. `unread` compares each note with when this person last opened them.
 */
export async function listCdsNotes(ctx: OrgContext): Promise<CdsNotesList> {
  readGuard(ctx);
  const [rows, read] = await Promise.all([
    withSuperuser((pb) => liveNotes(pb, ctx.orgId)),
    readSupportRead(ctx),
  ]);
  const readAt = read[SUPPORT_READ_NOTES_KEY];
  const out: CdsNotesList = { pinned: [], earlier: [] };
  for (const row of rows) {
    const note = toNote(row, readAt);
    (note.pinned ? out.pinned : out.earlier).push(note);
  }
  return out;
}

/** Records that this person has seen the notes (no-op when impersonating or for a job). */
export async function markNotesRead(
  ctx: OrgContext,
  now: Date = new Date(),
): Promise<void> {
  readGuard(ctx);
  await recordSupportRead(ctx, SUPPORT_READ_NOTES_KEY, now);
}

function cardText(body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  let t = lines.slice(0, FROM_CDS_NOTE_LINES).join("\n").trimEnd();
  const cut =
    lines.length > FROM_CDS_NOTE_LINES || t.length > FROM_CDS_NOTE_CHARS;
  if (t.length > FROM_CDS_NOTE_CHARS - 1) {
    t = t.slice(0, FROM_CDS_NOTE_CHARS - 1).trimEnd();
  }
  return cut ? `${t}…` : t;
}

/**
 * The newest non-removed pinned note for the From CDS card, or null. A role without
 * `support:read` (grants-only) gets null rather than an error, so Today never breaks.
 */
export async function pinnedNoteForFromCds(
  ctx: OrgContext,
): Promise<FromCdsNote | null> {
  assertOrgContext(ctx);
  if (!can(ctx, "support", "read")) return null;
  const rows = await withSuperuser((pb) =>
    liveNotes(pb, ctx.orgId, " && pinned = true", 1),
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    title: str(row.title),
    text: cardText(str(row.body)),
    created: str(row.created),
  };
}

// ---------------------------------------------------------------------------------------
// Documents: staff

const DOCUMENTS = "cds_documents";

/** Document title and note limits (the 12-02 migration). */
export const CDS_DOCUMENT_TITLE_MAX = 120;
export const CDS_DOCUMENT_NOTE_MAX = 500;
/** Documents per page (Show more loads the next page). */
export const CDS_DOCUMENTS_PAGE = 50;
/** Where the Documents tab lives (the cds.document bell link). */
export const DOCUMENTS_HREF = "/hub/support?tab=documents";

export type StaffDocumentDeps = StaffNotesDeps & { store?: ObjectStore };

/** A shared document as the hub lists it (never the storage key or the staff id). */
export type CdsDocumentItem = CdsDocument & { unread: boolean };

/**
 * Shares a document with one org (`cds_post`): the object is stored by
 * `staffStoreCdsDocumentObject` (type and size rules; trusted, so no scan), then the row and
 * its audit row (`support.document_shared`, organization = the org) commit in one batch. A
 * failed batch removes the stored object. Raises `cds.document` ("CDS shared a document:
 * {title}"); the email never links to the file itself.
 */
export async function staffShareDocument(
  ctx: PlatformContext,
  input: {
    orgId: string;
    title: string;
    note?: string;
    filename: string;
    bytes: Uint8Array;
  },
  deps: StaffDocumentDeps = {},
): Promise<{ id: string; raised: number }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "cds_post");
  assertId(input?.orgId);
  const title = text(input.title, "title", CDS_DOCUMENT_TITLE_MAX, true);
  const note = text(input.note ?? "", "note", CDS_DOCUMENT_NOTE_MAX, false);
  if (typeof input.filename !== "string" || input.filename.trim() === "") {
    throw new InvalidInput("a file name is required");
  }
  if (!(input.bytes instanceof Uint8Array)) {
    throw new InvalidInput("file bytes are required");
  }
  const now = nowOf(deps.clock);
  const orgId = input.orgId;
  const id = newRecordId();
  const store = deps.store ?? getObjectStore();

  const { business, authorName } = await withSuperuser(async (pb) => ({
    business: await businessName(pb, orgId),
    authorName: await staffFirstName(pb, ctx.actor),
  }));

  const obj = await staffStoreCdsDocumentObject(
    ctx,
    { orgId, docId: id, name: input.filename, bytes: input.bytes },
    { store },
  );

  try {
    await withSuperuser(async (pb) => {
      const batch = pb.createBatch();
      batch.collection(DOCUMENTS).create({
        id,
        organization: orgId,
        title,
        note,
        // The only place the storage key is written; no projection returns it.
        object_key: obj.object_key,
        filename: obj.filename,
        size: obj.size,
        mime: obj.mime,
        ext: obj.ext,
        shared_by: ctx.actor,
        author_name: authorName,
        removed_at: "",
      });
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "support.document_shared",
          organization: orgId,
          targetCollection: DOCUMENTS,
          targetId: id,
          meta: { title, size: obj.size, ext: obj.ext },
        }),
      );
      await batch.send();
    });
  } catch (err) {
    await store.delete(obj.object_key).catch(() => undefined);
    throw err;
  }

  let raised = 0;
  try {
    const r = await notifySupport(
      {
        orgId,
        as: ctx,
        type: "cds.document",
        title: `CDS shared a document: ${title}`,
        href: DOCUMENTS_HREF,
        authorFirstName: authorName,
        businessName: business,
        itemTitle: title,
        documentId: id,
      },
      { now, transport: deps.transport, push: deps.push, types: deps.types },
    );
    raised = r.raised;
  } catch (err) {
    // The document is shared; a failed alert never undoes it.
    console.error(`[support] cds.document alert failed ${errName(err)}`);
  }
  return { id, raised };
}

/**
 * Soft-removes one of the org's documents (`cds_post`); audited `support.document_removed`.
 * The object stays (retention owns deletion); links stop working at once (12-07 checks
 * `removed_at`).
 */
export async function staffRemoveDocument(
  ctx: PlatformContext,
  input: { orgId: string; id: string },
  clock: NotesClock = SYSTEM_CLOCK,
): Promise<void> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "cds_post");
  assertId(input?.orgId);
  const now = nowOf(clock);
  await withSuperuser(async (pb) => {
    const row = await loadScoped(pb, DOCUMENTS, input.orgId, input.id);
    if (str(row.removed_at) !== "") return;
    const batch = pb.createBatch();
    batch
      .collection(DOCUMENTS)
      .update(row.id, { removed_at: now.toISOString() });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "support.document_removed",
        organization: input.orgId,
        targetCollection: DOCUMENTS,
        targetId: row.id,
        meta: { title: str(row.title) },
      }),
    );
    await batch.send();
  });
}

// ---------------------------------------------------------------------------------------
// Documents: tenant

function toDocument(
  row: RecordModel,
  readAt: string | undefined,
): CdsDocumentItem {
  const created = str(row.created);
  return {
    id: row.id,
    title: str(row.title),
    note: str(row.note),
    filename: str(row.filename),
    size: typeof row.size === "number" ? row.size : 0,
    mime: str(row.mime),
    authorName: str(row.author_name) || "CDS",
    created,
    unread: isUnread(created, readAt),
  };
}

/** The listed fields; `object_key` and `shared_by` are never read. */
const DOCUMENT_FIELDS = "id,title,note,filename,size,mime,author_name,created";

/**
 * Documents CDS shared with this org (`support:read`), newest first, removed ones hidden.
 * `limit` defaults to 50 (max 100); `before` is the `created` of the last row shown.
 */
export async function listCdsDocuments(
  ctx: OrgContext,
  opts: { limit?: number; before?: string; beforeId?: string } = {},
): Promise<CdsDocumentItem[]> {
  readGuard(ctx);
  const limit = Math.min(
    Math.max(Math.trunc(Number(opts.limit) || CDS_DOCUMENTS_PAGE), 1),
    100,
  );
  let before: string | null = null;
  if (typeof opts.before === "string" && opts.before !== "") {
    const ms = msOf(opts.before);
    if (Number.isNaN(ms)) throw new InvalidInput("invalid cursor");
    before = new Date(ms).toISOString().replace("T", " ");
  }
  // IN-C07 / 12-REVIEW IN-A02: (created, id) cursor so same-millisecond rows are not skipped.
  let beforeId: string | null = null;
  if (before && opts.beforeId !== undefined && opts.beforeId !== "") {
    if (
      typeof opts.beforeId !== "string" ||
      !/^[a-z0-9]{15}$/.test(opts.beforeId)
    ) {
      throw new InvalidInput("invalid cursor");
    }
    beforeId = opts.beforeId;
  }
  const [rows, read] = await Promise.all([
    withSuperuser(async (pb) => {
      let filter = pb.filter("organization = {:org} && removed_at = ''", {
        org: ctx.orgId,
      });
      if (before && beforeId) {
        filter +=
          " && " +
          pb.filter("(created < {:b} || (created = {:b} && id < {:id}))", {
            b: before,
            id: beforeId,
          });
      } else if (before) {
        filter += " && " + pb.filter("created < {:b}", { b: before });
      }
      const res = await pb.collection(DOCUMENTS).getList(1, limit, {
        filter,
        sort: "-created,-id",
        fields: DOCUMENT_FIELDS,
        skipTotal: true,
      });
      return res.items;
    }),
    readSupportRead(ctx),
  ]);
  const readAt = read[SUPPORT_READ_DOCUMENTS_KEY];
  return rows.map((r) => toDocument(r, readAt));
}

/** Records that this person has seen the documents (no-op when impersonating or for a job). */
export async function markDocumentsRead(
  ctx: OrgContext,
  now: Date = new Date(),
): Promise<void> {
  readGuard(ctx);
  await recordSupportRead(ctx, SUPPORT_READ_DOCUMENTS_KEY, now);
}
