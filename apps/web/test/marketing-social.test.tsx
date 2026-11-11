// @vitest-environment jsdom
// 11-37 Task 2: /hub/marketing?tab=social and the social actions (DASH-14, DASH-15, DASH-16;
// 11-UI-SPEC "Marketing › Social"; T-11-37-01, T-11-37-02). The real server page and actions
// over a mocked session and @cds/db.
import { Forbidden } from "@cds/core";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../../../packages/ui/src/test-support/dom";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/hub/marketing",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
const nextCache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({
  revalidateTag: nextCache.revalidateTag,
  revalidatePath: vi.fn(),
  unstable_cache: (fn: () => unknown) => fn,
}));

const ROLES = {
  owner: { orgId: "org1", actor: "u1", role: "owner", grants: [] },
  admin: { orgId: "org1", actor: "u5", role: "admin", grants: [] },
  editor: { orgId: "org1", actor: "u2", role: "editor", grants: [] },
  viewer: { orgId: "org1", actor: "u3", role: "viewer", grants: [] },
  staff: { orgId: "org1", actor: "u4", role: "staff", grants: ["x"] },
} as const;

function session(role: keyof typeof ROLES) {
  return {
    ctx: ROLES[role],
    email: "o@example.com",
    org: { id: "org1", name: "Rivera", primaryHost: "rivera.sites.localhost" },
    orgs: [],
    staleOrg: false,
  };
}

const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
  agreementBlocks: vi.fn(async () => false),
}));
vi.mock("../lib/session", () => sess);

vi.mock("../app/(platform)/hub/marketing/ContactsTab", async () => {
  const { createElement } = await import("react");
  return { ContactsTab: async () => createElement("h2", null, "Contacts") };
});

