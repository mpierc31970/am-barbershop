// The one D275 rule (07-28; CONT-36, D275; CONTEXT Area 5 row 2; RESEARCH Pattern 4; choices
// 1-3). The one place that decides soft vs hard for pop-ups, forms and media; 07-30 adds the
// share image and favicon source here.
//
// Referenced = any page's draft page_sections refs, any page's kept versions (version_refs
// union), any pop-up's items (soft-deleted pop-ups included: they are still served, choice
// 2), a menu or footer button ("popup:<id>" in site_settings nav / footer, 07-25), and for
// media also another row's poster_asset and an active intake slot (07-12 choice 12).
//   - referenced -> SOFT delete (deleted_at set; hidden from lists, still served)
//   - otherwise  -> HARD delete
// Every query is `organization = {:org}` with bound params (invariant 1). Built expressions
// concatenate placeholders, never values (T-02-13). Internal to @cds/db: only
// deletedRefsAmong and the DeleteOutcome type are in the barrel.
import {
  emptyRefs,
  unionRefs,
  type SectionRefs,
  type SectionRegistry,
} from "@cds/core/content";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import type { OrgContext } from "../context";
import { requirePermission } from "../repository";
import type { ObjectStore } from "../storage";
import {
  draftRefs,
  keptVersionRefs,
  popupRefsById,
  shareImageOf,
  type OrgScope,
} from "./references";
import { commit, type Op } from "./shared";

export type { OrgScope } from "./references";

export type SoftKind = "popups" | "forms" | "media";
export type DeleteOutcome = { outcome: "soft" | "hard" };

/** The PB collection behind each ref kind. */
export const SOFT_COLLECTION: Readonly<Record<SoftKind, string>> = {
  popups: "popups",
  forms: "forms",
  media: "media_assets",
};

const KINDS: readonly SoftKind[] = ["popups", "forms", "media"];
const INTAKE_KINDS = ["logo", "hero", "gallery", "team", "moodboard"] as const;
const CHUNK = 50;
const AMONG_MAX = 500;
const ID_RE = /^[a-z0-9]{15}$/;
const CHROME_POPUP_RE = /popup:([a-z0-9]{15})/g;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** PB date format, as the media delete writes it. */
export function deletedStamp(): string {
  return new Date().toISOString().replace("T", " ");
}

/** Pop-up ids the menu and footer open ("popup:<id>" targets, 07-25). */
export async function chromePopupIds(
  pb: PocketBase,
  scope: OrgScope,
): Promise<string[]> {
  const rows = await pb.collection("site_settings").getFullList({
    filter: pb.filter("organization = {:org}", { org: scope.orgId }),
    fields: "nav,footer",
  });
  const out = new Set<string>();
  for (const r of rows) {
    const text = JSON.stringify([r.nav ?? null, r.footer ?? null]);
    for (const m of text.matchAll(CHROME_POPUP_RE)) out.add(m[1]!);
  }
  return [...out];
}

type MediaHolds = {
  posters: { holder: string; id: string }[];
  intake: string[];
};

/**
 * 07-30 (choice 6): share images are references. Every page draft's seo.share_image and the
 * site's site_settings.seo.share_image (the favicon source, the logo, is an active intake
 * slot and already held by mediaHolds).
 */
async function shareImageIds(
  pb: PocketBase,
  scope: OrgScope,
): Promise<string[]> {
  const out = new Set<string>();
  const filter = pb.filter("organization = {:org}", { org: scope.orgId });
  for (const r of await pb
    .collection("pages")
    .getFullList({ filter, fields: "seo" })) {
    const id = shareImageOf(r.seo);
    if (id) out.add(id);
  }
  for (const r of await pb
    .collection("site_settings")
    .getFullList({ filter, fields: "seo" })) {
    const id = shareImageOf(r.seo);
    if (id) out.add(id);
  }
  return [...out];
}

/** Video covers (poster_asset) and active intake slots of the org. */
async function mediaHolds(
  pb: PocketBase,
  scope: OrgScope,
): Promise<MediaHolds> {
  const posterRows = await pb.collection("media_assets").getFullList({
    filter: pb.filter("organization = {:org} && poster_asset != ''", {
      org: scope.orgId,
    }),
    fields: "id,poster_asset",
  });
  const params: Record<string, string> = { org: scope.orgId };
  const kinds = INTAKE_KINDS.map((k, i) => {
    params[`k${i}`] = k;
    return "kind = {:k" + i + "}";
  });
  const intakeRows = await pb.collection("media_assets").getFullList({
    filter: pb.filter(
      "organization = {:org} && removed_at = '' && (" +
        kinds.join(" || ") +
        ")",
      params,
    ),
    fields: "id",
  });
  return {
    posters: posterRows.map((r) => ({ holder: r.id, id: str(r.poster_asset) })),
    intake: intakeRows.map((r) => r.id),
  };
}

type RefParts = {
  drafts: SectionRefs;
  versions: SectionRefs;
  popups: Map<string, SectionRefs>;
  chrome: string[];
  media: MediaHolds;
  shareImages: string[];
};

async function refParts(
  pb: PocketBase,
  scope: OrgScope,
  registry: SectionRegistry,
  deps: { store?: ObjectStore },
): Promise<RefParts> {
  return {
    drafts: await draftRefs(pb, scope, registry),
    versions: await keptVersionRefs(pb, scope, registry, deps),
    popups: await popupRefsById(pb, scope),
    chrome: await chromePopupIds(pb, scope),
    media: await mediaHolds(pb, scope),
    shareImages: await shareImageIds(pb, scope),
  };
}

