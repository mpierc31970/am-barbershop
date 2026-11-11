// 14-44: the dev-only `/test-dns` page and its Server Actions (UI-SPEC "Test DNS page",
// D-UI-P14-24, P14-P32; T-14-44-01, T-14-44-02). The session and @cds/db are mocked; the real
// runAction maps refusals.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const SESSION = { ctx: CTX, org: { id: "org1", name: "Rivera Bakery" } };

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  requireHubSession: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => ({
  dnsProviderMode: vi.fn(),
  fakeWorldsForOrg: vi.fn(),
  fakeChangeNameservers: vi.fn(),
  fakeBreakEmailRecord: vi.fn(),
  fakeSetDnssec: vi.fn(),
  fakeSetSesStatus: vi.fn(),
  fakeSetHttps: vi.fn(),
  fakeExpireIn: vi.fn(),
}));
vi.mock("@cds/db", () => db);

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const actions = await import("../app/actions/test-dns");
const { default: Layout } = await import("../app/(platform)/test-dns/layout");
const { default: Page } = await import("../app/(platform)/test-dns/page");

function world(domain: string, over: Record<string, unknown> = {}) {
  return {
    world: {
      domain,
      registrar: "GoDaddy",
      expiresAt: "2027-10-01T00:00:00.000Z",
      dnssec: false,
      delegatedTo: "old",
      oldNameservers: [],
      oldZone: [],
      cdsZoneId: "fz_1",
      cdsNameservers: [],
      cdsZone: [],
      cdsStatus: "pending",
      otherNameservers: [],
      otherZone: [],
      publicOverrides: [],
      https: "fail",
      certDaysLeft: 0,
      ses: { status: "none", tokens: [] },
      ...over,
    },
    zoneStatus: "pending",
  };
}

const MINE = "riverabakery.com";

beforeEach(() => {
  vi.stubEnv("CDS_ENV", "dev");
  db.dnsProviderMode.mockReturnValue("fake");
  sess.getHubSession.mockResolvedValue(SESSION);
  sess.requireHubSession.mockResolvedValue(SESSION);
  sess.agreementBlocks.mockReturnValue(false);
  db.fakeWorldsForOrg.mockResolvedValue([world(MINE)]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("/test-dns layout (T-14-44-01)", () => {
  it("renders the strip and the page in dev with the fake provider", () => {
    const html = renderToStaticMarkup(Layout({ children: <p>inner</p> }));
    expect(html).toContain("Test DNS page. No real DNS changes.");
    expect(html).toContain("max-w-[720px]");
    expect(html).toContain("inner");
  });

  it("404s in production", () => {
    vi.stubEnv("CDS_ENV", "production");
    expect(() => Layout({ children: null })).toThrow("NOT_FOUND");
  });

  it("404s with CDS_DNS_PROVIDER=cloudflare", () => {
    db.dnsProviderMode.mockReturnValue("cloudflare");
    expect(() => Layout({ children: null })).toThrow("NOT_FOUND");
  });

  it("404s when the provider value is unknown", () => {
    db.dnsProviderMode.mockImplementation(() => {
      throw new Error("bad");
    });
    expect(() => Layout({ children: null })).toThrow("NOT_FOUND");
  });
});

describe("/test-dns page", () => {
  async function render(search: Record<string, string> = {}) {
    return renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve(search) }),
    );
  }

  it("lists the org's fake worlds and the chosen world's state", async () => {
    const html = await render();
    expect(html).toContain("Test DNS");
    expect(html).toContain(
      "Plays the outside world for the fake DNS, SES and HTTPS adapters.",
    );
    expect(html).toContain("riverabakery.com · Rivera Bakery · zone pending");
    expect(html).toContain("GoDaddy");
    expect(html).toContain("The old host");
    expect(html).toContain("Change nameservers to CDS");
    expect(html).toContain("Turn DNSSEC on");
    expect(html).toContain("Make HTTPS work");
    expect(html).toContain("npm run domains:run");
    expect(db.fakeWorldsForOrg).toHaveBeenCalledWith(CTX);
  });

  it("flips the toggle labels from the world state", async () => {
    db.fakeWorldsForOrg.mockResolvedValue([
      world(MINE, { dnssec: true, https: "ok", certDaysLeft: 89 }),
    ]);
    const html = await render();
    expect(html).toContain("Turn DNSSEC off");
    expect(html).toContain("Make HTTPS fail");
    expect(html).toContain("certificate 89 days left");
  });

  it("shows the empty state with no fake zones", async () => {
    db.fakeWorldsForOrg.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain(
      "No fake zones yet. Connect a domain in the hub first.",
    );
    expect(html).toContain("Back to the hub");
  });

  it("shows the Done copy after an action", async () => {
    const html = await render({ domain: MINE, done: "ns_cds" });
    expect(html).toContain("Done: nameservers now point to CDS.");
  });

  it("404s in production", async () => {
    vi.stubEnv("CDS_ENV", "production");
    await expect(render()).rejects.toThrow("NOT_FOUND");
  });
});

