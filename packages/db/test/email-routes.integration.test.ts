// Email routing on the real PocketBase 0.39.11 binary (ONB-09, ONB-10, D173; UI-SPEC Email
// routing; T-06-57..59, T-06-62): per-purpose routes, hashed single-use confirm tokens,
// describe-never-mutates, the default change that keeps the old address until confirmed,
// resend cooldown, removal rules, the bounce seam and role checks.
import { Forbidden, InvalidInput, RateLimited } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  mintOrgContext,
  mintSystemContext,
  type OrgContext,
} from "../src/context";
import { addSuppression, captureTransport } from "../src/email";
import {
  CONFIRM_SENDS_PER_ORG,
  resetConfirmSendLimitsForTests,
} from "../src/rate-limit";
import {
  addEmailRoute,
  changeDefaultRoute,
  confirmEmailRoute,
  describeRouteConfirm,
  listEmailRoutes,
  recordBounce,
  removeEmailRoute,
  resendRouteConfirmation,
  setNewsletterSender,
} from "../src/intake";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";
const DAY = 24 * 60 * 60 * 1000;
let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;

function ctxAs(
  orgId: string,
  role: OrgContext["role"],
  impersonator?: string,
): OrgContext {
  return mintOrgContext({
    orgId,
    actor: seed.A.owner,
    role,
    grants: [],
    ip: IP,
    ...(impersonator ? { impersonator } : {}),
  });
}

/** A fresh org with a confirmed default route, as Submit leaves it. */
async function freshOrg(
  name = "Rivera Bakery",
): Promise<{ org: string; ctx: OrgContext; defaultId: string }> {
  const org = (
    await pb.collection("organizations").create({
      name,
      slug: `er-${Math.random().toString(36).slice(2, 10)}`,
      status: "active",
    })
  ).id;
  const defaultId = (
    await pb.collection("org_email_routes").create({
      organization: org,
      purpose: "default",
      address: "maria@gmail.com",
      confirmed_at: new Date().toISOString(),
    })
  ).id;
  return { org, ctx: ctxAs(org, "owner"), defaultId };
}

function tokenOf(t: ReturnType<typeof captureTransport>, i = -1): string {
  const msg = t.sent.at(i)!;
  const m = /\/start\/confirm-email\?t=([A-Za-z0-9_-]{43})/.exec(msg.text);
  expect(m).not.toBeNull();
  return m![1]!;
}

async function auditCount(org: string, action: string): Promise<number> {
  return (
    await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = {:a}", {
        o: org,
        a: action,
      }),
    })
  ).length;
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(() => resetConfirmSendLimitsForTests());

describe("confirm email limits (A-WR-01)", () => {
  it("a remove/add loop stops sending once the org's hourly budget is spent; nothing is written", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await freshOrg();
    const transport = captureTransport();
    for (let i = 0; i < CONFIRM_SENDS_PER_ORG; i++) {
      const r = await addEmailRoute(
        ctx,
        { purpose: "billing", address: `loop${i}@example.com` },
        { transport },
      );
      await removeEmailRoute(ctx, r.id);
    }
    await expect(
      addEmailRoute(
        ctx,
        { purpose: "billing", address: "one-more@example.com" },
        { transport },
      ),
    ).rejects.toThrow(RateLimited);
    await expect(
      changeDefaultRoute(ctx, "new-default@example.com", { transport }),
    ).rejects.toThrow(RateLimited);
    expect(transport.sent).toHaveLength(CONFIRM_SENDS_PER_ORG);
    const rows = await pb.collection("org_email_routes").getFullList({
      filter: pb.filter("organization = {:o}", { o: org }),
    });
    expect(rows.map((r) => r.purpose)).toEqual(["default"]);
  });
});