const db = vi.hoisted(() => ({
  listSocialAccounts: vi.fn(),
  readGrowTicks: vi.fn(),
  previewHostSuffix: () => "sites.localhost",
  addSocialAccount: vi.fn(),
  updateSocialAccount: vi.fn(),
  removeSocialAccount: vi.fn(),
  reorderSocialAccounts: vi.fn(),
  setGrowTick: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const { default: MarketingPage } =
  await import("../app/(platform)/hub/marketing/page");
const actions = await import("../app/actions/social");
const { ToastRegion } = await import("@cds/ui/hub");

const IG = {
  id: "a00000000000001",
  platform: "instagram",
  name: "Instagram",
  label: "",
  url: "https://instagram.com/rivera",
  shortCode: "ig",
  order: 0,
  fallback: false,
  bioPath: "/ig",
};
const YT = {
  ...IG,
  id: "a00000000000002",
  platform: "youtube",
  name: "YouTube",
  url: "https://youtube.com/@rivera",
  shortCode: "yt",
  order: 1,
  bioPath: "/yt",
};

let mounted: Mounted | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  db.listSocialAccounts.mockResolvedValue([IG]);
  db.readGrowTicks.mockResolvedValue({
    ticks: ["all-same-name"],
    category: "shop",
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

async function render(role: keyof typeof ROLES, sp: Record<string, string>) {
  sess.requireHubSession.mockResolvedValue(session(role));
  const el = (await MarketingPage({
    searchParams: Promise.resolve(sp),
  })) as ReactElement;
  mounted = mount(<ToastRegion>{el}</ToastRegion>);
  return mounted.container;
}

function tabIds(el: HTMLElement): string[] {
  return [...el.querySelectorAll<HTMLAnchorElement>('a[href^="?tab="]')].map(
    (a) => a.getAttribute("href")!.slice(5),
  );
}

describe("/hub/marketing?tab=social (DASH-14..16)", () => {
  it("owner: Your accounts, Add an account and Grow your social under Contacts · Social", async () => {
    const el = await render("owner", { tab: "social" });
    expect(el.querySelector("h1")?.textContent).toBe("Marketing");
    expect(tabIds(el)).toEqual(["contacts", "social"]);
    expect(
      el.querySelector('a[aria-current="page"]')?.getAttribute("href"),
    ).toBe("?tab=social");
    const text = el.textContent ?? "";
    expect(text).toContain("My social accounts");
    expect(text).toContain("Your accounts");
    expect(text).toContain("Add an account");
    expect(text).toContain("Grow your social");
    expect(text).toContain("Bio link: rivera.sites.localhost/ig");
    expect(
      el.querySelector("[data-copy-bio]")?.getAttribute("data-copy-bio"),
    ).toBe("https://rivera.sites.localhost/ig");
    expect(el.querySelector("[data-bio-preview]")).not.toBeNull();
    expect(el.querySelector('[data-grow-group="instagram"]')).not.toBeNull();
    // No follower counts, no posting.
    expect(text).not.toMatch(/followers/i);
  });

  it("viewer: the list and copy buttons without edit controls; Social only", async () => {
    const el = await render("viewer", { tab: "contacts" });
    expect(tabIds(el)).toEqual(["social"]);
    expect(el.querySelector("[data-copy-bio]")).not.toBeNull();
    expect(el.querySelector('[aria-label="More for Instagram"]')).toBeNull();
    expect(el.querySelector("[data-add-account]")).toBeNull();
    const boxes = [
      ...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((b) => b.disabled)).toBe(true);
  });

  it("admin edits, editor reads only (UI-SPEC, 11-50); staff (contacts only) gets Contacts and no Social", async () => {
    const ad = await render("admin", { tab: "social" });
    expect(
      ad.querySelector('[aria-label="More for Instagram"]'),
    ).not.toBeNull();
    mounted?.unmount();
    mounted = null;
    const ed = await render("editor", { tab: "social" });
    expect(ed.querySelector('[aria-label="More for Instagram"]')).toBeNull();
    (mounted as Mounted | null)?.unmount();
    mounted = null;
    const st = await render("staff", { tab: "social" });
    expect(tabIds(st)).toEqual(["contacts"]);
    expect(db.listSocialAccounts).toHaveBeenCalledTimes(2);
  });

  it("a failed load shows ERR-LOAD in the panel", async () => {
    db.listSocialAccounts.mockRejectedValueOnce(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = await render("owner", { tab: "social" });
    expect(el.textContent).toContain("We couldn't load this.");
    err.mockRestore();
  });
});

describe("social actions (T-11-37-01, T-11-37-02)", () => {
  beforeEach(() => {
    sess.getHubSession.mockResolvedValue(session("owner"));
  });

  it("add copies only platform, label and url, passes the invalidator, answers the fresh list", async () => {
    db.addSocialAccount.mockResolvedValue(IG);
    const res = await actions.addSocialAccountAction({
      platform: "instagram",
      url: "https://instagram.com/rivera",
      organization: "org2",
      order: 9,
    });
    expect(res).toEqual({ ok: true, data: { accounts: [IG] } });
    const [ctx, input, deps] = db.addSocialAccount.mock.calls[0]!;
    expect(ctx).toBe(ROLES.owner);
    expect(input).toEqual({
      platform: "instagram",
      url: "https://instagram.com/rivera",
    });
    deps.invalidator.invalidate(["org:org1:social"]);
    expect(nextCache.revalidateTag).toHaveBeenCalledWith("org:org1:social");
  });

  it("a Viewer's write is refused by @cds/db and comes back as forbidden", async () => {
    sess.getHubSession.mockResolvedValue(session("viewer"));
    db.removeSocialAccount.mockRejectedValue(new Forbidden());
    const res = await actions.removeSocialAccountAction(IG.id);
    expect(res).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("bad ids never reach @cds/db", async () => {
    for (const id of [1, "../x", "A00000000000001", ""]) {
      expect(await actions.removeSocialAccountAction(id)).toMatchObject({
        ok: false,
        code: "invalid_input",
      });
      expect(await actions.updateSocialAccountAction(id, {})).toMatchObject({
        ok: false,
      });
    }
    expect(
      await actions.reorderSocialAccountsAction([IG.id, { id: 1 }]),
    ).toMatchObject({ ok: false });
    expect(await actions.setGrowTickAction("ig-bio-link", "yes")).toMatchObject(
      { ok: false },
    );
    expect(db.removeSocialAccount).not.toHaveBeenCalled();
    expect(db.updateSocialAccount).not.toHaveBeenCalled();
    expect(db.reorderSocialAccounts).not.toHaveBeenCalled();
    expect(db.setGrowTick).not.toHaveBeenCalled();
  });

  it("Undo puts the account back at its old place", async () => {
    const back = { ...IG, id: "a00000000000009", order: 1 };
    db.addSocialAccount.mockResolvedValue(back);
    db.listSocialAccounts
      .mockResolvedValueOnce([YT, back])
      .mockResolvedValueOnce([back, YT]);
    const res = await actions.restoreSocialAccountAction(
      { platform: "instagram", url: IG.url },
      0,
    );
    expect(db.reorderSocialAccounts.mock.calls[0]![1]).toEqual([
      back.id,
      YT.id,
    ]);
    expect(res).toEqual({ ok: true, data: { accounts: [back, YT] } });
  });

  it("a Grow tick saves through setGrowTick", async () => {
    db.setGrowTick.mockResolvedValue({
      ticks: ["ig-bio-link"],
      category: "shop",
    });
    expect(await actions.setGrowTickAction("ig-bio-link", true)).toEqual({
      ok: true,
      data: { ticks: ["ig-bio-link"] },
    });
    expect(db.setGrowTick).toHaveBeenCalledWith(
      ROLES.owner,
      "ig-bio-link",
      true,
    );
  });
});
