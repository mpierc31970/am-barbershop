// Composite scanner, sub-port selection and the Web Risk adapter (13-08; STAFF-23, D248,
// D295). Fakes only: no network, no PocketBase (the budget has its own integration test).
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ImageModerator,
  LinkChecker,
  ScanInput,
  SubResult,
  TextChecker,
} from "../ports";
import { getContentScanner, keywordScanner } from "../scan-standin";
import {
  compositeScanner,
  scannerProviders,
  usesKeywordTextStandIn,
} from "./composite";
import { getImageModerator, skippedImageModerator } from "./image";
import {
  getLinkChecker,
  LINKS_UNCHECKED_REASON,
  skippedLinkChecker,
  MAX_LOOKUPS_PER_SCAN,
  uniqueUrls,
  webRiskLinkChecker,
} from "./link";
import { getTextChecker, keywordTextChecker } from "./text";

const ORG = "orgaaaaaaaaaaaa";
const input = (over: Partial<ScanInput> = {}): ScanInput => ({
  orgId: ORG,
  texts: [],
  urls: [],
  ...over,
});

function fixed(name: string, r: Omit<SubResult, "provider">) {
  return {
    name,
    check: async () => ({ ...r, provider: name }),
  } satisfies TextChecker & ImageModerator & LinkChecker;
}

function failing(name: string) {
  return {
    name,
    check: async (): Promise<SubResult> => {
      throw new TypeError("boom secret-key-123");
    },
  } satisfies LinkChecker;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("compositeScanner", () => {
  it("text held + image skipped + link skipped → held with the keyword reason", async () => {
    const s = compositeScanner({
      text: keywordTextChecker,
      image: skippedImageModerator,
      link: skippedLinkChecker,
    });
    const r = await s.scan(input({ texts: ["hi __cds_test_held__"] }));
    expect(r.verdict).toBe("held");
    expect(r.reasons[0]).toBe("keyword: __cds_test_held__");
    expect(r.reasons).toContain("image check skipped: stand-in");
    expect(r.reasons).toContain("link check skipped: stand-in");
  });

  it("text clean + link rejects → throws scanner unavailable naming the link provider", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = compositeScanner({
      text: keywordTextChecker,
      image: skippedImageModerator,
      link: failing("webrisk"),
    });
    await expect(s.scan(input({ texts: ["hello"] }))).rejects.toThrow(
      /^scanner unavailable: link \(webrisk\)$/,
    );
    // Class name only in logs.
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("secret-key-123");
  });

  it("held still wins over a failed sub-check", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = compositeScanner({
      text: keywordTextChecker,
      image: failing("rekognition"),
      link: skippedLinkChecker,
    });
    const r = await s.scan(input({ texts: ["__cds_test_held__"] }));
    expect(r.verdict).toBe("held");
  });

  it("unsure beats a failed sub-check", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = compositeScanner({
      text: keywordTextChecker,
      image: skippedImageModerator,
      link: failing("webrisk"),
    });
    const r = await s.scan(input({ texts: ["__cds_test_unsure__"] }));
    expect(r.verdict).toBe("unsure");
  });

  it("text unsure + link held → held", async () => {
    const s = compositeScanner({
      text: keywordTextChecker,
      image: skippedImageModerator,
      link: fixed("webrisk", {
        verdict: "held",
        reasons: ["link: MALWARE (bad.example)"],
      }),
    });
    const r = await s.scan(input({ texts: ["__cds_test_unsure__"] }));
    expect(r.verdict).toBe("held");
    expect(r.reasons).toEqual(
      expect.arrayContaining([
        "link: MALWARE (bad.example)",
        "keyword: __cds_test_unsure__",
      ]),
    );
  });

  it("link unchecked (cap) + text clean → clean with the cap reason", async () => {
    const s = compositeScanner({
      text: keywordTextChecker,
      image: fixed("rekognition", { verdict: "clean", reasons: [] }),
      link: fixed("webrisk", {
        verdict: "unchecked",
        reasons: [LINKS_UNCHECKED_REASON],
      }),
    });
    const r = await s.scan(input({ texts: ["hello"] }));
    expect(r).toEqual({
      verdict: "clean",
      reasons: ["links unchecked: monthly cap"],
    });
  });

  it("all clean → clean with no reasons", async () => {
    const s = compositeScanner({
      text: keywordTextChecker,
      image: fixed("i", { verdict: "clean", reasons: [] }),
      link: fixed("l", { verdict: "clean", reasons: [] }),
    });
    expect(await s.scan(input({ texts: ["hello"] }))).toEqual({
      verdict: "clean",
      reasons: [],
    });
  });

  it("the default scanner keeps the keyword verdicts", async () => {
    const s = getContentScanner();
    expect(
      (await s.scan(input({ texts: ["__cds_test_held__"] }))).verdict,
    ).toBe("held");
    expect(
      (await s.scan(input({ texts: ["__cds_test_unsure__"] }))).verdict,
    ).toBe("unsure");
    expect((await s.scan(input({ texts: ["hello"] }))).verdict).toBe("clean");
  });
});