describe("adding routes", () => {
  it("adds a waiting inquiries route and sends email.confirm; only the hash is stored", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await freshOrg();
    const transport = captureTransport();
    const route = await addEmailRoute(
      ctx,
      { purpose: "inquiries", address: "Orders@RiveraBakery.com" },
      { transport },
    );
    expect(route).toMatchObject({
      purpose: "inquiries",
      address: "orders@riverabakery.com",
      status: "waiting",
      pendingDefault: false,
    });
    expect(route).not.toHaveProperty("confirm_hash");
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.type).toBe("email.confirm");
    expect(transport.sent[0]!.to).toBe("orders@riverabakery.com");
    expect(transport.sent[0]!.text).toContain("website inquiries");
    const token = tokenOf(transport);
    const row = await pb.collection("org_email_routes").getOne(route.id);
    expect(row.confirm_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(await auditCount(org, "org_email_routes.create")).toBe(1);
  });

  it("refuses a 6th inquiries address", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await freshOrg();
    const transport = captureTransport();
    for (let i = 1; i <= 5; i++) {
      await addEmailRoute(
        ctx,
        { purpose: "inquiries", address: `in${i}@riverabakery.com` },
        { transport },
      );
    }
    await expect(
      addEmailRoute(
        ctx,
        { purpose: "inquiries", address: "in6@riverabakery.com" },
        { transport },
      ),
    ).rejects.toThrow(InvalidInput);
    expect(transport.sent).toHaveLength(5);
  });

  it("C-WR-04: replaces swaps an inquiry row at the cap in one batch; a foreign or unknown row is refused", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await freshOrg();
    const other = await freshOrg("Other Bakery");
    const transport = captureTransport();
    const rows = [];
    for (let i = 1; i <= 5; i++) {
      rows.push(
        await addEmailRoute(
          ctx,
          { purpose: "inquiries", address: `in${i}@riverabakery.com` },
          { transport },
        ),
      );
    }
    const swapped = await addEmailRoute(
      ctx,
      {
        purpose: "inquiries",
        address: "in6@riverabakery.com",
        replaces: rows[2]!.id,
      },
      { transport },
    );
    const inq = (await listEmailRoutes(ctx)).filter(
      (r) => r.purpose === "inquiries",
    );
    expect(inq.map((r) => r.address).sort()).toEqual([
      "in1@riverabakery.com",
      "in2@riverabakery.com",
      "in4@riverabakery.com",
      "in5@riverabakery.com",
      "in6@riverabakery.com",
    ]);
    expect(inq.some((r) => r.id === swapped.id)).toBe(true);
    // Another org's row, or a row already gone, can't be replaced; nothing is written.
    const foreign = await addEmailRoute(
      other.ctx,
      { purpose: "inquiries", address: "x@otherbakery.com" },
      { transport },
    );
    await expect(
      addEmailRoute(
        ctx,
        {
          purpose: "inquiries",
          address: "in7@riverabakery.com",
          replaces: foreign.id,
        },
        { transport },
      ),
    ).rejects.toThrow("isn't on the list anymore");
    await expect(
      addEmailRoute(
        ctx,
        {
          purpose: "inquiries",
          address: "in7@riverabakery.com",
          replaces: rows[2]!.id,
        },
        { transport },
      ),
    ).rejects.toThrow(InvalidInput);
    expect(
      (await listEmailRoutes(other.ctx)).some((r) => r.id === foreign.id),
    ).toBe(true);
    expect(
      (await listEmailRoutes(ctx)).filter((r) => r.purpose === "inquiries"),
    ).toHaveLength(5);
    await expect(
      addEmailRoute(ctx, {
        purpose: "billing",
        address: "b@riverabakery.com",
        replaces: rows[0]!.id,
      }),
    ).rejects.toThrow(InvalidInput);
  });

  it("refuses a duplicate in the same purpose and a bad format", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await freshOrg();
    const transport = captureTransport();
    await addEmailRoute(
      ctx,
      { purpose: "inquiries", address: "a@riverabakery.com" },
      { transport },
    );
    await expect(
      addEmailRoute(
        ctx,
        { purpose: "inquiries", address: " A@riverabakery.com " },
        { transport },
      ),
    ).rejects.toThrow("This address is already on the list.");
    await expect(
      addEmailRoute(ctx, { purpose: "inquiries", address: "nope" }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      addEmailRoute(ctx, {
        purpose: "default" as "inquiries",
        address: "x@riverabakery.com",
      }),
    ).rejects.toThrow(InvalidInput);
  });

  it("refuses an address on the suppression list (scope all)", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await freshOrg();
    await addSuppression(ctx, {
      organization: org,
      email: "gone@riverabakery.com",
      reason: "bounce",
      scope: "all",
      sourceType: "test",
    });
    await expect(
      addEmailRoute(ctx, {
        purpose: "billing",
        address: "gone@riverabakery.com",
      }),
    ).rejects.toThrow(
      "Emails to this address bounced before. Check the spelling, or use another address.",
    );
  });

  it("a one-address purpose replaces its old address; the newsletter keeps its sender name", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await freshOrg();
    const transport = captureTransport();
    await addEmailRoute(
      ctx,
      { purpose: "newsletter", address: "news@riverabakery.com" },
      { transport },
    );
    await setNewsletterSender(ctx, "  Rivera   News ");
    await addEmailRoute(
      ctx,
      { purpose: "newsletter", address: "letters@riverabakery.com" },
      { transport },
    );
    const news = (await listEmailRoutes(ctx)).filter(
      (r) => r.purpose === "newsletter",
    );
    expect(news).toHaveLength(1);
    expect(news[0]).toMatchObject({
      address: "letters@riverabakery.com",
      senderName: "Rivera News",
    });
    await expect(setNewsletterSender(ctx, "x".repeat(121))).rejects.toThrow(
      InvalidInput,
    );
  });

  it("a confirmed one-address route keeps working until its replacement is confirmed (A-WR-05)", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await freshOrg();
    const transport = captureTransport();
    await addEmailRoute(
      ctx,
      { purpose: "billing", address: "books@riverabakery.com" },
      { transport },
    );
    await confirmEmailRoute(tokenOf(transport));
    await addEmailRoute(
      ctx,
      { purpose: "billing", address: "typo@riverabakery.con" },
      { transport },
    );
    // A second change replaces the pending typo, never the working address.
    await addEmailRoute(
      ctx,
      { purpose: "billing", address: "accounts@riverabakery.com" },
      { transport },
    );
    const billing = () =>
      listEmailRoutes(ctx).then((l) =>
        l
          .filter((r) => r.purpose === "billing")
          .map((r) => [r.address, r.status]),
      );
    expect(await billing()).toEqual([
      ["books@riverabakery.com", "confirmed"],
      ["accounts@riverabakery.com", "waiting"],
    ]);
    await confirmEmailRoute(tokenOf(transport));
    expect(await billing()).toEqual([
      ["accounts@riverabakery.com", "confirmed"],
    ]);
  });

  it("setNewsletterSender needs a newsletter route", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await freshOrg();
    await expect(setNewsletterSender(ctx, "Rivera")).rejects.toThrow(
      "Add a newsletter reply-to address first.",
    );
  });
});

