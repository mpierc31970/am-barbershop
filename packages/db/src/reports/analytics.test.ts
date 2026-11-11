// 11-32 Task 1: the AnalyticsSource adapter, stand-in and staff setter (DASH-10, DASH-13, D196).
// No PocketBase here: the superuser client is mocked, and Google is an injected fetch driven by
// recorded-response fixtures (endpoint shapes are [ASSUMED], RESEARCH A2).
import { generateKeyPairSync, createVerify } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pbState = vi.hoisted(() => ({
  org: {
    id: "org000000000001",
    name: "Rivera Bakery",
    analytics: {} as unknown,
  },
  updates: [] as { id: string; body: Record<string, unknown> }[],
  audits: [] as Record<string, unknown>[],
  reads: 0,
}));

vi.mock("../client", () => {
  const pb = {
    collection: (name: string) => ({
      getOne: async (id: string) => {
        pbState.reads++;
        if (name !== "organizations" || id !== pbState.org.id) {
          const err = Object.assign(new Error("not found"), { status: 404 });
          throw err;
        }
        return { ...pbState.org };
      },
    }),
    createBatch: () => {
      const ops: (() => void)[] = [];
      return {
        collection: (name: string) => ({
          update: (id: string, body: Record<string, unknown>) =>
            ops.push(() => {
              pbState.updates.push({ id, body });
              if (name === "organizations")
                pbState.org.analytics = body.analytics;
            }),
          create: (body: Record<string, unknown>) =>
            ops.push(() => {
              if (name === "audit_log") pbState.audits.push(body);
            }),
        }),
        send: async () => ops.forEach((op) => op()),
      };
    },
  };
  return {
    withSuperuser: async <T>(fn: (p: typeof pb) => Promise<T>) => fn(pb),
  };
});

const {
  ANALYTICS_COPY,
  getAnalyticsSource,
  googleAnalyticsSource,
  resetAnalyticsCacheForTests,
  serviceAccountToken,
  setOrgAnalytics,
  standInAnalytics,
  validateAnalyticsInput,
} = await import("./analytics");
const { mintPlatformContext } = await import("../context");

const ORG = "org000000000001";
const RANGE = { from: "2026-10-01", to: "2026-10-07" };

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const SA = {
  client_email: "cds-reports@cds-platform.iam.gserviceaccount.com",
  private_key: privateKey,
};

type Call = { url: string; init: RequestInit };

function fakeGoogle() {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    if (u === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "tok-1", expires_in: 3600 });
    }
    if (u.endsWith(":runReport")) {
      const body = JSON.parse(String(init?.body)) as { dimensions?: unknown };
      if (body.dimensions) {
        return Response.json({
          rows: [
            {
              dimensionValues: [{ value: "/" }],
              metricValues: [{ value: "120" }],
            },
            {
              dimensionValues: [{ value: "/menu" }],
              metricValues: [{ value: "45" }],
            },
          ],
        });
      }
      return Response.json({
        rows: [{ metricValues: [{ value: "88" }, { value: "131" }] }],
      });
    }
    if (u.includes("/searchAnalytics/query")) {
      return Response.json({
        rows: [
          { keys: ["rivera bakery"], clicks: 12, impressions: 300 },
          { keys: ["sourdough near me"], clicks: 3, impressions: 210 },
        ],
      });
    }
    return new Response("nope", { status: 404 });
  });
  return { calls, fetchImpl };
}

function lookup(ids: Record<string, string>) {
  return async (orgId: string) => (orgId === ORG ? ids : {});
}

beforeEach(() => {
  resetAnalyticsCacheForTests();
  pbState.org.analytics = {};
  pbState.updates = [];
  pbState.audits = [];
  pbState.reads = 0;
});

describe("stand-in (no credentials)", () => {
  it("returns { connected: false } for both calls", async () => {
    expect(await standInAnalytics.ga4Summary(ORG, RANGE)).toEqual({
      connected: false,
    });
    expect(await standInAnalytics.searchTopQueries(ORG, RANGE)).toEqual({
      connected: false,
    });
  });

  it("getAnalyticsSource picks the stand-in without CDS_ANALYTICS=google + a key", async () => {
    expect(getAnalyticsSource({})).toBe(standInAnalytics);
    expect(getAnalyticsSource({ CDS_ANALYTICS: "google" })).toBe(
      standInAnalytics,
    );
    expect(
      getAnalyticsSource({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(SA) }),
    ).toBe(standInAnalytics);
    expect(
      getAnalyticsSource({
        CDS_ANALYTICS: "google",
        GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(SA),
      }),
    ).not.toBe(standInAnalytics);
  });

  it("has the locked not-connected copy", () => {
    expect(ANALYTICS_COPY.notConnected).toBe(
      "Connects when CDS finishes setup",
    );
  });
});

