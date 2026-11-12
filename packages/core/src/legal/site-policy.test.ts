// Tenant site Privacy policy and Terms (AGR-08, D217; CONTEXT A5-Q1, A5-Q4; T-09-11-01..03).
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { compileSitePolicySources } from "../../scripts/legal-gen";
import { CORE_PRIVACY_CLAUSE_IDS } from "../addons/constants";
import type { AddonManifest } from "../addons/types";
import { InvalidInput } from "../errors";
import {
  CORE_PRIVACY_CLAUSES,
  latestSitePolicyVersion,
  renderSitePolicy,
  sitePolicyChanges,
  type SitePolicyFacts,
} from "./site-policy";
import { SITE_POLICY_TEMPLATES } from "./site-policies.generated";
import type { SitePolicyTemplate } from "./types";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const testimonialsClause = {
  id: "testimonials",
  heading: "Testimonials",
  what: "Names and quotes.",
  why: "To show reviews.",
  howLong: "Until we remove them.",
};
const credentialsClause = {
  id: "credentials",
  heading: "Credentials",
  what: "License details.",
  why: "To show qualifications.",
  howLong: "Until we remove them.",
};

function stubManifest(slug: string, extra: object): AddonManifest {
  return { slug, name: slug, ...extra } as unknown as AddonManifest;
}

function registry(manifests: AddonManifest[]) {
  return { list: () => manifests };
}

function facts(over: Partial<SitePolicyFacts> = {}): SitePolicyFacts {
  return {
    legalName: "Bloom Studio LLC",
    businessName: "Bloom Studio",
    privacyContact: "privacy@bloom.test",
    legalRegion: "Texas, United States",
    hasNewsletter: false,
    hasAnalytics: false,
    hasEmbeds: false,
    activeAddons: new Set(["testimonials"]),
    addons: registry([
      stubManifest("testimonials", { privacyClauses: [testimonialsClause] }),
      stubManifest("credentials", { privacyClauses: [credentialsClause] }),
    ]),
    ...over,
  };
}

describe("committed SITE_POLICY_TEMPLATES", () => {
  it("lists privacy and terms v1 to v3 drafts whose sha256 recomputes", () => {
    expect(SITE_POLICY_TEMPLATES.map((t) => `${t.page}@${t.version}`)).toEqual([
      "privacy@1",
      "terms@1",
      "privacy@2",
      "terms@2",
      "privacy@3",
      "terms@3",
    ]);
    for (const t of SITE_POLICY_TEMPLATES) {
      expect(t.draft).toBe(true);
      expect(t.changes === null).toBe(t.version === 1);
      expect(t.sha256).toBe(sha(t.bodyMd));
    }
    expect(latestSitePolicyVersion()).toBe(3);
    expect(sitePolicyChanges(1)).toBeNull();
  });

  it("only the privacy template has the clause slot, exactly once", () => {
    const privacy = SITE_POLICY_TEMPLATES.find((t) => t.page === "privacy")!;
    const terms = SITE_POLICY_TEMPLATES.find((t) => t.page === "terms")!;
    expect(privacy.bodyMd.match(/^\{\{clauses\}\}$/gm)).toHaveLength(1);
    expect(terms.bodyMd).not.toContain("{{clauses}}");
  });
});