describe("confirming (token-only, POST callers)", () => {
  it("describe does not change state; confirm sets confirmed_at and clears the hash; single use", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await freshOrg("Rivera Bakery");
    const transport = captureTransport();
    const route = await addEmailRoute(
      ctx,
      { purpose: "inquiries", address: "orders@riverabakery.com" },
      { transport },
    );
    const token = tokenOf(transport);
    const d = await describeRouteConfirm(token);
    expect(d).toEqual({
      orgName: "Rivera Bakery",
      address: "orders@riverabakery.com",
      purposeLabel: "website inquiries",
      state: "valid",
    });
    expect(
      (await pb.collection("org_email_routes").getOne(route.id)).confirmed_at,
    ).toBe("");
    const c = await confirmEmailRoute(token);
    expect(c).toEqual({
      orgName: "Rivera Bakery",
      address: "orders@riverabakery.com",
      purposeLabel: "website inquiries",
    });
    const row = await pb.collection("org_email_routes").getOne(route.id);
    expect(row.confirmed_at).not.toBe("");
    expect(row.confirm_hash).toBe("");
    expect(await confirmEmailRoute(token)).toBeNull();
    expect(await describeRouteConfirm(token)).toBeNull();
    expect(await auditCount(org, "org_email_routes.confirm")).toBe(1);
    expect(
      (await listEmailRoutes(ctx)).find((r) => r.id === route.id)?.status,
    ).toBe("confirmed");
  });

  it("an expired token describes as expired and does not confirm", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await freshOrg();
    const transport = captureTransport();
    await addEmailRoute(
      ctx,
      { purpose: "account", address: "acct@riverabakery.com" },
      { transport },
    );
    const token = tokenOf(transport);
    const later = new Date(Date.now() + 7 * DAY + 60_000);
    expect((await describeRouteConfirm(token, { now: later }))?.state).toBe(
      "expired",
    );
    expect(await confirmEmailRoute(token, { now: later })).toBeNull();
    expect(await confirmEmailRoute(token)).not.toBeNull();
  });

  it("malformed and unknown tokens are null", async (t) => {
    if (!inst) return t.skip();
    expect(await describeRouteConfirm("short")).toBeNull();
    expect(await confirmEmailRoute("x' || 1=1 --")).toBeNull();
    expect(await confirmEmailRoute("A".repeat(43))).toBeNull();
  });
});

