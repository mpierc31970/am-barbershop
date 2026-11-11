// HumanCheck port (PD-14; T-06-30): Turnstile siteverify behind a port, fail closed.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alwaysFail,
  alwaysPass,
  getHumanCheck,
  TURNSTILE_TEST_SECRET,
  TURNSTILE_VERIFY_URL,
  turnstileHumanCheck,
} from "./human-check";

function stubFetch(impl: (...args: unknown[]) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("turnstileHumanCheck", () => {
  it("passes when siteverify says success", async () => {
    stubFetch(() => json({ success: true }));
    expect(await turnstileHumanCheck("s3cret").verify("tok", "1.2.3.4")).toBe(
      true,
    );
  });

  it("fails when siteverify says no", async () => {
    stubFetch(() => json({ success: false, "error-codes": ["x"] }));
    expect(await turnstileHumanCheck("s3cret").verify("tok", "1.2.3.4")).toBe(
      false,
    );
  });

  it("fails on a non-200 response", async () => {
    stubFetch(() => json({ success: true }, 500));
    expect(await turnstileHumanCheck("s3cret").verify("tok", "1.2.3.4")).toBe(
      false,
    );
  });

  it("fails when fetch throws", async () => {
    stubFetch(() => Promise.reject(new Error("network")));
    expect(await turnstileHumanCheck("s3cret").verify("tok", "1.2.3.4")).toBe(
      false,
    );
  });

  it("fails on a non-JSON body", async () => {
    stubFetch(() => Promise.resolve(new Response("nope", { status: 200 })));
    expect(await turnstileHumanCheck("s3cret").verify("tok", "1.2.3.4")).toBe(
      false,
    );
  });

  it("refuses an empty or oversized token without calling fetch", async () => {
    const fn = stubFetch(() => json({ success: true }));
    const hc = turnstileHumanCheck("s3cret");
    expect(await hc.verify("", "1.2.3.4")).toBe(false);
    expect(await hc.verify("x".repeat(2049), "1.2.3.4")).toBe(false);
    expect(await hc.verify(42 as unknown as string, "1.2.3.4")).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("POSTs a form-encoded secret, response and remoteip to siteverify", async () => {
    const fn = stubFetch(() => json({ success: true }));
    await turnstileHumanCheck("s3cret").verify("tok-1", "203.0.113.9");
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    expect(init.method).toBe("POST");
    const body = init.body as URLSearchParams;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body.get("secret")).toBe("s3cret");
    expect(body.get("response")).toBe("tok-1");
    expect(body.get("remoteip")).toBe("203.0.113.9");
  });

  it("omits remoteip when the IP is empty", async () => {
    const fn = stubFetch(() => json({ success: true }));
    await turnstileHumanCheck("s3cret").verify("tok-1", "");
    const body = (fn.mock.calls[0] as [string, RequestInit])[1]
      .body as URLSearchParams;
    expect(body.has("remoteip")).toBe(false);
  });
});

describe("test checkers", () => {
  it("alwaysPass and alwaysFail", async () => {
    expect(await alwaysPass().verify("", "")).toBe(true);
    expect(await alwaysFail().verify("tok", "1.2.3.4")).toBe(false);
  });
});

describe("getHumanCheck (PD-14)", () => {
  it("production without a secret fails closed, never calling Cloudflare", async () => {
    vi.stubEnv("CDS_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const fn = stubFetch(() => json({ success: true }));
    expect(await getHumanCheck().verify("tok", "1.2.3.4")).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("dev without a secret uses the always-pass test secret", async () => {
    vi.stubEnv("CDS_ENV", "development");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const fn = stubFetch(() => json({ success: true }));
    expect(await getHumanCheck().verify("tok", "1.2.3.4")).toBe(true);
    const body = (fn.mock.calls[0] as [string, RequestInit])[1]
      .body as URLSearchParams;
    expect(body.get("secret")).toBe(TURNSTILE_TEST_SECRET);
    expect(TURNSTILE_TEST_SECRET).toBe("1x0000000000000000000000000000000AA");
  });

  it("uses TURNSTILE_SECRET_KEY when set", async () => {
    vi.stubEnv("CDS_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "real-secret");
    const fn = stubFetch(() => json({ success: true }));
    expect(await getHumanCheck().verify("tok", "1.2.3.4")).toBe(true);
    const body = (fn.mock.calls[0] as [string, RequestInit])[1]
      .body as URLSearchParams;
    expect(body.get("secret")).toBe("real-secret");
  });
});
