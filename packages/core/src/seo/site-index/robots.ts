// robots.txt from the site index (07-31 choice 9; CONT-15, CONT-37, D170, D277).
// Preview (and redirect, 14-14) hosts disallow everything. Custom hosts allow all, block the AI crawlers when the
// site's AI toggle is off, and point at the sitemap. Page paths are never listed: a
// Disallow line for a protected page would leak it (T-07-31-02).
// Pure, Edge-safe (07-02 header rule): no node:, no html cleaner, no next/* imports.
import type { HostKind } from "../page/meta";

export const AI_CRAWLER_AGENTS: readonly string[] = Object.freeze([
  "GPTBot",
  "ClaudeBot",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
  "Applebot-Extended",
]);

export function robotsTxt(input: {
  hostKind: HostKind | string;
  allowAiCrawlers: boolean;
  sitemapUrl: string;
}): string {
  if (input.hostKind !== "custom") return "User-agent: *\nDisallow: /\n";
  const lines = ["User-agent: *", "Allow: /", ""];
  if (input.allowAiCrawlers === false) {
    for (const agent of AI_CRAWLER_AGENTS) lines.push(`User-agent: ${agent}`);
    lines.push("Disallow: /", "");
  }
  lines.push(`Sitemap: ${input.sitemapUrl.replace(/[\r\n]/g, "")}`);
  return `${lines.join("\n")}\n`;
}
