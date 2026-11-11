// addonRepo: the generic record chokepoint for add-on collections (ADDON-06, ADDON-05;
// D248, D270; CONTEXT A1-Q4; RESEARCH Patterns 6 and 9, Pitfalls 7, 12 and 13; invariants 1,
// 4 and 9).
//
// An add-on reaches ONLY the collections its manifest declares: collection(name) refuses any
// other name (own-property check) before a single PB call. Every method:
//   - checks `addon:<slug>` read/write (owner/admin, or a member holding the add-on grant);
//     renters are refused (fail closed: add-on records are not owner-scoped)
//   - scopes every query `organization = {:org}` with bound params; a foreign id and an
//     absent id are the same NotFound
// Writes additionally:
//   - run under the `addons:<orgId>` lock and only while the add-on is active
//     (AddonNotActive otherwise; reads stay allowed so retained data can be shown/exported)
//   - validate through the add-on's pure record spec, never take organization from input,
//     screen texts and URLs: "held" saves with is_published false and a content flag, and
//     switching Show on site back on re-screens (the toggle cannot bypass the scanner)
//   - invalidate the add-on tag and the live tag
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import type { AddonManifest, AddonRecordSpec } from "@cds/core/addons";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { assertOrgContext, type OrgContext } from "../context";
import { withOrgLock } from "../content/lock";
import { addonTag, liveTag } from "../content/ports";
import { screen, type ScanOutcome } from "../content/screen";
import { asInput, commit, own, scopedGet, type Op } from "../content/shared";
import {
  assertId,
  mapError,
  newRecordId,
  requirePermission,
} from "../repository";
import { assertAddonActive } from "./entitlements";
import {
  afterRecordSave,
  cleanValues,
  declaredRecordSpec,
  nextSortOrder,
  prepareRecord,
} from "./records";
import type { AddonDeps, AddonRecord } from "./types";

/** Switching a record on re-screens it; a concurrent edit retries at most this often. */
const PUBLISH_ATTEMPTS = 3;

export const RECORD_CHANGED_COPY =
  "This item changed while it was being switched on. Try again.";
export const REORDER_STALE_COPY =
  "The list changed while you were reordering. Reload and try again.";

export type AddonCollectionRepo = {
  list(): Promise<AddonRecord[]>;
  get(id: string): Promise<AddonRecord>;
  save(raw: unknown): Promise<{ id: string; held: boolean }>;
  setPublished(id: string, on: boolean): Promise<{ held: boolean }>;
  reorder(ids: readonly string[]): Promise<void>;
  remove(id: string): Promise<void>;
  openHolds(): Promise<string[]>;
};

export type AddonRepo = { collection(name: string): AddonCollectionRepo };

