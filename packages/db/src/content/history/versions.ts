// Site-part history: list and restore (07-29; CONT-36, D184, D187, D275; CONTEXT Area 5
// row 3; choices 8-12; invariant 1, TEN-03; T-07-29-01..10).
//
// Version ids, never keys, cross the browser boundary (choice 8): the id is the file stamp,
// checked against SITE_VERSION_ID_RE and rebuilt into a key for the caller's own org only.
// A restore writes exactly one part through the lock-free writeSiteSettingsPartIn under the
// one withOrgLock taken here, audited as site_settings.restore, and never refuses because a
// pop-up or page was deleted (D275 / 07-28): a soft-deleted CTA pop-up comes back in the same
// batch, a gone or foreign CTA target is dropped, links to gone pages stay (resolveNav skips
// them), links to another org's page are removed.
import { InvalidInput, NotFound } from "@cds/core";
import {
  parseNavTarget,
  resolveSiteSettings,
  validateBanner,
  validateFooter,
  validateNav,
  type BannerSettings,
  type FooterSettings,
  type NavLink,
  type NavSettings,
  type SiteSettingsGroup,
} from "@cds/core/content";
import type PocketBase from "pocketbase";
import { ClientResponseError } from "pocketbase";
import { withSuperuser } from "../../client";
import type { OrgContext } from "../../context";
import { mapError, requirePermission } from "../../repository";
import { fromSnapshotRecord, toSnapshot } from "../../snapshot";
import {
  assertValidKey,
  getObjectStore,
  SITE_HISTORY_PARTS,
  tenantSitePartVersionKey,
  type ObjectStore,
  type SiteHistoryPart,
} from "../../storage";
import { writeSiteSettingsPartIn } from "../chrome/write";
import { withOrgLock } from "../lock";
import { readJson } from "../manifest";
import type { ContentDeps } from "../ports";
import { afterLiveSave } from "../screen";
import type { Op } from "../shared";
import { promoteMedia } from "../../media/library/promote";
import { shareImageState } from "../seo/share-image";
import { undeleteOps } from "../soft-delete";
import {
  atOfVersionId,
  canonicalJson,
  parseEnvelope,
  pickPart,
  SITE_VERSION_ID_RE,
  versionIdOf,
} from "./parts";
import { listPartKeys, SITE_VERSIONS_KEPT } from "./snapshot";

const COLLECTION = "site_settings";
const MALFORMED = "This version is malformed.";

export type SiteVersionAuthor =
  | { kind: "member"; name: string }
  | { kind: "former" }
  | { kind: "support" }
  | { kind: "earlier" };

export type SiteVersion = {
  id: string;
  at: string;
  who: SiteVersionAuthor;
  current: boolean;
};

export type RestoredSitePart = (
  | { part: "nav"; value: NavSettings }
  | { part: "footer"; value: FooterSettings }
  | { part: "banner"; value: BannerSettings }
  | { part: "settings"; value: SiteSettingsGroup }
) & { at: string; dropped: number };

export type HistoryDeps = ContentDeps & {
  store?: ObjectStore;
  now?: () => Date;
};

function assertPart(part: unknown): asserts part is SiteHistoryPart {
  if (
    typeof part !== "string" ||
    !(SITE_HISTORY_PARTS as readonly string[]).includes(part)
  ) {
    throw new InvalidInput("Unknown history.");
  }
}

async function liveRow(
  pb: PocketBase,
  orgId: string,
): Promise<Record<string, unknown> | null> {
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org: orgId }),
  });
  return (res.items[0] as Record<string, unknown> | undefined) ?? null;
}

/**
 * Names of the org's current members among `actors` (one bound-param query, choice 9).
 * Shared with page history (11-25): an actor not in the map is a former member.
 */
export async function memberNames(
  pb: PocketBase,
  orgId: string,
  actors: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (actors.length === 0) return out;
  const ors = actors.map((u) => pb.filter("user = {:u}", { u }));
  const rows = await pb.collection("memberships").getFullList({
    filter:
      pb.filter("organization = {:org}", { org: orgId }) +
      " && (" +
      ors.join(" || ") +
      ")",
    expand: "user",
    fields: "user,expand.user.name,expand.user.email",
  });
  for (const r of rows) {
    const u = (
      r.expand as { user?: { name?: unknown; email?: unknown } } | undefined
    )?.user;
    const name =
      typeof u?.name === "string" && u.name.trim() !== ""
        ? u.name
        : typeof u?.email === "string"
          ? u.email
          : "";
    if (typeof r.user === "string") out.set(r.user, name);
  }
  return out;
}

