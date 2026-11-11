// CONT-15 robots part (07-31 choice 9; D170): preview disallow-all, AI toggle, sitemap line.
import { describe, expect, it } from "vitest";
import { AI_CRAWLER_AGENTS, robotsTxt } from "./robots";

const sitemapUrl = "https://crumb.example/sitemap.xml";

describe("robotsTxt", () => {
  it("preview host disallows everything, nothing else", () => {
    expect(
      robotsTxt({ hostKind: "preview", allowAiCrawlers: true, sitemapUrl }),
    ).toBe("User-agent: *\nDisallow: /\n");
  });

  it("redirect host disallows everything (14-14, P14-P5)", () => {
    expect(
      robotsTxt({ hostKind: "redirect", allowAiCrawlers: true, sitemapUrl }),
    ).toBe("User-agent: *\nDisallow: /\n");
  });

  it("custom host with AI on allows all and lists the sitemap", () => {
    const txt = robotsTxt({
      hostKind: "custom",
      allowAiCrawlers: true,
      sitemapUrl,
    });
    expect(txt).toContain("User-agent: *\nAllow: /");
    expect(txt.trimEnd().endsWith(`Sitemap: ${sitemapUrl}`)).toBe(true);
    for (const agent of AI_CRAWLER_AGENTS) expect(txt).not.toContain(agent);
    expect(txt).not.toContain("Disallow");
  });

  it("custom host with AI off blocks the six AI crawlers", () => {
    const txt = robotsTxt({
      hostKind: "custom",
      allowAiCrawlers: false,
      sitemapUrl,
    });
    expect(AI_CRAWLER_AGENTS).toHaveLength(6);
    for (const agent of AI_CRAWLER_AGENTS) {
      expect(txt).toContain(`User-agent: ${agent}\n`);
    }
    expect(txt).toMatch(/User-agent: Applebot-Extended\nDisallow: \/\n/);
    expect(txt.trimEnd().endsWith(`Sitemap: ${sitemapUrl}`)).toBe(true);
  });

  it("never lists a page path", () => {
    const txt = robotsTxt({
      hostKind: "custom",
      allowAiCrawlers: false,
      sitemapUrl,
    });
    const disallows = txt.split("\n").filter((l) => l.startsWith("Disallow"));
    expect(disallows).toEqual(["Disallow: /"]);
  });
});
