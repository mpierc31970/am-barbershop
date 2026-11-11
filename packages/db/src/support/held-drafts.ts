// P12 held drafts (12-13; COMM-11; D102 mid-edit). When a member's save hits TargetLocked
// (a CDS service window covers the page, site part or add-on), the editor parks the pending
// change here instead of losing it. After the window ends the person applies it (re-run
// through the SAME writer the editor would have called, so every validation, scan and audit
// runs again; it lands as the draft) or discards it with a 30 s undo (P12-P9).
//
// - Per person (ownerField `user`, personal): every read and write is bound to
//   `organization = ctx.orgId && user = ctx.actor`. Nobody, the Owner included, sees a
//   colleague's held change; a foreign id is NotFound (T-12-13-02).
// - Permission: the original writer's (content write for section / page / site_part,
//   `addon:<slug>` write for add-on records; renters refused). Impersonated staff are refused
//   (staff bypass the lock anyway) and system jobs hold nothing.
// - Size: payload ≤ 256 KB of JSON; one live held draft per (person, kind, ref), so a new
//   hold of an existing item replaces the older one (a new, unsaved item gets its own ref and
//   is never replaced, 12-REVIEW WR-A02); drafts older than 30 days are pruned (T-12-13-03).
// - The stored lock target is derived here from the payload, never taken from the caller.
import {
  Forbidden,
  ImpersonationDenied,
  InvalidInput,
  NotFound,
  TargetLocked,
} from "@cds/core";
import type { WriteTarget } from "@cds/core/support";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { addonRepo } from "../addons/addon-repo";
import type { AddonDeps } from "../addons/types";
import { withSuperuser } from "../client";
import { saveFooter } from "../content/chrome/footer";
import { saveNav } from "../content/chrome/nav";
import { saveSiteSettings } from "../content/chrome/settings";
import { withOrgLock } from "../content/lock";
import { updatePage } from "../content/pages";
import type { ContentDeps } from "../content/ports";
import {
  saveSection,
  type SaveSectionInput,
  type SectionAddonOwners,
} from "../content/sections";
import { saveBanner } from "../content/site-settings";
import { assertOrgContext, type OrgContext } from "../context";
import type { ObjectStore } from "../storage";
import {
  assertId,
  mapError,
  newRecordId,
  requirePermission,
} from "../repository";
import { assertNotLocked, lockClockNow } from "./lock";
import { errName } from "./shared";

const COLLECTION = "held_drafts";

/** Largest held payload (JSON bytes). */
export const HELD_DRAFT_MAX_BYTES = 256 * 1024;
/** A held draft older than this is gone (UI-SPEC 595-608 step 3). */
export const HELD_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Discard undo window (P12-P9: 8 s toast plus grace). */
export const HELD_DRAFT_UNDO_MS = 30_000;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLLECTION_RE = /^[a-z][a-z0-9_]{0,62}$/;
const REF_MAX = 40;
const LIST_MAX = 200;
const PRUNE_BATCH = 200;

export type HeldDraftKind = "section" | "page" | "site_part" | "addon_record";

/** The site_settings parts the site-part editors save (nav = Menus, banner/settings = Header). */
export type HeldSitePart = "nav" | "footer" | "banner" | "settings";

const PART_KEY: Readonly<Record<HeldSitePart, string>> = {
  nav: "menus",
  footer: "footer",
  banner: "header",
  settings: "header",
};

/**
 * What the editor was about to save (choice 1). Each shape is the argument of the writer
 * applyHeldDraft re-runs:
 * - section: `saveSection(ctx, registry, section)`
 * - page: `updatePage(ctx, pageId, page)`
 * - site_part: `saveNav` / `saveFooter` / `saveBanner` / `saveSiteSettings` (`value`)
 * - addon_record: `addonRepo(ctx, deps, slug).collection(collection).save(record)`
 */
export type HoldDraftInput =
  | { kind: "section"; section: Record<string, unknown> }
  | { kind: "page"; pageId: string; page: Record<string, unknown> }
  | { kind: "site_part"; part: HeldSitePart; value: unknown }
  | {
      kind: "addon_record";
      slug: string;
      collection: string;
      record: Record<string, unknown>;
    };

