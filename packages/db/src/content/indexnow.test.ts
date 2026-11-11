// 14-21 (CONT-16, D190, D253): the IndexNow pinger and the CDS_SEARCH_PINGER selector.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_MAX_URLS,
  indexNowPinger,
  isIndexNowKey,
  requireIndexNowKey,
} from "./indexnow";
import {
  getSearchPinger,
  loggingPinger,
  resetSearchPingerForTests,
} from "./scan-standin";

const KEY = "abcd1234-efgh5678";

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number | (() => never)) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (typeof status === "function") status();
    return new Response(null, { status: status as number });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function bodyOf(c: Call) {
  return JSON.parse(String(c.init.body)) as {
    host: string;
    key: string;
    keyLocation: string;
    urlList: string[];
  };
}

describe("indexNowPinger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts once per host with keyLocation on that host", async () => {
    const f = fakeFetch(202);
    const pinger = indexNowPinger(KEY, { fetch: f.fn });
    const res = await pinger.ping(
      [
        "https://rivera.example/",
        "https://rivera.example/about",
        "https://other.example/x",
      ],
      { orgId: "org1" },
    );
    expect(res).toEqual({ orgId: "org1", result: "ok" });
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]!.url).toBe(INDEXNOW_ENDPOINT);
    expect(f.calls[0]!.init.method).toBe("POST");
    // WR-A10: a timeout signal on every ping.
    expect(f.calls.every((c) => c.init.signal instanceof AbortSignal)).toBe(
      true,
    );
    expect(
      (f.calls[0]!.init.headers as Record<string, string>)["content-type"],
    ).toBe("application/json; charset=utf-8");
    const first = bodyOf(f.calls[0]!);
    expect(first).toEqual({
      host: "rivera.example",
      key: KEY,
      keyLocation: `https://rivera.example/${KEY}.txt`,
      urlList: ["https://rivera.example/", "https://rivera.example/about"],
    });
    expect(bodyOf(f.calls[1]!).host).toBe("other.example");
  });

  it("200 is ok", async () => {
    const f = fakeFetch(200);
    const res = await indexNowPinger(KEY, { fetch: f.fn }).ping([
      "https://a.example/",
    ]);
    expect(res?.result).toBe("ok");
  });

  it.each([403, 422, 429, 500])("%i is an error", async (status) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakeFetch(status);
    const res = await indexNowPinger(KEY, { fetch: f.fn }).ping([
      "https://a.example/secret-path",
    ]);
    expect(res?.result).toBe("error");
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).not.toContain("a.example");
    expect(logged).not.toContain(KEY);
  });

  it("a thrown fetch is an error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakeFetch(() => {
      throw new TypeError("network");
    });
    const res = await indexNowPinger(KEY, { fetch: f.fn }).ping([
      "https://a.example/",
    ]);
    expect(res?.result).toBe("error");
  });

  it("caps a host's batch at 10,000 URLs", async () => {
    const f = fakeFetch(202);
    const urls = Array.from(
      { length: INDEXNOW_MAX_URLS + 1 },
      (_, i) => `https://a.example/p${i}`,
    );
    await indexNowPinger(KEY, { fetch: f.fn }).ping(urls);
    expect(f.calls).toHaveLength(1);
    expect(bodyOf(f.calls[0]!).urlList).toHaveLength(10_000);
  });

  it("no usable URL → skipped, nothing sent", async () => {
    const f = fakeFetch(202);
    const res = await indexNowPinger(KEY, { fetch: f.fn }).ping(["not a url"]);
    expect(res?.result).toBe("skipped");
    expect(f.calls).toHaveLength(0);
  });

  it("refuses a malformed key", () => {
    expect(isIndexNowKey("short")).toBe(false);
    expect(isIndexNowKey("has space 12345")).toBe(false);
    expect(isIndexNowKey(KEY)).toBe(true);
    expect(() => indexNowPinger("bad key")).toThrow(/CDS_INDEXNOW_KEY/);
    expect(() => requireIndexNowKey({})).toThrow(/CDS_INDEXNOW_KEY/);
  });
});

describe("getSearchPinger (CDS_SEARCH_PINGER)", () => {
  const saved = {
    p: process.env.CDS_SEARCH_PINGER,
    k: process.env.CDS_INDEXNOW_KEY,
  };
  afterEach(() => {
    resetSearchPingerForTests();
    if (saved.p === undefined) delete process.env.CDS_SEARCH_PINGER;
    else process.env.CDS_SEARCH_PINGER = saved.p;
    if (saved.k === undefined) delete process.env.CDS_INDEXNOW_KEY;
    else process.env.CDS_INDEXNOW_KEY = saved.k;
  });

  it("unset, empty and log give the logging stand-in", () => {
    delete process.env.CDS_SEARCH_PINGER;
    expect(getSearchPinger()).toBe(loggingPinger);
    process.env.CDS_SEARCH_PINGER = "";
    expect(getSearchPinger()).toBe(loggingPinger);
    process.env.CDS_SEARCH_PINGER = "log";
    expect(getSearchPinger()).toBe(loggingPinger);
  });

  it("indexnow without a key throws naming CDS_INDEXNOW_KEY", () => {
    process.env.CDS_SEARCH_PINGER = "indexnow";
    delete process.env.CDS_INDEXNOW_KEY;
    expect(() => getSearchPinger()).toThrow(/CDS_INDEXNOW_KEY/);
  });

  it("indexnow with a key gives a memoised real pinger", () => {
    process.env.CDS_SEARCH_PINGER = "indexnow";
    process.env.CDS_INDEXNOW_KEY = KEY;
    const p = getSearchPinger();
    expect(p).not.toBe(loggingPinger);
    expect(getSearchPinger()).toBe(p);
  });

  it("an unknown value throws", () => {
    process.env.CDS_SEARCH_PINGER = "bing";
    expect(() => getSearchPinger()).toThrow(/not supported/);
  });
});
