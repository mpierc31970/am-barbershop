// platform_meta key/value access (D5; 06-09 job heartbeats for the monitor, D174, D175, D290).
// The collection is superuser-only (every API rule null). Writes need a SystemContext, so only
// a job can record a heartbeat; reads are plain (the monitor status route reads them later).
// Keys are bound through pb.filter, never interpolated.
import { randomUUID } from "node:crypto";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { InvalidInput } from "@cds/core";
import { withSuperuser } from "./client";
import { assertSystemContext, type SystemContext } from "./context";

const COLLECTION = "platform_meta";
const KEY_RE = /^[a-z0-9:._-]{1,100}$/;

function checkKey(key: string): void {
  if (typeof key !== "string" || !KEY_RE.test(key)) {
    throw new InvalidInput("invalid platform_meta key");
  }
}

async function rowByKey(key: string): Promise<RecordModel | null> {
  return withSuperuser(async (pb) => {
    try {
      return await pb
        .collection(COLLECTION)
        .getFirstListItem(pb.filter("key = {:key}", { key }));
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) return null;
      throw err;
    }
  });
}

/** Upsert one key (a job heartbeat). Internal to @cds/db: not exported from the barrel. */
export async function writePlatformMeta(
  ctx: SystemContext,
  key: string,
  value: string,
): Promise<void> {
  assertSystemContext(ctx);
  checkKey(key);
  const existing = await rowByKey(key);
  await withSuperuser(async (pb) => {
    if (existing) {
      await pb.collection(COLLECTION).update(existing.id, { value });
      return;
    }
    try {
      await pb.collection(COLLECTION).create({ key, value });
    } catch (err) {
      // Lost a create race on the unique key: update the winner's row instead.
      const again = await rowByKey(key);
      if (!again) throw err;
      await pb.collection(COLLECTION).update(again.id, { value });
    }
  });
}

// ------------------------------------------------------------------ cross-process lock
// One platform_meta row per held lock. The unique `key` index makes `create` the atomic
// claim, so two Node processes (the site:assemble CLI and the web queue) cannot both hold
// it (WR-A05). The value is `<token> <ISO time>`. A row older than `staleMs` belongs to a
// crashed holder and is taken over: delete it by id, then create. Of two takers, only one
// delete finds the row and only one create passes the unique index. Internal to @cds/db:
// not exported from the barrel.

function lockToken(value: unknown): { token: string; at: number } {
  const [token = "", iso = ""] = String(value ?? "").split(" ");
  return { token, at: Date.parse(iso) };
}

async function tryCreate(pb: PocketBase, key: string, value: string) {
  try {
    await pb.collection(COLLECTION).create({ key, value });
    return true;
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 400) return false;
    throw err;
  }
}

/** Take the lock: its release token, or null when another holder has a fresh claim. */
export async function acquirePlatformLock(
  key: string,
  opts: { now: Date; staleMs: number },
): Promise<string | null> {
  checkKey(key);
  const token = randomUUID();
  const value = `${token} ${opts.now.toISOString()}`;
  return withSuperuser(async (pb) => {
    if (await tryCreate(pb, key, value)) return token;
    const held = await rowByKey(key);
    if (!held) return (await tryCreate(pb, key, value)) ? token : null;
    const { at } = lockToken(held.value);
    if (Number.isFinite(at) && opts.now.getTime() - at < opts.staleMs) {
      return null;
    }
    try {
      await pb.collection(COLLECTION).delete(held.id);
    } catch (err) {
      // Another taker removed it first: they hold the lock now.
      if (err instanceof ClientResponseError && err.status === 404) return null;
      throw err;
    }
    return (await tryCreate(pb, key, value)) ? token : null;
  });
}

/** Release the lock if this token still holds it (a taken-over lock is left alone). */
export async function releasePlatformLock(
  key: string,
  token: string,
): Promise<void> {
  checkKey(key);
  const held = await rowByKey(key);
  if (!held || lockToken(held.value).token !== token) return;
  await withSuperuser(async (pb) => {
    try {
      await pb.collection(COLLECTION).delete(held.id);
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) return;
      throw err;
    }
  });
}

/** The stored value, or null when the key was never written. */
export async function readPlatformMeta(key: string): Promise<string | null> {
  checkKey(key);
  const row = await rowByKey(key);
  return row ? String(row.value ?? "") : null;
}
