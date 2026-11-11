// @vitest-environment jsdom
// 10-25: Settings › Payments (BILL-06, PAY-03, PAY-10; CONTEXT A1; 10-UI-SPEC "Settings tabs",
// "Settings › Payments"; D285, D296, D311; T-10-25-01..03). The real page runs over a mocked
// session and @cds/db; the panel island renders in jsdom inside the hub ToastRegion. The
// connect actions are mocked for the page and run for real (over the mocked chokepoint) in
// their own block, as is the refresh route.
import { ImpersonationDenied, NotFound, authorize } from "@cds/core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ToastRegion } from "@cds/ui/hub";
import { act, type ReactElement, type ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/hub/settings",
  useRouter: () => ({
    push: vi.fn(),
    refresh: nav.refresh,
    replace: nav.replace,
  }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

type Ctx = {
  orgId: string;
  actor: string;
  role: string;
  grants: string[];
  impersonator?: string;
};
const OWNER: Ctx = { orgId: "org1", actor: "u1", role: "owner", grants: [] };

const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
  agreementBlocks: vi.fn(async () => false),
}));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => ({
  getOrgStage: vi.fn(),
  getBusinessProfile: vi.fn(),
  listMedia: vi.fn(),
  listTeam: vi.fn(),
  listEmailRoutes: vi.fn(),
  mailDomain: vi.fn(() => "send.example.com"),
  listAgreementDocuments: vi.fn(),
  agreementStatus: vi.fn(),
  sitePolicyState: vi.fn(),
  getBillingGate: vi.fn(),
  billingTabCounts: vi.fn(),
  readConnectStatus: vi.fn(),
  refreshConnectStatus: vi.fn(),
  startStripeConnect: vi.fn(),
  refreshConnectLink: vi.fn(),
  paymentsMode: vi.fn(() => "fake"),
}));
vi.mock("@cds/db", () => ({
  ...db,
  RESERVED_SLUGS: ["api", "hub"],
  SLUG_RE: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
}));

// 11-28: actions/billing (via the Pages tab / Billing panel) loads the add-on registry.
vi.mock("@cds/addon-registry/server", () => ({
  ADDON_REGISTRY: { get: () => undefined, list: () => [] },
}));
vi.mock("../app/actions/intake", () => ({}));
vi.mock("../app/actions/core-lists", () => ({}));
vi.mock("../app/actions/media", () => ({}));
vi.mock("../app/actions/email-routes", () => ({}));
vi.mock("../app/actions/site-policies", () => ({}));
const actions = vi.hoisted(() => ({
  startConnectAction: vi.fn(),
  checkConnectAction: vi.fn(),
}));
vi.mock("../app/actions/connect", () => actions);

const { default: SettingsPage } =
  await import("../app/(platform)/hub/settings/page");
const { navigation } =
  await import("../app/(platform)/hub/settings/PaymentsPanel");
const { connectPanelView, checkedLabel, CONNECT_HELP_HREF } =
  await import("../app/(platform)/hub/settings/payments-view");
const { CONNECT_STEPS, CONNECT_HOWTO } =
  await import("../app/(platform)/hub/settings/connect-steps");
const realActions = await vi.importActual<
  typeof import("../app/actions/connect")
>("../app/actions/connect");
const { GET: refreshRoute } =
  await import("../app/(platform)/hub/settings/connect/refresh/route");

const FEES =
  "You own this account, you are the seller, and you pay Stripe's fees directly (for example 2.9% + 30¢ online). CDS takes no cut.";
const HELP = "Help me set up Stripe";
const TOAST = "Stripe connected. Your site can take payments online.";
const IMPERSONATING =
  "You're viewing as CDS staff, so Stripe changes are turned off. Only the owner can connect Stripe.";
const ADMIN_LINE = "Only the site owner can connect or change Stripe.";
const ERR_CONNECT =
  "We couldn't open Stripe just now. Nothing changed. Try again in a minute.";

