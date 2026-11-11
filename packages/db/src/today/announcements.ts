// P11 today/announcements (11-12; DASH-23; T-11-12-03): CDS-wide announcements for the
// From CDS card on Today. A platform collection (no tenant field), read with the superuser
// client: an announcement is active when `starts_at <= now` and `ends_at` is empty or later
// than now, and it targets the org's path or every path (empty `paths`). Newest start wins.
//
// Writes: super_admin only (`announce_set`). Setting one ends whatever is active at that
// moment, so at most one shows; clearing ends the current one. The row writes and their
// audit row commit in one batch. A link is https (no credentials) or a /hub/ path.
import { authorizeStaff, InvalidInput } from "@cds/core";
import { ADDON_PATHS, type AddonPath } from "@cds/core/addons";
import { isHubHref } from "@cds/core/today";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { assertPlatformContext, type PlatformContext } from "../context";
import { newRecordId } from "../repository";

export type ActiveAnnouncement = {
  id: string;
  title: string;
  body: string;
  /** "" when the announcement has no link. */
  href: string;
};

export type AnnouncementInput = {
  title: string;
  body?: string;
  href?: string;
  /** Defaults to now. */
  startsAt?: Date;
  /** Open-ended when omitted or null. */
  endsAt?: Date | null;
  /** Site paths it targets; empty or omitted = every path. */
  paths?: readonly AddonPath[];
};

export type AnnouncementClock = { now(): Date };

const COLLECTION = "platform_announcements";
const SYSTEM_CLOCK: AnnouncementClock = { now: () => new Date() };
const TITLE_MAX = 80;
const BODY_MAX = 280;
const HREF_MAX = 300;
const SCAN_MAX = 50;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function validDate(d: unknown, what: string): Date {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new InvalidInput(`${what} must be a valid date`);
  }
  return d;
}

/** https with a host and no credentials, or a relative /hub/ link. Anything else is refused. */
export function isSafeAnnouncementHref(href: string): boolean {
  if (href.length > HREF_MAX) return false;
  if (href.startsWith("/")) return isHubHref(href);
  if (/[\s\u0000-\u001f\u007f\\]/.test(href)) return false;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname.length > 0 &&
    url.username === "" &&
    url.password === "" &&
    href.toLowerCase().startsWith("https://")
  );
}

function validate(input: AnnouncementInput, now: Date) {
  const title = str(input.title).trim();
  if (title.length === 0 || title.length > TITLE_MAX) {
    throw new InvalidInput(`title must be 1-${TITLE_MAX} characters`);
  }
  const body = str(input.body ?? "").trim();
  if (body.length > BODY_MAX) {
    throw new InvalidInput(`body must be at most ${BODY_MAX} characters`);
  }
  const href = str(input.href ?? "").trim();
  if (href !== "" && !isSafeAnnouncementHref(href)) {
    throw new InvalidInput("link must be https:// or a /hub/ path");
  }
  const startsAt = validDate(input.startsAt ?? now, "startsAt");
  const endsAt =
    input.endsAt === undefined || input.endsAt === null
      ? null
      : validDate(input.endsAt, "endsAt");
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new InvalidInput("endsAt must be after startsAt");
  }
  const paths = [...new Set(input.paths ?? [])];
  for (const p of paths) {
    if (!(ADDON_PATHS as readonly string[]).includes(p)) {
      throw new InvalidInput("paths must be standard or studio");
    }
  }
  return { title, body, href, startsAt, endsAt, paths };
}

async function activeRows(pb: PocketBase, now: Date): Promise<RecordModel[]> {
  const res = await pb.collection(COLLECTION).getList(1, SCAN_MAX, {
    filter: pb.filter(
      "starts_at <= {:now} && (ends_at = '' || ends_at > {:now})",
      { now },
    ),
    sort: "-starts_at,-created,-id",
  });
  return res.items;
}

function pathsOf(row: RecordModel): string[] {
  return Array.isArray(row.paths)
    ? row.paths.filter((p): p is string => typeof p === "string")
    : [];
}