describe("changing the default", () => {
  it("keeps the old default until the new one is confirmed", async (t) => {
    if (!inst) return t.skip();
    const { ctx, defaultId } = await freshOrg();
    const transport = captureTransport();
    const pending = await changeDefaultRoute(ctx, "new@riverabakery.com", {
      transport,
    });
    expect(pending).toMatchObject({
      purpose: "default",
      status: "waiting",
      pendingDefault: true,
    });
    const before = await listEmailRoutes(ctx);
    expect(before.filter((r) => r.purpose === "default")).toHaveLength(2);
    expect(before.find((r) => r.id === defaultId)?.status).toBe("confirmed");
    expect(transport.sent[0]!.text).toContain("all its email");

    await confirmEmailRoute(tokenOf(transport));
    const after = (await listEmailRoutes(ctx)).filter(
      (r) => r.purpose === "default",
    );
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      address: "new@riverabakery.com",
      status: "confirmed",
      pendingDefault: false,
    });
  });

  it("the same address as the confirmed default is a duplicate", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await freshOrg();
    await expect(changeDefaultRoute(ctx, "MARIA@gmail.com")).rejects.toThrow(
      "This address is already on the list.",
    );
  });
});

describe("resend and remove", () => {
  it("resend within 60 s is RateLimited; after 60 s a new token replaces the old", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await freshOrg();
    const transport = captureTransport();
    const route = await addEmailRoute(
      ctx,
      { purpose: "billing", address: "bills@riverabakery.com" },
      { transport },
    );
    const oldToken = tokenOf(transport);
    await expect(
      resendRouteConfirmation(ctx, route.id, { transport }),
    ).rejects.toThrow(RateLimited);
    await resendRouteConfirmation(ctx, route.id, {
      transport,
      now: new Date(Date.now() + 61_000),
    });
    expect(transport.sent).toHaveLength(2);
    const newToken = tokenOf(transport);
    expect(newToken).not.toBe(oldToken);
    expect(await confirmEmailRoute(oldToken)).toBeNull();
    expect(await confirmEmailRoute(newToken)).not.toBeNull();
    await expect(
      resendRouteConfirmation(ctx, route.id, {
        transport,
        now: new Date(Date.now() + 200_000),
      }),
    ).rejects.toThrow(InvalidInput);
  });

  it("the default can't be removed; an inquiries route can", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx, defaultId } = await freshOrg();
    await expect(removeEmailRoute(ctx, defaultId)).rejects.toThrow(
      InvalidInput,
    );
    const route = await addEmailRoute(
      ctx,
      { purpose: "inquiries", address: "x@riverabakery.com" },
      { transport: captureTransport() },
    );
    await removeEmailRoute(ctx, route.id);
    expect((await listEmailRoutes(ctx)).map((r) => r.id)).toEqual([defaultId]);
    expect(await auditCount(org, "org_email_routes.remove")).toBe(1);
  });
});