describe("sub-port selection", () => {
  it("unset → stand-ins", () => {
    vi.stubEnv("CDS_TEXT_CHECKER", "");
    vi.stubEnv("CDS_IMAGE_MODERATOR", "");
    vi.stubEnv("CDS_LINK_CHECKER", "");
    expect(getTextChecker()).toBe(keywordTextChecker);
    expect(getImageModerator()).toBe(skippedImageModerator);
    expect(getLinkChecker()).toBe(skippedLinkChecker);
    expect(scannerProviders()).toEqual({
      text: "keyword",
      image: "skipped",
      link: "skipped",
    });
  });

  it("usesKeywordTextStandIn marks composites guarded only by the keyword list (WR-A07)", () => {
    vi.stubEnv("CDS_CONTENT_SCANNER", "");
    vi.stubEnv("CDS_TEXT_CHECKER", "");
    expect(usesKeywordTextStandIn(getContentScanner())).toBe(true);
    const other = compositeScanner({
      text: fixed("ai", { verdict: "clean", reasons: [] }),
    });
    expect(usesKeywordTextStandIn(other)).toBe(false);
    expect(usesKeywordTextStandIn(keywordScanner)).toBe(false);
  });

  it("unknown values throw", () => {
    vi.stubEnv("CDS_TEXT_CHECKER", "bogus");
    vi.stubEnv("CDS_IMAGE_MODERATOR", "bogus");
    vi.stubEnv("CDS_LINK_CHECKER", "bogus");
    expect(() => getTextChecker()).toThrow(/CDS_TEXT_CHECKER="bogus"/);
    expect(() => getImageModerator()).toThrow(/CDS_IMAGE_MODERATOR="bogus"/);
    expect(() => getLinkChecker()).toThrow(/CDS_LINK_CHECKER="bogus"/);
    expect(() => compositeScanner()).toThrow();
  });

  it("webrisk needs a key, then selects the adapter", () => {
    vi.stubEnv("CDS_LINK_CHECKER", "webrisk");
    vi.stubEnv("CDS_WEBRISK_API_KEY", "");
    expect(() => getLinkChecker()).toThrow(/CDS_WEBRISK_API_KEY/);
    vi.stubEnv("CDS_WEBRISK_API_KEY", "k");
    expect(getLinkChecker().name).toBe("webrisk");
  });

  it("CDS_CONTENT_SCANNER=keyword keeps the bare keyword scanner; bogus throws", () => {
    vi.stubEnv("CDS_CONTENT_SCANNER", "keyword");
    expect(getContentScanner()).toBe(keywordScanner);
    vi.stubEnv("CDS_CONTENT_SCANNER", "bogus");
    expect(() => getContentScanner()).toThrow(/no implementation/);
  });
});