export type HeldDraftView = {
  id: string;
  kind: HeldDraftKind;
  ref: string;
  /** The lock target this change waits on. */
  target: WriteTarget;
  /** The parked change (the person's own input). */
  payload: Record<string, unknown>;
  /** When it was held ("Saved at 2:14 pm"). */
  savedAt: string;
  /** True while a service window still covers the target (apply would be refused). */
  locked: boolean;
};

type Prepared = {
  kind: HeldDraftKind;
  ref: string;
  target: WriteTarget;
  payload: Record<string, unknown>;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pbRun<T>(fn: (pb: PocketBase) => Promise<T>): Promise<T> {
  return withSuperuser(fn).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

/** Held drafts belong to a signed-in, un-impersonated member. */
function assertPerson(ctx: OrgContext): void {
  assertOrgContext(ctx);
  if (ctx.impersonator) {
    throw new ImpersonationDenied("staff edit through the lock directly");
  }
  if (ctx.systemJob || !ctx.actor) {
    throw new Forbidden("held changes belong to a signed-in person");
  }
}

/** The original writer's permission for this kind (choice 2). */
function requireWriter(ctx: OrgContext, kind: HeldDraftKind, slug = ""): void {
  if (kind === "addon_record") {
    requirePermission(ctx, `addon:${slug}`, "write");
    if (ctx.role === "renter") {
      throw new Forbidden("renter access needs an owner-scoped collection");
    }
    return;
  }
  requirePermission(ctx, "content", "write");
}

/**
 * The ref of a held change for an item that does not exist yet (12-REVIEW WR-A02): unique per
 * hold, so a second new section or add-on record is kept beside the first instead of
 * replacing it. Only edits of an existing id share a ref (and replace the older hold).
 */
function newItemRef(): string {
  return `new:${newRecordId()}`.slice(0, REF_MAX);
}

function prepare(raw: unknown): Prepared {
  if (!isRecord(raw)) throw new InvalidInput("held change must be an object");
  switch (raw.kind) {
    case "section": {
      const section = raw.section;
      if (!isRecord(section)) {
        throw new InvalidInput("section must be an object");
      }
      const pageId = section.pageId;
      assertId(pageId);
      const id = section.id;
      if (id !== undefined) assertId(id);
      return {
        kind: "section",
        // 12-REVIEW WR-A02: each new section is its own held change (never replaces another).
        ref: typeof id === "string" ? id : newItemRef(),
        target: { kind: "page", id: pageId as string },
        payload: { section },
      };
    }
    case "page": {
      assertId(raw.pageId);
      if (!isRecord(raw.page)) throw new InvalidInput("page must be an object");
      return {
        kind: "page",
        ref: raw.pageId as string,
        target: { kind: "page", id: raw.pageId as string },
        payload: { pageId: raw.pageId, page: raw.page },
      };
    }
    case "site_part": {
      const part = raw.part;
      if (
        typeof part !== "string" ||
        !Object.prototype.hasOwnProperty.call(PART_KEY, part)
      ) {
        throw new InvalidInput("unknown site part");
      }
      return {
        kind: "site_part",
        ref: part,
        target: { kind: "part", key: PART_KEY[part as HeldSitePart] },
        payload: { part, value: raw.value ?? null },
      };
    }
    case "addon_record": {
      const { slug, collection, record } = raw;
      if (typeof slug !== "string" || !SLUG_RE.test(slug) || slug.length > 40) {
        throw new InvalidInput("unknown add-on");
      }
      if (typeof collection !== "string" || !COLLECTION_RE.test(collection)) {
        throw new InvalidInput("unknown add-on collection");
      }
      if (!isRecord(record)) throw new InvalidInput("record must be an object");
      const id = record.id;
      if (id !== undefined) assertId(id);
      return {
        kind: "addon_record",
        // 12-REVIEW WR-A02: each new record is its own held change (never replaces another).
        ref: typeof id === "string" ? id : newItemRef(),
        target: { kind: "addon", slug },
        payload: { slug, collection, record },
      };
    }
    default:
      throw new InvalidInput("unknown held change kind");
  }
}

function toTarget(v: unknown): WriteTarget {
  if (isRecord(v)) {
    if (v.kind === "page" && typeof v.id === "string") {
      return { kind: "page", id: v.id };
    }
    if (v.kind === "part" && typeof v.key === "string") {
      return { kind: "part", key: v.key };
    }
    if (v.kind === "addon" && typeof v.slug === "string") {
      return { kind: "addon", slug: v.slug };
    }
  }
  return { kind: "content" };
}

function sameTarget(a: WriteTarget, b: WriteTarget): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function isLocked(
  pb: PocketBase,
  ctx: OrgContext,
  target: WriteTarget,
  now: Date,
): Promise<boolean> {
  try {
    await assertNotLocked(pb, ctx, [target], now);
    return false;
  } catch (err) {
    if (err instanceof TargetLocked) return true;
    throw err;
  }
}

function toView(r: RecordModel, locked: boolean): HeldDraftView {
  return {
    id: r.id,
    kind: r.kind as HeldDraftKind,
    ref: typeof r.ref === "string" ? r.ref : "",
    target: toTarget(r.target),
    payload: isRecord(r.payload) ? r.payload : {},
    savedAt: typeof r.created === "string" ? r.created : "",
    locked,
  };
}

/** The person's own row (discarded or not); foreign and absent are the same NotFound. */
async function ownRow(
  pb: PocketBase,
  ctx: OrgContext,
  id: string,
): Promise<RecordModel> {
  assertId(id);
  try {
    return await pb.collection(COLLECTION).getFirstListItem(
      pb.filter("id = {:id} && organization = {:org} && user = {:u}", {
        id,
        org: ctx.orgId,
        u: ctx.actor,
      }),
    );
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new NotFound();
    }
    throw err;
  }
}

function lockKey(ctx: OrgContext): string {
  return `held-drafts:${ctx.orgId}:${ctx.actor}`;
}

function expired(r: RecordModel, now: Date): boolean {
  const t = Date.parse(typeof r.created === "string" ? r.created : "");
  return Number.isFinite(t) && now.getTime() - t > HELD_DRAFT_TTL_MS;
}

// ---------------------------------------------------------------------------------------
// Public API.

/**
 * Park the change a locked save could not write (choice 2). Replaces this person's earlier
 * held draft for the same (kind, ref); a new item's ref is unique, so it never replaces one. Returns the stored draft with its lock state.
 */
export async function holdDraft(
  ctx: OrgContext,
  input: HoldDraftInput,
  now: Date = lockClockNow(),
): Promise<HeldDraftView> {
  assertPerson(ctx);
  const prepared = prepare(input);
  requireWriter(
    ctx,
    prepared.kind,
    prepared.target.kind === "addon" ? prepared.target.slug : "",
  );
  const json = JSON.stringify(prepared.payload);
  if (Buffer.byteLength(json, "utf8") > HELD_DRAFT_MAX_BYTES) {
    throw new InvalidInput("This change is too large to keep.");
  }
  return withOrgLock(lockKey(ctx), () =>
    pbRun(async (pb) => {
      // A held page must be one of this org's pages (a foreign page is NotFound).
      if (prepared.target.kind === "page") {
        try {
          await pb.collection("pages").getFirstListItem(
            pb.filter("id = {:id} && organization = {:org}", {
              id: prepared.target.id,
              org: ctx.orgId,
            }),
            { fields: "id" },
          );
        } catch (err) {
          if (err instanceof ClientResponseError && err.status === 404) {
            throw new NotFound();
          }
          throw err;
        }
      }
      const older = await pb.collection(COLLECTION).getFullList({
        filter: pb.filter(
          "organization = {:org} && user = {:u} && kind = {:k} && ref = {:r}",
          { org: ctx.orgId, u: ctx.actor, k: prepared.kind, r: prepared.ref },
        ),
        fields: "id",
      });
      const id = newRecordId();
      const batch = pb.createBatch();
      for (const o of older) batch.collection(COLLECTION).delete(o.id);
      batch.collection(COLLECTION).create({
        id,
        organization: ctx.orgId,
        user: ctx.actor,
        kind: prepared.kind,
        ref: prepared.ref,
        target: prepared.target,
        payload: prepared.payload,
        discarded_at: "",
      });
      await batch.send();
      const row = await ownRow(pb, ctx, id);
      return toView(row, await isLocked(pb, ctx, prepared.target, now));
    }),
  );
}

/**
 * The person's own held drafts (not discarded, not older than 30 days), newest first, each
 * with `locked` (choice 3). `target` narrows to one editor's target. Impersonated staff and
 * system jobs see none.
 */
export async function listHeldDrafts(
  ctx: OrgContext,
  opts: { target?: WriteTarget; now?: Date } = {},
): Promise<HeldDraftView[]> {
  assertOrgContext(ctx);
  if (ctx.impersonator || ctx.systemJob || !ctx.actor) return [];
  const now = opts.now ?? lockClockNow();
  return pbRun(async (pb) => {
    const res = await pb.collection(COLLECTION).getList(1, LIST_MAX, {
      filter: pb.filter(
        "organization = {:org} && user = {:u} && discarded_at = '' && created >= {:since}",
        {
          org: ctx.orgId,
          u: ctx.actor,
          since: new Date(now.getTime() - HELD_DRAFT_TTL_MS),
        },
      ),
      sort: "-created,-id",
    });
    const rows = res.items.filter(
      (r) => !opts.target || sameTarget(toTarget(r.target), opts.target),
    );
    const out: HeldDraftView[] = [];
    for (const r of rows) {
      out.push(toView(r, await isLocked(pb, ctx, toTarget(r.target), now)));
    }
    return out;
  });
}

/** Discard a held draft (soft, P12-P9): `undoDiscardHeldDraft` restores it within 30 s. */
export async function discardHeldDraft(
  ctx: OrgContext,
  id: string,
  now: Date = new Date(),
): Promise<{ id: string; discardedAt: string }> {
  assertPerson(ctx);
  return withOrgLock(lockKey(ctx), () =>
    pbRun(async (pb) => {
      const row = await ownRow(pb, ctx, id);
      if (row.discarded_at) {
        return { id: row.id, discardedAt: String(row.discarded_at) };
      }
      const discardedAt = now.toISOString();
      await pb
        .collection(COLLECTION)
        .update(row.id, { discarded_at: discardedAt });
      return { id: row.id, discardedAt };
    }),
  );
}

/** Undo a discard within 30 s; later (or for a draft that was never discarded) InvalidInput. */
export async function undoDiscardHeldDraft(
  ctx: OrgContext,
  id: string,
  now: Date = new Date(),
): Promise<HeldDraftView> {
  assertPerson(ctx);
  return withOrgLock(lockKey(ctx), () =>
    pbRun(async (pb) => {
      const row = await ownRow(pb, ctx, id);
      const at = Date.parse(
        typeof row.discarded_at === "string" ? row.discarded_at : "",
      );
      if (!Number.isFinite(at)) {
        throw new InvalidInput("These changes were not discarded.");
      }
      if (now.getTime() - at > HELD_DRAFT_UNDO_MS || expired(row, now)) {
        throw new InvalidInput("It is too late to undo this.");
      }
      // A newer hold for the same ref replaced this one: undo would bring back two.
      const newer = await pb.collection(COLLECTION).getList(1, 1, {
        filter: pb.filter(
          "organization = {:org} && user = {:u} && kind = {:k} && ref = {:r} && id != {:id}",
          {
            org: ctx.orgId,
            u: ctx.actor,
            k: row.kind,
            r: row.ref,
            id: row.id,
          },
        ),
        fields: "id",
      });
      if (newer.items.length > 0) {
        throw new InvalidInput("Newer changes replaced these.");
      }
      await pb.collection(COLLECTION).update(row.id, { discarded_at: "" });
      const fresh = await ownRow(pb, ctx, row.id);
      const target = toTarget(fresh.target);
      return toView(fresh, await isLocked(pb, ctx, target, now));
    }),
  );
}

/**
 * What applyHeldDraft hands the original writer: the editor's own ContentDeps (section
 * registry, invalidator, scanner, pinger), plus the section add-on owner lookup, the add-on
 * deps (add-on records only) and the object store (page address checks).
 */
export type HeldApplyDeps = ContentDeps & {
  sectionOwners?: SectionAddonOwners;
  addonDeps?: AddonDeps;
  store?: ObjectStore;
};

export type HeldApplyResult = {
  id: string;
  kind: HeldDraftKind;
  ref: string;
  target: WriteTarget;
  /** True when a screened writer (site parts, add-on records) held the text for review. */
  held: boolean;
};

/** Re-runs the writer the editor would have called (choice 4); every check runs again. */
async function replay(
  ctx: OrgContext,
  kind: HeldDraftKind,
  payload: Record<string, unknown>,
  deps: HeldApplyDeps,
): Promise<{ held: boolean }> {
  switch (kind) {
    case "section": {
      // saveSection: registry type, layout clamp, validation, sanitize, refs owned, one
      // hero, add-on active. Lands in the draft (has_unpublished_changes).
      await saveSection(
        ctx,
        deps.sections,
        payload.section as SaveSectionInput,
        deps.sectionOwners,
      );
      return { held: false };
    }
    case "page": {
      const page = isRecord(payload.page) ? payload.page : {};
      await updatePage(
        ctx,
        String(payload.pageId),
        page as Parameters<typeof updatePage>[2],
        deps.store,
      );
      return { held: false };
    }
    case "site_part": {
      const value = payload.value;
      switch (payload.part) {
        case "nav":
          return { held: (await saveNav(ctx, deps, value)).held };
        case "footer":
          return { held: (await saveFooter(ctx, deps, value)).held };
        case "banner":
          return { held: (await saveBanner(ctx, deps, value)).held };
        case "settings":
          await saveSiteSettings(ctx, deps, value);
          return { held: false };
        default:
          throw new InvalidInput("unknown site part");
      }
    }
    case "addon_record": {
      if (!deps.addonDeps) {
        throw new Error(
          "applyHeldDraft needs the add-on deps for add-on records",
        );
      }
      const repo = addonRepo(ctx, deps.addonDeps, String(payload.slug));
      const res = await repo
        .collection(String(payload.collection))
        .save(payload.record);
      return { held: res.held };
    }
    default:
      throw new InvalidInput("unknown held change kind");
  }
}

/**
 * Apply a held change after the window (choice 4). Refused with TargetLocked while a window
 * still covers the target. Re-runs the original writer, so validation, screening and audit run
 * again; a writer error (InvalidInput, NotFound, AddonNotActive, ...) keeps the held draft.
 * Sections and page settings land in the draft: nothing goes live, and the page's version
 * history still holds the version CDS left live, so it stays restorable. Deletes the held
 * draft once written.
 */
export async function applyHeldDraft(
  ctx: OrgContext,
  id: string,
  deps: HeldApplyDeps,
  now: Date = lockClockNow(),
): Promise<HeldApplyResult> {
  assertPerson(ctx);
  if (!deps || typeof deps.sections?.get !== "function") {
    throw new Error("applyHeldDraft needs the editor's content deps");
  }
  return withOrgLock(lockKey(ctx), async () => {
    const row = await pbRun((pb) => ownRow(pb, ctx, id));
    if (row.discarded_at || expired(row, now)) throw new NotFound();
    const kind = row.kind as HeldDraftKind;
    const target = toTarget(row.target);
    requireWriter(ctx, kind, target.kind === "addon" ? target.slug : "");
    const payload = isRecord(row.payload) ? row.payload : {};
    await pbRun((pb) => assertNotLocked(pb, ctx, [target], now));
    const { held } = await replay(ctx, kind, payload, deps);
    await pbRun(async (pb) => {
      try {
        await pb.collection(COLLECTION).delete(row.id);
      } catch (err) {
        // Written already; a leftover row is pruned or replaced later.
        console.error("[support] held draft cleanup failed:", errName(err));
      }
    });
    return {
      id: row.id,
      kind,
      ref: typeof row.ref === "string" ? row.ref : "",
      target,
      held,
    };
  });
}

/**
 * Job helper (12-31): deletes held drafts older than 30 days and discards older than the
 * 30 s undo window. Returns how many rows went.
 */
export async function jobPruneHeldDrafts(
  now: Date = new Date(),
): Promise<{ pruned: number }> {
  const oldBefore = new Date(now.getTime() - HELD_DRAFT_TTL_MS);
  const discardBefore = new Date(now.getTime() - HELD_DRAFT_UNDO_MS);
  return pbRun(async (pb) => {
    let pruned = 0;
    for (;;) {
      const res = await pb.collection(COLLECTION).getList(1, PRUNE_BATCH, {
        filter: pb.filter(
          "created < {:old} || (discarded_at != '' && discarded_at < {:gone})",
          { old: oldBefore, gone: discardBefore },
        ),
        fields: "id",
      });
      if (res.items.length === 0) break;
      let removed = 0;
      for (const r of res.items) {
        try {
          await pb.collection(COLLECTION).delete(r.id);
          removed += 1;
        } catch (err) {
          console.error("[support] held draft prune failed:", errName(err));
        }
      }
      pruned += removed;
      if (removed === 0 || res.items.length < PRUNE_BATCH) break;
    }
    return { pruned };
  });
}
