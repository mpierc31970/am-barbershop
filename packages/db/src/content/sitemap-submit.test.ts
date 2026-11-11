// 14-26 (CONT-16, D190, D253; T-14-26-01): the SitemapSubmitter port, its logging stand-in,
// the Search Console + Bing API adapter and the CDS_SITEMAP_SUBMITTER selector. Injected
// fetch and a throwaway RSA key generated here: never live, no network.
import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiSubmitter,
  getSitemapSubmitter,
  GSC_SCOPE,
  loggingSubmitter,
  resetSitemapSubmitterForTests,
} from "./sitemap-submit";

const SITE = "https://rivera.example/";
const FEED = "https://rivera.example/sitemap.xml";
const BING_KEY = "bing-key-0123456789";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SA = JSON.stringify({
  type: "service_account",
  client_email: "cds-sitemaps@example-project.iam.gserviceaccount.com",
  private_key: PEM,
});

type Call = { url: string; init: RequestInit };

/** A fetch that answers by URL prefix and records every call. */
function fakeFetch(
  answer: (url: string) => { status: number; json?: unknown } | "throw",
) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = answer(url);
    if (a === "throw") throw new TypeError("network down");
    return new Response(a.json === undefined ? null : JSON.stringify(a.json), {
      status: a.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function okWorld(googleStatus = 204, bingStatus = 200) {
  return fakeFetch((url) => {
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return {
        status: 200,
        json: { access_token: "tok-1", expires_in: 3600, token_type: "Bearer" },
      };
    }
    if (url.startsWith("https://www.googleapis.com/webmasters/v3/")) {
      return { status: googleStatus };
    }
    if (url.startsWith("https://ssl.bing.com/webmaster/api.svc/json/")) {
      return { status: bingStatus, json: { d: null } };
    }
    return { status: 599 };
  });
}

function b64urlJson(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

describe("loggingSubmitter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs a count only and answers logged", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await loggingSubmitter.submit(SITE, FEED);
    expect(loggingSubmitter.name).toBe("log");
    expect(res).toEqual({ result: "logged", engines: {} });
    const text = log.mock.calls.flat().join(" ");
    expect(text).toContain("sitemap submit (stand-in) 1 site");
    expect(text).not.toContain("rivera");
  });
});