function pbRun<T>(fn: (pb: PocketBase) => Promise<T>): Promise<T> {
  return withSuperuser(fn).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

function toRecord(r: RecordModel): AddonRecord {
  const out: AddonRecord = { id: r.id };
  for (const [k, v] of Object.entries(r)) {
    if (k === "collectionId" || k === "collectionName" || k === "expand") {
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Ids with an open "held" screening flag in the collection (Pitfall 7). */
export async function openHeldIds(
  pb: PocketBase,
  orgId: string,
  collection: string,
): Promise<Set<string>> {
  const flags = await pb.collection("content_flags").getFullList({
    filter: pb.filter(
      "organization = {:org} && target_collection = {:c} && verdict = 'held' && status = 'open'",
      { org: orgId, c: collection },
    ),
    fields: "target_id",
  });
  return new Set(
    flags
      .map((f) => (typeof f.target_id === "string" ? f.target_id : ""))
      .filter((id) => id !== ""),
  );
}

function scanInputs(
  spec: AddonRecordSpec,
  r: RecordModel,
): { texts: string[]; urls: string[] } {
  const values = cleanValues(toRecord(r));
  return { texts: spec.textsOf(values), urls: spec.urlsOf(values) };
}

function collectionRepo(
  ctx: OrgContext,
  deps: AddonDeps,
  manifest: AddonManifest,
  name: string,
): AddonCollectionRepo {
  const slug = manifest.slug;
  const feature = `addon:${slug}`;
  const lockKey = `addons:${ctx.orgId}`;

  const check = (action: "read" | "write"): void => {
    requirePermission(ctx, feature, action);
    if (ctx.role === "renter") {
      throw new Forbidden("renter access needs an owner-scoped collection");
    }
  };

  /** Under the add-on lock, with the add-on active. */
  const locked = <T>(fn: (pb: PocketBase) => Promise<T>): Promise<T> =>
    withOrgLock(lockKey, () =>
      pbRun(async (pb) => {
        await assertAddonActive(pb, ctx.orgId, manifest);
        return fn(pb);
      }),
    );

  const event = (op: string, id: string, meta?: Record<string, unknown>) => ({
    action: `${slug}.${name}.${op}`,
    targetCollection: name,
    targetId: id,
    ...(meta ? { meta } : {}),
  });

  const invalidate = (): void =>
    deps.invalidator.invalidate([
      addonTag(ctx.orgId, slug),
      liveTag(ctx.orgId),
    ]);

  const get = async (id: string): Promise<AddonRecord> => {
    check("read");
    assertId(id);
    return toRecord(await pbRun((pb) => scopedGet(pb, ctx, name, id)));
  };

  return {
    async list() {
      check("read");
      const rows = await pbRun((pb) =>
        pb.collection(name).getFullList({
          filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
          sort: "sort_order,id",
        }),
      );
      return rows.map(toRecord);
    },

    get,

    async save(raw) {
      check("write");
      const { spec } = declaredRecordSpec(manifest, name);
      const input = asInput(raw, "record input");
      const idRaw = own(input, "id");
      if (idRaw !== undefined) assertId(idRaw);
      const prepared = await prepareRecord(ctx, deps, spec, input);
      const id = await locked(async (pb) => {
        if (typeof idRaw === "string") {
          await scopedGet(pb, ctx, name, idRaw);
          await commit(
            pb,
            ctx,
            [
              {
                collection: name,
                op: "update",
                id: idRaw,
                body: prepared.body,
              },
            ],
            event("update", idRaw),
          );
          return idRaw;
        }
        const newId = newRecordId();
        const sort_order = await nextSortOrder(pb, ctx.orgId, name);
        await commit(
          pb,
          ctx,
          [
            {
              collection: name,
              op: "create",
              id: newId,
              body: { ...prepared.body, organization: ctx.orgId, sort_order },
            },
          ],
          event("create", newId),
        );
        return newId;
      });
      await afterRecordSave(ctx, deps, slug, prepared.outcome, {
        collection: name,
        id,
      });
      return { id, held: prepared.held };
    },

    async setPublished(id, on) {
      check("write");
      assertId(id);
      if (typeof on !== "boolean") {
        throw new InvalidInput("Show on site must be on or off.");
      }
      const { spec } = declaredRecordSpec(manifest, name);
      for (let attempt = 0; attempt < PUBLISH_ATTEMPTS; attempt++) {
        const current = await pbRun((pb) => scopedGet(pb, ctx, name, id));
        const scanned = scanInputs(spec, current);
        const fingerprint = JSON.stringify(scanned);
        const outcome: ScanOutcome = on
          ? await screen(ctx, deps, scanned.texts, scanned.urls)
          : { verdict: "clean", reasons: [] };
        const held = outcome.verdict === "held";
        const committed = await locked(async (pb) => {
          const row = await scopedGet(pb, ctx, name, id);
          if (on && JSON.stringify(scanInputs(spec, row)) !== fingerprint) {
            return false;
          }
          const is_published = on && !held;
          await commit(
            pb,
            ctx,
            [{ collection: name, op: "update", id, body: { is_published } }],
            event("publish", id, { is_published }),
          );
          return true;
        });
        if (!committed) continue;
        await afterRecordSave(ctx, deps, slug, outcome, {
          collection: name,
          id,
        });
        return { held };
      }
      throw new InvalidInput(RECORD_CHANGED_COPY);
    },

    async reorder(ids) {
      check("write");
      if (!Array.isArray(ids)) throw new InvalidInput(REORDER_STALE_COPY);
      for (const id of ids) assertId(id);
      await locked(async (pb) => {
        const rows = await pb.collection(name).getFullList({
          filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
          fields: "id",
        });
        const current = new Set(rows.map((r) => r.id));
        const given = new Set(ids);
        if (
          given.size !== ids.length ||
          given.size !== current.size ||
          ids.some((id) => !current.has(id))
        ) {
          throw new InvalidInput(REORDER_STALE_COPY);
        }
        const ops: Op[] = ids.map((id, i) => ({
          collection: name,
          op: "update",
          id,
          body: { sort_order: i + 1 },
        }));
        await commit(pb, ctx, ops, event("reorder", "", { count: ids.length }));
      });
      invalidate();
    },

    async remove(id) {
      check("write");
      assertId(id);
      await locked(async (pb) => {
        await scopedGet(pb, ctx, name, id);
        await commit(
          pb,
          ctx,
          [{ collection: name, op: "delete", id }],
          event("delete", id),
        );
      });
      invalidate();
    },

    async openHolds() {
      check("read");
      const held = await pbRun((pb) => openHeldIds(pb, ctx.orgId, name));
      return [...held].sort();
    },
  };
}

/**
 * The record repository for one add-on. collection(name) resolves only collections the
 * add-on's manifest declares (ADDON-06, the mechanical "own collections only" rule).
 */
export function addonRepo(
  ctx: OrgContext,
  deps: AddonDeps,
  slug: string,
): AddonRepo {
  assertOrgContext(ctx);
  const manifest = deps.addons.get(slug);
  if (!manifest) throw new NotFound();
  return {
    collection(name: string): AddonCollectionRepo {
      if (
        typeof name !== "string" ||
        !Object.hasOwn(manifest.collections, name)
      ) {
        throw new InvalidInput(`unknown collection for ${manifest.slug}`);
      }
      return collectionRepo(ctx, deps, manifest, name);
    },
  };
}
