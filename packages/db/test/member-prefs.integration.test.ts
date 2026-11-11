// 11-12: per-person member prefs (DASH-17, DASH-22, DASH-33, DASH-36; Pitfall 6, Pitfall 7).
// Each person's Today layout, tours, alert channels, quiet hours, dismissals and seen flags
// live in one member_prefs row per (org, user). Reads and writes are pinned to ctx.actor;
// impersonating staff read the defaults and can never write (T-11-12-01, T-11-12-02).
import { randomBytes } from "node:crypto";
import { ImpersonationDenied, InvalidInput } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import {
  DEFAULT_MEMBER_PREFS,
  markDismissed,
  markSeen,
  markTourSeen,
  readMemberPrefs,
  resetAlertChannels,
  resetTours,
  setAlertChannel,
  updateMemberPrefs,
} from "../src/today/prefs";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;

const tag = () => randomBytes(4).toString("hex");

async function newUser(): Promise<string> {
  const password = randomBytes(18).toString("hex");
  return (
    await pb.collection("users").create({
      email: `prefs-${tag()}@cds.test`,
      password,
      passwordConfirm: password,
    })
  ).id;
}

async function newOrg(): Promise<{
  org: string;
  owner: string;
  ctx: OrgContext;
}> {
  const t = tag();
  const org = (
    await pb.collection("organizations").create({
      name: `Prefs ${t}`,
      slug: `prefs-${t}`,
      status: "active",
      path: "standard",
    })
  ).id;
  const owner = await newUser();
  await pb
    .collection("memberships")
    .create({ user: owner, organization: org, role: "owner" });
  return { org, owner, ctx: ctxFor(org, owner, "owner") };
}

function ctxFor(
  orgId: string,
  actor: string,
  role: "owner" | "editor",
  impersonator?: string,
): OrgContext {
  return mintOrgContext({
    orgId,
    actor,
    role,
    grants: [],
    ...(impersonator ? { impersonator } : {}),
    ip: "127.0.0.1",
  });
}

async function rowsFor(org: string, user: string) {
  return pb.collection("member_prefs").getFullList({
    filter: pb.filter("organization = {:org} && user = {:u}", { org, u: user }),
  });
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
});

afterAll(async () => {
  await inst?.stop();
});

