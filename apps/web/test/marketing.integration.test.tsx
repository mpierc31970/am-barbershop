// @vitest-environment jsdom
// Phase 15 exit (15-28; HUB-01, HUB-02, HUB-07; ROADMAP P15 "the hub serves and a visitor can
// register from it"; T-15-28-01). Against the PocketBase 0.39.11 binary, the real @cds/db
// chokepoint and the real route modules:
//
//   1. prices set through the real catalog (setPrice, super_admin) render on the home page
//      and /pricing exactly as the shared @cds/core/pricing helpers print them;
//   2. the hub CTA /start?path=studio opens the configurator with Studio chosen and step 2
//      "Your business" current, and the first save creates a real Studio quote;
//   3. the hub CTA /start?addon=<public slug> pre-ticks that add-on, saved on the quote;
//   4. a /contact submission lands in hub_inquiries and shows in listLeads as kind inquiry;
//   5. /report still accepts a report (a review_cases row; HUB-07 regression);
//   6. an unknown platform URL (/does-not-exist) renders the marketing not-found.
//
// Mocked: next/headers (a request with one client IP and an in-memory cookie jar),
// next/navigation (notFound/redirect throw), next/cache (unstable_cache pass-through, as the
// other exit tests), next/link (a plain <a>) and the Turnstile check (getHumanCheck, plus a fetch
// stand-in for siteverify: only Cloudflare's dummy test token passes, so no network call). Everything
// else is real. Skips locally without the PocketBase binary; fails under CI.
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import {
  formatMonthly,
  pathPriceLine,
  priceLabelFor,
  type CatalogRow,
} from "@cds/core/pricing";
import type { ContactState } from "../lib/contact-form";
import type { ReportState } from "../lib/report-form";
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PlatformContext } from "@cds/db";
import {
  hubInquiryRowsFor,
  reviewCaseRows,
} from "../../../packages/db/test/hub-exit-reads";
import { createBillingSpy } from "../../../packages/db/test/fake-billing-spy";
import {
  bootSeededPb,
  staffContext,
  type SeededPb,
} from "../../../packages/db/test/seeded";
import {
  click,
  flush,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

// The jsdom environment swaps in jsdom's FormData/Blob/File, which Node's fetch cannot send
// (PocketBase batch requests fail with "Failed to read the submitted batch data"). Put Node's
// own classes back; the Configurator under test never builds a FormData from the DOM.
const nodeFormData = (await new Response(new URLSearchParams("a=1")).formData())
  .constructor as typeof FormData;
Object.assign(globalThis, {
  FormData: nodeFormData,
  Blob: NodeBlob,
  File: NodeFile,
});

const IP = "203.0.113.128";
/** Cloudflare's dummy Turnstile response token (the test site keys produce it). */
const TURNSTILE_DUMMY = "XXXX.DUMMY.TOKEN.XXXX";

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  human: [] as { token: string; ip: string }[],
  /** x-cds-tenant-host, as the middleware sets it on a tenant rewrite; null = platform host. */
  tenantHost: null as string | null,
}));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      "x-forwarded-for": "203.0.113.128",
      ...(state.tenantHost ? { "x-cds-tenant-host": state.tenantHost } : {}),
    }),
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined,
    set: (name: string, value: string) => {
      state.jar.set(name, value);
    },
    delete: (opts: string | { name: string }) => {
      state.jar.delete(typeof opts === "string" ? opts : opts.name);
    },
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  permanentRedirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT_308:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/start",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => Promise<unknown>) =>
    (...a: unknown[]) =>
      fn(...a),
  revalidateTag: () => {},
  revalidatePath: () => {},
}));

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) =>
    createElement("a", rest, children),
}));

// next/font/local only runs under the Next compiler: stand-in class names (as marketing-pages).
vi.mock("../app/(platform)/(marketing)/fonts", () => ({
  anybody: { variable: "font-var-anybody" },
  hanken: { variable: "font-var-hanken" },
}));

// WR-B07: createHubInquiry runs the Turnstile check inside @cds/db, which calls the default
// verifier (Cloudflare test secret). Answer its siteverify request here (only the dummy token
// passes) and send every other request (PocketBase) to the real fetch; the barrel override
// below covers /report.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (url.startsWith("https://challenges.cloudflare.com/turnstile/")) {
    const body = new URLSearchParams(String(init?.body ?? ""));
    const token = body.get("response") ?? "";
    state.human.push({ token, ip: body.get("remoteip") ?? "" });
    return Response.json({ success: token === TURNSTILE_DUMMY });
  }
  return realFetch(input, init);
}) as typeof fetch;

