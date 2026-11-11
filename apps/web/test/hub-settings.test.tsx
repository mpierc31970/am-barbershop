// @vitest-environment jsdom
// 06-22 Task 2: Settings (/hub/settings?tab=business|team-hours|email; 06-UI-SPEC "Settings",
// "Hub shell changes"; D311, D312, PD-21, D-UI-P6-25; T-06-104, T-06-105) and Website ›
// Services (D37). The real pages run over a mocked session and @cds/db; the actions are
// mocked; client islands render in jsdom inside the hub ToastRegion.
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
  typeInto,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/hub/settings",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => ({
  getOrgStage: vi.fn(),
  getBusinessProfile: vi.fn(),
  listMedia: vi.fn(),
  listTeam: vi.fn(),
  listServices: vi.fn(),
  listEmailRoutes: vi.fn(),
  mailDomain: vi.fn(() => "send.example.com"),
  activeAddons: vi.fn(async () => [] as string[]),
  listPages: vi.fn(),
  addonRepo: vi.fn(),
  addonPageInfo: vi.fn(),
  registerAddonCollections: vi.fn(),
  registerSectionAddonOwners: vi.fn(),
  registerAddonAlertTypes: vi.fn(),
  getBillingGate: vi.fn(),
  getContentScanner: vi.fn(),
  getSearchPinger: vi.fn(),
  listAgreementDocuments: vi.fn(),
  // WR-D06: the Legal screens never read the combined list (it also reads the invoice
  // mirror); an outage there must not break them.
  listDocuments: vi.fn(async () => {
    throw new Error("invoice mirror down");
  }),
  agreementStatus: vi.fn(),
  sitePolicyState: vi.fn(),
  // 10-25 Payments tab.
  billingTabCounts: vi.fn(),
  readConnectStatus: vi.fn(),
  paymentsMode: vi.fn(() => "fake"),
  // 10-29 Billing tab.
  readBillingAccount: vi.fn(),
  listBillingInvoices: vi.fn(),
  listWorkOrders: vi.fn(),
  carePlanUsage: vi.fn(),
  mediaUsage: vi.fn(),
  mediaAllowance: vi.fn(),
  listOrgAddons: vi.fn(),
  readPriceCatalog: vi.fn(),
  formatGb: vi.fn((b: number) => `${Math.round((b / 1024 ** 3) * 10) / 10} GB`),
  packRemoveRefusedCopy: vi.fn(() => "refused"),
  // 11-24 sensitive-practice switch.
  readAlertProfileFacts: vi.fn(),
  // 11-41 Your data.
  readDataDownloadState: vi.fn(),
  statsTimeZone: vi.fn(async () => "America/Chicago"),
}));
vi.mock("@cds/db", () => ({
  ...db,
  RESERVED_SLUGS: ["api", "hub"],
  SLUG_RE: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
}));

const intake = vi.hoisted(() => ({
  saveProfileAction: vi.fn(),
  saveAnswersAction: vi.fn(),
  markStageSavedAction: vi.fn(),
  dismissFirstVisitAction: vi.fn(),
  sendToCdsAction: vi.fn(),
}));
vi.mock("../app/actions/intake", () => intake);
vi.mock("../app/actions/core-lists", () => ({}));
vi.mock("../app/actions/media", () => ({}));
vi.mock("../app/actions/email-routes", () => ({}));
const siteSettingsActions = vi.hoisted(() => ({
  saveSiteSettingsAction: vi.fn(),
  setSensitivePracticeAction: vi.fn(),
}));
vi.mock("../app/actions/site-settings", () => siteSettingsActions);
const sitePolicyActions = vi.hoisted(() => ({
  publishSitePoliciesAction: vi.fn(),
  previewSitePolicyAction: vi.fn(),
}));
vi.mock("../app/actions/site-policies", () => sitePolicyActions);
vi.mock("../app/actions/connect", () => ({
  startConnectAction: vi.fn(),
  checkConnectAction: vi.fn(),
}));
const billingActions = vi.hoisted(() => ({
  carePlanPreviewAction: vi.fn(),
  setCarePlanAction: vi.fn(),
  packPreviewAction: vi.fn(),
  buyPackAction: vi.fn(),
  removePackAction: vi.fn(),
  updateCardAction: vi.fn(),
}));
vi.mock("../app/actions/billing", () => billingActions);
const dataDownloadActions = vi.hoisted(() => ({
  requestDataDownloadAction: vi.fn(),
  readDataDownloadAction: vi.fn(),
}));
vi.mock("../app/actions/data-download", () => dataDownloadActions);

