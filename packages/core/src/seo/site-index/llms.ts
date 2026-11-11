// llms.txt from the site index (07-31 choice 10; CONT-13, CONT-15, CONT-37, D277).
// llmstxt.org shape: "# Name", "> summary", "## Pages", "## Services" and add-on groups.
// Titles have brackets and newlines neutralised so a title cannot forge a link (T-07-31-04).
// Served only on a custom host with the AI toggle on (the route decides).
// Pure, Edge-safe (07-02 header rule): no node:, no html cleaner, no next/* imports.
import { indexUrl } from "./sitemap";
import type { SiteIndex } from "./types";

function line(s: string): string {
  return String(s)
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function linkText(s: string): string {
  return line(s).replace(/\[/g, "(").replace(/\]/g, ")");
}

function linkUrl(s: string): string {
  return line(s)
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/ /g, "%20");
}

export function llmsTxt(input: { origin: string; index: SiteIndex }): string {
  const { index, origin } = input;
  const out: string[] = [`# ${line(index.site.name) || "Website"}`, ""];
  const summary = line(index.site.summary);
  if (summary !== "") out.push(`> ${summary}`, "");
  if (index.pages.length > 0) {
    out.push("## Pages", "");
    for (const p of index.pages) {
      const desc = line(p.description);
      out.push(
        `- [${linkText(p.title) || p.path}](${linkUrl(indexUrl(origin, p.path))})${desc ? `: ${desc}` : ""}`,
      );
    }
    out.push("");
  }
  const groups = new Map<string, SiteIndex["records"]>();
  for (const r of index.records) {
    const g = line(r.group) || "More";
    const list = groups.get(g) ?? [];
    list.push(r);
    groups.set(g, list);
  }
  for (const [group, records] of groups) {
    if (records.length === 0) continue;
    out.push(`## ${group}`, "");
    for (const r of records) {
      const text = line(r.text);
      out.push(
        `- [${linkText(r.title)}](${linkUrl(indexUrl(origin, r.path))})${text ? `: ${text}` : ""}`,
      );
    }
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}