describe("apiSubmitter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("WR-A12: Google uses the org's Search Console property; none recorded skips Google", async () => {
    const env = {
      GSC_SERVICE_ACCOUNT_JSON: SA,
      BING_WEBMASTER_API_KEY: BING_KEY,
    };
    const f = okWorld();
    const sub = apiSubmitter({ fetch: f.fn, env });
    const res = await sub.submit(SITE, FEED, {
      gscProperty: "sc-domain:rivera.example",
    });
    expect(res.engines).toEqual({ google: "ok", bing: "ok" });
    const put = f.calls.find((c) => c.init.method === "PUT")!;
    expect(put.url).toContain(
      `/sites/${encodeURIComponent("sc-domain:rivera.example")}/sitemaps/`,
    );

    const g = okWorld();
    const none = await apiSubmitter({ fetch: g.fn, env }).submit(SITE, FEED, {
      gscProperty: null,
    });
    expect(none).toEqual({
      result: "ok",
      engines: { google: "skipped", bing: "ok" },
    });
    expect(g.calls.some((c) => c.url.includes("googleapis.com"))).toBe(false);
  });

  it("Google: service-account JWT exchange, then PUT with the bearer; Bing: POST with apikey", async () => {
    const f = okWorld();
    const now = new Date("2026-10-18T06:00:00.000Z");
    const sub = apiSubmitter({
      fetch: f.fn,
      now: () => now,
      env: {
        GSC_SERVICE_ACCOUNT_JSON: SA,
        BING_WEBMASTER_API_KEY: BING_KEY,
      },
    });
    expect(sub.name).toBe("api");
    const res = await sub.submit(SITE, FEED);
    expect(res).toEqual({
      result: "ok",
      engines: { google: "ok", bing: "ok" },
    });
    expect(f.calls).toHaveLength(3);
    // WR-A10: token, Google and Bing calls all carry a timeout signal.
    expect(f.calls.every((c) => c.init.signal instanceof AbortSignal)).toBe(
      true,
    );

    // Token exchange: RS256 JWT bearer grant, signed by the service-account key.
    const tok = f.calls[0]!;
    expect(tok.url).toBe("https://oauth2.googleapis.com/token");
    expect(tok.init.method).toBe("POST");
    const form = new URLSearchParams(String(tok.init.body));
    expect(form.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    const [h, c, s] = form.get("assertion")!.split(".");
    expect(b64urlJson(h!)).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = b64urlJson(c!);
    expect(claims).toMatchObject({
      iss: "cds-sitemaps@example-project.iam.gserviceaccount.com",
      scope: GSC_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now.getTime() / 1000,
      exp: now.getTime() / 1000 + 3600,
    });
    expect(GSC_SCOPE).toBe("https://www.googleapis.com/auth/webmasters");
    const verify = createVerify("RSA-SHA256");
    verify.update(`${h}.${c}`);
    expect(verify.verify(publicKey, Buffer.from(s!, "base64url"))).toBe(true);

    // Search Console PUT.
    const put = f.calls[1]!;
    expect(put.url).toBe(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/sitemaps/${encodeURIComponent(FEED)}`,
    );
    expect(put.init.method).toBe("PUT");
    expect((put.init.headers as Record<string, string>).authorization).toBe(
      "Bearer tok-1",
    );

    // Bing SubmitFeed.
    const bing = f.calls[2]!;
    expect(bing.url).toBe(
      `https://ssl.bing.com/webmaster/api.svc/json/SubmitFeed?apikey=${BING_KEY}`,
    );
    expect(bing.init.method).toBe("POST");
    expect(JSON.parse(String(bing.init.body))).toEqual({
      siteUrl: SITE,
      feedUrl: FEED,
    });
  });

  it("caches the access token until it expires", async () => {
    const f = okWorld();
    let t = Date.parse("2026-10-18T06:00:00.000Z");
    const sub = apiSubmitter({
      fetch: f.fn,
      now: () => new Date(t),
      env: { GSC_SERVICE_ACCOUNT_JSON: SA },
    });
    await sub.submit(SITE, FEED);
    await sub.submit(SITE, FEED);
    const tokenCalls = () =>
      f.calls.filter((c) => c.url.startsWith("https://oauth2")).length;
    expect(tokenCalls()).toBe(1);
    t += 3600_000;
    await sub.submit(SITE, FEED);
    expect(tokenCalls()).toBe(2);
  });

  it("only Bing configured: google skipped, no Google call", async () => {
    const f = okWorld();
    const sub = apiSubmitter({
      fetch: f.fn,
      env: { BING_WEBMASTER_API_KEY: BING_KEY },
    });
    const res = await sub.submit(SITE, FEED);
    expect(res).toEqual({
      result: "ok",
      engines: { google: "skipped", bing: "ok" },
    });
    expect(f.calls.map((c) => c.url)).toEqual([
      `https://ssl.bing.com/webmaster/api.svc/json/SubmitFeed?apikey=${BING_KEY}`,
    ]);
  });

  it("only Google configured: bing skipped", async () => {
    const f = okWorld();
    const sub = apiSubmitter({
      fetch: f.fn,
      env: { GSC_SERVICE_ACCOUNT_JSON: SA },
    });
    const res = await sub.submit(SITE, FEED);
    expect(res).toEqual({
      result: "ok",
      engines: { google: "ok", bing: "skipped" },
    });
    expect(f.calls.some((c) => c.url.includes("bing"))).toBe(false);
  });

  it("nothing configured: skipped, no calls", async () => {
    const f = okWorld();
    const res = await apiSubmitter({ fetch: f.fn, env: {} }).submit(SITE, FEED);
    expect(res).toEqual({
      result: "skipped",
      engines: { google: "skipped", bing: "skipped" },
    });
    expect(f.calls).toEqual([]);
  });

  it("a 403 from Search Console is an error; logs the status class only", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = okWorld(403, 200);
    const res = await apiSubmitter({
      fetch: f.fn,
      env: {
        GSC_SERVICE_ACCOUNT_JSON: SA,
        BING_WEBMASTER_API_KEY: BING_KEY,
      },
    }).submit(SITE, FEED);
    expect(res).toEqual({
      result: "error",
      engines: { google: "error", bing: "ok" },
    });
    const text = err.mock.calls.flat().join(" ");
    expect(text).toContain("4xx");
    for (const secret of ["rivera", BING_KEY, "tok-1", "PRIVATE KEY"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("a Bing network failure is an error; a failed token exchange is a Google error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakeFetch((url) => {
      if (url.startsWith("https://oauth2.googleapis.com/token"))
        return { status: 401, json: { error: "invalid_grant" } };
      return "throw";
    });
    const res = await apiSubmitter({
      fetch: f.fn,
      env: {
        GSC_SERVICE_ACCOUNT_JSON: SA,
        BING_WEBMASTER_API_KEY: BING_KEY,
      },
    }).submit(SITE, FEED);
    expect(res).toEqual({
      result: "error",
      engines: { google: "error", bing: "error" },
    });
    expect(f.calls.some((c) => c.url.includes("webmasters/v3"))).toBe(false);
  });

  it("malformed service-account JSON is a Google error, never a throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = okWorld();
    const res = await apiSubmitter({
      fetch: f.fn,
      env: { GSC_SERVICE_ACCOUNT_JSON: "{not json" },
    }).submit(SITE, FEED);
    expect(res.engines.google).toBe("error");
    expect(res.result).toBe("error");
  });

  it("provider URLs come from env (GSC_TOKEN_URL, GSC_API_BASE, BING_WEBMASTER_API_BASE)", async () => {
    const f = fakeFetch((url) =>
      url.startsWith("https://tok.test/")
        ? { status: 200, json: { access_token: "t", expires_in: 3600 } }
        : { status: 200 },
    );
    const res = await apiSubmitter({
      fetch: f.fn,
      env: {
        GSC_SERVICE_ACCOUNT_JSON: SA,
        BING_WEBMASTER_API_KEY: BING_KEY,
        GSC_TOKEN_URL: "https://tok.test/token",
        GSC_API_BASE: "https://gsc.test/v3",
        BING_WEBMASTER_API_BASE: "https://bing.test/json/",
      },
    }).submit(SITE, FEED);
    expect(res.result).toBe("ok");
    expect(f.calls.map((c) => new URL(c.url).origin)).toEqual([
      "https://tok.test",
      "https://gsc.test",
      "https://bing.test",
    ]);
    expect(f.calls[2]!.url).toBe(
      `https://bing.test/json/SubmitFeed?apikey=${BING_KEY}`,
    );
  });
});

describe("getSitemapSubmitter", () => {
  const saved = process.env.CDS_SITEMAP_SUBMITTER;
  beforeEach(() => resetSitemapSubmitterForTests());
  afterEach(() => {
    if (saved === undefined) delete process.env.CDS_SITEMAP_SUBMITTER;
    else process.env.CDS_SITEMAP_SUBMITTER = saved;
    resetSitemapSubmitterForTests();
  });

  it("unset or log -> the logging stand-in", () => {
    delete process.env.CDS_SITEMAP_SUBMITTER;
    expect(getSitemapSubmitter()).toBe(loggingSubmitter);
    process.env.CDS_SITEMAP_SUBMITTER = "log";
    expect(getSitemapSubmitter()).toBe(loggingSubmitter);
  });

  it("api -> the API submitter (memoised)", () => {
    process.env.CDS_SITEMAP_SUBMITTER = "api";
    const a = getSitemapSubmitter();
    expect(a.name).toBe("api");
    expect(getSitemapSubmitter()).toBe(a);
  });

  it("an unknown value throws", () => {
    process.env.CDS_SITEMAP_SUBMITTER = "gsc";
    expect(() => getSitemapSubmitter()).toThrow(/CDS_SITEMAP_SUBMITTER/);
  });
});