describe("renderSitePolicy privacy", () => {
  it("includes core clauses and active add-on clauses only, in order", () => {
    const r = renderSitePolicy("privacy", facts(), 1);
    expect(r.page).toBe("privacy");
    expect(r.title).toBe("Privacy policy");
    expect(r.templateVersion).toBe(1);
    expect(r.clauseIds).toEqual(["contact-forms", "cookies", "testimonials"]);
    expect(r.coveredLabels).toEqual([
      "Contact forms",
      "Cookies",
      "Testimonials",
    ]);
    expect(r.html).toContain("<h3>Contact forms</h3>");
    expect(r.html).toContain("<h3>Cookies</h3>");
    expect(r.html).toContain("<h3>Testimonials</h3>");
    expect(r.html).not.toContain("Credentials");
    expect(r.html.indexOf("<h3>Contact forms</h3>")).toBeLessThan(
      r.html.indexOf("<h3>Testimonials</h3>"),
    );
    expect(r.html).toContain("What we collect:");
    expect(r.html).toContain("How long we keep it:");
  });

  it("analytics, newsletter and embeds follow the facts", () => {
    const off = renderSitePolicy("privacy", facts(), 1);
    expect(off.clauseIds).not.toContain("analytics");
    const on = renderSitePolicy(
      "privacy",
      facts({ hasAnalytics: true, hasNewsletter: true, hasEmbeds: true }),
      1,
    );
    expect(on.clauseIds).toEqual([
      "contact-forms",
      "contacts-newsletter",
      "analytics",
      "embedded-media",
      "cookies",
      "testimonials",
    ]);
    expect(CORE_PRIVACY_CLAUSES.map((c) => c.id)).toEqual([
      "contact-forms",
      "contacts-newsletter",
      "analytics",
      "embedded-media",
      "cookies",
    ]);
    expect(Object.isFrozen(CORE_PRIVACY_CLAUSES)).toBe(true);
  });

  it("escapes tenant input and links the privacy contact", () => {
    const r = renderSitePolicy(
      "privacy",
      facts({ legalName: "<script>x</script> & Co" }),
      1,
    );
    expect(r.html).not.toContain("<script");
    expect(r.html).toContain("&lt;script&gt;x&lt;/script&gt; &amp; Co");
    expect(r.html).toContain(
      '<a href="mailto:privacy@bloom.test">privacy@bloom.test</a>',
    );
  });

  it("refuses a privacy contact that is not an email", () => {
    expect(() =>
      renderSitePolicy(
        "privacy",
        facts({ privacyContact: 'x@y.z" onclick="a' }),
        1,
      ),
    ).toThrow(InvalidInput);
  });

  it("refuses empty legal name or privacy contact", () => {
    expect(() =>
      renderSitePolicy("privacy", facts({ legalName: "  " }), 1),
    ).toThrow(InvalidInput);
    expect(() =>
      renderSitePolicy("terms", facts({ privacyContact: "" }), 1),
    ).toThrow(InvalidInput);
  });

  it("skips an add-on whose privacyClauses throws or is malformed", () => {
    const throwing = stubManifest("broken", {});
    Object.defineProperty(throwing, "privacyClauses", {
      get() {
        throw new Error("boom");
      },
    });
    const malformed = stubManifest("bad", {
      privacyClauses: [{ ...testimonialsClause, id: "bad", what: "<b>x</b>" }],
    });
    const r = renderSitePolicy(
      "privacy",
      facts({
        activeAddons: new Set(["broken", "bad", "testimonials"]),
        addons: registry([
          throwing,
          malformed,
          stubManifest("testimonials", {
            privacyClauses: [testimonialsClause],
          }),
        ]),
      }),
      1,
    );
    expect(r.clauseIds).toEqual(["contact-forms", "cookies", "testimonials"]);
    expect(r.html).not.toContain("<b>");
  });

  it("WR-B06: logs every dropped contribution, naming the add-on", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      renderSitePolicy(
        "privacy",
        facts({
          activeAddons: new Set(["clash", "testimonials"]),
          addons: registry([
            stubManifest("clash", {
              privacyClauses: [{ ...testimonialsClause, id: "cookies" }],
            }),
            stubManifest("testimonials", {
              privacyClauses: [testimonialsClause],
            }),
          ]),
        }),
        1,
      );
      expect(spy).toHaveBeenCalledWith(
        "[legal] privacy clauses dropped",
        "clash",
        "duplicate",
      );
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("WR-B06: CORE_PRIVACY_CLAUSE_IDS (checked by defineAddon) matches the renderer", () => {
    expect(CORE_PRIVACY_CLAUSES.map((c) => c.id)).toEqual([
      ...CORE_PRIVACY_CLAUSE_IDS,
    ]);
  });

  it("a throwing registry list still renders the core clauses", () => {
    const r = renderSitePolicy(
      "privacy",
      facts({
        addons: {
          list() {
            throw new Error("boom");
          },
        },
      }),
      1,
    );
    expect(r.clauseIds).toEqual(["contact-forms", "cookies"]);
  });

  it("carries the draft box and uses only h2/h3 headings", () => {
    const r = renderSitePolicy("privacy", facts(), 1);
    expect(r.draft).toBe(true);
    expect(r.html).toContain(
      "Draft: this page is a starting template and has not been reviewed by a lawyer.",
    );
    expect(r.html).not.toMatch(/<h[14-6][\s>]/);
    expect(r.html).toMatch(/<h2>Who we are<\/h2>/);
    expect(r.html).toMatch(/<h2>Who hosts this site<\/h2>/);
    expect(r.html).not.toContain("{{");
  });
});

describe("renderSitePolicy versions (CONTEXT A5-Q4)", () => {
  const v1 = SITE_POLICY_TEMPLATES.filter((t) => t.version === 1);
  const v2: SitePolicyTemplate[] = [
    ...v1,
    {
      page: "privacy",
      version: 2,
      title: "Privacy policy",
      changes: "New wording.",
      draft: false,
      bodyMd: "## Brand new\n\nVersion two text.\n\n{{clauses}}\n",
      sha256: "x",
    },
    {
      page: "terms",
      version: 2,
      title: "Terms",
      changes: "New wording.",
      draft: false,
      bodyMd: "## Brand new terms\n\nVersion two.\n",
      sha256: "y",
    },
  ];

  it("keeps rendering the acknowledged version after a newer one ships", () => {
    expect(latestSitePolicyVersion(v2)).toBe(2);
    expect(sitePolicyChanges(2, v2)).toBe("New wording.");
    const old = renderSitePolicy("privacy", facts(), 1, v2);
    expect(old.templateVersion).toBe(1);
    expect(old.html).not.toContain("Version two");
    const next = renderSitePolicy("privacy", facts(), 2, v2);
    expect(next.html).toContain("Version two text.");
    expect(next.draft).toBe(false);
    expect(next.html).not.toContain("Draft: this page");
  });

  it("an unknown version throws InvalidInput", () => {
    expect(() => renderSitePolicy("privacy", facts(), 9)).toThrow(InvalidInput);
    expect(() => renderSitePolicy("terms", facts(), 0)).toThrow(InvalidInput);
  });
});

describe("renderSitePolicy terms", () => {
  it("names the business and region and explains the Report link", () => {
    const r = renderSitePolicy("terms", facts(), 1);
    expect(r.title).toBe("Terms");
    expect(r.clauseIds).toEqual([]);
    expect(r.coveredLabels).toEqual([]);
    expect(r.html).toContain("Bloom Studio");
    expect(r.html).toContain("Texas, United States");
    expect(r.html).toMatch(/Report link[^.]*anyone[^.]*report/i);
    const v3 = renderSitePolicy("terms", facts(), 3);
    expect(v3.html).not.toContain("Report link");
    expect(v3.html).toContain("mailto:pierce1970+BarberOwner@gmail.com");
    expect(r.html).not.toContain("<script");
    expect(r.html).not.toMatch(/<h[14-6][\s>]/);
  });
});

describe("compileSitePolicySources", () => {
  const src = (page: string, version: number, body: string, over = "") => ({
    path: `packages/core/src/legal/site-policies/${page}/v${version}.md`,
    text: `---\npage: ${page}\nversion: ${version}\ntitle: "T ${page}"\ndraft: true\n${
      version > 1 ? 'changes: "New."\n' : ""
    }${over}---\n\n${body}`,
  });
  const privacyBody =
    "## Who we are\n\nWe are {{legal_name}}.\n\n{{clauses}}\n";
  const termsBody = "## Terms\n\nRun by {{business_name}}.\n";

  it("compiles a matching pair", () => {
    const out = compileSitePolicySources([
      src("privacy", 1, privacyBody),
      src("terms", 1, termsBody),
    ]);
    expect(out.map((t) => `${t.page}@${t.version}`)).toEqual([
      "privacy@1",
      "terms@1",
    ]);
  });

  it("a privacy v2 without a terms v2 fails", () => {
    expect(() =>
      compileSitePolicySources([
        src("privacy", 1, privacyBody),
        src("terms", 1, termsBody),
        src("privacy", 2, privacyBody),
      ]),
    ).toThrow(/terms v2/);
  });

  it("{{clauses}} is allowed only once and only in privacy", () => {
    expect(() =>
      compileSitePolicySources([
        src("privacy", 1, privacyBody),
        src("terms", 1, `${termsBody}\n{{clauses}}\n`),
      ]),
    ).toThrow(/clauses/);
    expect(() =>
      compileSitePolicySources([
        src("privacy", 1, "## A\n\nNo slot here.\n"),
        src("terms", 1, termsBody),
      ]),
    ).toThrow(/clauses/);
  });

  it("rejects an unknown variable and raw HTML", () => {
    expect(() =>
      compileSitePolicySources([
        src("privacy", 1, `${privacyBody}\n{{secret}}\n`),
        src("terms", 1, termsBody),
      ]),
    ).toThrow(/secret/);
    expect(() =>
      compileSitePolicySources([
        src("privacy", 1, privacyBody),
        src("terms", 1, `${termsBody}\n<script>x</script>\n`),
      ]),
    ).toThrow(/raw HTML/);
  });
});