const {
  SETTINGS_TABS,
  resolveSettingsTab,
  reviewReturnHref,
  settingsTabHref,
  settingsTabLabel,
} = await import("../app/(platform)/hub/settings/tabs");
const { default: SettingsPage } =
  await import("../app/(platform)/hub/settings/page");
const { default: SettingsLoading } =
  await import("../app/(platform)/hub/settings/loading");
const { WEBSITE_TABS, composeWebsiteTabs } =
  await import("../app/(platform)/hub/website/tabs");
const { default: WebsitePage } =
  await import("../app/(platform)/hub/website/page");

let mounted: Mounted | null = null;
function unmountAll(): void {
  mounted?.unmount();
  mounted = null;
}
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

const PROFILE = {
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
};

const DEFAULT_ROUTE = {
  id: "r0000000000def1",
  purpose: "default",
  address: "maria@riverabakery.com",
  senderName: "",
  status: "confirmed",
  pendingDefault: false,
};

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  for (const fn of Object.values(intake)) fn.mockReset();
  db.mailDomain.mockImplementation(() => "send.example.com");
  db.activeAddons.mockResolvedValue([]);
  db.paymentsMode.mockImplementation(() => "fake");
  db.billingTabCounts.mockResolvedValue({ payments: 0, billing: 0 });
  db.readConnectStatus.mockResolvedValue({
    state: "not_connected",
    displayName: null,
    accountSuffix: null,
    chargesEnabled: false,
    checkedAt: null,
    wasConnected: false,
  });
  intake.saveProfileAction.mockResolvedValue({ ok: true, data: {} });
  db.readAlertProfileFacts.mockResolvedValue({
    sensitiveSetting: "",
    sensitiveOn: false,
    timeZone: "America/Chicago",
  });
  db.readDataDownloadState.mockReset();
  db.readDataDownloadState.mockImplementation(
    async (ctx: { role: string; impersonator?: string }) => ({
      who: ctx.impersonator
        ? "impersonating"
        : ctx.role === "owner"
          ? "owner"
          : "not-owner",
      latest: null,
      nextAllowedAt: null,
      canRequest: ctx.role === "owner" && !ctx.impersonator,
    }),
  );
  siteSettingsActions.setSensitivePracticeAction.mockReset();
  siteSettingsActions.setSensitivePracticeAction.mockResolvedValue({
    ok: true,
    data: {},
  });
});

const SIGNED_DOC = {
  kind: "agreement",
  id: "aaaaaaaaaa11111",
  title: "Signed agreement",
  versions: [
    { key: "service-agreement", title: "Service Agreement", version: 1 },
  ],
  signedAt: "2026-10-08T19:14:00.000Z",
  signerName: "Maria Lopez",
  signerEmail: "maria@riverabakery.com",
  signingKind: "signup",
  evidenceSha256: "a".repeat(64),
  downloadUrl: "/hub/agreement/download/aaaaaaaaaa11111",
};

const SITE_POLICY_STATE = {
  published: false,
  ack: null,
  latestTemplateVersion: 1,
  templateUpdateWaiting: false,
  addedSinceReview: [],
  missingInputs: [],
  coveredLabels: ["Contact forms", "Analytics"],
  lastUpdated: null,
};

function load(opts: { role?: string; bouncing?: boolean } = {}) {
  sess.requireHubSession.mockResolvedValue({
    ctx: { ...CTX, role: opts.role ?? "owner" },
    email: "a@b.c",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  });
  db.getOrgStage.mockResolvedValue({
    stage: "",
    path: "standard",
    slug: "rivera-bakery",
  });
  db.getBusinessProfile.mockResolvedValue(PROFILE);
  db.listAgreementDocuments.mockResolvedValue([]);
  db.agreementStatus.mockResolvedValue({
    state: "unsigned",
    missing: [],
    consentCurrent: false,
    lastSignedAt: null,
    lastSignerName: null,
  });
  db.sitePolicyState.mockResolvedValue(SITE_POLICY_STATE);
  db.listMedia.mockResolvedValue([]);
  db.listTeam.mockResolvedValue([
    {
      id: "m1",
      name: "Maria Lopez",
      role: "Owner",
      bio: "",
      is_published: true,
      photoId: null,
      sortOrder: 0,
    },
  ]);
  db.listServices.mockResolvedValue([
    {
      id: "s1",
      name: "Haircut",
      description: "",
      price_display: "fixed",
      price_cents: 4500,
      duration_minutes: 60,
      is_published: true,
      sortOrder: 0,
    },
  ]);
  db.listEmailRoutes.mockResolvedValue(
    opts.bouncing
      ? [
          DEFAULT_ROUTE,
          {
            ...DEFAULT_ROUTE,
            id: "r0000000000inq1",
            purpose: "inquiries",
            address: "orders@riverabakery.com",
            status: "bouncing",
          },
        ]
      : [DEFAULT_ROUTE],
  );
}