vi.mock("@cds/db", async (orig) => {
  const real = await orig<typeof import("@cds/db")>();
  return {
    ...real,
    getHumanCheck: () => ({
      verify: async (token: string, ip: string) => {
        state.human.push({ token, ip });
        return token === "XXXX.DUMMY.TOKEN.XXXX";
      },
    }),
  };
});

const db = await import("@cds/db");
const { default: HomePage } =
  await import("../app/(platform)/(marketing)/page");
const { default: PricingPage } =
  await import("../app/(platform)/(marketing)/pricing/page");
const { default: StartPage } = await import("../app/(platform)/start/page");
const { Configurator } =
  await import("../app/(platform)/start/_components/Configurator");
const { submitContactAction } = await import("../app/actions/contact");
const { submitReportAction } = await import("../app/actions/report");
const { INITIAL_CONTACT_STATE } = await import("../lib/contact-form");
const { default: RootNotFound } = await import("../app/not-found");
const { default: MarketingLayout } =
  await import("../app/(platform)/(marketing)/layout");
const { default: MarketingNotFound } =
  await import("../app/(platform)/(marketing)/not-found");
const { quoteCookieName } = await import("../lib/quote-cookie");
const { getCatalogView, getPickableSlugs, resetCatalogSnapshot } =
  await import("../lib/catalog-view");
const { MK_COPY } = await import("@cds/core/marketing");

/** Prices this test sets through the real catalog (both paths + one add-on). */
const PRICES = {
  standardPlan: 4400,
  studioPlan: 8400,
  standardBuild: 120000,
  studioBuild: 260000,
  addonMonthly: 1100,
} as const;

let booted: SeededPb | null = null;
let admin: PlatformContext;
let catalog: CatalogRow[] = [];
/** A public, pickable add-on slug from the throwaway PB's merged catalog view. */
let addonSlug = "";
let addonName = "";
let addonPath: "standard" | "studio" = "standard";
let mounted: Mounted | null = null;

function needPb(t: { skip: () => void }): boolean {
  if (booted) return true;
  if (process.env.CI) throw new Error("PocketBase unavailable under CI");
  t.skip();
  return false;
}

/** HTML-escaped text as renderToStaticMarkup prints it. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#x27;");
}

async function html(el: Promise<ReactNode> | ReactNode): Promise<string> {
  return renderToStaticMarkup((await el) as ReactElement);
}

/** The Configurator element inside the /start server tree (what the browser hydrates). */
function findConfigurator(node: ReactNode): ReactElement | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findConfigurator(n as ReactNode);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === Configurator) return node;
  return findConfigurator((node.props as { children?: ReactNode }).children);
}

async function startTree(
  params: Record<string, string>,
): Promise<ReactElement> {
  const tree = await StartPage({ searchParams: Promise.resolve(params) });
  const el = findConfigurator(tree);
  expect(el).not.toBeNull();
  return el!;
}

const radio = (el: ParentNode, value: string) =>
  (Array.from(el.querySelectorAll('[role="radio"]')) as HTMLElement[]).find(
    (r) => r.dataset.value === value,
  );
const currentStep = (el: ParentNode) =>
  el
    .querySelector('nav[aria-label="Quote steps"]')
    ?.querySelector('[aria-current="step"]')?.textContent;

async function storedQuote() {
  const token = state.jar.get(quoteCookieName());
  expect(token).toBeTruthy();
  return db.readQuoteByToken(token!);
}