const STATUS = {
  not_connected: {
    state: "not_connected",
    displayName: null,
    accountSuffix: null,
    chargesEnabled: false,
    checkedAt: null,
    wasConnected: false,
  },
  setup_unfinished: {
    state: "setup_unfinished",
    displayName: null,
    accountSuffix: "4f2Q",
    chargesEnabled: false,
    checkedAt: "2026-10-10T12:00:00.000Z",
    wasConnected: false,
  },
  connected: {
    state: "connected",
    displayName: "Rivera Bakery",
    accountSuffix: "4f2Q",
    chargesEnabled: true,
    checkedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    wasConnected: true,
  },
  restricted: {
    state: "restricted",
    displayName: "Rivera Bakery",
    accountSuffix: "4f2Q",
    chargesEnabled: false,
    checkedAt: "2026-10-10T12:00:00.000Z",
    wasConnected: true,
  },
  disconnected: {
    state: "disconnected",
    displayName: "Rivera Bakery",
    accountSuffix: "4f2Q",
    chargesEnabled: false,
    checkedAt: "2026-10-10T12:00:00.000Z",
    wasConnected: true,
  },
} as const;
type StateKey = keyof typeof STATUS;

let mounted: Mounted | null = null;
function show(ui: ReactNode): Mounted {
  mounted = mount(<ToastRegion>{ui}</ToastRegion>);
  return mounted;
}
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal: () => void;
    close: () => void;
  };
  if (typeof proto.showModal !== "function") {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

function signIn(ctx: Ctx | null) {
  const session = ctx
    ? {
        ctx,
        email: "a@b.c",
        org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
      }
    : null;
  sess.requireHubSession.mockResolvedValue(session);
  sess.getHubSession.mockResolvedValue(session);
}

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  for (const fn of Object.values(actions)) fn.mockReset();
  nav.replace.mockReset();
  sess.agreementBlocks.mockResolvedValue(false);
  db.paymentsMode.mockImplementation(() => "fake");
  db.mailDomain.mockImplementation(() => "send.example.com");
  db.getOrgStage.mockResolvedValue({
    stage: "",
    path: "standard",
    slug: "rivera-bakery",
  });
  db.getBusinessProfile.mockResolvedValue({
    id: "bp1",
    orgName: "Rivera Bakery",
    tagline: "",
    business_type: "bakery",
    business_type_other: "",
    description: "",
    phone: "",
    public_email: "maria@riverabakery.com",
    address: { street: "", city: "", state: "", zip: "" },
    service_area: "",
    time_zone: "America/Chicago",
    hours: null,
    socials: [],
    about: "",
    mission: "",
    headline: "",
    font_pairing: "cds-choose",
    ga4_id: "",
    legal_name: "",
    privacy_contact: "",
    legal_region: "",
  });
  db.listMedia.mockResolvedValue([]);
  db.listEmailRoutes.mockResolvedValue([]);
  db.listAgreementDocuments.mockResolvedValue([]);
  db.agreementStatus.mockResolvedValue({
    state: "signed",
    missing: [],
    consentCurrent: true,
    lastSignedAt: null,
    lastSignerName: null,
  });
  db.sitePolicyState.mockResolvedValue({
    published: true,
    templateUpdateWaiting: false,
    addedSinceReview: [],
    missingInputs: [],
  });
  db.billingTabCounts.mockResolvedValue({ payments: 0, billing: 0 });
  db.readConnectStatus.mockResolvedValue(STATUS.not_connected);
  // The chokepoint's own authority check (connect:write is owner only, never impersonating).
  db.startStripeConnect.mockImplementation(async (ctx: Ctx) => {
    authorize(ctx as never, "connect", "write");
    return { url: "https://connect.stripe.com/setup/s/fresh" };
  });
  db.refreshConnectLink.mockImplementation(async (ctx: Ctx) => {
    authorize(ctx as never, "connect", "write");
    return { url: "https://connect.stripe.com/setup/s/fresh" };
  });
  db.refreshConnectStatus.mockImplementation(async (ctx: Ctx) => {
    authorize(ctx as never, "connect", "read");
    return STATUS.connected;
  });
  signIn(OWNER);
});

