// Site-part snapshots (07-29; CONT-36, D184, D187; choices 4-7). Internal: imported by path
// from chrome/write.ts only, never from a barrel.
//
// lock-free: never calls withOrgLock, run or withSuperuser; called only from write.ts inside
// the caller's lock. Best effort (D248 spirit): the DB commit is the save, so any failure
// here is logged without ids or keys and swallowed.
import type { OrgContext } from "../../context";
import { toSnapshot } from "../../snapshot";
import { readJson } from "../manifest";
import {
  getObjectStore,
  tenantSitePartVersionKey,
  tenantSitePartVersionPrefix,
  type ObjectStore,
  type SiteHistoryPart,
} from "../../storage";
import {
  atOfVersionId,
  canonicalJson,
  parseEnvelope,
  pickPart,
  versionIdOf,
  type SiteSnapshotEnvelope,
} from "./parts";

/** Versions kept per site part (D184: "small" = 10). */
export const SITE_VERSIONS_KEPT = 10;

const JSON_TYPE = "application/json";

export type SnapshotOpts = { store?: ObjectStore; now?: () => Date };

/** The part's sorted version keys (stamp-shaped file names only). */
export async function listPartKeys(
  store: ObjectStore,
  orgId: string,
  part: SiteHistoryPart,
): Promise<string[]> {
  const prefix = tenantSitePartVersionPrefix(orgId, part);
  return (await store.list(prefix))
    .map((o) => o.key)
    .filter(
      (k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"),
    )
    .filter((k) => versionIdOf(k) !== null)
    .sort();
}

/** Monotonic key: max(now, last + 1 ms), +1 ms on a clash (mirrors publish.ts). */
export function nextSiteVersionKey(
  orgId: string,
  part: SiteHistoryPart,
  at: Date,
  existing: readonly string[],
): string {
  const taken = new Set(existing);
  const lastId =
    existing.length > 0 ? versionIdOf(existing[existing.length - 1]!) : null;
  let ms = at.getTime();
  if (lastId !== null) ms = Math.max(ms, Date.parse(atOfVersionId(lastId)) + 1);
  let key = tenantSitePartVersionKey(orgId, part, new Date(ms));
  while (taken.has(key)) {
    ms += 1;
    key = tenantSitePartVersionKey(orgId, part, new Date(ms));
  }
  return key;
}

function hasValue(row: Record<string, unknown>): boolean {
  return Object.values(row).some(
    (v) => v !== null && v !== undefined && v !== "",
  );
}

async function putEnvelope(
  store: ObjectStore,
  key: string,
  env: SiteSnapshotEnvelope,
): Promise<void> {
  await store.put(key, JSON.stringify(env), JSON_TYPE);
}

/**
 * Snapshot one part after a committed write: baseline on first save (choice 6), no
 * duplicate of the newest (choice 7), prune to 10. Never throws.
 */
export async function writeSitePartSnapshot(
  ctx: OrgContext,
  part: SiteHistoryPart,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  opts: SnapshotOpts = {},
): Promise<void> {
  try {
    const store = opts.store ?? getObjectStore();
    const now = (opts.now ?? (() => new Date()))();
    const keys = await listPartKeys(store, ctx.orgId, part);

    if (keys.length === 0 && before) {
      const prev = pickPart(part, toSnapshot("site_settings", before));
      if (hasValue(prev)) {
        const updated =
          typeof before.updated === "string" ? Date.parse(before.updated) : NaN;
        const ms =
          Number.isFinite(updated) && updated < now.getTime()
            ? updated
            : now.getTime() - 1;
        const at = new Date(ms);
        const key = tenantSitePartVersionKey(ctx.orgId, part, at);
        await putEnvelope(store, key, {
          v: 1,
          part,
          at: at.toISOString(),
          by: null,
          row: prev,
        });
        keys.push(key);
      }
    }

    const row = pickPart(part, toSnapshot("site_settings", after));
    const newest = keys[keys.length - 1];
    if (newest) {
      const env = parseEnvelope(await readJson(store, newest));
      if (env && canonicalJson(env.row) === canonicalJson(row)) return;
    }

    const key = nextSiteVersionKey(ctx.orgId, part, now, keys);
    const id = versionIdOf(key)!;
    await putEnvelope(store, key, {
      v: 1,
      part,
      at: atOfVersionId(id),
      by: {
        actor: ctx.actor,
        staff: Boolean(ctx.impersonator || ctx.systemJob),
      },
      row,
    });
    keys.push(key);

    for (const old of keys.slice(
      0,
      Math.max(0, keys.length - SITE_VERSIONS_KEPT),
    )) {
      await store.delete(old).catch(() => undefined);
    }
  } catch {
    console.warn("[history] snapshot failed");
  }
}
