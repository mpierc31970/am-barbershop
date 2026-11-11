import { describe, expect, it } from "vitest";
import {
  addToHistogram,
  attributeSource,
  bucketIndex,
  emptyHistogram,
  isBot,
  isNotConnected,
  mergeHistograms,
  p75,
  rateVital,
  SOCIAL_SOURCE_KEYS,
  VITAL_BUCKETS,
  type AnalyticsSource,
  type DateRange,
} from "./index";

const OWN = "acme.example.com";

describe("attributeSource", () => {
  it("UTM source wins and a social key is kind social", () => {
    expect(
      attributeSource({
        utmSource: "instagram",
        referrer: "https://www.google.com/",
        ownHost: OWN,
      }),
    ).toEqual({ source: "instagram", kind: "social" });
  });

  it("lowercases UTM and treats a non-social UTM as a campaign", () => {
    expect(attributeSource({ utmSource: "Spring_Mail", ownHost: OWN })).toEqual(
      { source: "spring_mail", kind: "campaign" },
    );
  });

  it("clamps hostile UTM values to other", () => {
    expect(attributeSource({ utmSource: "<script>", ownHost: OWN })).toEqual({
      source: "other",
      kind: "campaign",
    });
    expect(
      attributeSource({ utmSource: "a".repeat(41), ownHost: OWN }).source,
    ).toBe("other");
  });

  it("maps social referrer hosts to their platform key", () => {
    expect(
      attributeSource({ referrer: "https://l.instagram.com/", ownHost: OWN }),
    ).toEqual({ source: "instagram", kind: "social" });
    expect(
      attributeSource({ referrer: "https://t.co/abc", ownHost: OWN }),
    ).toEqual({ source: "x", kind: "social" });
    expect(
      attributeSource({ referrer: "https://m.facebook.com/x", ownHost: OWN }),
    ).toEqual({ source: "facebook", kind: "social" });
  });

  it("maps search engines to search", () => {
    expect(
      attributeSource({ referrer: "https://www.google.com", ownHost: OWN }),
    ).toEqual({ source: "google", kind: "search" });
    expect(
      attributeSource({ referrer: "https://duckduckgo.com/", ownHost: OWN }),
    ).toEqual({ source: "duckduckgo", kind: "search" });
  });

  it("own host, empty or junk referrer is direct", () => {
    const direct = { source: "direct", kind: "direct" };
    expect(
      attributeSource({ referrer: `https://${OWN}/about`, ownHost: OWN }),
    ).toEqual(direct);
    expect(attributeSource({ referrer: "", ownHost: OWN })).toEqual(direct);
    expect(attributeSource({ ownHost: OWN })).toEqual(direct);
    expect(attributeSource({ referrer: "not a url", ownHost: OWN })).toEqual(
      direct,
    );
  });

  it("other hosts are referrals named by host without www", () => {
    expect(
      attributeSource({ referrer: "https://www.Partner.org/p", ownHost: OWN }),
    ).toEqual({ source: "partner.org", kind: "referral" });
  });

  it("declares the ten social keys", () => {
    expect(SOCIAL_SOURCE_KEYS).toHaveLength(10);
  });
});

describe("isBot", () => {
  it("flags Lighthouse, headless and empty UAs", () => {
    expect(
      isBot(
        "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 Chrome-Lighthouse",
      ),
    ).toBe(true);
    expect(isBot("Mozilla/5.0 HeadlessChrome/120")).toBe(true);
    expect(isBot("Googlebot/2.1")).toBe(true);
    expect(isBot("")).toBe(true);
    expect(isBot(null)).toBe(true);
  });

  it("passes a normal Chrome UA", () => {
    expect(
      isBot(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
  });
});

describe("vitals histograms", () => {
  it("bucket counts include an overflow bucket", () => {
    expect(emptyHistogram("lcp")).toHaveLength(8000 / 250 + 1);
    expect(emptyHistogram("inp")).toHaveLength(1000 / 25 + 1);
    expect(emptyHistogram("cls")).toHaveLength(40 + 1);
    expect(VITAL_BUCKETS.lcp.step).toBe(250);
  });

  it("bucketIndex places values, overflow above max", () => {
    expect(bucketIndex("lcp", 0)).toBe(0);
    expect(bucketIndex("lcp", 1000)).toBe(3);
    expect(bucketIndex("lcp", 99999)).toBe(32);
    expect(bucketIndex("cls", 0.1)).toBe(3);
    expect(bucketIndex("lcp", -5)).toBe(0);
  });

  it("p75 of 100 samples at 1000 ms is 1000", () => {
    let h = emptyHistogram("lcp");
    for (let i = 0; i < 100; i++) h = addToHistogram("lcp", h, 1000);
    expect(p75("lcp", h)).toBe(1000);
  });

  it("p75 picks the 75th percentile bucket", () => {
    let h = emptyHistogram("inp");
    for (let i = 0; i < 70; i++) h = addToHistogram("inp", h, 60);
    for (let i = 0; i < 30; i++) h = addToHistogram("inp", h, 410);
    expect(p75("inp", h)).toBe(425);
  });

  it("empty histogram p75 is null; overflow p75 is max", () => {
    expect(p75("lcp", emptyHistogram("lcp"))).toBeNull();
    expect(p75("lcp", [])).toBeNull();
    const h = addToHistogram("lcp", emptyHistogram("lcp"), 20000);
    expect(h[h.length - 1]).toBe(1);
    expect(p75("lcp", h)).toBe(8000);
  });

  it("mergeHistograms adds element-wise and tolerates short arrays", () => {
    const a = addToHistogram("cls", emptyHistogram("cls"), 0.01);
    const b = addToHistogram("cls", emptyHistogram("cls"), 0.01);
    const m = mergeHistograms("cls", a, b, []);
    expect(m[0]).toBe(2);
    expect(m).toHaveLength(41);
  });

  it("ignores non-finite values", () => {
    const h = addToHistogram("lcp", emptyHistogram("lcp"), Number.NaN);
    expect(h.reduce((s, n) => s + n, 0)).toBe(0);
  });

  it("rateVital uses Google thresholds", () => {
    expect(rateVital("lcp", 2600)).toBe("needs-work");
    expect(rateVital("lcp", 2500)).toBe("good");
    expect(rateVital("lcp", 4001)).toBe("poor");
    expect(rateVital("inp", 150)).toBe("good");
    expect(rateVital("inp", 300)).toBe("needs-work");
    expect(rateVital("cls", 0.3)).toBe("poor");
  });
});

describe("AnalyticsSource port", () => {
  it("a stand-in returns not connected", async () => {
    const src: AnalyticsSource = {
      ga4Summary: async () => ({ connected: false }),
      searchTopQueries: async () => ({ connected: false }),
    };
    const range: DateRange = { from: "2026-10-01", to: "2026-10-07" };
    const r = await src.ga4Summary("org1", range);
    expect(isNotConnected(r)).toBe(true);
    const q = await src.searchTopQueries("org1", range);
    expect(q.connected).toBe(false);
  });
});
