// P11 people attacks (11-09, TEN-03, invariant 1, Pitfall 6): member_prefs, alerts,
// push_subscriptions and member_invites.
//
// Cross-org: every collection is writes: custom, so the generic repo is read-only and org B's
// get of org A's row is NotFound.
//
// Same-org other user (Pitfall 6): member_prefs, alerts and push_subscriptions are
// `personal` in the registry, so the chokepoint pins EVERY org context to rows whose `user`
// is its actor. Org A's Editor cannot get, list or filter its way to org A's Owner's row, and
// the Owner cannot see the Editor's (the Owner role grants no window into a colleague's
// prefs, alerts or devices). An impersonating staff context (actor = staff id) sees none of
// the org's personal rows (Pitfall 7). The module functions arrive later (11-12 prefs,
// 11-20 alerts, 11-22 push); those plans add `<collection>:<area>` write attacks here and
// re-run this suite.
import { ImpersonationDenied, NotFound } from "@cds/core";
import { expect } from "vitest";
import { mintOrgContext } from "../../src/context";
import { tenantRepo } from "../../src/repository";
import {
  bellCount,
  listBell,
  markAlertRead,
  markAllRead,
} from "../../src/alerts/list";
import { readMemberPrefs, updateMemberPrefs } from "../../src/today/prefs";
import type { P11Personal, P11Seed } from "../p11-seed";
import { readOnlyAttack, type AttackEnv, type AttackMap } from "./env";

/**
 * Same-org, other-user attack on one personal collection: org A's Editor and org A's Owner
 * each see only their own row, through get, list and a caller filter naming the other user.
 */
function sameOrgOtherUser(
  env: AttackEnv,
  p11: () => P11Seed,
  name: P11Personal,
): () => Promise<void> {
  return async () => {
    const seed = env.seed();
    const { editorA, rows } = p11();
    const ownerRow = rows[name].A;
    const editorRow = editorA.rows[name];
    const repo = tenantRepo(name);
    expect("create" in repo, `${name} generic create`).toBe(false);
    expect("update" in repo, `${name} generic update`).toBe(false);
    expect("delete" in repo, `${name} generic delete`).toBe(false);

    // The other user's row is NotFound in both directions.
    await expect(repo.get(editorA.ctx, ownerRow)).rejects.toThrow(NotFound);
    await expect(repo.get(seed.ctxA, editorRow)).rejects.toThrow(NotFound);

    // Each member lists only its own row.
    const mine = await repo.list(editorA.ctx, { perPage: 500 });
    expect(mine.items.map((r) => r.id)).toEqual([editorRow]);
    const owners = await repo.list(seed.ctxA, { perPage: 500 });
    expect(owners.items.map((r) => r.id)).toEqual([ownerRow]);

    // A caller filter naming the other user is ANDed with the actor pin: nothing comes back.
    const probe = await repo.list(editorA.ctx, {
      filter: "user = {:u}",
      params: { u: seed.A.owner },
    });
    expect(probe.items).toEqual([]);

    // Staff impersonating the owner act as themselves: no member's personal rows.
    const impersonated = mintOrgContext({
      orgId: seed.A.org,
      actor: seed.B.owner,
      role: "owner",
      grants: [],
      impersonator: seed.B.owner,
      ip: "10.0.0.9",
    });
    const staff = await repo.list(impersonated, { perPage: 500 });
    expect(staff.items).toEqual([]);
  };
}

/**
 * 11-12 module writer: org B's owner saving prefs touches only its own org B row, reads never
 * return org A's row, and staff impersonating org A's owner cannot write (T-11-12-01/02).
 */
function prefsWriter(env: AttackEnv, p11: () => P11Seed): () => Promise<void> {
  return async () => {
    const seed = env.seed();
    const pb = env.pb();
    const ownerRowA = p11().rows.member_prefs.A;
    const before = await pb.collection("member_prefs").getOne(ownerRowA);
    await updateMemberPrefs(seed.ctxB, { dismissed: ["tip:attack"] });
    const after = await pb.collection("member_prefs").getOne(ownerRowA);
    expect(after.dismissed).toEqual(before.dismissed);
    expect(after.updated).toBe(before.updated);
    expect((await readMemberPrefs(seed.ctxB)).dismissed).toEqual([
      "tip:attack",
    ]);
    const impersonated = mintOrgContext({
      orgId: seed.A.org,
      actor: seed.A.owner,
      role: "owner",
      grants: [],
      impersonator: seed.B.owner,
      ip: "10.0.0.9",
    });
    await expect(
      updateMemberPrefs(impersonated, { dismissed: [] }),
    ).rejects.toThrow(ImpersonationDenied);
  };
}

/**
 * 11-20 bell reads and marks: org B's owner never lists, counts or marks org A's alert; org
 * A's Editor cannot mark the Owner's; staff impersonating org A's owner see no bell and
 * mark nothing (T-11-20-05). No org A row changes.
 */
function bellReader(env: AttackEnv, p11: () => P11Seed): () => Promise<void> {
  return async () => {
    const seed = env.seed();
    const { rows, editorA } = p11();
    const ownerAlertA = rows.alerts.A;
    const keys = new Set(["seed:a-owner", "seed:a-editor", "seed:b-owner"]);
    const listedB = await listBell(seed.ctxB, { needsYouKeys: keys });
    expect(listedB.map((r) => r.id)).not.toContain(ownerAlertA);
    await expect(markAlertRead(seed.ctxB, ownerAlertA)).rejects.toThrow(
      NotFound,
    );
    await expect(markAlertRead(editorA.ctx, ownerAlertA)).rejects.toThrow(
      NotFound,
    );
    const editorList = await listBell(editorA.ctx, { needsYouKeys: keys });
    expect(editorList.map((r) => r.id)).toEqual([editorA.rows.alerts]);
    const impersonated = mintOrgContext({
      orgId: seed.A.org,
      actor: seed.A.owner,
      role: "owner",
      grants: [],
      impersonator: seed.B.owner,
      ip: "10.0.0.9",
    });
    expect(await listBell(impersonated, { needsYouKeys: keys })).toEqual([]);
    expect(await bellCount(impersonated, keys)).toBe(0);
    expect(await markAllRead(impersonated)).toEqual({ marked: 0 });
    await markAlertRead(impersonated, ownerAlertA);
    const after = await env.pb().collection("alerts").getOne(ownerAlertA);
    expect(after.read_at).toBe("");
  };
}

export function attacks(env: AttackEnv, p11: () => P11Seed): AttackMap {
  return {
    member_prefs: readOnlyAttack(env, "member_prefs"),
    alerts: readOnlyAttack(env, "alerts"),
    push_subscriptions: readOnlyAttack(env, "push_subscriptions"),
    member_invites: readOnlyAttack(env, "member_invites"),
    "member_prefs:prefs": prefsWriter(env, p11),
    "member_prefs:other user": sameOrgOtherUser(env, p11, "member_prefs"),
    "alerts:other user": sameOrgOtherUser(env, p11, "alerts"),
    "alerts:bell": bellReader(env, p11),
    "push_subscriptions:other user": sameOrgOtherUser(
      env,
      p11,
      "push_subscriptions",
    ),
  };
}