async function openSettings(
  tab?: string,
  extra: Record<string, string> = {},
): Promise<Mounted> {
  const el = (await SettingsPage({
    searchParams: Promise.resolve(
      tab === undefined ? { ...extra } : { tab, ...extra },
    ),
  })) as ReactElement;
  return show(el);
}

function tabLinks(
  c: ParentNode,
): { href: string; text: string; current: boolean }[] {
  const nav = c.querySelector('nav[aria-label="Settings sections"]')!;
  return Array.from(nav.querySelectorAll("a")).map((a) => ({
    href: a.getAttribute("href") ?? "",
    text: a.textContent ?? "",
    current: a.getAttribute("aria-current") === "page",
  }));
}

// ---------------------------------------------------------------------------------------

describe("SETTINGS_TABS (one array)", () => {
  it("is Business info · Team & hours · Email · Domain · People & roles · Payments · Billing · Integrations · Legal; unknown -> Business info", () => {
    expect(SETTINGS_TABS.map((t) => [t.id, t.label])).toEqual([
      ["business", "Business info"],
      ["team-hours", "Team & hours"],
      ["email", "Email"],
      ["domain", "Domain"],
      ["people", "People & roles"],
      ["payments", "Payments"],
      ["billing", "Billing"],
      ["integrations", "Integrations"],
      ["legal", "Legal"],
    ]);
    expect(resolveSettingsTab(undefined)).toBe("business");
    expect(resolveSettingsTab("bogus")).toBe("business");
    expect(resolveSettingsTab(["email", "x"])).toBe("email");
    expect(resolveSettingsTab("team-hours")).toBe("team-hours");
    expect(settingsTabHref("email")).toBe("/hub/settings?tab=email");
  });

  it("the Email label carries the bouncing count", () => {
    expect(settingsTabLabel("email", { email: 0 })).toBe("Email");
    expect(settingsTabLabel("email", { email: 1 })).toBe("Email · 1");
    expect(settingsTabLabel("business", { email: 2 })).toBe("Business info");
  });
});