async function openTab(sp: Record<string, string> = { tab: "payments" }) {
  const el = (await SettingsPage({
    searchParams: Promise.resolve(sp),
  })) as ReactElement;
  return show(el);
}

/** The panel only (the closed how-to drawer also holds the step copy). */
function panelText(c: ParentNode): string {
  return c.querySelector("[data-connect-panel]")?.textContent ?? "";
}

/** Live status regions (the toast region among them), never the drawer. */
function statusText(): string {
  return Array.from(document.querySelectorAll('[role="status"]'))
    .map((n) => n.textContent ?? "")
    .join(" ");
}

function tabTexts(c: ParentNode): string[] {
  const navEl = c.querySelector('nav[aria-label="Settings sections"]')!;
  return Array.from(navEl.querySelectorAll("a")).map(
    (a) => a.textContent ?? "",
  );
}

// ---------------------------------------------------------------------------------------

describe("Settings › Payments tab visibility (D311, D-UI-P10-10)", () => {
  it("Owner and Admin see Payments before Legal (Billing is Owner only, 10-29)", async () => {
    for (const role of ["owner", "admin"]) {
      signIn({ ...OWNER, role });
      const { container: c } = await openTab({});
      expect(tabTexts(c)).toEqual([
        "Business info",
        "Team & hours",
        "Email",
        "Domain",
        "People & roles",
        "Payments",
        ...(role === "owner" ? ["Billing"] : []),
        "Integrations",
        "Legal",
      ]);
      mounted?.unmount();
      mounted = null;
    }
  });

  it("Editor: no Payments tab, and ?tab=payments falls back to Business info", async () => {
    signIn({ ...OWNER, role: "editor" });
    const { container: c } = await openTab();
    expect(tabTexts(c)).not.toContain("Payments");
    expect(
      c.querySelector('a[aria-current="page"]')?.getAttribute("href"),
    ).toBe("?tab=business");
    expect(c.textContent).not.toContain("Take payments on your site");
    expect(db.readConnectStatus).not.toHaveBeenCalled();
    expect(db.billingTabCounts).not.toHaveBeenCalled();
  });

  it("Viewer: 404", async () => {
    signIn({ ...OWNER, role: "viewer" });
    await expect(openTab()).rejects.toThrow("NOT_FOUND");
  });

  it('"Payments · 1" when Stripe needs attention; a failed count read counts 0', async () => {
    db.billingTabCounts.mockResolvedValue({ payments: 1, billing: 0 });
    const { container: c } = await openTab({});
    expect(tabTexts(c)[5]).toBe("Payments · 1");
    mounted?.unmount();
    mounted = null;
    db.billingTabCounts.mockRejectedValue(new Error("down"));
    const { container: d } = await openTab({});
    expect(tabTexts(d)[5]).toBe("Payments");
  });

  it("a failed status read shows ERR-LOAD with Try again", async () => {
    db.readConnectStatus.mockRejectedValue(new Error("pb down: secret"));
    const { container: c } = await openTab();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain(
      "We couldn't load this.",
    );
    expect(c.textContent).not.toContain("secret");
  });
});