/** The part's newest 10 versions, newest first (content read). */
export async function listSiteSettingsVersions(
  ctx: OrgContext,
  part: SiteHistoryPart,
  opts: { store?: ObjectStore } = {},
): Promise<SiteVersion[]> {
  requirePermission(ctx, "content", "read");
  assertPart(part);
  const store = opts.store ?? getObjectStore();
  return withSuperuser(async (pb) => {
    const row = await liveRow(pb, ctx.orgId);
    const live = canonicalJson(
      pickPart(part, row ? toSnapshot(COLLECTION, row) : null),
    );
    const keys = (await listPartKeys(store, ctx.orgId, part))
      .reverse()
      .slice(0, SITE_VERSIONS_KEPT);
    const entries: {
      id: string;
      at: string;
      by: { actor: string; staff: boolean } | null;
      same: boolean;
    }[] = [];
    for (const key of keys) {
      const id = versionIdOf(key);
      if (!id) continue;
      const env = parseEnvelope(await readJson(store, key).catch(() => null));
      if (!env || env.part !== part) continue;
      entries.push({
        id,
        at: atOfVersionId(id),
        by: env.by,
        same: canonicalJson(pickPart(part, env.row)) === live,
      });
    }
    const actors = [
      ...new Set(
        entries.flatMap((e) => (e.by && !e.by.staff ? [e.by.actor] : [])),
      ),
    ];
    const names = await memberNames(pb, ctx.orgId, actors);
    let currentGiven = false;
    return entries.map((e) => {
      const current = e.same && !currentGiven;
      if (current) currentGiven = true;
      let who: SiteVersionAuthor;
      if (e.by === null) who = { kind: "earlier" };
      else if (e.by.staff) who = { kind: "support" };
      else if (names.has(e.by.actor)) {
        who = { kind: "member", name: names.get(e.by.actor)! };
      } else who = { kind: "former" };
      return { id: e.id, at: e.at, who, current };
    });
  });
}

type RefRow = { id: string; organization: string; deleted_at: string };

/** Rows by id only (never by org), so ownership and soft-delete come from one read. */
async function rowsById(
  pb: PocketBase,
  collection: "pages" | "popups",
  ids: string[],
): Promise<Map<string, RefRow>> {
  const out = new Map<string, RefRow>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const filter = chunk
      .map((id, n) => pb.filter("id = {:i" + n + "}", { ["i" + n]: id }))
      .join(" || ");
    const rows = await pb.collection(collection).getFullList({
      filter,
      fields: "id,organization,deleted_at",
    });
    for (const r of rows) {
      out.set(r.id, {
        id: r.id,
        organization: String(r.organization ?? ""),
        deleted_at: String(r.deleted_at ?? ""),
      });
    }
  }
  return out;
}

function pageIdOf(target: string): string | null {
  const t = parseNavTarget(target);
  return t?.kind === "page" ? t.id : null;
}

/** Drop links to another org's page (children go with a dropped parent). */
function keepLink(
  link: NavLink,
  pages: Map<string, RefRow>,
  orgId: string,
): boolean {
  const id = pageIdOf(link.target);
  if (!id) return true;
  const row = pages.get(id);
  return !row || row.organization === orgId;
}

async function navRefPass(
  pb: PocketBase,
  ctx: OrgContext,
  nav: NavSettings,
): Promise<{ value: NavSettings; extraOps: Op[]; dropped: number }> {
  const pageIds: string[] = [];
  for (const item of nav.items) {
    const p = pageIdOf(item.target);
    if (p) pageIds.push(p);
    for (const c of item.children) {
      const cp = pageIdOf(c.target);
      if (cp) pageIds.push(cp);
    }
  }
  const ctaTarget = nav.cta ? parseNavTarget(nav.cta.target) : null;
  if (ctaTarget?.kind === "page") pageIds.push(ctaTarget.id);
  const pages = await rowsById(pb, "pages", pageIds);
  let dropped = 0;
  const items = nav.items
    .filter((item) => {
      const ok = keepLink(item, pages, ctx.orgId);
      if (!ok) dropped += 1;
      return ok;
    })
    .map((item) => ({
      ...item,
      children: item.children.filter((c) => {
        const ok = keepLink(c, pages, ctx.orgId);
        if (!ok) dropped += 1;
        return ok;
      }),
    }));
  let cta = nav.cta;
  const extraOps: Op[] = [];
  if (cta && ctaTarget?.kind === "popup") {
    const pop = (await rowsById(pb, "popups", [ctaTarget.id])).get(
      ctaTarget.id,
    );
    if (!pop || pop.organization !== ctx.orgId) {
      cta = null;
      dropped += 1;
    } else if (pop.deleted_at !== "") {
      extraOps.push(
        ...(await undeleteOps(pb, ctx, {
          popups: [pop.id],
          forms: [],
          media: [],
        })),
      );
    }
  } else if (cta && ctaTarget?.kind === "page") {
    const page = pages.get(ctaTarget.id);
    if (!page || page.organization !== ctx.orgId) {
      cta = null;
      dropped += 1;
    }
  } else if (cta && !ctaTarget) {
    cta = null;
    dropped += 1;
  }
  return { value: { ...nav, items, cta }, extraOps, dropped };
}