describe("/hub/settings", () => {
  it("no tab: H1 Settings, AutosaveStatus under it, nine tabs with Business info current (14-31 Domain, 14-32 Integrations)", async () => {
    load();
    const { container: c } = await openSettings();
    expect(c.querySelector("h1")?.textContent).toBe("Settings");
    const h1 = c.querySelector("h1")!;
    // ScreenHeader (11-47) wraps the H1 twice; AutosaveStatus sits right under it.
    expect(
      h1.parentElement?.parentElement?.parentElement?.querySelector(
        '[role="status"]',
      ),
    ).not.toBeNull();
    expect(
      c.querySelector('a[aria-label="How Business info works"]'),
    ).not.toBeNull();
    expect(tabLinks(c)).toEqual([
      { href: "?tab=business", text: "Business info", current: true },
      { href: "?tab=team-hours", text: "Team & hours", current: false },
      { href: "?tab=email", text: "Email", current: false },
      { href: "?tab=domain", text: "Domain", current: false },
      { href: "?tab=people", text: "People & roles", current: false },
      { href: "?tab=payments", text: "Payments", current: false },
      { href: "?tab=billing", text: "Billing", current: false },
      { href: "?tab=integrations", text: "Integrations", current: false },
      { href: "?tab=legal", text: "Legal", current: false },
    ]);
  });

  it("WR-D06: next=/hub/review?step=facts shows Back to your review; any other next is ignored", async () => {
    expect(reviewReturnHref("/hub/review?step=facts")).toBe(
      "/hub/review?step=facts",
    );
    for (const bad of [
      "https://evil.example/",
      "//evil.example",
      "/hub/review?step=facts&x=1",
      "/hub/billing",
      undefined,
    ]) {
      expect(reviewReturnHref(bad)).toBeNull();
    }
    load();
    let c = (await openSettings("business", { next: "/hub/review?step=facts" }))
      .container;
    const back = c.querySelector<HTMLAnchorElement>("a[data-review-return]");
    expect(back?.getAttribute("href")).toBe("/hub/review?step=facts");
    expect(back?.textContent).toBe("Back to your review");
    unmountAll();
    c = (await openSettings("business", { next: "https://evil.example/" }))
      .container;
    expect(c.querySelector("a[data-review-return]")).toBeNull();
  });

  it("Business info: the four groups with logo and style; no hours, legal or domain fields", async () => {
    load();
    const { container: c } = await openSettings("business");
    // Section headings only (the closed leave-guard dialog has its own h2).
    const headings = Array.from(c.querySelectorAll("section > div h2")).map(
      (h) => h.textContent,
    );
    expect(headings).toEqual([
      "Your business",
      "How customers reach you",
      "Where you are",
      "Social links",
    ]);
    expect(c.querySelector("#field-logo")).not.toBeNull();
    expect(c.textContent).toContain("Your site's style");
    expect(c.textContent).not.toContain("Opening hours");
    expect(c.textContent).not.toContain("Legal business name");
    expect(c.textContent).not.toContain("Your web address");
    expect(db.getOrgStage).toHaveBeenCalled();
  });

  it("Business info saves through the field's own step: business for the tagline, contact for the phone", async () => {
    load();
    const { container: c } = await openSettings("business");
    const tagline = c.querySelector<HTMLInputElement>("#field-tagline")!;
    typeInto(tagline, "Sourdough baked daily in Austin.");
    act(() => {
      tagline.focus();
      tagline.blur();
    });
    const phone = c.querySelector<HTMLInputElement>("#field-phone")!;
    typeInto(phone, "512-555-0100");
    act(() => {
      phone.focus();
      phone.blur();
    });
    await flush();
    expect(intake.saveProfileAction).toHaveBeenCalledWith("business", {
      tagline: "Sourdough baked daily in Austin.",
    });
    expect(
      intake.saveProfileAction.mock.calls.some(
        (x) => x[0] === "contact" && Object.hasOwn(x[1] as object, "phone"),
      ),
    ).toBe(true);
  });

  it("11-24 sensitive-practice switch: effective value, autosaves on/off (D305)", async () => {
    load();
    db.readAlertProfileFacts.mockResolvedValue({
      sensitiveSetting: "",
      sensitiveOn: true,
      timeZone: "America/Chicago",
    });
    const { container: c } = await openSettings("business");
    const box = c.querySelector("[data-sensitive-practice]")!;
    expect(box.textContent).toContain(
      "Keep client names out of phone and email alerts",
    );
    expect(box.textContent).toContain(
      "On for therapy, counseling and health businesses unless you turn it off.",
    );
    const sw = box.querySelector<HTMLInputElement>('input[role="switch"]')!;
    expect(sw.checked).toBe(true);
    expect(sw.disabled).toBe(false);
    act(() => sw.click());
    await flush();
    expect(siteSettingsActions.setSensitivePracticeAction).toHaveBeenCalledWith(
      "off",
    );
    expect(sw.checked).toBe(false);
  });

  it("11-24 sensitive-practice switch: read-only for an Editor and impersonating staff; absent when unreadable", async () => {
    load({ role: "editor" });
    const { container: c } = await openSettings("business");
    expect(
      c.querySelector<HTMLInputElement>(
        '[data-sensitive-practice] input[role="switch"]',
      )!.disabled,
    ).toBe(true);
    unmountAll();
    load();
    sess.requireHubSession.mockResolvedValue({
      ctx: { ...CTX, impersonator: "s1" },
      email: "a@b.c",
      org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
    });
    const { container: d } = await openSettings("business");
    expect(
      d.querySelector<HTMLInputElement>(
        '[data-sensitive-practice] input[role="switch"]',
      )!.disabled,
    ).toBe(true);
    unmountAll();
    load();
    db.readAlertProfileFacts.mockRejectedValue(new Error("down"));
    const { container: e } = await openSettings("business");
    expect(e.querySelector("[data-sensitive-practice]")).toBeNull();
    expect(e.textContent).toContain("Your site's style");
  });

  it("11-41 Your data: last on Business info; Owner asks, Editor reads why not, outage is local", async () => {
    load();
    const { container: c } = await openSettings("business");
    const sec = c.querySelector("section#your-data")!;
    expect(sec).not.toBeNull();
    expect(sec.querySelector("h2")!.textContent).toBe("Your data");
    expect(sec.textContent).toContain(
      "Passwords, card details and security keys",
    );
    expect(
      [...sec.querySelectorAll("button")].map((b) => b.textContent),
    ).toContain("Download my data");
    unmountAll();
    load({ role: "editor" });
    const { container: e } = await openSettings("business");
    const esec = e.querySelector("section#your-data")!;
    expect(esec.textContent).toContain(
      "Only the site owner can download the site's data.",
    );
    expect(esec.querySelector("button")).toBeNull();
    unmountAll();
    load();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.readDataDownloadState.mockRejectedValue(new Error("down"));
    const { container: f } = await openSettings("business");
    expect(f.querySelector("section#your-data")!.textContent).toContain(
      "We couldn't load this part. The rest of the page is fine.",
    );
    expect(f.textContent).toContain("Your site's style");
    spy.mockRestore();
  });

  it("Team & hours: the Team list first, then Opening hours", async () => {
    load();
    const { container: c } = await openSettings("team-hours");
    const text = c.textContent ?? "";
    expect(text).toContain("Maria Lopez");
    const team = text.indexOf("Team");
    const hours = text.indexOf("Opening hours");
    expect(team).toBeGreaterThan(-1);
    expect(hours).toBeGreaterThan(team);
    expect(c.querySelector("h2#group-hours")?.textContent).toBe(
      "Opening hours",
    );
    expect(db.listTeam).toHaveBeenCalled();
    expect(
      c.querySelector('a[href="/hub/settings?tab=business#field-time_zone"]'),
    ).not.toBeNull();
  });

  it("Email: the routing component, with the bouncing count on the tab label", async () => {
    load({ bouncing: true });
    const { container: c } = await openSettings("email");
    expect(c.textContent).toContain("Where should your email go?");
    expect(tabLinks(c)[2]).toEqual({
      href: "?tab=email",
      text: "Email · 1",
      current: true,
    });
    expect(c.textContent).toContain(
      "Emails to orders@riverabakery.com are bouncing",
    );
    expect(c.textContent).toContain(
      "From: Rivera Bakery <rivera-bakery@send.example.com>",
    );
  });

  it("Editor: the read-only line, disabled fields and no add buttons", async () => {
    load({ role: "editor" });
    const { container: c } = await openSettings("team-hours");
    expect(c.textContent).toContain(
      "Only the owner or an admin can change settings.",
    );
    expect(button(c, "Add a team member")).toBeNull();
    mounted?.unmount();
    mounted = null;
    const { container: b } = await openSettings("business");
    expect(b.querySelector<HTMLInputElement>("#field-tagline")!.disabled).toBe(
      true,
    );
  });

  it("Viewer: 404 (not in their nav either)", async () => {
    load({ role: "viewer" });
    await expect(openSettings()).rejects.toThrow("NOT_FOUND");
    expect(db.getBusinessProfile).not.toHaveBeenCalled();
  });

  it("a failed load shows ERR-LOAD with Try again, never the error text", async () => {
    load();
    db.getBusinessProfile.mockRejectedValue(new Error("pb down: secret"));
    const { container: c } = await openSettings("team-hours");
    const alert = c.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("We couldn't load this.");
    expect(
      alert?.querySelector('a[href="/hub/settings?tab=team-hours"]')
        ?.textContent,
    ).toBe("Try again");
    expect(c.textContent).not.toContain("secret");
  });

  it("the tabs still open when the routes can't be read", async () => {
    load();
    db.listEmailRoutes.mockRejectedValue(new Error("down"));
    const { container: c } = await openSettings("business");
    expect(tabLinks(c).map((t) => t.text)).toEqual([
      "Business info",
      "Team & hours",
      "Email",
      "Domain",
      "People & roles",
      "Payments",
      "Billing",
      "Integrations",
      "Legal",
    ]);
    expect(c.querySelector("#field-tagline")).not.toBeNull();
  });

  it("Legal: visible to an Admin; hidden for an Editor, whose ?tab=legal is Business info", async () => {
    load({ role: "admin" });
    const { container: a } = await openSettings();
    expect(tabLinks(a).map((t) => t.text)).toContain("Legal");
    mounted?.unmount();
    mounted = null;
    db.listAgreementDocuments.mockClear();
    db.sitePolicyState.mockClear();
    load({ role: "editor" });
    const { container: c } = await openSettings("legal");
    expect(tabLinks(c).map((t) => t.text)).toEqual([
      "Business info",
      "Team & hours",
      "Email",
    ]);
    expect(
      c.querySelector('a[aria-current="page"]')?.getAttribute("href"),
    ).toBe("?tab=business");
    expect(c.querySelector("#field-tagline")).not.toBeNull();
    expect(c.textContent).not.toContain("Your agreements");
    expect(db.listAgreementDocuments).not.toHaveBeenCalled();
    expect(db.sitePolicyState).not.toHaveBeenCalled();
  });

  it("Legal: every signing with versions, date, signer, type and Download", async () => {
    load();
    db.listAgreementDocuments.mockResolvedValue([SIGNED_DOC]);
    db.agreementStatus.mockResolvedValue({
      state: "current",
      missing: [],
      consentCurrent: true,
      lastSignedAt: SIGNED_DOC.signedAt,
      lastSignerName: "Maria Lopez",
    });
    const { container: c } = await openSettings("legal");
    expect(c.querySelector("h2#legal-agreements")?.textContent).toBe(
      "Your agreements",
    );
    const text = c.textContent ?? "";
    expect(text).toContain(
      "Your agreement is up to date. Last signed 8 Oct 2026.",
    );
    expect(text).toContain("Service Agreement · version 1");
    expect(text).toContain("Maria Lopez");
    expect(text).toContain("First signing");
    expect(text).toContain("2:14 pm");
    const dl = c.querySelector(
      'a[aria-label="Download the agreement signed 8 Oct 2026"]',
    );
    expect(dl?.getAttribute("href")).toBe(
      "/hub/agreement/download/aaaaaaaaaa11111",
    );
    expect(tabLinks(c)[8]).toEqual({
      href: "?tab=legal",
      text: "Legal",
      current: true,
    });
  });

  it("Legal: no signings shows EMPTY-AGR; Review and sign only after Send to CDS", async () => {
    load();
    const { container: c } = await openSettings("legal");
    expect(c.textContent).toContain("No signed agreements yet");
    expect(c.textContent).toContain(
      "Not signed yet. You sign once, before checkout.",
    );
    expect(
      c.querySelector('a[aria-label="Review and sign your agreement"]'),
    ).toBeNull();
    mounted?.unmount();
    mounted = null;
    load();
    db.getOrgStage.mockResolvedValue({
      stage: "ready_for_build",
      path: "standard",
      slug: "rivera-bakery",
    });
    const { container: d } = await openSettings("legal");
    const links = d.querySelectorAll(
      'a[aria-label="Review and sign your agreement"]',
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("/hub/agreement");
  });

  it("Legal · 1 when a site policy update waits; a failed count read counts 0", async () => {
    load({ role: "admin" });
    db.sitePolicyState.mockResolvedValue({
      templateUpdateWaiting: true,
      addedSinceReview: [],
    });
    const { container: c } = await openSettings();
    expect(tabLinks(c).at(-1)!.text).toBe("Legal · 1");
    mounted?.unmount();
    mounted = null;
    load({ role: "admin" });
    db.sitePolicyState.mockRejectedValue(new Error("down"));
    const { container: d } = await openSettings();
    expect(tabLinks(d).at(-1)!.text).toBe("Legal");
  });

  it("Legal section 2: the owner sees the warning, both pages and the unticked publish box", async () => {
    load();
    const { container: c } = await openSettings("legal");
    const text = c.textContent ?? "";
    expect(text).toContain("Your site's policy pages");
    expect(text).toContain("CDS is not a law firm");
    expect(text).toContain("Privacy policy");
    expect(text).toContain("Covers: Contact forms · Analytics");
    const box = c.querySelector<HTMLInputElement>(
      'input[name="site-policies-ack"]',
    );
    expect(box?.checked).toBe(false);
    expect(text).toContain("Publish policy pages");
  });

  it("Legal section 2: an Admin reads the owner-only line, no box", async () => {
    load({ role: "admin" });
    const { container: c } = await openSettings("legal");
    expect(c.textContent).toContain("CDS is not a law firm");
    expect(c.textContent).toContain(
      "Only the site owner can publish these pages.",
    );
    expect(c.querySelector('input[name="site-policies-ack"]')).toBeNull();
  });

  it("Legal section 2: a failed state read shows ERR-LOAD there only", async () => {
    load();
    db.sitePolicyState.mockRejectedValue(new Error("down"));
    const { container: c } = await openSettings("legal");
    expect(c.querySelector("h2#legal-agreements")).not.toBeNull();
    expect(c.querySelector("h2#legal-site-policies")?.textContent).toBe(
      "Your site's policy pages",
    );
    expect(c.textContent).toContain("We couldn't load this.");
  });

  it("IN-C04: a failed business profile read keeps the agreements list (UTC)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    load();
    db.getBusinessProfile.mockRejectedValue(new Error("pb down"));
    db.listAgreementDocuments.mockResolvedValue([SIGNED_DOC]);
    const { container: c } = await openSettings("legal");
    expect(c.querySelector("h2#legal-agreements")).not.toBeNull();
    expect(c.textContent).toContain("Service Agreement · version 1");
    expect(c.textContent).not.toContain("We couldn't load this.");
    err.mockRestore();
  });

  it("Legal: a failed load shows ERR-LOAD", async () => {
    load();
    db.listAgreementDocuments.mockRejectedValue(new Error("pb down: secret"));
    const { container: c } = await openSettings("legal");
    const alert = c.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("We couldn't load this.");
    expect(c.textContent).not.toContain("secret");
  });

  it("loading: the H1 and skeleton fields", () => {
    const { container: c } = show(<SettingsLoading />);
    expect(c.querySelector("h1")?.textContent).toBe("Settings");
    expect(c.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

// 10-29 Settings › Billing (BILL-03, BILL-08, BILL-13, BILL-16, BILL-19; D311).
const GIB = 1024 ** 3;
const PAID_ACCOUNT = {
  id: "ba1",
  organization: "org1",
  provider: "fake",
  status: "active",
  cadence: "monthly",
  buildPlan: "full",
  installmentsPaid: 0,
  paidAt: "2026-10-08T15:00:00.000Z",
  carePlan: false,
  media5gbQty: 0,
  media25gbQty: 0,
  currentPeriodEnd: "2026-11-08T15:00:00.000Z",
  lapsedAt: null,
  priceLockedUntil: null,
  amountDueCents: 0,
  cardBrand: "visa",
  cardLast4: "4242",
  cardExp: "08/28",
  declinedAt: null,
  restoredAt: null,
  updated: "",
};

function loadBilling(account: unknown = PAID_ACCOUNT, care = false) {
  db.readBillingAccount.mockResolvedValue(account);
  db.listBillingInvoices.mockResolvedValue([]);
  db.listWorkOrders.mockResolvedValue([]);
  db.carePlanUsage.mockResolvedValue({
    on: care,
    usedMinutes: care ? 25 : 0,
    monthLabel: "October",
    resetLabel: "1 Nov",
    entries: [],
    totalEntries: 0,
  });
  db.mediaUsage.mockResolvedValue({ usedBytes: 1.2 * GIB });
  db.mediaAllowance.mockResolvedValue(2 * GIB);
  db.listOrgAddons.mockResolvedValue([]);
  db.readPriceCatalog.mockResolvedValue([
    {
      itemKind: "plan",
      itemKey: "base",
      path: "standard",
      monthlyCents: 3900,
      oneTimeCents: null,
      installments: null,
    },
    {
      itemKind: "care_plan",
      itemKey: "care",
      path: "standard",
      monthlyCents: 9900,
      oneTimeCents: null,
      installments: null,
    },
  ]);
}

describe("Settings › Billing (10-29)", () => {
  it("Owner sees Billing between Payments and Legal; Admin does not, and ?tab=billing is Business info", async () => {
    load();
    loadBilling();
    const { container: o } = await openSettings();
    expect(tabLinks(o).map((t) => t.text)).toEqual([
      "Business info",
      "Team & hours",
      "Email",
      "Domain",
      "People & roles",
      "Payments",
      "Billing",
      "Integrations",
      "Legal",
    ]);
    mounted?.unmount();
    mounted = null;
    load({ role: "admin" });
    const { container: a } = await openSettings("billing");
    expect(tabLinks(a).map((t) => t.text)).not.toContain("Billing");
    expect(
      a.querySelector('a[aria-current="page"]')?.getAttribute("href"),
    ).toBe("?tab=business");
    expect(db.readBillingAccount).not.toHaveBeenCalled();
  });

  it("'Billing · 2' for past due plus one waiting quote", async () => {
    load();
    loadBilling();
    db.billingTabCounts.mockResolvedValue({ payments: 0, billing: 2 });
    const { container: c } = await openSettings();
    expect(tabLinks(c).map((t) => t.text)).toContain("Billing · 2");
  });

  it("renders the seven sections in UI-SPEC order inside the 880px column", async () => {
    load();
    loadBilling();
    const { container: c } = await openSettings("billing");
    const panel = c.querySelector("[data-billing-panel]")!;
    expect(panel.className).toContain("max-w-[880px]");
    expect(panel.className).toContain("gap-8");
    const headings = Array.from(panel.querySelectorAll("h2"))
      .filter((h) => !h.closest("dialog"))
      .map((h) => h.textContent?.trim());
    // The invoice EmptyState ("No invoices yet") carries its own heading after these.
    expect(headings.slice(0, 6)).toEqual([
      "Your plan",
      "What you pay for",
      "Care Plan",
      "Media storage",
      "Quotes from CDS",
      "Invoices",
    ]);
    expect(panel.textContent).toContain("You're all paid up.");
  });

  it("before the first payment: one line, quotes and the invoice empty state only", async () => {
    load();
    loadBilling(null);
    const { container: c } = await openSettings("billing");
    const panel = c.querySelector("[data-billing-panel]")!;
    expect(panel.textContent).toContain(
      "Your plan, card and invoices show here after checkout.",
    );
    expect(panel.textContent).not.toContain("What you pay for");
    expect(panel.textContent).toContain("No invoices yet");
  });

  it("?card=updated shows Toast 'Card updated.' once", async () => {
    load();
    loadBilling();
    await openSettings("billing", { card: "updated" });
    await flush();
    const toasts = Array.from(document.querySelectorAll('[role="status"]'))
      .map((n) => n.textContent ?? "")
      .filter((t) => t.includes("Card updated."));
    expect(toasts).toHaveLength(1);
  });

  it("Care Plan add opens ChargeConfirmDialog with the server preview", async () => {
    load();
    loadBilling();
    billingActions.carePlanPreviewAction.mockResolvedValue({
      ok: true,
      preview: {
        title: "Add the Care Plan?",
        what: "1 hour a month of changes made for you by CDS.",
        todayCents: 4150,
        todayLabel: "For the rest of October",
        thenText: "$99/mo on your monthly bill from 1 Nov",
        cardLine: "Plus sales tax. Charged to Visa ending 4242.",
        confirmLabel: "Add and pay $41.50",
      },
    });
    const { container: c } = await openSettings("billing");
    click(button(c, "Add the Care Plan, $99/mo"));
    await flush();
    expect(billingActions.carePlanPreviewAction).toHaveBeenCalledOnce();
    expect(button(c, "Add and pay $41.50")).not.toBeNull();
  });

  it("Care Plan remove opens the destructive dialog", async () => {
    load();
    loadBilling({ ...PAID_ACCOUNT, carePlan: true }, true);
    const { container: c } = await openSettings("billing");
    click(button(c, "Remove the Care Plan"));
    await flush();
    expect(button(c, "Keep Care Plan")).not.toBeNull();
    expect(billingActions.setCarePlanAction).not.toHaveBeenCalled();
  });

  it("Update card goes through updateCardAction", async () => {
    load();
    loadBilling();
    billingActions.updateCardAction.mockResolvedValue({
      ok: false,
      code: "save_failed",
      message:
        "We couldn't open the card page just now. Try again in a minute.",
    });
    const { container: c } = await openSettings("billing");
    const link = c.querySelector<HTMLAnchorElement>(
      'a[href="/hub/settings/billing/card"]',
    );
    expect(link).not.toBeNull();
    click(link);
    await flush();
    expect(billingActions.updateCardAction).toHaveBeenCalledOnce();
    expect(c.textContent).toContain("We couldn't open the card page just now.");
  });

  it("an impersonating owner reads it with no purchase buttons", async () => {
    load();
    sess.requireHubSession.mockResolvedValue({
      ctx: { ...CTX, impersonator: "s1" },
      email: "a@b.c",
      org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
    });
    loadBilling();
    const { container: c } = await openSettings("billing");
    expect(c.textContent).toContain("You're viewing as CDS staff");
    expect(button(c, "Add the Care Plan, $99/mo")).toBeNull();
  });
});

describe("Website › Services (D311, D37)", () => {
  it("Services is the second Website tab", () => {
    expect(WEBSITE_TABS.map((t) => t.id)).toEqual([
      "pages",
      "services",
      "media",
      "forms",
      "navigation",
      "footer",
      "banner",
      "popups",
      "site",
    ]);
  });

  it("a Viewer reads content but not business details: no Services tab", () => {
    const ids = (role: string) =>
      composeWebsiteTabs({
        core: WEBSITE_TABS,
        installed: [],
        role: role as "viewer",
        grants: [],
      }).map((t) => t.id);
    expect(ids("viewer")).toEqual([
      "pages",
      "media",
      "forms",
      "navigation",
      "footer",
      "banner",
      "popups",
      "site",
    ]);
    expect(ids("editor")).toContain("services");
  });

  it("?tab=services renders the same ServicesSection (owner edits)", async () => {
    load();
    const el = (await WebsitePage({
      searchParams: Promise.resolve({ tab: "services" }),
    })) as ReactElement;
    const { container: c } = show(el);
    expect(db.listServices).toHaveBeenCalled();
    expect(c.textContent).toContain("Haircut");
    expect(c.textContent).toContain("$45 · 60 min");
    expect(button(c, "Add a service")).not.toBeNull();
    const current = c.querySelector('a[aria-current="page"]');
    expect(current?.getAttribute("href")).toBe("?tab=services");
  });

  it("an Editor sees Services read-only", async () => {
    load({ role: "editor" });
    const el = (await WebsitePage({
      searchParams: Promise.resolve({ tab: "services" }),
    })) as ReactElement;
    const { container: c } = show(el);
    expect(c.textContent).toContain("Haircut");
    expect(button(c, "Add a service")).toBeNull();
  });
});