describe("Settings › Payments panel (BILL-06, PAY-03)", () => {
  it("Owner, not connected: Connect your Stripe account opens Stripe's onboarding", async () => {
    const go = vi.spyOn(navigation, "go").mockImplementation(() => {});
    let resolve!: (v: unknown) => void;
    actions.startConnectAction.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { container: c } = await openTab();
    expect(c.querySelector("h2")?.textContent).toBe(
      "Take payments on your site",
    );
    expect(c.textContent).toContain("Not connected");
    const btn = button(c, "Connect your Stripe account")!;
    act(() => click(btn));
    await flush();
    expect(actions.startConnectAction).toHaveBeenCalledTimes(1);
    expect(c.textContent).toContain("Opening Stripe…");
    await act(async () => {
      resolve({ ok: true, data: { url: "https://connect.stripe.com/x" } });
    });
    await flush();
    expect(go).toHaveBeenCalledWith("https://connect.stripe.com/x");
    // The link is minted on click only, never rendered into the page (T-10-25-02).
    expect(c.innerHTML).not.toContain("connect.stripe.com");
    go.mockRestore();
  });

  it("a failed start shows ERR-CONNECT, never the generic save copy", async () => {
    actions.startConnectAction.mockResolvedValue({
      ok: false,
      code: "save_failed",
      message: "Your changes weren't saved.",
    });
    const { container: c } = await openTab();
    act(() => click(button(c, "Connect your Stripe account")));
    await flush();
    expect(c.textContent).toContain(ERR_CONNECT);
    expect(c.textContent).not.toContain("weren't saved");
  });

  it("Setup not finished and Needs attention offer Finish Stripe setup", async () => {
    for (const s of ["setup_unfinished", "restricted"] as const) {
      db.readConnectStatus.mockResolvedValue(STATUS[s]);
      const { container: c } = await openTab();
      expect(button(c, "Finish Stripe setup")).not.toBeNull();
      expect(c.textContent).toContain(
        s === "restricted" ? "Needs attention" : "Setup not finished",
      );
      mounted?.unmount();
      mounted = null;
    }
  });

  it("Connected: account suffix, Online payments On, Last checked, dashboard link; no Disconnect", async () => {
    db.readConnectStatus.mockResolvedValue(STATUS.connected);
    db.paymentsMode.mockImplementation(() => "stripe");
    const { container: c } = await openTab();
    expect(c.textContent).toContain("Rivera Bakery (acct ending 4f2Q)");
    expect(c.textContent).toContain("2 minutes ago");
    expect(
      c.querySelector('a[href="https://dashboard.stripe.com/"]'),
    ).not.toBeNull();
    expect(button(c, "Check again")).not.toBeNull();
    // No Disconnect button in v1.0 (D-UI-P10-9): DISCONNECT-HELP points at Stripe instead.
    expect(button(c, "Disconnect")).toBeNull();
    expect(c.textContent).toContain("Settings › Connected accounts");
  });

  it("Admin: read-only with the owner-only line, no buttons", async () => {
    signIn({ ...OWNER, role: "admin" });
    const { container: c } = await openTab();
    expect(c.textContent).toContain(ADMIN_LINE);
    expect(button(c, "Connect your Stripe account")).toBeNull();
  });

  it("Staff impersonating the owner: read-only with IMPERSONATING-CONNECT", async () => {
    signIn({ ...OWNER, impersonator: "staff1" });
    db.readConnectStatus.mockResolvedValue(STATUS.restricted);
    const { container: c } = await openTab();
    expect(c.textContent).toContain(IMPERSONATING);
    expect(button(c, "Finish Stripe setup")).toBeNull();
  });

  it("?connect=return: Checking…, then Connected and the toast; the param is stripped", async () => {
    let resolve!: (v: unknown) => void;
    actions.checkConnectAction.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { container: c } = await openTab({
      tab: "payments",
      connect: "return",
    });
    await flush();
    expect(panelText(c)).toContain("Checking your Stripe account…");
    expect(actions.checkConnectAction).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/hub/settings?tab=payments", {
      scroll: false,
    });
    await act(async () => {
      resolve({
        ok: true,
        data: connectPanelView(
          STATUS.connected,
          { role: "owner", impersonating: false, testMode: true },
          { now: new Date() },
        ),
      });
    });
    await flush();
    expect(panelText(c)).not.toContain("Checking your Stripe account…");
    expect(
      c
        .querySelector("[data-connect-panel]")
        ?.getAttribute("data-connect-panel"),
    ).toBe("connected");
    expect(statusText()).toContain(TOAST);
  });

  it("?connect=return that is still unfinished shows the state and no toast", async () => {
    actions.checkConnectAction.mockResolvedValue({
      ok: true,
      data: connectPanelView(
        STATUS.setup_unfinished,
        { role: "owner", impersonating: false, testMode: true },
        { now: new Date() },
      ),
    });
    const { container: c } = await openTab({
      tab: "payments",
      connect: "return",
    });
    await flush();
    expect(button(c, "Finish Stripe setup")).not.toBeNull();
    expect(statusText()).not.toContain(TOAST);
  });

  it("Help me set up Stripe opens the how-to drawer in place", async () => {
    const { container: c } = await openTab();
    const link = Array.from(c.querySelectorAll("a")).find(
      (a) => a.textContent === HELP,
    )!;
    expect(link.getAttribute("href")).toBe(CONNECT_HELP_HREF);
    act(() => click(link));
    await flush();
    const dialog = document.querySelector("dialog[open]");
    expect(dialog?.textContent).toContain(HELP);
    expect(dialog?.textContent).toContain("Click Connect your Stripe account");
  });

  it("?help=stripe opens the drawer on load (no-JS path)", async () => {
    await openTab({ tab: "payments", help: "stripe" });
    await flush();
    expect(document.querySelector("dialog[open]")?.textContent).toContain(HELP);
  });
});

