// 11-13 (DASH-20, DASH-21, DASH-22, DASH-27, DASH-31; D285, D312; RESEARCH Pattern 3): the
// one Needs-you source on the real PocketBase 0.39.11 binary. Core providers merged with the
// active add-ons' providers, filtered by the person's grants on the server, ordered urgent
// first then oldest, a failing provider skipped and named in `failed`.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { activeTodayProviders } from "@cds/addon-registry/server";
import { composeAddonRegistry } from "@cds/core/addons";
import { isHubHref, type NeedsYouItem } from "@cds/core/today";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { todayFixture } from "../../core/src/addons/__fixtures__/manifests";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import { listNeedsYou, type NeedsYouAddonProvider } from "../src/today";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";
const NOW = new Date("2026-10-11T12:00:00.000Z");

let inst: PbInstance | null = null;
let pb: PocketBase;

function ctx(
  orgId: string,
  actor: string,
  role: OrgContext["role"],
  extra: { grants?: string[]; impersonator?: string } = {},
): OrgContext {
  return mintOrgContext({
    orgId,
    actor,
    role,
    grants: extra.grants ?? [],
    ip: IP,
    ...(extra.impersonator ? { impersonator: extra.impersonator } : {}),
  });
}

async function newUser(email: string): Promise<string> {
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  return (
    await pb
      .collection("users")
      .create({ email, password, passwordConfirm: password, name: "Ana" })
  ).id;
}

async function newOrg(
  slug: string,
  data: Record<string, unknown> = {},
): Promise<{ org: string; owner: string; editor: string; viewer: string }> {
  const org = (
    await pb.collection("organizations").create({
      name: `Org ${slug}`,
      slug,
      status: "active",
      ...data,
    })
  ).id;
  const ids: string[] = [];
  for (const role of ["owner", "editor", "viewer"] as const) {
    const u = await newUser(`${role}-${slug}@cds.test`);
    await pb
      .collection("memberships")
      .create({ user: u, organization: org, role });
    ids.push(u);
  }
  return { org, owner: ids[0]!, editor: ids[1]!, viewer: ids[2]! };
}

async function unreadMessage(org: string): Promise<string> {
  const form = await pb.collection("forms").create({
    organization: org,
    name: "Contact",
    template: "contact",
    layout: "1",
    fields: [],
    notify_route: "inquiries",
  });
  return (
    await pb.collection("form_submissions").create({
      organization: org,
      form: form.id,
      form_name: "Contact",
      data: {},
      labels: {},
      spam: false,
    })
  ).id;
}

async function pastDue(org: string): Promise<void> {
  await pb.collection("billing_accounts").create({
    organization: org,
    provider: "fake",
    customer_id: `cus_${org}`,
    subscription_id: `sub_${org}`,
    status: "past_due",
    cadence: "monthly",
    build_plan: "full",
  });
}

const keys = (items: NeedsYouItem[]) => items.map((i) => i.key);
const base = { today: [] as NeedsYouAddonProvider[], registry: ADDON_REGISTRY };

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
});

afterAll(async () => {
  await inst?.stop();
});

describe("listNeedsYou core providers and grants (DASH-20, DASH-22)", () => {
  let o: Awaited<ReturnType<typeof newOrg>>;
  let msg: string;

  beforeAll(async () => {
    if (!inst) return;
    o = await newOrg("ny-a");
    msg = await unreadMessage(o.org);
    await pastDue(o.org);
  });

  it("Owner: urgent fix-card first, then the unread message", async (t) => {
    if (!inst) return t.skip();
    const out = await listNeedsYou(ctx(o.org, o.owner, "owner"), {
      ...base,
      now: NOW,
    });
    expect(out.failed).toEqual([]);
    expect(keys(out.items)).toEqual(["billing:fix_card", `inbox:${msg}`]);
    const [card, inbox] = out.items;
    expect(card!.level).toBe("urgent");
    expect(card!.section).toBe("settings");
    expect(card!.tab).toBe("billing");
    expect(inbox!.level).toBe("normal");
    expect(inbox!.actionLabel).toBe("Reply");
    expect(inbox!.section).toBe("inbox");
    expect(inbox!.href).toBe(`/hub/inbox?tab=messages&message=${msg}`);
    for (const i of out.items) {
      expect(isHubHref(i.href)).toBe(true);
      // Internal grant fields never leave the module.
      expect(Object.keys(i)).not.toContain("feature");
      expect(Object.keys(i)).not.toContain("access");
    }
  });

  it("Editor gets the inbox item but no billing item; Viewer gets nothing", async (t) => {
    if (!inst) return t.skip();
    const ed = await listNeedsYou(ctx(o.org, o.editor, "editor"), base);
    expect(keys(ed.items)).toEqual([`inbox:${msg}`]);
    expect(ed.failed).toEqual([]);
    const vw = await listNeedsYou(ctx(o.org, o.viewer, "viewer"), base);
    expect(vw).toEqual({ items: [], failed: [] });
  });

  it("impersonating staff sees the owner view without billing (billingNeedsYou rule)", async (t) => {
    if (!inst) return t.skip();
    const out = await listNeedsYou(
      ctx(o.org, "staff00000000001", "owner", {
        impersonator: "staff00000000001",
      }),
      base,
    );
    expect(keys(out.items)).toEqual([`inbox:${msg}`]);
  });

  it("never reads another org's rows", async (t) => {
    if (!inst) return t.skip();
    const other = await newOrg("ny-b");
    const out = await listNeedsYou(ctx(other.org, other.owner, "owner"), base);
    expect(out.items).toEqual([]);
  });
});