describe("webRiskLinkChecker", () => {
  function fakeFetch(answer: (uri: string) => unknown, status = 200) {
    const calls: string[] = [];
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url));
      calls.push(u.searchParams.get("uri") ?? "");
      return new Response(
        JSON.stringify(answer(u.searchParams.get("uri") ?? "")),
        {
          status,
          headers: { "content-type": "application/json" },
        },
      );
    });
    return { f: f as unknown as typeof fetch, calls };
  }
  const allowAll = async (n: number) => n;

  it("{threat} → held; {} → clean", async () => {
    const { f } = fakeFetch((uri) =>
      uri.includes("bad.example")
        ? { threat: { threatTypes: ["MALWARE"] } }
        : {},
    );
    const c = webRiskLinkChecker("key", { fetch: f, reserve: allowAll });
    const held = await c.check(input({ urls: ["https://bad.example/x"] }));
    expect(held.verdict).toBe("held");
    expect(held.reasons).toEqual(["link: MALWARE (bad.example)"]);
    const clean = await c.check(input({ urls: ["https://good.example/"] }));
    expect(clean).toEqual({
      verdict: "clean",
      reasons: [],
      provider: "webrisk",
    });
  });

  it("the same URL twice → one fetch; the request carries the threat types and key", async () => {
    const urls: string[] = [];
    const f = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const reserve = vi.fn(async (n: number) => n);
    const c = webRiskLinkChecker("the-key", { fetch: f, reserve });
    await c.check(
      input({
        urls: [
          "https://Shop.example/a",
          "https://shop.example/a#reviews",
          "mailto:x@example.com",
          "/relative",
        ],
      }),
    );
    expect(urls).toHaveLength(1);
    expect(reserve).toHaveBeenCalledWith(1, expect.any(Date));
    const u = new URL(urls[0]!);
    expect(u.origin + u.pathname).toBe(
      "https://webrisk.googleapis.com/v1/uris:search",
    );
    expect(u.searchParams.getAll("threatTypes")).toEqual([
      "MALWARE",
      "SOCIAL_ENGINEERING",
      "UNWANTED_SOFTWARE",
    ]);
    expect(u.searchParams.get("uri")).toBe("https://shop.example/a");
    expect(u.searchParams.get("key")).toBe("the-key");
  });

  it("at the cap: nothing fetched, unchecked with the cap reason", async () => {
    const { f, calls } = fakeFetch(() => ({}));
    const c = webRiskLinkChecker("k", { fetch: f, reserve: async () => 0 });
    const r = await c.check(
      input({ urls: ["https://a.example/", "https://b.example/"] }),
    );
    expect(calls).toHaveLength(0);
    expect(r).toEqual({
      verdict: "unchecked",
      reasons: [LINKS_UNCHECKED_REASON],
      provider: "webrisk",
    });
  });

  it("partly over the cap: only the allowed hosts are looked up", async () => {
    const { f, calls } = fakeFetch(() => ({}));
    const c = webRiskLinkChecker("k", { fetch: f, reserve: async () => 1 });
    const r = await c.check(
      input({ urls: ["https://a.example/", "https://b.example/"] }),
    );
    expect(calls).toEqual(["https://a.example/"]);
    expect(r.verdict).toBe("unchecked");
  });

  it("no links → clean without reserving", async () => {
    const reserve = vi.fn(async (n: number) => n);
    const c = webRiskLinkChecker("k", {
      fetch: fakeFetch(() => ({})).f,
      reserve,
    });
    expect((await c.check(input())).verdict).toBe("clean");
    expect(reserve).not.toHaveBeenCalled();
  });

  it("a non-2xx answer throws", async () => {
    const { f } = fakeFetch(() => ({ error: "x" }), 503);
    const c = webRiskLinkChecker("k", { fetch: f, reserve: allowAll });
    await expect(
      c.check(input({ urls: ["https://a.example/"] })),
    ).rejects.toThrow(/503/);
  });

  it("a hung request is aborted after the timeout", async () => {
    const f = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as unknown as typeof fetch;
    const c = webRiskLinkChecker("k", {
      fetch: f,
      reserve: allowAll,
      timeoutMs: 20,
    });
    await expect(
      c.check(input({ urls: ["https://a.example/"] })),
    ).rejects.toThrow();
  });

  it("refuses an empty key", () => {
    expect(() => webRiskLinkChecker("  ")).toThrow();
  });

  it("uniqueUrls keeps every distinct http(s) URL, not one per host (WR-A03)", () => {
    expect(
      uniqueUrls([
        "https://a.example/1",
        "http://A.example/2",
        "https://a.example/1#top",
        "ftp://b.example/",
        42,
        "https://b.example/",
      ]),
    ).toEqual([
      { host: "a.example", url: "https://a.example/1" },
      { host: "a.example", url: "http://a.example/2" },
      { host: "b.example", url: "https://b.example/" },
    ]);
  });

  it("a bad link next to a good one on the same host is held (WR-A03)", async () => {
    const looked: string[] = [];
    const c = webRiskLinkChecker("k", {
      reserve: async (n) => n,
      fetch: (async (u: string) => {
        const uri = new URL(u).searchParams.get("uri") ?? "";
        looked.push(uri);
        const body = uri.endsWith("/phish")
          ? { threat: { threatTypes: ["SOCIAL_ENGINEERING"] } }
          : {};
        return new Response(JSON.stringify(body), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const r = await c.check(
      input({
        urls: [
          "https://docs.google.example/benign",
          "https://docs.google.example/phish",
        ],
      }),
    );
    expect(looked).toHaveLength(2);
    expect(r.verdict).toBe("held");
  });

  it("links past the per-scan cap are unchecked, never clean (WR-A03)", async () => {
    let asked = 0;
    const c = webRiskLinkChecker("k", {
      reserve: async (n) => {
        asked = n;
        return n;
      },
      fetch: (async () =>
        new Response("{}", { status: 200 })) as unknown as typeof fetch,
    });
    const urls = Array.from(
      { length: MAX_LOOKUPS_PER_SCAN + 3 },
      (_, i) => `https://a.example/${i}`,
    );
    const r = await c.check(input({ urls }));
    expect(asked).toBe(MAX_LOOKUPS_PER_SCAN);
    expect(r).toMatchObject({
      verdict: "unchecked",
      reasons: [LINKS_UNCHECKED_REASON],
    });
  });
});