describe("PAY-10: the fee disclosure and help link on every connect screen (D296)", () => {
  const viewers: [string, Ctx][] = [
    ["owner", OWNER],
    ["admin", { ...OWNER, role: "admin" }],
    ["impersonating", { ...OWNER, impersonator: "staff1" }],
  ];
  for (const state of Object.keys(STATUS) as StateKey[]) {
    for (const [who, ctx] of viewers) {
      it(`${state} as ${who}: "CDS takes no cut" and "${HELP}"`, async () => {
        signIn(ctx);
        db.readConnectStatus.mockResolvedValue(STATUS[state]);
        const { container: c } = await openTab();
        expect(c.querySelector("[data-fees-box]")?.textContent).toBe(FEES);
        const help = Array.from(c.querySelectorAll("a")).filter(
          (a) => a.textContent === HELP,
        );
        expect(help).toHaveLength(1);
      });
    }
  }

  it("the checking state keeps the disclosure too", async () => {
    actions.checkConnectAction.mockReturnValue(new Promise(() => {}));
    const { container: c } = await openTab({
      tab: "payments",
      connect: "return",
    });
    expect(panelText(c)).toContain("Checking your Stripe account…");
    expect(panelText(c)).toContain("CDS takes no cut");
    expect(panelText(c)).toContain(HELP);
  });
});

describe("connectPanelView / checkedLabel", () => {
  it("maps role, test mode and the dashboard link; never more than the suffix", () => {
    const v = connectPanelView(
      STATUS.connected,
      { role: "owner", impersonating: false, testMode: false },
      { now: new Date() },
    );
    expect(v.role).toBe("owner");
    expect(v.dashboardHref).toBe("https://dashboard.stripe.com/");
    expect(v.helpHref).toBe(CONNECT_HELP_HREF);
    expect(JSON.stringify(v)).not.toContain("acct_");
    const t = connectPanelView(
      STATUS.connected,
      { role: "admin", impersonating: false, testMode: true },
      { now: new Date() },
    );
    expect(t.role).toBe("admin");
    expect(t.dashboardHref).toBeNull();
    expect(t.testMode).toBe(true);
  });

  it("relative labels", () => {
    const now = new Date("2026-10-10T12:00:00.000Z");
    expect(checkedLabel(null, now)).toBeNull();
    expect(checkedLabel("2026-10-10T11:59:40.000Z", now)).toBe("just now");
    expect(checkedLabel("2026-10-10T11:58:00.000Z", now)).toBe("2 minutes ago");
    expect(checkedLabel("2026-10-10T09:00:00.000Z", now)).toBe("3 hours ago");
    expect(checkedLabel("2026-10-05T12:00:00.000Z", now)).toBe("5 days ago");
  });
});