describe("bounces (P12 seam)", () => {
  it("a hard bounce marks every matching route and suppresses per org", async (t) => {
    if (!inst) return t.skip();
    const one = await freshOrg("One");
    const two = await freshOrg("Two");
    const transport = captureTransport();
    await addEmailRoute(
      one.ctx,
      { purpose: "inquiries", address: "shared@riverabakery.com" },
      { transport },
    );
    await addEmailRoute(
      two.ctx,
      { purpose: "billing", address: "shared@riverabakery.com" },
      { transport },
    );
    const system = mintSystemContext({ job: "test-bounce" });
    expect(
      await recordBounce(system, {
        email: "shared@riverabakery.com",
        hard: false,
      }),
    ).toBe(0);
    expect(
      await recordBounce(system, {
        email: "Shared@riverabakery.com",
        hard: true,
      }),
    ).toBe(2);
    for (const o of [one, two]) {
      const r = (await listEmailRoutes(o.ctx)).find(
        (x) => x.address === "shared@riverabakery.com",
      );
      expect(r?.status).toBe("bouncing");
      const sup = await pb.collection("email_suppressions").getFullList({
        filter: pb.filter("organization = {:o} && email = {:e}", {
          o: o.org,
          e: "shared@riverabakery.com",
        }),
      });
      expect(sup.map((s) => s.scope)).toContain("all");
      expect(await auditCount(o.org, "org_email_routes.bounce")).toBe(1);
    }
    await expect(
      addEmailRoute(one.ctx, {
        purpose: "account",
        address: "shared@riverabakery.com",
      }),
    ).rejects.toThrow("Emails to this address bounced before.");
  });

  it("orgId limits the bounce to one org; an org context is refused", async (t) => {
    if (!inst) return t.skip();
    const one = await freshOrg("One");
    const two = await freshOrg("Two");
    const system = mintSystemContext({ job: "test-bounce" });
    expect(
      await recordBounce(system, {
        email: "maria@gmail.com",
        hard: true,
        orgId: one.org,
      }),
    ).toBe(1);
    expect((await listEmailRoutes(one.ctx))[0]!.status).toBe("bouncing");
    expect((await listEmailRoutes(two.ctx))[0]!.status).toBe("confirmed");
    await expect(
      recordBounce(one.ctx as never, { email: "maria@gmail.com", hard: true }),
    ).rejects.toThrow();
  });
});

describe("roles", () => {
  it("an Editor can list but not add; impersonating staff can add (audited)", async (t) => {
    if (!inst) return t.skip();
    const { org } = await freshOrg();
    const editor = ctxAs(org, "editor");
    expect(await listEmailRoutes(editor)).toHaveLength(1);
    await expect(
      addEmailRoute(editor, {
        purpose: "inquiries",
        address: "e@riverabakery.com",
      }),
    ).rejects.toThrow(Forbidden);
    const staff = ctxAs(org, "owner", seed.A.owner);
    const route = await addEmailRoute(
      staff,
      { purpose: "inquiries", address: "s@riverabakery.com" },
      { transport: captureTransport() },
    );
    const rows = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && target_id = {:id}", {
        o: org,
        id: route.id,
      }),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.impersonator).toBe(seed.A.owner);
  });

  it("another org's route id is NotFound for resend and remove", async (t) => {
    if (!inst) return t.skip();
    const a = await freshOrg("A");
    const b = await freshOrg("B");
    const route = await addEmailRoute(
      a.ctx,
      { purpose: "inquiries", address: "a@riverabakery.com" },
      { transport: captureTransport() },
    );
    await expect(removeEmailRoute(b.ctx, route.id)).rejects.toThrow();
    await expect(
      resendRouteConfirmation(b.ctx, route.id, {
        now: new Date(Date.now() + 120_000),
      }),
    ).rejects.toThrow();
    expect((await listEmailRoutes(a.ctx)).some((r) => r.id === route.id)).toBe(
      true,
    );
  });
});
