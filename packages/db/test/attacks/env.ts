// TEN-03 attack modules (07-01). The isolation suite (isolation.integration.test.ts) merges
// every module's attacks into its customWriters map with mergeAttacks, so each P7 writer
// plan owns one file and never edits the suite itself.
//
// Key convention:
//   - A new collection is keyed by its own name (`forms`, `contacts`, ...).
//   - A collection that already has a base attack in the suite is keyed `<collection>:<area>`
//     (`media_assets:media-library`, `pages:seo`, ...).
//   - attackCollection(key) is the text before the first `:`; the suite's coverage test
//     counts a collection as covered when any key maps to it.
//   - mergeAttacks throws on a repeated key, so two plans can never shadow each other.
//
// Later plans replace only the body of their own module's `attacks(env)` function. Until
// then every module holds read-only attacks: the generic repo has no create/update/delete
// for the collection, and org B's get of org A's row is NotFound.
import { NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { expect } from "vitest";
import { tenantRepo, type RecordData } from "../../src/repository";
import type { TwoOrgs } from "../fixtures";

/** Org A's and org B's record in a collection, plus valid create data. */
export type Seeded = { a: string; b: string; create: RecordData };

/** What an attack module may read from the running suite (lazy: seeded in beforeAll). */
export type AttackEnv = {
  seed(): TwoOrgs;
  pb(): PocketBase;
  seedRecordFor(name: string): Seeded;
};

/** Attack key -> one async attack that throws when isolation is broken. */
export type AttackMap = Record<string, () => Promise<void>>;

/** The collection an attack key covers: the text before the first `:`. */
export function attackCollection(key: string): string {
  const i = key.indexOf(":");
  return i === -1 ? key : key.slice(0, i);
}

/**
 * The generic repo for `collection` is read-only, and org B reading org A's row is
 * NotFound.
 */
export function readOnlyAttack(
  env: AttackEnv,
  collection: string,
): () => Promise<void> {
  return async () => {
    const repo = tenantRepo(collection);
    expect("create" in repo, `${collection} generic create`).toBe(false);
    expect("update" in repo, `${collection} generic update`).toBe(false);
    expect("delete" in repo, `${collection} generic delete`).toBe(false);
    await expect(
      repo.get(env.seed().ctxB, env.seedRecordFor(collection).a),
    ).rejects.toThrow(NotFound);
  };
}

/** Merge attack maps; a key present in two maps is a bug and throws. */
export function mergeAttacks(...maps: AttackMap[]): AttackMap {
  const out: AttackMap = {};
  for (const map of maps) {
    for (const [key, attack] of Object.entries(map)) {
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        throw new Error(`duplicate attack key ${key}`);
      }
      out[key] = attack;
    }
  }
  return out;
}
