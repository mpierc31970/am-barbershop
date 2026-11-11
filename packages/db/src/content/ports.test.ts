// Content ports and stand-ins (CONT-31, D248, D270; T-03-22).
import { afterEach, describe, expect, it, vi } from "vitest";
import { liveTag, pageTag, recordingInvalidator, siteTag } from "./ports";
import {
  getContentScanner,
  getSearchPinger,
  keywordScanner,
  loggingPinger,
} from "./scan-standin";

const ORG = "orgaaaaaaaaaaaa";

describe("keywordScanner", () => {
  it("holds the synthetic held token", async () => {
    const r = await keywordScanner.scan({
      orgId: ORG,
      texts: ["Welcome __cds_test_held__ friends"],
      urls: [],
    });
    expect(r.verdict).toBe("held");
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("marks the synthetic unsure token unsure", async () => {
    const r = await keywordScanner.scan({
      orgId: ORG,
      texts: ["<p>__CDS_TEST_UNSURE__</p>"],
      urls: [],
    });
    expect(r.verdict).toBe("unsure");
  });

  it("held wins over unsure", async () => {
    const r = await keywordScanner.scan({
      orgId: ORG,
      texts: ["__cds_test_unsure__", "__cds_test_held__"],
      urls: [],
    });
    expect(r.verdict).toBe("held");
  });

  it("is clean otherwise, and matches whole words only", async () => {
    const r = await keywordScanner.scan({
      orgId: ORG,
      texts: ["Book a massage", "occasional casinos"],
      urls: ["https://example.com/casino"],
    });
    expect(r).toEqual({ verdict: "clean", reasons: [] });
  });

  it("checks URL hostnames", async () => {
    const r = await keywordScanner.scan({
      orgId: ORG,
      texts: [],
      urls: ["https://best-casino.example.com/x"],
    });
    expect(r.verdict).toBe("unsure");
  });

  it("tolerates malformed input", async () => {
    const r = await keywordScanner.scan({
      orgId: ORG,
      texts: [42 as unknown as string],
      urls: ["not a url"],
    });
    expect(r.verdict).toBe("clean");
  });
});

describe("loggingPinger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs the URL count only, never a URL", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    await loggingPinger.ping([
      "https://a.example.com/",
      "https://a.example.com/about",
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual(["INDEXNOW_STANDIN", 2]);
    const flat = JSON.stringify(spy.mock.calls);
    expect(flat).not.toContain("example.com");
  });
});

describe("stand-in selection", () => {
  afterEach(() => {
    delete process.env.CDS_CONTENT_SCANNER;
    delete process.env.CDS_SEARCH_PINGER;
  });

  it("defaults to the stand-ins", async () => {
    // 13-08: unset = the composite scanner (keyword text + skipped image/link stand-ins).
    const composite = getContentScanner();
    expect(composite).not.toBe(keywordScanner);
    const r = await composite.scan({
      orgId: ORG,
      texts: ["__cds_test_held__"],
      urls: [],
    });
    expect(r.verdict).toBe("held");
    process.env.CDS_CONTENT_SCANNER = "keyword";
    expect(getContentScanner()).toBe(keywordScanner);
    expect(getSearchPinger()).toBe(loggingPinger);
  });

  it("throws for an implementation that does not exist yet", () => {
    process.env.CDS_CONTENT_SCANNER = "real";
    process.env.CDS_SEARCH_PINGER = "bing";
    expect(() => getContentScanner()).toThrow(/no implementation/);
    expect(() => getSearchPinger()).toThrow(/not supported/);
  });
});

describe("tags", () => {
  it("produces the exact tag strings", () => {
    expect(siteTag(ORG)).toBe(`org:${ORG}:site`);
    expect(pageTag(ORG, "pageaaaaaaaaaaa")).toBe(
      `org:${ORG}:page:pageaaaaaaaaaaa`,
    );
    expect(liveTag(ORG)).toBe(`org:${ORG}:live`);
  });

  it("recordingInvalidator records tags", () => {
    const inv = recordingInvalidator();
    inv.invalidate(["a", "b"]);
    inv.invalidate(["c"]);
    expect(inv.tags).toEqual(["a", "b", "c"]);
  });
});
