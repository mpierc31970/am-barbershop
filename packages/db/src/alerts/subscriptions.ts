// P11 alerts/subscriptions (11-22; DASH-34, DASH-36): a person's phone/desktop devices for
// Web Push. One push_subscriptions row per (organization, user, endpoint).
//
// - Per person (Pitfall 6): every read and write is bound to `organization = ctx.orgId` and
//   `user = ctx.actor`. Nobody, the Owner included, sees or removes a colleague's device.
// - Impersonation: staff never subscribe a member's account (ImpersonationDenied); the device
//   list reads empty.
// - The endpoint is untrusted browser input that the server later POSTs to (T-11-22-03):
//   https only, ≤ 1024 chars, no credentials, no explicit port, no IP literal or local host,
//   and the host must be a known browser push service (isPushServiceEndpoint, WR-B04).
//   Keys must decode to a P-256 point (65 bytes, 0x04) and a 16-byte auth secret.
// - At most MAX_DEVICES per person per org: saving one more drops the oldest.
// - One device endpoint has one owner (review 11 WR-A02): saving it drops any row another
//   person holds for the same endpoint, in any org, so a shared browser never keeps pushing
//   the previous person's alerts. Sign-out forgets the device (forgetPushDeviceForSession,
//   auth.ts) and the browser unsubscribes itself (push-client, WR-E01).
// The send-side helpers (subscriptionsForUsers, markGone, ...) live in alerts/push/store.ts,
// internal to @cds/db.
import { ImpersonationDenied, InvalidInput, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import { assertOrgContext, type OrgContext } from "../context";
import { isUniqueViolation } from "../payments/staff-alert";
import { newRecordId } from "../repository";
import { isPushServiceEndpoint, vapidFromEnv } from "./push";

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** Short device family for the device list ("iphone", "android", "desktop"...). */
  uaFamily?: string;
};

/** A device as the person sees it (never the endpoint or keys). */
export type PushDevice = {
  id: string;
  uaFamily: string;
  createdAt: string;
  lastOkAt: string | null;
  failCount: number;
};

const COLLECTION = "push_subscriptions";
export const MAX_PUSH_DEVICES = 10;
const ENDPOINT_MAX = 1024;
const B64URL_RE = /^[A-Za-z0-9_-]+={0,2}$/;
const UA_RE = /^[a-z0-9 ._-]{0,40}$/;
const ID_RE = /^[a-z0-9]{15}$/;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function decodeB64url(v: string): Uint8Array | null {
  if (!B64URL_RE.test(v) || v.length > 256) return null;
  try {
    return new Uint8Array(Buffer.from(v.replace(/=+$/, ""), "base64url"));
  } catch {
    return null;
  }
}

function isLocalOrIpHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local"))
    return true;
  if (h.startsWith("[")) return true; // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true; // IPv4 literal
  if (!h.includes(".")) return true; // single-label (intranet) names
  return false;
}

/** Throws InvalidInput unless `endpoint` is a plausible push-service URL. */
export function assertPushEndpoint(endpoint: unknown): string {
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    throw new InvalidInput("endpoint is required");
  }
  if (endpoint.length > ENDPOINT_MAX) {
    throw new InvalidInput("endpoint is too long");
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new InvalidInput("endpoint must be a URL");
  }
  if (url.protocol !== "https:") {
    throw new InvalidInput("endpoint must use https");
  }
  if (url.username || url.password || url.port) {
    throw new InvalidInput("endpoint must be a plain https URL");
  }
  if (isLocalOrIpHost(url.hostname) || !isPushServiceEndpoint(endpoint)) {
    throw new InvalidInput("endpoint must be a push service");
  }
  return endpoint;
}

/**
 * The VAPID public key the browser subscribes with, or null when Web Push is not configured
 * (the Phone alerts card is then not shown). Never the private key.
 */
export function pushPublicKey(): string | null {
  return vapidFromEnv()?.publicKey ?? null;
}

/** Validates and normalises the browser's PushSubscription JSON. */
export function validatePushSubscription(input: unknown): {
  endpoint: string;
  p256dh: string;
  auth: string;
  uaFamily: string;
} {
  if (typeof input !== "object" || input === null) {
    throw new InvalidInput("subscription is required");
  }
  const raw = input as Record<string, unknown>;
  const endpoint = assertPushEndpoint(raw.endpoint);
  const keys =
    typeof raw.keys === "object" && raw.keys !== null
      ? (raw.keys as Record<string, unknown>)
      : {};
  const p256dh = str(keys.p256dh);
  const auth = str(keys.auth);
  const point = decodeB64url(p256dh);
  if (!point || point.length !== 65 || point[0] !== 0x04) {
    throw new InvalidInput("p256dh must be a P-256 public key");
  }
  const secret = decodeB64url(auth);
  if (!secret || secret.length !== 16) {
    throw new InvalidInput("auth must be a 16-byte secret");
  }
  const uaFamily = str(raw.uaFamily).trim().toLowerCase().slice(0, 40);
  if (!UA_RE.test(uaFamily)) {
    throw new InvalidInput("uaFamily has invalid characters");
  }
  return { endpoint, p256dh, auth, uaFamily };
}