describe("Phase 15 exit: hub to registration (throwaway PocketBase)", () => {
  beforeAll(async () => {
    booted = await bootSeededPb();
    if (!booted) {
      if (process.env.CI) throw new Error("PocketBase binary missing under CI");
      return;
    }
    admin = await staffContext(
      booted.inst,
      "hub-exit-admin@cds.test",
      "super_admin",
    );
    resetCatalogSnapshot();
    const entries = await getCatalogView();
    const pickable = await getPickableSlugs();
    const pick =
      entries.find(
        (e) => !e.private && pickable?.has(e.slug) && e.path !== "both",
      ) ?? entries.find((e) => !e.private && pickable?.has(e.slug));
    expect(pick, "a public pickable add-on in the seeded view").toBeDefined();
    addonSlug = pick!.slug;
    addonName = pick!.name;
    addonPath = pick!.path === "studio" ? "studio" : "standard";

    // Prices through the real catalog chokepoint (audited, provider sync on the fake spy).
    const deps = { billing: createBillingSpy() };
    const set = (input: Parameters<typeof db.setPrice>[1]) =>
      db.setPrice(admin, input, deps);
    await set({
      kind: "plan",
      key: "base",
      path: "standard",
      monthlyCents: PRICES.standardPlan,
    });
    await set({
      kind: "plan",
      key: "base",
      path: "studio",
      monthlyCents: PRICES.studioPlan,
    });
    await set({
      kind: "build_fee",
      key: "base",
      path: "standard",
      oneTimeCents: PRICES.standardBuild,
    });
    await set({
      kind: "build_fee",
      key: "base",
      path: "studio",
      oneTimeCents: PRICES.studioBuild,
    });
    await set({
      kind: "addon",
      key: addonSlug,
      path: addonPath,
      monthlyCents: PRICES.addonMonthly,
    });
    catalog = await db.readPriceCatalog();
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    await booted?.inst.stop();
  });

  afterEach(async () => {
    if (mounted) {
      mounted.unmount();
      mounted = null;
    }
    await flush();
  });

  it("home renders both path price lines from the real catalog", async (t) => {
    if (!needPb(t)) return;
    const out = await html(HomePage());
    for (const path of ["standard", "studio"] as const) {
      const line = pathPriceLine(catalog, path);
      expect(line).not.toBeNull();
      expect(line).not.toBe("Price coming soon");
      expect(out).toContain(esc(line!));
    }
    expect(pathPriceLine(catalog, "standard")).toBe(
      "$1,200 build, then $44 a month",
    );
    expect(out).toContain('href="/start?path=studio"');
    expect(out).toContain('href="/start?path=standard"');
  });

  it("/pricing renders the plan and add-on prices the shared helpers print", async (t) => {
    if (!needPb(t)) return;
    const out = await html(PricingPage());
    expect(out).toContain(esc(formatMonthly(PRICES.standardPlan)));
    expect(out).toContain(esc(formatMonthly(PRICES.studioPlan)));
    const row = catalog.find(
      (r) =>
        r.itemKind === "addon" &&
        r.itemKey === addonSlug &&
        r.path === addonPath,
    );
    expect(row?.monthlyCents).toBe(PRICES.addonMonthly);
    expect(out).toContain(esc(priceLabelFor(row)));
    expect(out).toContain(addonName);
  });

  it("/start?path=studio opens with Studio chosen and step 2 current, and saves a Studio quote", async (t) => {
    if (!needPb(t)) return;
    state.jar.clear();
    const el = await startTree({ path: "studio" });
    expect((el.props as { preselect: unknown }).preselect).toEqual({
      path: "studio",
      addon: null,
    });
    mounted = mount(el);
    const c = mounted.container;
    expect(radio(c, "studio")?.getAttribute("aria-checked")).toBe("true");
    expect(currentStep(c)).toBe("Your business");
    await flush(20);
    // The preselect is shown, never saved on mount (15 CR-A01): no quote, no cookie yet.
    expect(state.jar.get(quoteCookieName())).toBeUndefined();
    // The visitor's first choice saves the carried Studio path with it.
    const businessType = (
      Array.from(c.querySelectorAll('[role="radio"]')) as HTMLElement[]
    ).find(
      (r) => r.dataset.value !== "standard" && r.dataset.value !== "studio",
    );
    expect(businessType).toBeDefined();
    click(businessType);
    await flush(20);
    const q = await storedQuote();
    expect(q?.path).toBe("studio");
    expect(q?.status).toBe("draft");
  });

  it("/start?addon=<public slug> pre-ticks it and saves it on the quote", async (t) => {
    if (!needPb(t)) return;
    state.jar.clear();
    const el = await startTree({ addon: addonSlug });
    const pre = (
      el.props as {
        preselect: { path: string | null; addon: { slug: string } | null };
      }
    ).preselect;
    expect(pre.addon?.slug).toBe(addonSlug);
    mounted = mount(el);
    const c = mounted.container;
    if (pre.path === null) {
      click(radio(c, addonPath));
      await flush(20);
    }
    // Step 2: any business type reveals the add-on list.
    const types = Array.from(
      c.querySelectorAll('[role="radio"]'),
    ) as HTMLElement[];
    const businessType = types.find(
      (r) => r.dataset.value !== "standard" && r.dataset.value !== "studio",
    );
    expect(businessType).toBeDefined();
    click(businessType);
    await flush(20);
    const box = c.querySelector(
      `input[type="checkbox"][value="${addonSlug}"]`,
    ) as HTMLInputElement | null;
    expect(box?.checked).toBe(true);
    await flush(40);
    const q = await storedQuote();
    expect(q?.selections.addons).toContain(addonSlug);
  });

  it("a /contact submission lands in hub_inquiries and shows in listLeads as an inquiry", async (t) => {
    if (!needPb(t)) return;
    db.resetContactLimitsForTests();
    const email = "hub-exit-visitor@cds.test";
    const fd = new FormData();
    fd.set("name", "Rosa Vega");
    fd.set("email", email);
    fd.set("business", "Vega Hair Studio");
    fd.set("topic", "question");
    fd.set("message", "Can I move my salon site over from Vagaro?");
    fd.set("cf-turnstile-response", TURNSTILE_DUMMY);
    const res: ContactState = await submitContactAction(
      INITIAL_CONTACT_STATE,
      fd,
    );
    expect(res).toMatchObject({ status: "sent", email, isCall: false });
    expect(state.human.at(-1)).toEqual({ token: TURNSTILE_DUMMY, ip: IP });

    const rows = await hubInquiryRowsFor(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Rosa Vega",
      business: "Vega Hair Studio",
      topic: "question",
    });
    // No IP is stored, nor anything derived from it (P15-P14, WR-B06).
    expect(rows[0]!.fields).not.toContain("ip_bucket");
    expect(rows[0]!.stored).not.toContain(IP);

    const leads = await db.listLeads(admin);
    const lead = leads.find((l) => l.kind === "inquiry" && l.email === email);
    expect(lead).toBeDefined();
  });

  it("/report still accepts a report (a review_cases row)", async (t) => {
    if (!needPb(t)) return;
    db.resetReportLimitsForTests();
    const before = (await reviewCaseRows()).length;
    const fd = new FormData();
    fd.set("category", "scam");
    fd.set("url", "https://hub-exit-unknown.example.com/deals");
    fd.set(
      "description",
      "This page asks for card numbers for a fake discount.",
    );
    fd.set("email", "hub-exit-reporter@cds.test");
    fd.set("cf-turnstile-response", TURNSTILE_DUMMY);
    const res: ReportState = await submitReportAction(
      { status: "idle", error: null, fieldErrors: {} },
      fd,
    );
    expect(res.status).toBe("sent");
    const ref = (res as { ref: string }).ref;
    expect(ref).toMatch(/^R-\d+$/);
    const cases = await reviewCaseRows();
    expect(cases).toHaveLength(before + 1);
    const row = cases.find((c) => c.seq === Number(ref.slice(2)));
    expect(row?.kind).toBe("report");
  });

  it("an unknown platform URL (/does-not-exist) renders the marketing not-found", async () => {
    // Next renders app/not-found.tsx for any unmatched platform-host URL (tenant hosts are
    // rewritten to /tenant/<host>/… and keep their own not-found).
    state.tenantHost = null;
    const el = await RootNotFound();
    expect(el.type).toBe(MarketingLayout);
    const child = (el.props as { children: ReactElement }).children;
    expect(child.type).toBe(MarketingNotFound);
    const out = await html(MarketingLayout({ children: child }));
    expect(out).toContain('<meta name="cds-surface" content="hub"/>');
    expect(out).toContain(esc(MK_COPY.NOT_FOUND.H1));
    expect(out).toContain('href="/add-ons"');
    expect(out).toContain('id="main"');
  });

  it("on a tenant host the root not-found carries no CDS marketing chrome", async () => {
    state.tenantHost = "a.example.com";
    try {
      const out = await html(RootNotFound());
      expect(out).not.toContain("cds-surface");
      expect(out).not.toContain("data-mk");
      expect(out).not.toContain(esc(MK_COPY.NOT_FOUND.H1));
      expect(out).toContain("<h1>");
    } finally {
      state.tenantHost = null;
    }
  });
});
