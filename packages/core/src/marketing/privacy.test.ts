// 15-18 choice 6 (P15-P13, T-15-18-01/02): the DRAFT hub privacy notice.
import { describe, expect, it } from "vitest";
import { isPolicyKey, lintLegalMarkdown, renderLegalMarkdown } from "../legal";
import { HUB_PRIVACY } from "./privacy";

describe("HUB_PRIVACY", () => {
  it("is a draft with an ISO updated date and a non-empty body", () => {
    expect(HUB_PRIVACY.draft).toBe(true);
    expect(HUB_PRIVACY.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(HUB_PRIVACY.markdown.trim().length).toBeGreaterThan(200);
    expect(Object.isFrozen(HUB_PRIVACY)).toBe(true);
  });

  it("is not a signed policy (no new POLICY_KEY)", () => {
    expect(isPolicyKey("privacy")).toBe(false);
  });

  it("stays inside the legal markdown subset and renders without script", () => {
    expect(lintLegalMarkdown(HUB_PRIVACY.markdown)).toEqual([]);
    const html = renderLegalMarkdown(HUB_PRIVACY.markdown);
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("<h2>");
    // The contact-form fields are one list of six items, not six lists.
    expect(html.match(/<ul>/g)).toHaveLength(1);
    expect(html.match(/<li>/g)).toHaveLength(6);
    expect(html).toContain(
      '<a href="mailto:hello@connectionsdesignstudios.com">',
    );
  });

  it("states the facts of the shipped contact form (P15-P14)", () => {
    const md = HUB_PRIVACY.markdown;
    for (const fact of [
      "your name",
      "your email address",
      "your business name",
      "your phone number",
      "your message",
      "2 years",
      "Cloudflare Turnstile",
      "no analytics or advertising cookies",
      "report",
    ]) {
      expect(md).toContain(fact);
    }
  });

  it("WR-B06: describes the in-memory contact limit and claims no stored address code", () => {
    const md = HUB_PRIVACY.markdown;
    expect(md).toContain("for one hour, in its memory only");
    expect(md).toContain("Your address is not saved");
    // The old claims were false: an unsalted IPv4 hash is reversible, and it was never read.
    expect(md).not.toMatch(/scrambled code/i);
    expect(md).not.toMatch(/can't be turned back/i);
  });
});