/** `exclude` = the item asking (a pop-up or a video never holds itself). */
function unionParts(parts: RefParts, exclude?: string): SectionRefs {
  const popupRefs = [...parts.popups]
    .filter(([id]) => id !== exclude)
    .map(([, r]) => r);
  const extra = emptyRefs();
  extra.popups = parts.chrome;
  extra.media = [
    ...parts.media.posters
      .filter((p) => p.holder !== exclude && p.id !== "")
      .map((p) => p.id),
    ...parts.media.intake,
    ...parts.shareImages,
  ];
  return unionRefs([parts.drafts, parts.versions, ...popupRefs, extra]);
}

/** Every id the org's content still references (the union the GC and the deleters test). */
export async function orgReferencedIds(
  pb: PocketBase,
  scope: OrgScope,
  registry: SectionRegistry,
  deps: { store?: ObjectStore } = {},
): Promise<SectionRefs> {
  return unionParts(await refParts(pb, scope, registry, deps));
}

/** Is `id` (of `kind`) referenced anywhere in the scope's org? */
export async function isReferenced(
  pb: PocketBase,
  scope: OrgScope,
  registry: SectionRegistry,
  kind: SoftKind,
  id: string,
  deps: { store?: ObjectStore } = {},
): Promise<boolean> {
  const parts = await refParts(pb, scope, registry, deps);
  if (kind === "media" && parts.media.intake.includes(id)) return true;
  return unionParts(parts, id)[kind].includes(id);
}

/** Ids of `kind` among `ids` (chunked, bound params) matching `extra` in the org. */
async function rowsAmong(
  pb: PocketBase,
  scope: OrgScope,
  kind: SoftKind,
  ids: readonly string[],
  extra: string,
  fields: string,
): Promise<RecordModel[]> {
  const unique = [...new Set(ids)].filter((id) => ID_RE.test(id));
  const out: RecordModel[] = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const params: Record<string, string> = { org: scope.orgId };
    const ors = chunk.map((id, j) => {
      params[`i${j}`] = id;
      return "id = {:i" + j + "}";
    });
    const expr =
      "organization = {:org}" + extra + " && (" + ors.join(" || ") + ")";
    out.push(
      ...(await pb.collection(SOFT_COLLECTION[kind]).getFullList({
        filter: pb.filter(expr, params),
        fields,
      })),
    );
  }
  return out;
}

/** One `deleted_at: ""` update per soft-deleted id of the scope's org among `refs`. */
export async function undeleteOps(
  pb: PocketBase,
  scope: OrgScope,
  refs: SectionRefs,
): Promise<Op[]> {
  const ops: Op[] = [];
  for (const kind of KINDS) {
    const ids = Array.isArray(refs?.[kind]) ? refs[kind] : [];
    if (ids.length === 0) continue;
    const rows = await rowsAmong(
      pb,
      scope,
      kind,
      ids,
      " && deleted_at != ''",
      "id",
    );
    for (const r of rows) {
      ops.push({
        collection: SOFT_COLLECTION[kind],
        op: "update",
        id: r.id,
        body: { deleted_at: "" },
      });
    }
  }
  return ops;
}

/**
 * The ids among `refs` whose row is soft-deleted or absent for the caller's org (another
 * org's id reads as absent: no hint it exists). Content read; at most 500 ids per kind.
 */
export async function deletedRefsAmong(
  ctx: OrgContext,
  refs: SectionRefs,
): Promise<SectionRefs> {
  requirePermission(ctx, "content", "read");
  return withSuperuser(async (pb) => {
    const out = emptyRefs();
    for (const kind of KINDS) {
      const ids = [
        ...new Set(
          (Array.isArray(refs?.[kind]) ? refs[kind] : []).filter(
            (id): id is string => typeof id === "string" && id !== "",
          ),
        ),
      ].slice(0, AMONG_MAX);
      if (ids.length === 0) continue;
      const rows = await rowsAmong(pb, ctx, kind, ids, "", "id,deleted_at");
      const live = new Set(
        rows.filter((r) => str(r.deleted_at) === "").map((r) => r.id),
      );
      out[kind] = ids.filter((id) => !live.has(id));
    }
    return out;
  });
}

/**
 * Soft or hard delete of one row, in one commit with its audit row: referenced -> deleted_at
 * (`<collection>.soft_delete`; a no-op when already soft-deleted), else the row goes
 * (`<collection>.delete`).
 */
export async function softOrHard(
  pb: PocketBase,
  ctx: OrgContext,
  collection: string,
  row: RecordModel,
  referenced: boolean,
  meta?: Record<string, unknown>,
): Promise<DeleteOutcome> {
  if (referenced) {
    if (str(row.deleted_at) === "") {
      await commit(
        pb,
        ctx,
        [
          {
            collection,
            op: "update",
            id: row.id,
            body: { deleted_at: deletedStamp() },
          },
        ],
        {
          action: `${collection}.soft_delete`,
          targetCollection: collection,
          targetId: row.id,
          ...(meta ? { meta } : {}),
        },
      );
    }
    return { outcome: "soft" };
  }
  await commit(pb, ctx, [{ collection, op: "delete", id: row.id }], {
    action: `${collection}.delete`,
    targetCollection: collection,
    targetId: row.id,
    ...(meta ? { meta } : {}),
  });
  return { outcome: "hard" };
}