describe("serviceAccountToken (node:crypto RS256)", () => {
  it("POSTs a JWT bearer grant signed with the service-account key", async () => {
    const { calls, fetchImpl } = fakeGoogle();
    const now = new Date("2026-10-11T12:00:00Z");
    const token = await serviceAccountToken(
      SA,
      ["https://www.googleapis.com/auth/analytics.readonly"],
      fetchImpl as unknown as typeof fetch,
      { now: () => now },
    );
    expect(token).toBe("tok-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe("POST");
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(form.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    const jwt = form.get("assertion")!;
    const [h, c, s] = jwt.split(".");
    const header = JSON.parse(Buffer.from(h!, "base64url").toString("utf8"));
    const claims = JSON.parse(Buffer.from(c!, "base64url").toString("utf8"));
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(claims).toMatchObject({
      iss: SA.client_email,
      aud: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(now.getTime() / 1000) + 3600,
    });
    const ok = createVerify("RSA-SHA256")
      .update(`${h}.${c}`)
      .verify(publicKey, Buffer.from(s!, "base64url"));
    expect(ok).toBe(true);
  });

  it("refuses a malformed service account without calling out", async () => {
    const { calls, fetchImpl } = fakeGoogle();
    await expect(
      serviceAccountToken(
        { client_email: "", private_key: "" },
        ["x"],
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("googleAnalyticsSource (REST adapter)", () => {
  it("maps runReport to Ga4Summary and caches the day's answer", async () => {
    const { calls, fetchImpl } = fakeGoogle();
    const src = googleAnalyticsSource({
      serviceAccount: SA,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: lookup({ ga4_property_id: "123456789" }),
    });
    const first = await src.ga4Summary(ORG, RANGE);
    expect(first).toEqual({
      connected: true,
      users: 88,
      sessions: 131,
      topPages: [
        { path: "/", views: 120 },
        { path: "/menu", views: 45 },
      ],
    });
    const report = calls.filter((c) => c.url.endsWith(":runReport"));
    expect(report).toHaveLength(2);
    expect(report[0]!.url).toBe(
      "https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport",
    );
    expect(report[0]!.init.method).toBe("POST");
    expect(
      (report[0]!.init.headers as Record<string, string>).authorization,
    ).toBe("Bearer tok-1");
    const body = JSON.parse(String(report[0]!.init.body));
    expect(body.dateRanges).toEqual([
      { startDate: "2026-10-01", endDate: "2026-10-07" },
    ]);

    const n = calls.length;
    expect(await src.ga4Summary(ORG, RANGE)).toEqual(first);
    expect(calls.length).toBe(n);
  });

  it("maps searchAnalytics/query to SearchQueries", async () => {
    const { calls, fetchImpl } = fakeGoogle();
    const src = googleAnalyticsSource({
      serviceAccount: SA,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: lookup({ gsc_site_url: "sc-domain:riverabakery.com" }),
    });
    expect(await src.searchTopQueries(ORG, RANGE)).toEqual({
      connected: true,
      rows: [
        { query: "rivera bakery", clicks: 12, impressions: 300 },
        { query: "sourdough near me", clicks: 3, impressions: 210 },
      ],
    });
    const q = calls.find((c) => c.url.includes("searchAnalytics"))!;
    expect(q.url).toBe(
      "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Ariverabakery.com/searchAnalytics/query",
    );
    expect(JSON.parse(String(q.init.body))).toMatchObject({
      startDate: "2026-10-01",
      endDate: "2026-10-07",
      dimensions: ["query"],
      rowLimit: 10,
    });
  });

  it("is not connected when the org has no ids (and never calls Google)", async () => {
    const { calls, fetchImpl } = fakeGoogle();
    const src = googleAnalyticsSource({
      serviceAccount: SA,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: lookup({}),
    });
    expect(await src.ga4Summary(ORG, RANGE)).toEqual({ connected: false });
    expect(await src.searchTopQueries(ORG, RANGE)).toEqual({
      connected: false,
    });
    expect(calls).toHaveLength(0);
  });

  it("a Google error reads as not connected and is not cached", async () => {
    let fail = true;
    const { fetchImpl } = fakeGoogle();
    const flaky = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (fail && String(url).endsWith(":runReport")) {
        return new Response("boom", { status: 500 });
      }
      return fetchImpl(url, init);
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const src = googleAnalyticsSource({
      serviceAccount: SA,
      fetchImpl: flaky as unknown as typeof fetch,
      lookup: lookup({ ga4_property_id: "123456789" }),
    });
    expect(await src.ga4Summary(ORG, RANGE)).toEqual({ connected: false });
    fail = false;
    expect((await src.ga4Summary(ORG, RANGE)).connected).toBe(true);
    expect(err.mock.calls.flat().join(" ")).not.toContain("tok-1");
    err.mockRestore();
  });

  it("honours https endpoint overrides and ignores non-https ones", async () => {
    const { calls, fetchImpl } = fakeGoogle();
    const src = googleAnalyticsSource({
      serviceAccount: SA,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: lookup({ ga4_property_id: "123456789" }),
      endpoints: { ga4Base: "http://evil.example/v1beta" },
    });
    await src.ga4Summary(ORG, RANGE);
    expect(calls.some((c) => c.url.startsWith("http://evil"))).toBe(false);
  });
});

describe("validateAnalyticsInput", () => {
  it("rejects a Universal Analytics id and an http Search Console URL", () => {
    expect(() =>
      validateAnalyticsInput({ ga4MeasurementId: "UA-123" }),
    ).toThrow(/measurement/i);
    expect(() =>
      validateAnalyticsInput({ gscSiteUrl: "http://riverabakery.com/" }),
    ).toThrow(/Search Console/i);
    expect(() => validateAnalyticsInput({ ga4PropertyId: "12a" })).toThrow(
      /property/i,
    );
    expect(() =>
      validateAnalyticsInput({ owner: "someone" as unknown as "cds" }),
    ).toThrow(/owner/i);
  });

  it("accepts G- ids, https and sc-domain sites", () => {
    expect(
      validateAnalyticsInput({
        ga4MeasurementId: "G-ABC123XYZ",
        ga4PropertyId: "123456789",
        gscSiteUrl: "https://riverabakery.com/",
        owner: "tenant",
      }),
    ).toEqual({
      ga4_measurement_id: "G-ABC123XYZ",
      ga4_property_id: "123456789",
      gsc_site_url: "https://riverabakery.com/",
      owner: "tenant",
    });
    expect(
      validateAnalyticsInput({ gscSiteUrl: "sc-domain:riverabakery.com" }),
    ).toEqual({ gsc_site_url: "sc-domain:riverabakery.com" });
  });
});

describe("setOrgAnalytics (staff, audited)", () => {
  const support = () =>
    mintPlatformContext({
      actor: "staff00000000001",
      staffRole: "support_agent",
      ip: "cli",
    });

  it("support_agent may set ids; writes the org and an org.analytics_set audit row", async () => {
    const invalidate = vi.fn();
    const r = await setOrgAnalytics(
      support(),
      ORG,
      { ga4MeasurementId: "G-ABC123", owner: "cds" },
      { invalidator: { invalidate } },
    );
    expect(r).toMatchObject({
      orgName: "Rivera Bakery",
      before: {},
      after: { ga4_measurement_id: "G-ABC123", owner: "cds" },
      changed: true,
    });
    expect(pbState.updates).toEqual([
      {
        id: ORG,
        body: { analytics: { ga4_measurement_id: "G-ABC123", owner: "cds" } },
      },
    ]);
    expect(pbState.audits).toHaveLength(1);
    expect(pbState.audits[0]).toMatchObject({
      action: "org.analytics_set",
      organization: ORG,
    });
    expect(invalidate).toHaveBeenCalledWith([
      `org:${ORG}:site`,
      `org:${ORG}:live`,
    ]);
  });

  it("keeps fields not named, and --clear empties them", async () => {
    pbState.org.analytics = {
      ga4_measurement_id: "G-OLD1",
      gsc_site_url: "sc-domain:riverabakery.com",
    };
    const r = await setOrgAnalytics(support(), ORG, {
      ga4PropertyId: "987654",
    });
    expect(r.after).toEqual({
      ga4_measurement_id: "G-OLD1",
      ga4_property_id: "987654",
      gsc_site_url: "sc-domain:riverabakery.com",
    });
    const c = await setOrgAnalytics(support(), ORG, { clear: true });
    expect(c.after).toEqual({});
  });

  it("refuses unknown staff and bad ids before any read", async () => {
    const nobody = mintPlatformContext({
      actor: "x00000000000001",
      staffRole: "" as unknown as "support_agent",
      ip: "cli",
    });
    await expect(
      setOrgAnalytics(nobody, ORG, { ga4MeasurementId: "G-ABC123" }),
    ).rejects.toThrow();
    await expect(
      setOrgAnalytics(support(), ORG, { ga4MeasurementId: "UA-123" }),
    ).rejects.toThrow();
    expect(pbState.reads).toBe(0);
    expect(pbState.updates).toHaveLength(0);
  });

  it("an unchanged set writes nothing", async () => {
    pbState.org.analytics = { ga4_measurement_id: "G-ABC123" };
    const r = await setOrgAnalytics(support(), ORG, {
      ga4MeasurementId: "G-ABC123",
    });
    expect(r.changed).toBe(false);
    expect(pbState.updates).toHaveLength(0);
    expect(pbState.audits).toHaveLength(0);
  });
});