describe("member prefs (DASH-22, DASH-36)", () => {
  it("first read returns the defaults; update then read returns the patch", async (t) => {
    if (!inst) return t.skip();
    const { ctx, org, owner } = await newOrg();
    expect(await readMemberPrefs(ctx)).toEqual(DEFAULT_MEMBER_PREFS);
    expect(DEFAULT_MEMBER_PREFS.quietHours).toEqual({
      on: true,
      from: "21:00",
      until: "07:00",
    });
    expect(await rowsFor(org, owner)).toHaveLength(0);

    const saved = await updateMemberPrefs(ctx, {
      todayLayout: {
        order: ["inquiries", "addon:appointments"],
        hidden: ["tips"],
      },
      quietHours: { on: false, from: "22:30", until: "06:00" },
      alertChannels: { "form.submission": { email: true, push: false } },
    });
    const read = await readMemberPrefs(ctx);
    expect(read).toEqual(saved);
    expect(read.todayLayout).toEqual({
      order: ["inquiries", "addon:appointments"],
      hidden: ["tips"],
    });
    expect(read.quietHours).toEqual({
      on: false,
      from: "22:30",
      until: "06:00",
    });
    expect(read.alertChannels).toEqual({
      "form.submission": { email: true, push: false },
    });
    expect(read.toursSeen).toEqual([]);
    expect(await rowsFor(org, owner)).toHaveLength(1);
  });

  it("a second member in the same org sees their own defaults", async (t) => {
    if (!inst) return t.skip();
    const { ctx, org } = await newOrg();
    await updateMemberPrefs(ctx, { dismissed: ["tip:photos"] });
    const editor = await newUser();
    await pb
      .collection("memberships")
      .create({ user: editor, organization: org, role: "editor" });
    const editorCtx = ctxFor(org, editor, "editor");
    expect(await readMemberPrefs(editorCtx)).toEqual(DEFAULT_MEMBER_PREFS);
    await markSeen(editorCtx, "live:celebrated");
    expect((await readMemberPrefs(ctx)).seenFlags).toEqual([]);
    expect((await readMemberPrefs(editorCtx)).dismissed).toEqual([]);
  });

  it("under impersonation, read returns defaults and every write is refused", async (t) => {
    if (!inst) return t.skip();
    const { ctx, org, owner } = await newOrg();
    await updateMemberPrefs(ctx, { toursSeen: ["today"] });
    const staff = await newUser();
    for (const imp of [
      ctxFor(org, owner, "owner", staff),
      ctxFor(org, staff, "owner", staff),
    ]) {
      expect(await readMemberPrefs(imp)).toEqual(DEFAULT_MEMBER_PREFS);
      await expect(updateMemberPrefs(imp, { toursSeen: [] })).rejects.toThrow(
        ImpersonationDenied,
      );
      await expect(markSeen(imp, "x")).rejects.toThrow(ImpersonationDenied);
      await expect(markDismissed(imp, "x")).rejects.toThrow(
        ImpersonationDenied,
      );
      await expect(resetTours(imp)).rejects.toThrow(ImpersonationDenied);
      await expect(
        setAlertChannel(imp, "form.submission", "push", false),
      ).rejects.toThrow(ImpersonationDenied);
      await expect(resetAlertChannels(imp)).rejects.toThrow(
        ImpersonationDenied,
      );
    }
    expect((await readMemberPrefs(ctx)).toursSeen).toEqual(["today"]);
    expect(await rowsFor(org, staff)).toHaveLength(0);
  });

  it("refuses off-step times, too many ids, bad ids and unknown keys", async (t) => {
    if (!inst) return t.skip();
    const { ctx, org, owner } = await newOrg();
    await expect(
      updateMemberPrefs(ctx, {
        quietHours: { on: true, from: "21:15", until: "07:00" },
      }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      updateMemberPrefs(ctx, {
        quietHours: { on: true, from: "24:00", until: "07:00" },
      }),
    ).rejects.toThrow(InvalidInput);
    const many = Array.from({ length: 101 }, (_, i) => `card-${i}`);
    await expect(
      updateMemberPrefs(ctx, { todayLayout: { order: [], hidden: many } }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      updateMemberPrefs(ctx, { dismissed: ["Bad Id"] }),
    ).rejects.toThrow(InvalidInput);
    await expect(markSeen(ctx, "x".repeat(81))).rejects.toThrow(InvalidInput);
    await expect(
      updateMemberPrefs(ctx, {
        alertChannels: { "form.submission": { sms: true } as never },
      }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      updateMemberPrefs(ctx, { role: "owner" } as never),
    ).rejects.toThrow(InvalidInput);
    expect(await rowsFor(org, owner)).toHaveLength(0);
    // 100 is the cap, not past it.
    const hundred = many.slice(0, 100);
    const ok = await updateMemberPrefs(ctx, {
      todayLayout: { order: [], hidden: hundred },
    });
    expect(ok.todayLayout.hidden).toHaveLength(100);
  });

  it("helpers: seen, dismissed, tours and alert channels", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await newOrg();
    await markSeen(ctx, "live:celebrated");
    await markSeen(ctx, "live:celebrated");
    await markDismissed(ctx, "announcement:abc123");
    await updateMemberPrefs(ctx, { toursSeen: ["today", "pages"] });
    await setAlertChannel(ctx, "form.submission", "push", false);
    await setAlertChannel(ctx, "form.submission", "email", true);
    let p = await readMemberPrefs(ctx);
    expect(p.seenFlags).toEqual(["live:celebrated"]);
    expect(p.dismissed).toEqual(["announcement:abc123"]);
    expect(p.toursSeen).toEqual(["today", "pages"]);
    expect(p.alertChannels).toEqual({
      "form.submission": { push: false, email: true },
    });
    await resetTours(ctx);
    await resetAlertChannels(ctx);
    p = await readMemberPrefs(ctx);
    expect(p.toursSeen).toEqual([]);
    expect(p.alertChannels).toEqual({});
    expect(p.seenFlags).toEqual(["live:celebrated"]);
  });

  it("concurrent upserts never create two rows", async (t) => {
    if (!inst) return t.skip();
    const { ctx, org, owner } = await newOrg();
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        updateMemberPrefs(ctx, { dismissed: [`tip:t${i}`] }),
      ),
    );
    expect(await rowsFor(org, owner)).toHaveLength(1);
    expect((await readMemberPrefs(ctx)).dismissed).toHaveLength(1);
  });

  it("tours finished at the same time in two tabs are all kept (IN-E02)", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await newOrg();
    const ids = ["today", "pages", "media", "inbox"];
    await Promise.all(ids.map((id) => markTourSeen(ctx, id)));
    await markTourSeen(ctx, "today");
    expect([...(await readMemberPrefs(ctx)).toursSeen].sort()).toEqual(
      [...ids].sort(),
    );
    await expect(markTourSeen(ctx, "bad id!")).rejects.toThrow(InvalidInput);
  });
});