async function footerRefPass(
  pb: PocketBase,
  ctx: OrgContext,
  footer: FooterSettings,
): Promise<{ value: FooterSettings; dropped: number }> {
  const ids = footer.extra_links.flatMap((l) => {
    const p = pageIdOf(l.target);
    return p ? [p] : [];
  });
  const pages = await rowsById(pb, "pages", ids);
  let dropped = 0;
  const extra_links = footer.extra_links.filter((l) => {
    const ok = keepLink(l, pages, ctx.orgId);
    if (!ok) dropped += 1;
    return ok;
  });
  return { value: { ...footer, extra_links }, dropped };
}

function validatePart(
  part: SiteHistoryPart,
  fields: Record<string, unknown>,
): NavSettings | FooterSettings | BannerSettings | SiteSettingsGroup {
  try {
    switch (part) {
      case "nav":
        return validateNav(fields.nav);
      case "footer":
        return validateFooter(fields.footer);
      case "banner":
        return validateBanner(fields.banner);
      case "settings":
        return resolveSiteSettings({
          language: fields.language,
          settings: fields.settings,
          seo: fields.seo,
        });
    }
  } catch {
    throw new InvalidInput(MALFORMED);
  }
}

/** Restore one part from one of its versions (content write; audited; live at once). */
export async function restoreSiteSettingsVersion(
  ctx: OrgContext,
  deps: HistoryDeps,
  part: SiteHistoryPart,
  version: string,
): Promise<RestoredSitePart> {
  requirePermission(ctx, "content", "write");
  assertPart(part);
  if (typeof version !== "string" || !SITE_VERSION_ID_RE.test(version)) {
    throw new NotFound();
  }
  const at = atOfVersionId(version);
  if (Number.isNaN(Date.parse(at))) throw new NotFound();
  let key: string;
  try {
    key = tenantSitePartVersionKey(ctx.orgId, part, new Date(at));
    assertValidKey(key);
  } catch {
    throw new NotFound();
  }
  if (versionIdOf(key) !== version) throw new NotFound();
  const store = deps.store ?? getObjectStore();

  let restoredShare = "";
  const { id, value, dropped } = await withOrgLock(ctx.orgId, () =>
    withSuperuser(async (pb) => {
      const bytes = await store.get(key);
      if (!bytes) throw new NotFound();
      let raw: unknown;
      try {
        raw = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new InvalidInput(MALFORMED);
      }
      const env = parseEnvelope(raw);
      if (!env || env.part !== part) throw new InvalidInput(MALFORMED);
      const fields = pickPart(part, fromSnapshotRecord(COLLECTION, env.row));
      let next = validatePart(part, fields);
      let extraOps: Op[] = [];
      let dropped = 0;
      if (part === "nav") {
        const r = await navRefPass(pb, ctx, next as NavSettings);
        next = r.value;
        extraOps = r.extraOps;
        dropped = r.dropped;
      } else if (part === "footer") {
        const r = await footerRefPass(pb, ctx, next as FooterSettings);
        next = r.value;
        dropped = r.dropped;
      } else if (part === "settings") {
        // 07-30: the snapshot's share image (validated by resolveSiteSettings: bad -> "").
        // Soft-deleted -> un-deleted in the same batch; gone or foreign -> dropped. Never refuses.
        const group = next as SiteSettingsGroup;
        if (group.share_image) {
          const state = await shareImageState(pb, ctx.orgId, group.share_image);
          if (state === "deleted") {
            extraOps = await undeleteOps(pb, ctx, {
              popups: [],
              forms: [],
              media: [group.share_image],
            });
            restoredShare = group.share_image;
          } else if (state === "gone") {
            next = { ...group, share_image: "" };
            dropped += 1;
          } else {
            restoredShare = group.share_image;
          }
        }
      }
      const rowId = await writeSiteSettingsPartIn(
        pb,
        ctx,
        part,
        next as never,
        {
          audit: { action: "site_settings.restore", meta: { part, version } },
          extraOps,
          store,
          now: deps.now,
        },
      );
      return { id: rowId, value: next, dropped };
    }),
  ).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });

  await afterLiveSave(
    ctx,
    deps,
    { verdict: "clean", reasons: [] },
    { collection: COLLECTION, id },
  );
  if (restoredShare) {
    await promoteMedia(ctx, [restoredShare]).catch(() => undefined);
  }
  return { part, value, at, dropped } as RestoredSitePart;
}
