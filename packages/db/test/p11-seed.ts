// P11 fixtures (11-09, TEN-03, invariant 1, Pitfall 6): one superuser-inserted row per org
// per P11 tenant collection, plus a second org A member (an Editor) who owns its own rows in
// the per-person collections (member_prefs, alerts, push_subscriptions). Seeded before the
// isolation suite's org A snapshot, so the "left every org A row unchanged" check covers them.
import { randomBytes } from "node:crypto";
import type PocketBase from "pocketbase";
import { mintOrgContext, type OrgContext } from "../src/context";
import type { TwoOrgs } from "./fixtures";

export const P11_COLLECTIONS = [
  "member_prefs",
  "alerts",
  "push_subscriptions",
  "social_accounts",
  "site_daily_stats",
  "member_invites",
  "data_exports",
] as const;

/** Per-person collections: every org context only sees its own rows (`personal`). */
export const P11_PERSONAL = [
  "member_prefs",
  "alerts",
  "push_subscriptions",
] as const;

export type P11Collection = (typeof P11_COLLECTIONS)[number];
export type P11Personal = (typeof P11_PERSONAL)[number];

export type P11Seed = {
  /** The owner's row in each org (org A's owner, org B's owner). */
  rows: Record<P11Collection, { A: string; B: string }>;
  /** A second org A member (Editor) and its own per-person rows. */
  editorA: {
    user: string;
    ctx: OrgContext;
    rows: Record<P11Personal, string>;
  };
};

const IP = "127.0.0.1";

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

async function personalRows(
  pb: PocketBase,
  org: string,
  user: string,
  tag: string,
): Promise<Record<P11Personal, string>> {
  const create = async (name: string, data: Record<string, unknown>) =>
    (await pb.collection(name).create({ organization: org, user, ...data })).id;
  return {
    member_prefs: await create("member_prefs", {
      today_layout: { order: [], hidden: [] },
      tours_seen: [],
      alert_channels: {},
      quiet_hours: { on: false, from: "21:00", until: "08:00" },
      dismissed: [],
      seen_flags: [],
    }),
    alerts: await create("alerts", {
      type: "form.submission",
      level: "normal",
      title: `Seed alert ${tag}`,
      safe_title: "New message",
      href: "/hub/forms",
      source_key: `seed:${tag}`,
      push_state: "pending",
    }),
    push_subscriptions: await create("push_subscriptions", {
      endpoint: `https://push.example.com/${tag}-${hex(8)}`,
      p256dh: hex(32),
      auth: hex(8),
      ua_family: "chrome",
      fail_count: 0,
    }),
  };
}

async function orgRows(
  pb: PocketBase,
  org: string,
  owner: string,
  tag: string,
): Promise<Record<P11Collection, string>> {
  const create = async (name: string, data: Record<string, unknown>) =>
    (await pb.collection(name).create({ organization: org, ...data })).id;
  const now = new Date();
  const week = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  return {
    ...(await personalRows(pb, org, owner, `${tag}-owner`)),
    social_accounts: await create("social_accounts", {
      platform: "instagram",
      label: "",
      url: `https://instagram.com/${tag}`,
      short_code: "ig",
      order: 0,
    }),
    site_daily_stats: await create("site_daily_stats", {
      day: "2026-10-01",
      path: "/",
      source: "direct",
      views: 3,
      not_found: 0,
    }),
    member_invites: await create("member_invites", {
      email: `invitee-${tag}@cds.test`,
      role: "editor",
      token_hash: hex(32),
      expires_at: week,
      invited_by: owner,
      status: "pending",
    }),
    data_exports: await create("data_exports", {
      requested_by: owner,
      status: "ready",
      object_key: `dev/tenants/${org}/exports/download-${tag}.zip`,
      size_bytes: 1024,
      requested_at: now.toISOString(),
      ready_at: now.toISOString(),
      expires_at: week,
    }),
  };
}

export async function seedP11(pb: PocketBase, seed: TwoOrgs): Promise<P11Seed> {
  const a = await orgRows(pb, seed.A.org, seed.A.owner, "a");
  const b = await orgRows(pb, seed.B.org, seed.B.owner, "b");
  const password = hex(18);
  const editor = (
    await pb.collection("users").create({
      email: "editor-a@cds.test",
      password,
      passwordConfirm: password,
    })
  ).id;
  await pb
    .collection("memberships")
    .create({ user: editor, organization: seed.A.org, role: "editor" });
  const rows = {} as P11Seed["rows"];
  for (const name of P11_COLLECTIONS) rows[name] = { A: a[name], B: b[name] };
  return {
    rows,
    editorA: {
      user: editor,
      ctx: mintOrgContext({
        orgId: seed.A.org,
        actor: editor,
        role: "editor",
        grants: [],
        ip: IP,
      }),
      rows: await personalRows(pb, seed.A.org, editor, "a-editor"),
    },
  };
}