describe("build work while being built (DASH-31, D312)", () => {
  it("still-needed intake items appear, optional ones flagged", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("ny-build", { stage: "being_built" });
    const out = await listNeedsYou(ctx(o.org, o.owner, "owner"), base);
    expect(out.failed).toEqual([]);
    const logo = out.items.find((i) => i.key === "intake:logo");
    expect(logo).toBeDefined();
    expect(logo!.optional).toBe(true);
    expect(logo!.href.startsWith("/hub/setup/business")).toBe(true);
    const path = out.items.find((i) => i.key === "intake:path");
    expect(path).toBeDefined();
    expect(path!.optional).toBeUndefined();
    expect(out.items.some((i) => i.key === "intake:org_name")).toBe(false);
    for (const i of out.items) expect(isHubHref(i.href)).toBe(true);
    // Editors read the business but do not fill it in.
    const ed = await listNeedsYou(ctx(o.org, o.editor, "editor"), base);
    expect(ed.items.some((i) => i.key.startsWith("intake:"))).toBe(false);
  });

  it("no intake items once live", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("ny-live", { stage: "live" });
    const out = await listNeedsYou(ctx(o.org, o.owner, "owner"), base);
    expect(out.items.some((i) => i.key.startsWith("intake:"))).toBe(false);
  });

  it("an unconfirmed email route asks for confirmation", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("ny-mail");
    const route = await pb.collection("org_email_routes").create({
      organization: o.org,
      purpose: "default",
      address: "hello@ny-mail.test",
    });
    const out = await listNeedsYou(ctx(o.org, o.owner, "owner"), base);
    const item = out.items.find((i) => i.key === `email:${route.id}`);
    expect(item).toBeDefined();
    expect(item!.actionLabel).toBe("Confirm email address");
    expect(item!.tab).toBe("email");
  });

  it("an unfinished Stripe onboarding asks the Owner to finish it", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("ny-stripe");
    await pb.collection("gateway_accounts").create({
      organization: o.org,
      provider: "fake",
      account_id: "acct_nystripe",
      charges_enabled: false,
      details_submitted: false,
      status: "restricted",
    });
    const own = await listNeedsYou(ctx(o.org, o.owner, "owner"), base);
    expect(keys(own.items)).toContain("connect:setup");
    const ed = await listNeedsYou(ctx(o.org, o.editor, "editor"), base);
    expect(keys(ed.items)).not.toContain("connect:setup");
  });
});

describe("add-on providers and failure semantics (DASH-21, Pattern 3)", () => {
  const registry = composeAddonRegistry([todayFixture], {
    fileExists: () => true,
  });
  const fixtureItem = (over: Partial<NeedsYouItem> = {}): NeedsYouItem => ({
    key: "today-fixture:ping",
    kind: "today-fixture.ping",
    level: "normal",
    title: "A fixture needs you",
    actionLabel: "Open",
    href: "/hub/addons/today-fixture",
    section: "addon:today-fixture",
    at: "2026-10-01T12:00:00.000Z",
    ...over,
  });
  const servers = {
    "today-fixture": {
      today: { needsYou: async () => [fixtureItem()] },
    },
  };

  it("the active fixture add-on's item appears; paused it is absent", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("ny-addon");
    const c = ctx(o.org, o.owner, "owner");
    const active = activeTodayProviders(registry, servers, ["today-fixture"]);
    const on = await listNeedsYou(c, { ...base, today: active });
    expect(keys(on.items)).toEqual(["today-fixture:ping"]);
    const paused = activeTodayProviders(
      registry,
      servers,
      ["today-fixture"],
      ["today-fixture"],
    );
    const off = await listNeedsYou(c, { ...base, today: paused });
    expect(off.items).toEqual([]);
  });

  it("add-on items need the add-on grant", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("ny-grant");
    const today = activeTodayProviders(registry, servers, ["today-fixture"]);
    const without = await listNeedsYou(ctx(o.org, o.editor, "editor"), {
      ...base,
      today,
    });
    expect(without.items).toEqual([]);
    const withGrant = await listNeedsYou(
      ctx(o.org, o.editor, "editor", { grants: ["today-fixture"] }),
      { ...base, today },
    );
    expect(keys(withGrant.items)).toEqual(["today-fixture:ping"]);
  });

  it("a throwing provider is skipped and named; the others still show", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("ny-fail");
    const msg = await unreadMessage(o.org);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await listNeedsYou(ctx(o.org, o.owner, "owner"), {
      ...base,
      today: [
        {
          slug: "boom",
          needsYou: async () => {
            throw new TypeError("secret detail");
          },
        },
      ],
    });
    expect(out.failed).toEqual(["addon:boom"]);
    expect(keys(out.items)).toEqual([`inbox:${msg}`]);
    const logged = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("[needs-you] addon:boom failed TypeError");
    expect(logged).not.toContain("secret detail");
    log.mockRestore();
  });

  it("drops add-on items with an external href or a foreign key or section", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("ny-spoof");
    const bad = [
      fixtureItem({ key: "today-fixture:ext", href: "https://evil.test/x" }),
      fixtureItem({ key: "today-fixture:pr", href: "//evil.test" }),
      fixtureItem({ key: "billing:fix_card" }),
      fixtureItem({ key: "today-fixture:sec", section: "settings" }),
      fixtureItem({ key: "today-fixture:ok" }),
    ];
    const out = await listNeedsYou(ctx(o.org, o.owner, "owner"), {
      ...base,
      today: [{ slug: "today-fixture", needsYou: async () => bad }],
    });
    expect(keys(out.items)).toEqual(["today-fixture:ok"]);
  });
});
