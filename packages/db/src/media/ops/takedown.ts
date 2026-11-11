// Staff media takedown (07-27; D249, CONT-33; choice 9; T-07-27-05..07). super_admin only
// (STAFF_MATRIX.media_takedown), after a staff MFA sign-in. A takedown ALWAYS hard-deletes,
// even when pages or kept versions reference the asset: D249 overrides 07-12's soft-delete
// rule, and public renderers drop missing media silently. The row delete and its
// `media_assets.takedown` audit row (staff actor, org, reason) commit in one batch; then both
// stores' objects are removed and the CDN purged (removeMediaObjects, 07-12). A video mid-job
// is safe: 07-13's job discards its output when the row is gone.
//
// Invariant 1: the row is read with `id` AND `organization` bound; another org's asset is
// NotFound with no hint. Used-on lookups run under an internal owner view of the org,
// minted only after the staff check (the addons installer precedent), never exported.
import type { SectionRegistry } from "@cds/core/content";
import { Forbidden, InvalidInput, NotFound, authorizeStaff } from "@cds/core";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody } from "../../audit";
import { withSuperuser } from "../../client";
import { findRefHolders } from "../../content/references";
import { liveTag, siteTag, type Invalidator } from "../../content/ports";
import {
  isPlatformContext,
  mintOrgContext,
  type OrgContext,
  type PlatformContext,
} from "../../context";
import type { ObjectStore } from "../../storage/object-store";
import { removeMediaObjects } from "../library/delete";
import type { MediaDelivery } from "../ports";

const COLLECTION = "media_assets";
const ID_RE = /^[a-z0-9]{15}$/;
const REASON_MAX = 500;

export type TakedownCase = {
  orgName: string;
  asset: {
    id: string;
    kind: string;
    name: string;
    bytes: number;
    status: string;
    public: boolean;
    deleted: boolean;
  };
  /** Titles of the pages that use it (draft rows or kept versions). */
  usedOn: string[];
};

export type TakedownDeps = {
  sections: SectionRegistry;
  invalidator: Invalidator;
  delivery?: MediaDelivery;
  store?: ObjectStore;
  publicStore?: ObjectStore;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

function staffOnly(ctx: PlatformContext): void {
  if (!isPlatformContext(ctx)) throw new Forbidden("takedown is for CDS staff");
  authorizeStaff(ctx.staffRole, "media_takedown");
}

function checkIds(orgId: unknown, assetId: unknown): void {
  if (typeof orgId !== "string" || !ID_RE.test(orgId)) throw new NotFound();
  if (typeof assetId !== "string" || !ID_RE.test(assetId)) throw new NotFound();
}

async function rowOf(
  pb: PocketBase,
  orgId: string,
  assetId: string,
): Promise<RecordModel> {
  const found = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("id = {:id} && organization = {:org}", {
      id: assetId,
      org: orgId,
    }),
  });
  const row = found.items[0];
  if (!row) throw new NotFound();
  return row;
}

function ownerView(ctx: PlatformContext, orgId: string): OrgContext {
  return mintOrgContext({
    orgId,
    actor: ctx.actor,
    role: "owner",
    grants: [],
    impersonator: ctx.actor,
    ip: ctx.ip,
  });
}

export async function describeTakedown(
  ctx: PlatformContext,
  orgId: string,
  assetId: string,
  deps: { sections: SectionRegistry; store?: ObjectStore },
): Promise<TakedownCase> {
  staffOnly(ctx);
  checkIds(orgId, assetId);
  return withSuperuser(async (pb) => {
    const row = await rowOf(pb, orgId, assetId);
    let orgName = "";
    try {
      const org = await pb
        .collection("organizations")
        .getOne(orgId, { fields: "name" });
      orgName = str(org.name);
    } catch (err) {
      if (!(err instanceof ClientResponseError)) throw err;
    }
    const holders = await findRefHolders(
      pb,
      ownerView(ctx, orgId),
      deps.sections,
      "media",
      row.id,
      deps.store ? { store: deps.store } : {},
    );
    const titles = new Map(holders.draftPages.map((p) => [p.id, p.title]));
    const missing = holders.versionPages.filter((id) => !titles.has(id));
    if (missing.length > 0) {
      const pages = await pb.collection("pages").getFullList({
        filter: pb.filter("organization = {:org}", { org: orgId }),
        fields: "id,title",
      });
      for (const p of pages) {
        if (missing.includes(p.id)) titles.set(p.id, str(p.title));
      }
    }
    return {
      orgName,
      asset: {
        id: row.id,
        kind: str(row.kind),
        name: str(row.name),
        bytes: num(row.bytes),
        status: str(row.status),
        public: str(row.public_at) !== "",
        deleted: str(row.deleted_at) !== "",
      },
      usedOn: [...titles.values()].map((t) => t || "Untitled page"),
    };
  });
}

export async function takedownMedia(
  ctx: PlatformContext,
  input: { orgId: string; assetId: string; reason: string },
  deps: TakedownDeps,
): Promise<{ publicKeys: number }> {
  staffOnly(ctx);
  checkIds(input?.orgId, input?.assetId);
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason === "" || reason.length > REASON_MAX) {
    throw new InvalidInput(`Give a reason, up to ${REASON_MAX} characters.`);
  }
  const { orgId, assetId } = input;
  const row = await withSuperuser(async (pb) => {
    const r = await rowOf(pb, orgId, assetId);
    const batch = pb.createBatch();
    batch.collection(COLLECTION).delete(r.id);
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "media_assets.takedown",
        organization: orgId,
        targetCollection: COLLECTION,
        targetId: assetId,
        meta: { reason, kind: str(r.kind), bytes: num(r.bytes) },
      }),
    );
    await batch.send();
    return r;
  });
  const { publicKeys } = await removeMediaObjects(orgId, row, deps);
  try {
    deps.invalidator.invalidate([siteTag(orgId), liveTag(orgId)]);
  } catch {
    // Cached renders expire on their own (tenant page cache <= 300 s).
  }
  return { publicKeys: publicKeys.length };
}
