// P11 alerts/push store (11-22; DASH-36): the internal reads and writes the delivery path makes
// on push_subscriptions. Internal to @cds/db (never in the alerts barrel): raise.ts and the
// 11-23 job call these with the superuser client they already hold.
//
// - subscriptionsForUsers: every device of the given people in one org (bound filter).
// - markGone: the push service said 404/410, so the device unsubscribed; delete the row.
// - markFailed / markOk: fail_count bookkeeping for "error" / "ok" outcomes.
// Every function swallows a missing row (a concurrent delete is not an error).
import type PocketBase from "pocketbase";
import { ClientResponseError } from "pocketbase";
import type { PushOutcome, PushSubscriptionKeys } from "./port";

const COLLECTION = "push_subscriptions";

export type StoredSubscription = PushSubscriptionKeys & {
  id: string;
  user: string;
  failCount: number;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function missing(err: unknown): boolean {
  return err instanceof ClientResponseError && err.status === 404;
}

/** Every stored device of `userIds` in `orgId`. Empty input → []. */
export async function subscriptionsForUsers(
  pb: PocketBase,
  orgId: string,
  userIds: readonly string[],
): Promise<StoredSubscription[]> {
  const users = [...new Set(userIds.filter((u) => u))];
  if (!orgId || users.length === 0) return [];
  const params: Record<string, string> = { org: orgId };
  const ors = users.map((u, i) => {
    params["u" + i] = u;
    return "user = {:u" + i + "}";
  });
  const clause = "organization = {:org} && (" + ors.join(" || ") + ")";
  const rows = await pb.collection(COLLECTION).getFullList({
    filter: pb.filter(clause, params),
    fields: "id,user,endpoint,p256dh,auth,fail_count",
  });
  return rows.map((r) => ({
    id: r.id,
    user: str(r.user),
    endpoint: str(r.endpoint),
    p256dh: str(r.p256dh),
    auth: str(r.auth),
    failCount: typeof r.fail_count === "number" ? r.fail_count : 0,
  }));
}

/**
 * Sign-out (review 11 WR-A02, WR-E01): delete every row `userId` holds for `endpoint`, in
 * every org. Called only by forgetPushDeviceForSession (auth.ts), which takes the user from
 * the session token, never from input. Returns the rows removed.
 */
export async function removeEndpointRows(
  pb: PocketBase,
  userId: string,
  endpoint: string,
): Promise<number> {
  const rows = await pb.collection(COLLECTION).getFullList({
    filter: pb.filter("endpoint = {:e} && user = {:u}", {
      e: endpoint,
      u: userId,
    }),
    fields: "id",
  });
  let n = 0;
  for (const r of rows) {
    try {
      await pb.collection(COLLECTION).delete(r.id);
      n += 1;
    } catch (err) {
      if (!missing(err)) throw err;
    }
  }
  return n;
}

/** 404/410 from the push service: the subscription no longer exists. */
export async function markGone(pb: PocketBase, id: string): Promise<void> {
  try {
    await pb.collection(COLLECTION).delete(id);
  } catch (err) {
    if (!missing(err)) throw err;
  }
}

/** Any other failure: count it (11-23 / 11-24 may surface repeated failures). */
export async function markFailed(
  pb: PocketBase,
  sub: Pick<StoredSubscription, "id" | "failCount">,
): Promise<void> {
  try {
    await pb
      .collection(COLLECTION)
      .update(sub.id, { fail_count: sub.failCount + 1 });
  } catch (err) {
    if (!missing(err)) throw err;
  }
}

/** A delivered push: stamp last_ok_at and reset fail_count. */
export async function markOk(
  pb: PocketBase,
  sub: Pick<StoredSubscription, "id">,
  now: Date,
): Promise<void> {
  try {
    await pb
      .collection(COLLECTION)
      .update(sub.id, { last_ok_at: now.toISOString(), fail_count: 0 });
  } catch (err) {
    if (!missing(err)) throw err;
  }
}

/** Book-keeping for one send outcome. Never throws (delivery must not fail on it). */
export async function recordOutcome(
  pb: PocketBase,
  sub: Pick<StoredSubscription, "id" | "failCount">,
  outcome: PushOutcome,
  now: Date,
): Promise<void> {
  try {
    if (outcome === "gone") await markGone(pb, sub.id);
    else if (outcome === "error") await markFailed(pb, sub);
    else await markOk(pb, sub, now);
  } catch {
    console.error("[alerts] push subscription bookkeeping failed");
  }
}

/**
 * The app-icon badge sent with a push: the person's unread alerts from the bell's 30 days.
 * ponytail: ignores Needs-you clearing (needs the request's keys); the hub resets the badge to
 * the exact bell count on its next load.
 */
export async function unreadForBadge(
  pb: PocketBase,
  org: string,
  user: string,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const res = await pb.collection("alerts").getList(1, 1, {
    filter: pb.filter(
      "organization = {:org} && user = {:u} && read_at = '' && created >= {:since}",
      { org, u: user, since },
    ),
    fields: "id",
  });
  return res.totalItems;
}
