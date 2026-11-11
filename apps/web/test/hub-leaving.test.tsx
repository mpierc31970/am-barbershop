// 14-42 Task 2: Leaving CDS in the hub (LIFE-01, D282, D-UI-P14-21, D-UI-P14-23; 14-UI-SPEC
// "Leaving CDS (owner)"; T-14-42-01..03). The real server page, layout and actions over a
// mocked session and @cds/db:
//   - /hub/leaving: Owner without a notice gets the start page (ordered lines incl. annual and
//     launch-price variants); Owner with a notice gets the checklist with the handback flow and
//     locked later steps; an Admin reads it with no buttons; Editors / Viewers get notFound; a
//     closed site goes to Billing; staff viewing as the owner get the button turned off.
//   - The hub layout mounts the LeavingBanner for Owners and Admins only.
//   - Settings › Billing ends with Leave CDS…, aria-disabled under impersonation.
//   - The actions narrow input and map a refused code to CODE-WRONG.
import { Forbidden, RateLimited } from "@cds/core";
import { P14_COPY } from "@cds/core/dns";
import { ToastRegion } from "@cds/ui/hub";
import type { ReactElement, ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/hub/today" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "x-cds-path": state.pathname }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) =>
    createElement("a", rest, children),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@cds/addon-registry/server", () => ({}));

const ORG = "orgaaaaaaaaaaa1";
const ENDS = "2026-11-14T15:00:00.000Z";

const db = vi.hoisted(() => ({
  // layout neighbours (guarded reads)
  listNeedsYou: vi.fn(async () => ({ items: [], failed: [] })),
  activeAddons: vi.fn(async () => [] as string[]),
  pausedAddons: vi.fn(async () => [] as string[]),
  getOrgStage: vi.fn(async () => ({ stage: "live", path: "standard" })),
  readBillingAccount: vi.fn(async () => ({
    status: "active",
    amountDueCents: 0,
    restoredAt: null,
  })),
  readDeclinedNotice: vi.fn(),
  countSubmissions: vi.fn(async () => ({ unread: 0, filtered: 0 })),
  bellCounts: vi.fn(async () => ({ unread: 0, urgent: 0 })),
  activeServiceNotices: vi.fn(async () => []),
  getBusinessProfile: vi.fn(async () => ({ time_zone: "America/Chicago" })),
  suspensionStatusFor: vi.fn(async () => ({ state: "none" })),
  // 14-39 / 14-40
  offboardingView: vi.fn(),
  offboardingChecklist: vi.fn(),
  handbackView: vi.fn(),
  requestOffboardingCode: vi.fn(),
  startOffboarding: vi.fn(),
  cancelOffboarding: vi.fn(),
  chooseHandbackDestination: vi.fn(),
  checkHandbackDestination: vi.fn(),
  confirmHandbackSwitched: vi.fn(),
  handbackZoneFile: vi.fn(),
  requestOffboardingDownload: vi.fn(),
  completeOffboardingStep: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const sess = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("../lib/session", async (orig) => ({
  ...(await orig<typeof import("../lib/session")>()),
  getDeclinedSession: async () => null,
  getHubSession: async () => sess.session,
  requireHubSession: async () => sess.session,
  agreementBlocks: async () => false,
}));

const { default: LeavingPage } =
  await import("../app/(platform)/hub/leaving/page");
const { default: HubLayout } = await import("../app/(platform)/hub/layout");
const { BillingPanel } =
  await import("../app/(platform)/hub/settings/BillingPanel");
const actions = await import("../app/actions/leaving");

type Role = "owner" | "admin" | "editor" | "viewer";

function asRole(role: Role, impersonator?: string): void {
  const ctx: Record<string, unknown> = {
    orgId: ORG,
    actor: "uaaaaaaaaaaaaa1",
    role,
    grants: [],
    ip: "",
    ...(impersonator ? { impersonator } : {}),
  };
  sess.session = {
    ctx,
    email: "maria@gmail.com",
    org: { id: ORG, name: "Rivera Bakery", primaryHost: null },
    orgs: [{ id: ORG, name: "Rivera Bakery", role }],
    staleOrg: false,
  };
}

const STEPS_LOCKED = [
  { key: "dns_handback", status: "open" },
  { key: "download", status: "locked" },
  { key: "addons", status: "locked" },
  { key: "services", status: "locked" },
  { key: "billing", status: "locked" },
  { key: "close", status: "locked" },
];

function checklist(over: Record<string, unknown> = {}) {
  return {
    status: "preview",
    noticeEndsAt: ENDS,
    locked: false,
    steps: STEPS_LOCKED,
    download: { availableUntil: ENDS, line: "Available until 14 Nov 2026." },
    addons: { items: [], line: P14_COPY.ADDONS_NA },
    services: [
      { key: "stripe", label: "Stripe", state: "not connected" },
      {
        key: "analytics",
        label: "Google Analytics and Search Console",
        state: "not connected",
      },
    ],
    billing: {
      endsOn: ENDS,
      annual: false,
      rateLock: false,
      lines: ["Your plan ends on 14 Nov 2026."],
    },
    close: {
      closesOn: ENDS,
      deletedOn: "2026-12-14T15:00:00.000Z",
      line: "14 Nov 2026. Deleted 30 days later, on 14 Dec 2026.",
    },
    ...over,
  };
}

function noticeView(over: Record<string, unknown> = {}) {
  return {
    status: "notice",
    requestedAt: "2026-10-15T15:00:00.000Z",
    requestedByKind: "owner",
    noticeEndsAt: ENDS,
    daysLeft: 23,
    next: "move your DNS",
    banner: "Moving away · 23 days left · Next: move your DNS",
    steps: [],
    systemSteps: null,
    reasonCategory: null,
    note: null,
    cancelledAt: null,
    closedAt: null,
    handbackOverdueAt: null,
    canAct: true,
    ...over,
  };
}

const ZONE = {
  domain: "riverabakery.com",
  zoneStatus: "active",
  registrar: "GoDaddy.com, LLC",
  groups: {
    copy_exactly: [
      {
        type: "MX",
        name: "@",
        value: "smtp.google.com",
        priority: 1,
        sources: ["x"],
      },
    ],
    points_to_cds: [{ type: "A", name: "@", value: "82.180.132.176" }],
    remove: [],
  },
  destination: null,
  destinationNameservers: [],
  cdsNameservers: ["ana.ns.cloudflare.com", "bob.ns.cloudflare.com"],
  results: [],
  canCheckBefore: true,
  status: "open",
  emailMissing: 0,
  message: null,
  checkedAt: null,
  switchedAt: null,
  movedAwayAt: null,
  checkPassed: false,
  deletedAt: null,
};

async function renderPage(): Promise<string> {
  const tree = await LeavingPage();
  return renderToStaticMarkup(createElement(ToastRegion, null, tree));
}

async function renderLayout(): Promise<string> {
  return renderToStaticMarkup(
    (await HubLayout({
      children: createElement("p", null, "inner"),
    })) as ReactElement,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.pathname = "/hub/today";
  asRole("owner");
  db.offboardingView.mockResolvedValue(null);
  db.offboardingChecklist.mockResolvedValue(checklist());
  db.handbackView.mockResolvedValue({ zones: [ZONE] });
});

describe("/hub/leaving page", () => {
  it("Owner, no notice: the start page with the ordered lines, code step and one danger button", async () => {
    const html = await renderPage();
    expect(html).toContain("Moving away");
    expect(html).toContain(P14_COPY.LEAVE_INTRO.replace(/'/g, "&#x27;"));
    expect(html).toContain("until <strong");
    expect(html).toContain("14 Nov 2026");
    expect(html).toContain(
      "On 14 Nov your site closes. It&#x27;s deleted 30 days after that.",
    );
    expect(html).toContain(P14_COPY.BTN_START_NOTICE);
    expect(html).toContain('href="/hub/settings?tab=billing"');
    expect(html).not.toContain('aria-disabled="true"');
    expect(db.offboardingChecklist).toHaveBeenCalledWith(
      expect.objectContaining({ role: "owner" }),
      undefined,
      expect.objectContaining({ manifests: expect.any(Array) }),
    );
  });

  it("annual + launch price: the billing line names both", async () => {
    db.offboardingChecklist.mockResolvedValue(
      checklist({
        billing: {
          endsOn: ENDS,
          annual: true,
          rateLock: true,
          lines: [
            "Your plan ends on 14 Nov 2026.",
            "Your annual prepay isn't refunded.",
            "You lose your launch price. If you come back later, current prices apply.",
          ],
        },
      }),
    );
    const html = await renderPage();
    expect(html).toContain("Your annual prepay isn&#x27;t refunded.");
    expect(html).toContain("You lose your launch price.");
  });

  it("a cancelled notice shows the start page again (a new notice can start)", async () => {
    db.offboardingView.mockResolvedValue(noticeView({ status: "cancelled" }));
    const html = await renderPage();
    expect(html).toContain(P14_COPY.BTN_START_NOTICE);
  });

  it("staff viewing as the owner: Start is aria-disabled with IMPERSONATING-LEAVE", async () => {
    asRole("owner", "staffaaaaaaaaa1");
    const html = await renderPage();
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain(
      P14_COPY.IMPERSONATING_LEAVE.replace(/'/g, "&#x27;"),
    );
  });

  it("Owner with a notice: the checklist, the handback flow and locked later steps", async () => {
    db.offboardingView.mockResolvedValue(noticeView());
    db.offboardingChecklist.mockResolvedValue(checklist({ status: "notice" }));
    const html = await renderPage();
    expect(html).toContain("Notice ends 14 Nov 2026 · 23 days left");
    expect(html).toContain('data-handback="riverabakery.com"');
    expect(html).toContain("smtp.google.com");
    expect(html).toContain("Back to GoDaddy&#x27;s DNS");
    expect(html).toContain(P14_COPY.BTN_DOWNLOAD_ZONE_FILE);
    expect(html).toContain(P14_COPY.LOCKED);
    expect(html.match(/data-step-status="locked"/g)).toHaveLength(5);
    expect(html).toContain(P14_COPY.BTN_STAY);
    // Record sources never reach the page.
    expect(html).not.toContain("sources");
  });

  it("Admin with a notice: read-only (no buttons)", async () => {
    asRole("admin");
    db.offboardingView.mockResolvedValue(noticeView({ canAct: false }));
    db.offboardingChecklist.mockResolvedValue(checklist({ status: "notice" }));
    const html = await renderPage();
    expect(html).toContain("Only the owner can make changes here.");
    expect(html).toContain("smtp.google.com");
    expect(html).not.toContain("<button");
  });

  it("Admin without a notice, Editor and Viewer: notFound", async () => {
    asRole("admin");
    await expect(renderPage()).rejects.toThrow("NOT_FOUND");
    asRole("editor");
    await expect(renderPage()).rejects.toThrow("NOT_FOUND");
    asRole("viewer");
    await expect(renderPage()).rejects.toThrow("NOT_FOUND");
  });

  it("a closed site goes to Billing", async () => {
    db.offboardingView.mockResolvedValue(noticeView({ status: "closed" }));
    await expect(renderPage()).rejects.toThrow(
      "REDIRECT:/hub/settings?tab=billing",
    );
  });

  it("a failed read shows one alert", async () => {
    db.offboardingView.mockRejectedValue(new TypeError("pb down"));
    const html = await renderPage();
    expect(html).toContain("We couldn&#x27;t load this.");
  });
});

describe("hub layout banner", () => {
  it("Owner during the notice: the static banner under the top bar", async () => {
    db.offboardingView.mockResolvedValue(noticeView());
    const html = await renderLayout();
    expect(html).toContain('aria-label="Moving away"');
    expect(html).toContain("Next: move your DNS");
    expect(html).toContain('href="/hub/leaving"');
    expect(html.indexOf("data-leaving-banner")).toBeLessThan(
      html.indexOf('id="hub-main"'),
    );
  });

  it("Admin sees it too", async () => {
    asRole("admin");
    db.offboardingView.mockResolvedValue(noticeView({ canAct: false }));
    expect(await renderLayout()).toContain("data-leaving-banner");
  });

  it("Editor and Viewer see nothing new (no read at all)", async () => {
    for (const r of ["editor", "viewer"] as const) {
      asRole(r);
      db.offboardingView.mockResolvedValue(noticeView());
      const html = await renderLayout();
      expect(html).not.toContain("data-leaving-banner");
    }
    expect(db.offboardingView).not.toHaveBeenCalled();
  });

  it("no notice or a failed read: no banner, the hub still opens", async () => {
    expect(await renderLayout()).not.toContain("data-leaving-banner");
    db.offboardingView.mockRejectedValue(new TypeError("down"));
    const html = await renderLayout();
    expect(html).not.toContain("data-leaving-banner");
    expect(html).toContain("<p>inner</p>");
  });

  it("on /hub/leaving the Open checklist link is hidden", async () => {
    state.pathname = "/hub/leaving";
    db.offboardingView.mockResolvedValue(noticeView());
    const html = await renderLayout();
    expect(html).toContain("data-leaving-banner");
    expect(html).not.toContain(P14_COPY.BTN_OPEN_CHECKLIST);
  });
});

describe("Settings › Billing Move away row", () => {
  const view = (impersonating: boolean) => ({
    paid: false,
    status: { ok: false as const },
    plan: null,
    items: null,
    care: null,
    media: null,
    pagePacks: null,
    quotes: { ok: true as const, data: [] },
    invoices: { ok: true as const, data: [] },
    canBuy: false,
    impersonating,
  });

  it("is the last row, linking to /hub/leaving", () => {
    const html = renderToStaticMarkup(
      createElement(
        ToastRegion,
        null,
        createElement(BillingPanel, { view: view(false), cardUpdated: false }),
      ),
    );
    const row = html.indexOf("data-leave-row");
    expect(row).toBeGreaterThan(html.indexOf("billing-invoices"));
    expect(html).toContain(`href="/hub/leaving"`);
    expect(html).toContain(P14_COPY.BTN_LEAVE_CDS);
    expect(html).toContain("There&#x27;s a 30-day notice period.");
  });

  it("under impersonation: aria-disabled with IMPERSONATING-LEAVE", () => {
    const html = renderToStaticMarkup(
      createElement(
        ToastRegion,
        null,
        createElement(BillingPanel, { view: view(true), cardUpdated: false }),
      ),
    );
    expect(html).not.toContain(`href="/hub/leaving"`);
    expect(html).toMatch(/aria-disabled="true"[^>]*>Move away…/);
    expect(html).toContain(
      P14_COPY.IMPERSONATING_LEAVE.replace(/'/g, "&#x27;"),
    );
  });
});

describe("leaving actions", () => {
  const good = {
    reasonCategory: "cost",
    note: "",
    otpId: "abcdefghijklmno",
    code: "123456",
  };

  it("start passes the narrowed input; bad input never reaches @cds/db", async () => {
    db.startOffboarding.mockResolvedValue(noticeView());
    expect(await actions.startLeavingAction(good)).toEqual({
      ok: true,
      data: null,
    });
    expect(db.startOffboarding).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG }),
      undefined,
      {
        reasonCategory: "cost",
        note: "",
        code: { otpId: "abcdefghijklmno", code: "123456" },
      },
    );
    db.startOffboarding.mockClear();
    for (const bad of [
      null,
      { ...good, reasonCategory: "spite" },
      { ...good, code: "12a456" },
      { ...good, otpId: "../x" },
      { ...good, note: "x".repeat(1001) },
    ]) {
      const res = await actions.startLeavingAction(bad);
      expect(res.ok).toBe(false);
    }
    expect(db.startOffboarding).not.toHaveBeenCalled();
  });

  it("a refused code maps to CODE-WRONG", async () => {
    db.startOffboarding.mockRejectedValue(new Forbidden("x"));
    const res = await actions.startLeavingAction(good);
    expect(res).toMatchObject({ ok: false, code: "code_wrong" });
    expect(res.ok ? "" : res.message).toMatch(/didn't match/);
  });

  it("impersonating staff get IMPERSONATING-LEAVE", async () => {
    asRole("owner", "staffaaaaaaaaa1");
    const { ImpersonationDenied } = await import("@cds/core");
    db.startOffboarding.mockRejectedValue(new ImpersonationDenied("x"));
    const res = await actions.startLeavingAction(good);
    expect(res).toMatchObject({
      ok: false,
      message: P14_COPY.IMPERSONATING_LEAVE,
    });
  });

  it("choose narrows the domain and nameservers and maps the view (no sources)", async () => {
    db.chooseHandbackDestination.mockResolvedValue(ZONE);
    const res = await actions.chooseDestinationAction("RiveraBakery.com", {
      kind: "other",
      nameservers: ["ns1.new.net", "ns2.new.net"],
    });
    expect(db.chooseHandbackDestination).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      "riverabakery.com",
      { kind: "other", nameservers: ["ns1.new.net", "ns2.new.net"] },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.registrarId).toBe("godaddy");
      expect(res.data.registrarName).toBe("GoDaddy");
      expect(JSON.stringify(res.data)).not.toContain("sources");
    }
    expect(
      (
        await actions.chooseDestinationAction("not a domain", {
          kind: "registrar",
        })
      ).ok,
    ).toBe(false);
    expect(
      (await actions.chooseDestinationAction("a.com", { kind: "other" })).ok,
    ).toBe(false);
  });

  it("check keeps rate_limited for the flow's wait line", async () => {
    db.checkHandbackDestination.mockRejectedValue(new RateLimited("x"));
    const res = await actions.checkNewDnsAction("riverabakery.com");
    expect(res).toMatchObject({ ok: false, code: "rate_limited" });
  });

  it("zone file, steps, download and Stay call through with the session org only", async () => {
    db.handbackZoneFile.mockResolvedValue({
      filename: "riverabakery.com-zone.txt",
      text: "; zone",
    });
    expect(await actions.downloadZoneFileAction("riverabakery.com")).toEqual({
      ok: true,
      data: { filename: "riverabakery.com-zone.txt", text: "; zone" },
    });
    db.completeOffboardingStep.mockResolvedValue(undefined);
    expect((await actions.completeLeavingStepAction("billing")).ok).toBe(true);
    expect((await actions.completeLeavingStepAction("close")).ok).toBe(false);
    expect((await actions.completeLeavingStepAction("dns_handback")).ok).toBe(
      false,
    );
    db.requestOffboardingDownload.mockResolvedValue({ id: "x" });
    expect((await actions.downloadLeavingDataAction()).ok).toBe(true);
    db.cancelOffboarding.mockResolvedValue({
      view: noticeView({ status: "cancelled" }),
      dnsHandedBack: false,
      message: P14_COPY.STAY_B,
    });
    expect(await actions.stayWithCdsAction()).toEqual({
      ok: true,
      data: { message: P14_COPY.STAY_B },
    });
    expect(db.cancelOffboarding).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG }),
      undefined,
    );
  });
});
