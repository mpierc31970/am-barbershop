// packages/db/src/staff/canned.ts (13-15): canned replies for the staff ticket composer
// (STAFF-09, D96; T-13-15-01, T-13-15-02). Platform collection `canned_replies` (migration
// 1790000871, 8 seeds). Any staff role lists, creates, edits, archives and restores; there is
// no delete (archived_at instead). Placeholders are checked against the closed allowlist at
// save (assertCannedPlaceholders) and again at insert (renderCanned in the composer, 13-41).
// Every write lands with its audit row in one batch.
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import { assertCannedPlaceholders, type CannedVars } from "@cds/core/staff";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { assertPlatformContext, type PlatformContext } from "../context";
import { newRecordId } from "../repository";
import { staffGetTicket } from "../support/staff-tickets";

const COLLECTION = "canned_replies";
const ID_RE = /^[a-z0-9]{15}$/;
export const CANNED_TITLE_MAX = 80;
export const CANNED_BODY_MAX = 5000;

export type StaffCannedReply = {
  id: string;
  title: string;
  body: string;
  archivedAt: string | null;
  created: string;
  updated: string;
};

export type StaffCannedInput = { id?: string; title: unknown; body: unknown };

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function toReply(r: RecordModel): StaffCannedReply {
  const archived = str(r.archived_at);
  return {
    id: r.id,
    title: str(r.title),
    body: str(r.body),
    archivedAt: archived === "" ? null : archived,
    created: str(r.created),
    updated: str(r.updated),
  };
}

function validId(id: unknown): string {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new NotFound("canned reply not found");
  }
  return id;
}

function validate(input: StaffCannedInput): { title: string; body: string } {
  const title = str(input.title).trim();
  const body = str(input.body).replace(/\r\n/g, "\n").trim();
  if (title === "") throw new InvalidInput("Give the reply a title.");
  if (title.length > CANNED_TITLE_MAX) {
    throw new InvalidInput(`Keep the title to ${CANNED_TITLE_MAX} characters.`);
  }
  if (body === "") throw new InvalidInput("Write the reply text.");
  if (body.length > CANNED_BODY_MAX) {
    throw new InvalidInput(`Keep the reply to ${CANNED_BODY_MAX} characters.`);
  }
  assertCannedPlaceholders(body);
  return { title, body };
}

async function loadReply(pb: PocketBase, id: string): Promise<RecordModel> {
  try {
    return await pb.collection(COLLECTION).getOne(id);
  } catch {
    throw new NotFound("canned reply not found");
  }
}

/** Canned replies sorted by title; archived ones only with `includeArchived`. */
export async function staffListCanned(
  ctx: PlatformContext,
  opts: { includeArchived?: boolean } = {},
): Promise<StaffCannedReply[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "canned_replies");
  return withSuperuser(async (pb) => {
    const rows = await pb.collection(COLLECTION).getFullList({
      ...(opts.includeArchived ? {} : { filter: "archived_at = ''" }),
      sort: "title,id",
    });
    return rows.map(toReply);
  });
}

/**
 * Create (no `id`) or edit one canned reply. Lengths 80 / 5000; unknown placeholders refused
 * (PLACEHOLDER-UNKNOWN). Sets created_by / updated_by to the staff id; audit `canned.saved`.
 */
export async function staffSaveCanned(
  ctx: PlatformContext,
  input: StaffCannedInput,
): Promise<StaffCannedReply> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "canned_replies");
  const v = validate(input);
  return withSuperuser(async (pb) => {
    const existing =
      input.id === undefined ? null : await loadReply(pb, validId(input.id));
    const id = existing?.id ?? newRecordId();
    const batch = pb.createBatch();
    if (existing) {
      batch
        .collection(COLLECTION)
        .update(id, { title: v.title, body: v.body, updated_by: ctx.actor });
    } else {
      batch.collection(COLLECTION).create({
        id,
        title: v.title,
        body: v.body,
        created_by: ctx.actor,
        updated_by: ctx.actor,
      });
    }
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "canned.saved",
        organization: null,
        targetCollection: COLLECTION,
        targetId: id,
        meta: { title: v.title, created: existing === null },
      }),
    );
    await batch.send();
    return toReply(await pb.collection(COLLECTION).getOne(id));
  });
}

async function setArchived(
  ctx: PlatformContext,
  id: unknown,
  archive: boolean,
  now: Date,
): Promise<StaffCannedReply> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "canned_replies");
  const rid = validId(id);
  return withSuperuser(async (pb) => {
    const row = await loadReply(pb, rid);
    const isArchived = str(row.archived_at) !== "";
    if (isArchived === archive) return toReply(row); // already there: no write, no audit
    const batch = pb.createBatch();
    batch.collection(COLLECTION).update(rid, {
      archived_at: archive ? now.toISOString() : "",
      updated_by: ctx.actor,
    });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: archive ? "canned.archived" : "canned.restored",
        organization: null,
        targetCollection: COLLECTION,
        targetId: rid,
        meta: { title: str(row.title) },
      }),
    );
    await batch.send();
    return toReply(await pb.collection(COLLECTION).getOne(rid));
  });
}

/** Hide a canned reply from the picker (never deleted); audit `canned.archived`. */
export async function staffArchiveCanned(
  ctx: PlatformContext,
  id: unknown,
  opts: { now?: Date } = {},
): Promise<StaffCannedReply> {
  return setArchived(ctx, id, true, opts.now ?? new Date());
}

/** Bring an archived reply back; audit `canned.restored`. */
export async function staffRestoreCanned(
  ctx: PlatformContext,
  id: unknown,
  opts: { now?: Date } = {},
): Promise<StaffCannedReply> {
  return setArchived(ctx, id, false, opts.now ?? new Date());
}

function firstWord(name: unknown, fallback: string): string {
  const w = str(name).trim().split(/\s+/)[0] ?? "";
  return w || fallback;
}

async function userName(pb: PocketBase, id: string | null): Promise<string> {
  if (!id || !ID_RE.test(id)) return "";
  try {
    return str(
      (await pb.collection("users").getOne(id, { fields: "id,name" })).name,
    );
  } catch {
    return "";
  }
}

/**
 * The values a canned reply fills for one ticket (`support_read`, via staffGetTicket):
 * filer's first name (else "there"; a CDS-opened ticket has no tenant filer), business name,
 * ticket number, and the calling staff member's first name (else "CDS").
 */
export async function staffCannedVarsFor(
  ctx: PlatformContext,
  ticketNumber: unknown,
  opts: { now?: Date } = {},
): Promise<CannedVars> {
  const ticket = await staffGetTicket(ctx, ticketNumber, opts);
  return withSuperuser(async (pb) => {
    const filer = ticket.openedBy.cds
      ? ""
      : await userName(pb, ticket.openedBy.userId);
    const agent = await userName(pb, ctx.actor);
    return {
      first_name: firstWord(filer, "there"),
      business: ticket.orgName,
      ticket: ticket.number,
      agent: firstWord(agent, "CDS"),
    };
  });
}
