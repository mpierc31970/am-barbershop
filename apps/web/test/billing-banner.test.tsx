// @vitest-environment jsdom
// 10-32 Task 1: the owner billing banner and the one-time restored toast (BILL-03, D27, D310,
// D-UI-P10-13; T-10-32-01, T-10-32-03). billingBannerView / restoredToastAt run against a
// mocked readBillingAccount; the hub layout renders with a mocked session and @cds/db; the
// toast island mounts in jsdom.
import type { ReactElement, ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flush,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const state = vi.hoisted(() => ({
  path: "/hub/website",
  pathname: "/hub/website",
  search: new URLSearchParams(),
  cookies: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.cookies.has(name)
        ? { name, value: state.cookies.get(name) }
        : undefined,
  }),
  headers: async () => new Headers({ "x-cds-path": state.path }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  usePathname: () => state.pathname,
  useSearchParams: () => state.search,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) =>
    createElement("a", rest, children),
}));

const db = vi.hoisted(() => ({
  readBillingAccount: vi.fn(),
  activeAddons: vi.fn(async () => [] as string[]),
  getOrgStage: vi.fn(async () => ({ stage: "live", path: "standard" })),
  countSubmissions: vi.fn(async () => ({ unread: 0, filtered: 0 })),
  readDeclinedNotice: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const sess = vi.hoisted(() => ({
  session: null as unknown,
  getDeclinedSession: vi.fn(async () => null),
}));
vi.mock("../lib/session", async (orig) => ({
  ...(await orig<typeof import("../lib/session")>()),
  getDeclinedSession: sess.getDeclinedSession,
  requireHubSession: async () => {
    if (!sess.session) throw new Error("REDIRECT:/sign-in");
    return sess.session;
  },
}));

const { billingBannerView, bannerSuppressed, restoredToastAt } =
  await import("../lib/billing-banner");
const { default: HubLayout } = await import("../app/(platform)/hub/layout");
const { RestoredToast, RESTORED_TOAST_COPY } =
  await import("../app/(platform)/hub/RestoredToast");
const { ToastRegion } = await import("@cds/ui/hub");
const { BANNER_PAST_DUE } = await import("@cds/ui/hub/billing");

const PAUSED_START = "Your add-ons are paused because payment stopped.";
const CARD = "/hub/settings/billing/card";

function ctx(role = "owner", impersonator?: string) {
  return {
    orgId: "org1",
    actor: "u1",
    role,
    grants: [],
    ip: "",
    ...(impersonator ? { impersonator } : {}),
  } as never;
}

function account(over: Record<string, unknown> = {}) {
  return {
    status: "active",
    amountDueCents: 0,
    restoredAt: null,
    ...over,
  };
}

beforeEach(() => {
  db.readBillingAccount.mockReset();
  state.path = "/hub/website";
  state.pathname = "/hub/website";
  state.search = new URLSearchParams();
  state.cookies.clear();
  sess.session = null;
});

describe("billingBannerView (D310, D-UI-P10-13)", () => {
  it("past due owner on /hub/website: past_due with Update card target", async () => {
    db.readBillingAccount.mockResolvedValue(
      account({ status: "past_due", amountDueCents: 3900 }),
    );
    await expect(billingBannerView(ctx(), "/hub/website")).resolves.toEqual({
      state: "past_due",
      amountCents: 3900,
      updateCardHref: CARD,
    });
  });

  it("lapsed owner: paused", async () => {
    db.readBillingAccount.mockResolvedValue(
      account({ status: "lapsed", amountDueCents: 7800 }),
    );
    await expect(billingBannerView(ctx(), "/hub")).resolves.toMatchObject({
      state: "paused",
      amountCents: 7800,
    });
  });

  it("no banner on Settings › Billing, for non-owners, impersonating staff or an active org", async () => {
    db.readBillingAccount.mockResolvedValue(account({ status: "past_due" }));
    expect(
      await billingBannerView(ctx(), "/hub/settings?tab=billing"),
    ).toBeNull();
    for (const role of ["admin", "editor", "viewer"]) {
      expect(await billingBannerView(ctx(role), "/hub/website")).toBeNull();
    }
    expect(
      await billingBannerView(ctx("owner", "staff1"), "/hub/website"),
    ).toBeNull();
    db.readBillingAccount.mockResolvedValue(account());
    expect(await billingBannerView(ctx(), "/hub/website")).toBeNull();
    db.readBillingAccount.mockResolvedValue(null);
    expect(await billingBannerView(ctx(), "/hub/website")).toBeNull();
  });

  it("a failed read renders no banner (T-10-32-03)", async () => {
    db.readBillingAccount.mockRejectedValue(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(billingBannerView(ctx(), "/hub/website")).resolves.toBeNull();
    err.mockRestore();
  });

  it("bannerSuppressed: billing tab, billing routes, focused frames, preview", () => {
    expect(bannerSuppressed("/hub/settings?tab=billing")).toBe(true);
    expect(bannerSuppressed("/hub/settings/billing/card")).toBe(true);
    expect(bannerSuppressed("/hub/agreement?mode=reaccept&next=%2Fhub")).toBe(
      true,
    );
    expect(bannerSuppressed("/hub/declined")).toBe(true);
    expect(bannerSuppressed("/hub/website/pages/p1/preview")).toBe(true);
    expect(bannerSuppressed("/hub/settings?tab=payments")).toBe(false);
    expect(bannerSuppressed("/hub/website/pages/p1")).toBe(false);
    expect(bannerSuppressed("/hub/agreement")).toBe(false);
    expect(bannerSuppressed("/hub")).toBe(false);
  });
});

describe("restoredToastAt (choice 2)", () => {
  const NOW = new Date("2026-10-10T12:00:00Z");
  const TWO_DAYS_AGO = "2026-10-08 12:00:00.000Z";
  const KEY = String(new Date("2026-10-08T12:00:00.000Z").getTime());

  it("restored 2 days ago and no cookie: toast key; cookie equal: none", async () => {
    db.readBillingAccount.mockResolvedValue(
      account({ restoredAt: TWO_DAYS_AGO }),
    );
    await expect(restoredToastAt(ctx(), undefined, NOW)).resolves.toBe(KEY);
    await expect(restoredToastAt(ctx(), KEY, NOW)).resolves.toBeNull();
    await expect(restoredToastAt(ctx(), "123", NOW)).resolves.toBe(KEY);
  });

  it("none after 7 days, while lapsed again, or for non-owners", async () => {
    db.readBillingAccount.mockResolvedValue(
      account({ restoredAt: "2026-10-01 11:00:00.000Z" }),
    );
    expect(await restoredToastAt(ctx(), undefined, NOW)).toBeNull();
    db.readBillingAccount.mockResolvedValue(
      account({ status: "lapsed", restoredAt: TWO_DAYS_AGO }),
    );
    expect(await restoredToastAt(ctx(), undefined, NOW)).toBeNull();
    db.readBillingAccount.mockResolvedValue(
      account({ restoredAt: TWO_DAYS_AGO }),
    );
    expect(await restoredToastAt(ctx("admin"), undefined, NOW)).toBeNull();
  });
});

describe("hub layout banner (BILL-03)", () => {
  function signIn(role = "owner") {
    sess.session = {
      ctx: ctx(role),
      email: "owner@palm.example",
      org: { id: "org1", name: "Palm Science", primaryHost: "palm.example" },
    };
  }
  async function render(): Promise<string> {
    return renderToStaticMarkup(
      (await HubLayout({
        children: createElement("p", null, "inner"),
      })) as ReactElement,
    );
  }

  it("past due owner on /hub/website: BANNER-PAST-DUE with Update card", async () => {
    signIn();
    db.readBillingAccount.mockResolvedValue(
      account({ status: "past_due", amountDueCents: 3900 }),
    );
    const html = await render();
    expect(html).toContain('data-billing-banner="past_due"');
    expect(html).toContain(BANNER_PAST_DUE.replace("'", "&#x27;"));
    expect(html).toMatch(new RegExp(`<a href="${CARD}"[^>]*>Update card</a>`));
    expect(html).not.toMatch(/×|Dismiss|Close/);
    expect(html).toContain("<p>inner</p>");
  });

  it("paused owner: BANNER-PAUSED with Update card and pay", async () => {
    signIn();
    db.readBillingAccount.mockResolvedValue(
      account({ status: "lapsed", amountDueCents: 7800 }),
    );
    const html = await render();
    expect(html).toContain('data-billing-banner="paused"');
    expect(html).toContain(PAUSED_START);
    expect(html).toContain("$78.00");
    expect(html).toContain("Update card and pay");
  });

  it("no banner on the Billing tab (also after landing elsewhere), for an editor, or when active", async () => {
    signIn();
    db.readBillingAccount.mockResolvedValue(account({ status: "past_due" }));
    state.pathname = "/hub/settings";
    state.search = new URLSearchParams("tab=billing");
    expect(await render()).not.toContain("data-billing-banner");

    state.pathname = "/hub/website";
    state.search = new URLSearchParams();
    signIn("editor");
    expect(await render()).not.toContain("data-billing-banner");

    signIn();
    db.readBillingAccount.mockResolvedValue(account());
    expect(await render()).not.toContain("data-billing-banner");
  });

  it("a banner read failure still renders the hub", async () => {
    signIn();
    db.readBillingAccount.mockRejectedValue(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await render();
    err.mockRestore();
    expect(html).toContain("<p>inner</p>");
    expect(html).not.toContain("data-billing-banner");
  });
});

describe("RestoredToast island (once per restore)", () => {
  let mounted: Mounted | null = null;
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    document.cookie = "cds_restored_seen=; Path=/hub; Max-Age=0";
  });

  it("shows the toast once and writes the seen cookie", async () => {
    const set = vi.spyOn(document, "cookie", "set");
    mounted = mount(
      createElement(
        ToastRegion,
        null,
        createElement(RestoredToast, { restoredKey: "1791460800000" }),
      ),
    );
    await flush();
    expect(document.body.textContent).toContain(RESTORED_TOAST_COPY);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]![0]).toMatch(
      /^cds_restored_seen=1791460800000; Path=\/hub; Max-Age=\d+; SameSite=Lax/,
    );
    set.mockRestore();
  });

  it("shows nothing without a key (or with a malformed one)", async () => {
    mounted = mount(
      createElement(
        ToastRegion,
        null,
        createElement(RestoredToast, { restoredKey: null }),
        createElement(RestoredToast, { restoredKey: "x; Path=/" }),
      ),
    );
    await flush();
    expect(document.body.textContent).not.toContain(RESTORED_TOAST_COPY);
  });
});