/** The announcement From CDS shows for this path at `now`, or null. */
export async function activeAnnouncement(
  now: Date,
  path: AddonPath,
): Promise<ActiveAnnouncement | null> {
  validDate(now, "now");
  const rows = await withSuperuser((pb) => activeRows(pb, now));
  for (const row of rows) {
    const paths = pathsOf(row);
    if (paths.length > 0 && !paths.includes(path)) continue;
    const href = str(row.href);
    return {
      id: row.id,
      title: str(row.title),
      body: str(row.body),
      // A stored link that no longer passes the guard is dropped, never rendered.
      href: href && isSafeAnnouncementHref(href) ? href : "",
    };
  }
  return null;
}

/** The console's view of the announcement showing now (13-37): any path, with its targeting. */
export type StaffAnnouncementView = ActiveAnnouncement & {
  /** Empty = every path. */
  paths: AddonPath[];
  startsAt: string;
  /** null = open-ended. */
  endsAt: string | null;
};

/**
 * The newest announcement active at `now` on any path, for Catalog › Announcement (13-37).
 * Both staff roles read it (`catalog_listings`); only super_admin may change it.
 */
export async function staffCurrentAnnouncement(
  ctx: PlatformContext,
  clock: AnnouncementClock = SYSTEM_CLOCK,
): Promise<StaffAnnouncementView | null> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "catalog_listings");
  const now = validDate(clock.now(), "now");
  const rows = await withSuperuser((pb) => activeRows(pb, now));
  const row = rows[0];
  if (!row) return null;
  const href = str(row.href);
  const endsAt = str(row.ends_at);
  return {
    id: row.id,
    title: str(row.title),
    body: str(row.body),
    href: href && isSafeAnnouncementHref(href) ? href : "",
    paths: pathsOf(row).filter((p): p is AddonPath =>
      (ADDON_PATHS as readonly string[]).includes(p),
    ),
    startsAt: str(row.starts_at),
    endsAt: endsAt === "" ? null : endsAt,
  };
}

/**
 * Publishes an announcement (super_admin, `announce_set`). Ends every announcement active at
 * `now` first, so only the new one shows. Audited `platform.announcement_set`.
 */
export async function setAnnouncement(
  ctx: PlatformContext,
  input: AnnouncementInput,
  clock: AnnouncementClock = SYSTEM_CLOCK,
): Promise<{ id: string; ended: string[] }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "announce_set");
  const now = validDate(clock.now(), "now");
  const v = validate(input, now);
  return withSuperuser(async (pb) => {
    const ended = (await activeRows(pb, now)).map((r) => r.id);
    const id = newRecordId();
    const batch = pb.createBatch();
    for (const old of ended) {
      batch.collection(COLLECTION).update(old, { ends_at: now.toISOString() });
    }
    batch.collection(COLLECTION).create({
      id,
      title: v.title,
      body: v.body,
      href: v.href,
      starts_at: v.startsAt.toISOString(),
      ends_at: v.endsAt ? v.endsAt.toISOString() : "",
      paths: v.paths,
      created_by: ctx.actor,
    });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "platform.announcement_set",
        organization: null,
        targetCollection: COLLECTION,
        targetId: id,
        meta: {
          title: v.title,
          href: v.href,
          paths: v.paths,
          startsAt: v.startsAt.toISOString(),
          endsAt: v.endsAt ? v.endsAt.toISOString() : null,
          ended,
        },
      }),
    );
    await batch.send();
    return { id, ended };
  });
}

/** Ends every announcement active now (super_admin, `announce_set`); audited. */
export async function clearAnnouncement(
  ctx: PlatformContext,
  clock: AnnouncementClock = SYSTEM_CLOCK,
): Promise<{ ended: string[] }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "announce_set");
  const now = validDate(clock.now(), "now");
  return withSuperuser(async (pb) => {
    const ended = (await activeRows(pb, now)).map((r) => r.id);
    if (ended.length === 0) return { ended };
    const batch = pb.createBatch();
    for (const old of ended) {
      batch.collection(COLLECTION).update(old, { ends_at: now.toISOString() });
    }
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "platform.announcement_cleared",
        organization: null,
        targetCollection: COLLECTION,
        targetId: ended[0] ?? "",
        meta: { ended },
      }),
    );
    await batch.send();
    return { ended };
  });
}