describe("/test-dns actions (T-14-44-02)", () => {
  const cases: [string, () => void][] = [
    [
      "ns_cds",
      () => expect(db.fakeChangeNameservers).toHaveBeenCalledWith(MINE, "cds"),
    ],
    [
      "ns_back",
      () => expect(db.fakeChangeNameservers).toHaveBeenCalledWith(MINE, "old"),
    ],
    [
      "break_email",
      () => expect(db.fakeBreakEmailRecord).toHaveBeenCalledWith(MINE),
    ],
    [
      "dnssec_on",
      () => expect(db.fakeSetDnssec).toHaveBeenCalledWith(MINE, true),
    ],
    [
      "dnssec_off",
      () => expect(db.fakeSetDnssec).toHaveBeenCalledWith(MINE, false),
    ],
    [
      "ses_verified",
      () => expect(db.fakeSetSesStatus).toHaveBeenCalledWith(MINE, "verified"),
    ],
    [
      "https_fail",
      () => expect(db.fakeSetHttps).toHaveBeenCalledWith(MINE, false),
    ],
    [
      "https_ok",
      () => expect(db.fakeSetHttps).toHaveBeenCalledWith(MINE, true),
    ],
    ["expire_7", () => expect(db.fakeExpireIn).toHaveBeenCalledWith(MINE, 7)],
  ];

  it.each(cases)("%s calls its fake world action", async (action, check) => {
    const r = await actions.runTestDnsAction(MINE, action as never);
    expect(r.ok).toBe(true);
    check();
  });

  it("refuses a domain the member's org does not own", async () => {
    const r = await actions.runTestDnsAction("someoneelse.com", "ns_cds");
    expect(r).toMatchObject({ ok: false, code: "not_found" });
    expect(db.fakeChangeNameservers).not.toHaveBeenCalled();
  });

  it("refuses a malformed domain or action before any read", async () => {
    const bad = await actions.runTestDnsAction("Bad Domain!", "ns_cds");
    expect(bad.ok).toBe(false);
    const badAction = await actions.runTestDnsAction(MINE, "drop" as never);
    expect(badAction.ok).toBe(false);
    expect(db.fakeWorldsForOrg).not.toHaveBeenCalled();
  });

  it("refuses in production and with a non-fake provider", async () => {
    vi.stubEnv("CDS_ENV", "production");
    expect((await actions.runTestDnsAction(MINE, "ns_cds")).ok).toBe(false);
    vi.stubEnv("CDS_ENV", "dev");
    db.dnsProviderMode.mockReturnValue("cloudflare");
    expect((await actions.runTestDnsAction(MINE, "ns_cds")).ok).toBe(false);
    expect(db.fakeChangeNameservers).not.toHaveBeenCalled();
  });

  it("is signed out without a session", async () => {
    sess.getHubSession.mockResolvedValue(null);
    const r = await actions.runTestDnsAction(MINE, "ns_cds");
    expect(r).toMatchObject({ ok: false, code: "signed_out" });
  });

  it("submitTestDns redirects back with done or error", async () => {
    const ok = new FormData();
    ok.set("domain", MINE);
    ok.set("action", "ns_cds");
    await expect(actions.submitTestDns(ok)).rejects.toThrow(
      `REDIRECT:/test-dns?domain=${MINE}&done=ns_cds`,
    );
    const other = new FormData();
    other.set("domain", "someoneelse.com");
    other.set("action", "ns_cds");
    await expect(actions.submitTestDns(other)).rejects.toThrow(
      "REDIRECT:/test-dns?domain=someoneelse.com&error=1",
    );
  });
});
