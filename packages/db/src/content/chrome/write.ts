// The one upsert for site_settings parts (07-25; CONT-13, CONT-36; invariant 1, TEN-03;
// T-07-25-01, T-07-25-05). Internal: never exported from the chrome barrel.
//
// One site_settings row per organization (unique index). This is the find-or-create upsert
// of the org's own row, writing exactly one part. 07-26 adds the settings part (fields
// language, settings and seo; seo merged from the row read here so its other keys survive,
// 07-26 choice 1).
// 07-29: the snapshot hook lives in writeSiteSettingsPartIn; lock-free beneath every public
// writer. Every part (nav, footer, banner, settings) and every caller (saveNav, saveFooter,
// addPageToNav, saveSiteSettings, saveBanner, restore) is snapshotted here and only here.
import { storedSiteSettings, type SiteSettingsGroup } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { auditBody } from "../../audit";
import type { OrgContext } from "../../context";
import { newRecordId } from "../../repository";
import type { ObjectStore } from "../../storage";
import { writeSitePartSnapshot } from "../history/snapshot";
import { commit, run, type Op } from "../shared";

const COLLECTION = "site_settings";

export type SiteSettingsPart = "nav" | "footer" | "settings" | "banner";

type PartValue<P extends SiteSettingsPart> = P extends "settings"
  ? SiteSettingsGroup
  : unknown;

export type WritePartOpts = {
  /** Audit override (restore: site_settings.restore with { part, version }). */
  audit?: { action: string; meta?: Record<string, unknown> };
  /** More ops committed in the same batch (restore: undeleteOps for a CTA pop-up). */
  extraOps?: Op[];
  store?: ObjectStore;
  now?: () => Date;
};

function partBody(
  part: SiteSettingsPart,
  value: unknown,
  currentSeo: unknown,
): Record<string, unknown> {
  if (part === "settings") {
    return storedSiteSettings(value as SiteSettingsGroup, currentSeo);
  }
  return { [part]: value };
}

/** Upsert one part of the org's site_settings row; returns the row id. */
export function writeSiteSettingsPart<P extends SiteSettingsPart>(
  ctx: OrgContext,
  part: P,
  value: PartValue<P>,
): Promise<string> {
  return run(ctx, (pb) => writeSiteSettingsPartIn(pb, ctx, part, value));
}

/**
 * The same upsert for callers that already hold the org lock (run / withOrgLock is not
 * re-entrant): saveSiteSettings, saveBanner and restore. Snapshots the part after the
 * commit (best effort; never throws from the snapshot).
 */
export async function writeSiteSettingsPartIn<P extends SiteSettingsPart>(
  pb: PocketBase,
  ctx: OrgContext,
  part: P,
  value: PartValue<P>,
  opts: WritePartOpts = {},
): Promise<string> {
  const existing = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
  });
  const current = existing.items[0] as Record<string, unknown> | undefined;
  const meta = opts.audit?.meta;
  const id = current ? String(current.id) : newRecordId();
  // commit() audits only impersonated writes; an explicit audit (restore) is always
  // recorded, in the same batch (T-07-29-06).
  const extra: Op[] = [...(opts.extraOps ?? [])];
  if (opts.audit && !ctx.impersonator) {
    extra.push({
      collection: "audit_log",
      op: "create",
      id: newRecordId(),
      body: auditBody(ctx, {
        action: opts.audit.action,
        targetCollection: COLLECTION,
        targetId: id,
        ...(meta ? { meta } : {}),
      }),
    });
  }
  let body: Record<string, unknown>;
  if (current) {
    body = partBody(part, value, current.seo);
    await commit(
      pb,
      ctx,
      [{ collection: COLLECTION, op: "update", id, body }, ...extra],
      {
        action: opts.audit?.action ?? `${COLLECTION}.update`,
        targetCollection: COLLECTION,
        targetId: id,
        ...(meta ? { meta } : {}),
      },
    );
  } else {
    body = partBody(part, value, null);
    await commit(
      pb,
      ctx,
      [
        {
          collection: COLLECTION,
          op: "create",
          id,
          body: { organization: ctx.orgId, ...body },
        },
        ...extra,
      ],
      {
        action: opts.audit?.action ?? `${COLLECTION}.create`,
        targetCollection: COLLECTION,
        targetId: id,
        ...(meta ? { meta } : {}),
      },
    );
  }
  await writeSitePartSnapshot(
    ctx,
    part,
    current ?? null,
    { ...(current ?? {}), ...body },
    { store: opts.store, now: opts.now },
  );
  return id;
}