describe("connect actions (T-10-25-01)", () => {
  it("startConnectAction: the owner gets the URL", async () => {
    const res = await realActions.startConnectAction();
    expect(res).toEqual({
      ok: true,
      data: { url: "https://connect.stripe.com/setup/s/fresh" },
    });
  });

  it("startConnectAction refuses an Admin and staff impersonating the owner", async () => {
    signIn({ ...OWNER, role: "admin" });
    const admin = await realActions.startConnectAction();
    expect(admin).toMatchObject({ ok: false, message: ADMIN_LINE });
    signIn({ ...OWNER, impersonator: "staff1" });
    db.startStripeConnect.mockRejectedValueOnce(new ImpersonationDenied());
    const staff = await realActions.startConnectAction();
    expect(staff).toMatchObject({ ok: false, message: IMPERSONATING });
  });

  it("checkConnectAction returns the panel view for Owner and Admin", async () => {
    const res = await realActions.checkConnectAction();
    expect(res.ok && res.data.state).toBe("connected");
    expect(res.ok && res.data.role).toBe("owner");
    signIn({ ...OWNER, role: "admin" });
    const a = await realActions.checkConnectAction();
    expect(a.ok && a.data.role).toBe("admin");
  });

  it("signed out: signed_out, no chokepoint call", async () => {
    signIn(null);
    const res = await realActions.startConnectAction();
    expect(res).toMatchObject({ ok: false, code: "signed_out" });
    expect(db.startStripeConnect).not.toHaveBeenCalled();
  });
});

describe("refresh route (CONNECT_REFRESH_PATH, choice 1; T-10-25-03)", () => {
  it("owner: 303 to a fresh onboarding link", async () => {
    const res = await refreshRoute();
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(
      "https://connect.stripe.com/setup/s/fresh",
    );
    expect(db.refreshConnectLink).toHaveBeenCalledTimes(1);
    // WR-D02: a GET never starts (creates or replaces) an account.
    expect(db.startStripeConnect).not.toHaveBeenCalled();
  });

  it("admin or impersonating staff: 303 to the Payments tab, no link minted", async () => {
    for (const ctx of [
      { ...OWNER, role: "admin" },
      { ...OWNER, impersonator: "staff1" },
    ]) {
      signIn(ctx);
      const res = await refreshRoute();
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toBe("/hub/settings?tab=payments");
    }
    expect(db.refreshConnectLink).not.toHaveBeenCalled();
  });

  it("signed out: /sign-in; a failure or an odd URL: the Payments tab", async () => {
    signIn(null);
    expect((await refreshRoute()).headers.get("Location")).toBe("/sign-in");
    signIn(OWNER);
    db.refreshConnectLink.mockRejectedValueOnce(new Error("stripe down"));
    expect((await refreshRoute()).headers.get("Location")).toBe(
      "/hub/settings?tab=payments",
    );
    db.refreshConnectLink.mockResolvedValueOnce({ url: "javascript:alert(1)" });
    expect((await refreshRoute()).headers.get("Location")).toBe(
      "/hub/settings?tab=payments",
    );
  });

  it("WR-D02: no account yet (or disconnected): the Payments tab, nothing created", async () => {
    db.refreshConnectLink.mockRejectedValueOnce(
      new NotFound("No Stripe account to finish setting up."),
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await refreshRoute();
    err.mockRestore();
    expect(res.headers.get("Location")).toBe("/hub/settings?tab=payments");
    expect(db.startStripeConnect).not.toHaveBeenCalled();
  });
});

describe("the connect-stripe how-to (D110; the Help me set up Stripe target)", () => {
  const md = () =>
    readFileSync(
      path.resolve(import.meta.dirname, "../../..", CONNECT_HOWTO),
      "utf8",
    );

  it("states the fees (PAY-10) and is the Payments tab's route", () => {
    const text = md();
    expect(text).toContain("CDS takes no cut");
    expect(text).toContain("route: /hub/settings?tab=payments");
  });

  it("the baked drawer steps match its Activate then Use steps (drift)", async () => {
    const gen =
      (await import("../../../packages/addon-registry/scripts/gen.mjs")) as {
        parseUseSteps: (md: string) => unknown[];
      };
    const text = md();
    const activate = gen.parseUseSteps(
      text.replace("## Use", "## Used").replace("## Activate", "## Use"),
    );
    const use = gen.parseUseSteps(text);
    expect(activate.length).toBeGreaterThan(0);
    expect(use.length).toBeGreaterThan(0);
    expect([...activate, ...use]).toEqual(
      CONNECT_STEPS.map((step) => ({ ...step })),
    );
  });
});