function assertPerson(ctx: OrgContext): void {
  assertOrgContext(ctx);
  if (ctx.impersonator) {
    throw new ImpersonationDenied("staff cannot turn on alerts for a member");
  }
  if (ctx.systemJob || !ctx.actor) {
    throw new ImpersonationDenied("devices belong to a signed-in person");
  }
}

function ownFilter(pb: PocketBase, ctx: OrgContext): string {
  return pb.filter("organization = {:org} && user = {:u}", {
    org: ctx.orgId,
    u: ctx.actor,
  });
}

function toDevice(r: RecordModel): PushDevice {
  const last = str(r.last_ok_at);
  return {
    id: r.id,
    uaFamily: str(r.ua_family),
    createdAt: str(r.created),
    lastOkAt: last || null,
    failCount: typeof r.fail_count === "number" ? r.fail_count : 0,
  };
}

/** Deletes every row for `endpoint` held by someone other than `userId`, in any org. */
async function dropOtherOwners(
  pb: PocketBase,
  endpoint: string,
  userId: string,
): Promise<void> {
  const rows = await pb.collection(COLLECTION).getFullList({
    filter: pb.filter("endpoint = {:e} && user != {:u}", {
      e: endpoint,
      u: userId,
    }),
    fields: "id",
  });
  for (const r of rows) {
    await pb
      .collection(COLLECTION)
      .delete(r.id)
      .catch((err: unknown) => {
        if (!(err instanceof ClientResponseError && err.status === 404)) {
          throw err;
        }
      });
  }
}

/**
 * Saves (or refreshes) this device for the caller. Same endpoint again = keys updated and
 * fail_count reset. The endpoint then belongs to the caller only: another person's rows for
 * it are dropped first (WR-A02). Returns the device id.
 */
export async function savePushSubscription(
  ctx: OrgContext,
  sub: PushSubscriptionInput,
): Promise<{ id: string }> {
  assertPerson(ctx);
  const clean = validatePushSubscription(sub);
  // One save per endpoint at a time, so two people saving one browser cannot both stay.
  return withOrgLock(`push-endpoint:${clean.endpoint}`, () =>
    saveLocked(ctx, clean),
  );
}

async function saveLocked(
  ctx: OrgContext,
  clean: ReturnType<typeof validatePushSubscription>,
): Promise<{ id: string }> {
  return withSuperuser(async (pb) => {
    await dropOtherOwners(pb, clean.endpoint, ctx.actor);
    const sameClause =
      "organization = {:org} && user = {:u} && endpoint = {:e}";
    const same = () =>
      pb.collection(COLLECTION).getList(1, 1, {
        filter: pb.filter(sameClause, {
          org: ctx.orgId,
          u: ctx.actor,
          e: clean.endpoint,
        }),
        fields: "id",
      });
    const body = {
      p256dh: clean.p256dh,
      auth: clean.auth,
      ua_family: clean.uaFamily,
      fail_count: 0,
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = (await same()).items[0];
      if (existing) {
        await pb.collection(COLLECTION).update(existing.id, body);
        return { id: existing.id };
      }
      // Cap the person's devices: the oldest go first.
      const mine = await pb.collection(COLLECTION).getFullList({
        filter: ownFilter(pb, ctx),
        sort: "created",
        fields: "id",
      });
      for (const old of mine.slice(
        0,
        Math.max(0, mine.length - MAX_PUSH_DEVICES + 1),
      )) {
        await pb.collection(COLLECTION).delete(old.id);
      }
      const id = newRecordId();
      try {
        await pb.collection(COLLECTION).create({
          id,
          organization: ctx.orgId,
          user: ctx.actor,
          endpoint: clean.endpoint,
          ...body,
        });
        return { id };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw new InvalidInput("this device is being saved elsewhere; try again");
  });
}

/** Removes one of the caller's own devices. A colleague's or unknown id → NotFound. */
export async function removePushSubscription(
  ctx: OrgContext,
  id: string,
): Promise<void> {
  assertPerson(ctx);
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new NotFound("device not found");
  }
  await withSuperuser(async (pb) => {
    const clause = "id = {:id} && organization = {:org} && user = {:u}";
    const hit = await pb.collection(COLLECTION).getList(1, 1, {
      filter: pb.filter(clause, { id, org: ctx.orgId, u: ctx.actor }),
      fields: "id",
    });
    if (hit.items.length === 0) throw new NotFound("device not found");
    await pb.collection(COLLECTION).delete(id);
  });
}

/** The caller's devices, newest first. Impersonation / system job → []. */
export async function listMyDevices(ctx: OrgContext): Promise<PushDevice[]> {
  assertOrgContext(ctx);
  if (ctx.impersonator || ctx.systemJob || !ctx.actor) return [];
  return withSuperuser(async (pb) => {
    const rows = await pb.collection(COLLECTION).getFullList({
      filter: ownFilter(pb, ctx),
      sort: "-created",
      fields: "id,ua_family,created,last_ok_at,fail_count",
    });
    return rows.map(toDevice);
  });
}
