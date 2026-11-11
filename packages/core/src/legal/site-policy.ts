// Tenant site Privacy policy and Terms renderer (AGR-08, D217; CONTEXT A5-Q1, A5-Q4).
//
// Pure and Edge-safe: no node:*, no db package, no sanitizer, no crypto (the db package hashes
// the output for the acknowledgement). The template comes from SITE_POLICY_TEMPLATES (compiled
// by legal:gen); tenant values are escaped by renderLegalMarkdown, never parsed as markdown;
// clause text is escaped here. Add-on clauses are read through the registry only, for active
// add-ons only, and a malformed or throwing contribution is dropped (invariant 4,
// T-09-11-02). Callers in apps/web pass the HTML through sanitizeLegalHtml (09-22).
import { privacyClauseProblem } from "../addons/define";
import type { AddonManifest, PrivacyClause } from "../addons/types";
import { escapeHtml } from "../email/escape";
import { InvalidInput } from "../errors";
import { renderLegalMarkdown } from "./markdown";
import { SITE_POLICY_TEMPLATES } from "./site-policies.generated";
import type { SitePolicyTemplate } from "./types";

export type SitePolicyPage = "privacy" | "terms";

export type SitePolicyFacts = {
  legalName: string;
  /** Falls back to legalName when blank. */
  businessName: string;
  /** An email address; rendered as a mailto: link. */
  privacyContact: string;
  legalRegion: string;
  /** The org has a contact list or a newsletter form. */
  hasNewsletter: boolean;
  /** A GA4 measurement id is set. */
  hasAnalytics: boolean;
  /** Any video, map or embed block exists (callers pass true when unknown). */
  hasEmbeds: boolean;
  activeAddons: ReadonlySet<string>;
  addons: { list(): readonly AddonManifest[] };
};

export type RenderedSitePolicy = {
  page: SitePolicyPage;
  templateVersion: number;
  title: string;
  html: string;
  /** Clause ids in render order: core first, then add-ons in registry order. */
  clauseIds: readonly string[];
  /** Clause headings, same order (the "covers" list in Settings). */
  coveredLabels: readonly string[];
  draft: boolean;
};

/** UI-SPEC "Tenant Draft box" (D-UI-P9-8). */
export const SITE_POLICY_DRAFT_TEXT =
  "Draft: this page is a starting template and has not been reviewed by a lawyer.";

type CoreClause = PrivacyClause & {
  when: (f: SitePolicyFacts) => boolean;
};

function freezeClause(c: CoreClause): CoreClause {
  return Object.freeze(c);
}

/** Core clauses, in render order (CONTEXT A5-Q1, choice 3). DRAFT wording. */
export const CORE_PRIVACY_CLAUSES: readonly CoreClause[] = Object.freeze([
  freezeClause({
    id: "contact-forms",
    heading: "Contact forms",
    what: "The name, email address, phone number and message you send us through a form on this site.",
    why: "To read and answer your message.",
    howLong:
      "Until we have dealt with your message and no longer need it, then we delete it.",
    when: () => true,
  }),
  freezeClause({
    id: "contacts-newsletter",
    heading: "Newsletter sign-ups",
    what: "Your name and email address when you sign up for our emails or newsletter, and whether you opened or unsubscribed.",
    why: "To send you the updates you asked for.",
    howLong: "Until you unsubscribe or ask us to delete it.",
    when: (f) => f.hasNewsletter,
  }),
  freezeClause({
    id: "analytics",
    heading: "Analytics",
    what: "If you agree in the cookie banner, Google Analytics records how you use this site, such as the pages you visit, your device and your approximate location.",
    why: "To understand which pages are useful and improve the site.",
    howLong:
      "As set in our Google Analytics account, usually no longer than 14 months.",
    when: (f) => f.hasAnalytics,
  }),
  freezeClause({
    id: "embedded-media",
    heading: "Embedded media",
    what: "Videos and maps from other services, such as YouTube, Vimeo or Google Maps, load only after you choose to load them. Once loaded, that service may collect information about you under its own privacy policy.",
    why: "To show you the video or map you asked to see.",
    howLong: "As set by the service that provides the video or map.",
    when: (f) => f.hasEmbeds,
  }),
  freezeClause({
    id: "cookies",
    heading: "Cookies",
    what: "A small cookie that remembers your cookie choice, and cookies that keep this site working. Other cookies are set only if you agree to them.",
    why: "So the site works and remembers what you chose.",
    howLong: "Your cookie choice is kept for 180 days, then we ask again.",
    when: () => true,
  }),
]);

const EMAIL_RE =
  /^[^\s@<>"'()[\]\\,;:]+@[^\s@<>"'()[\]\\,;:]+\.[^\s@<>"'()[\]\\,;:]+$/;
const CLAUSES_LINE = "{{clauses}}";

function templatesOrDefault(
  templates: readonly SitePolicyTemplate[] | undefined,
): readonly SitePolicyTemplate[] {
  return templates ?? SITE_POLICY_TEMPLATES;
}

/** The newest template version (one number covers both pages). */
export function latestSitePolicyVersion(
  templates?: readonly SitePolicyTemplate[],
): number {
  let max = 0;
  for (const t of templatesOrDefault(templates)) max = Math.max(max, t.version);
  return max;
}

/** What changed in this version (privacy template's note); null for v1 or unknown. */
export function sitePolicyChanges(
  version: number,
  templates?: readonly SitePolicyTemplate[],
): string | null {
  const t = templatesOrDefault(templates).find(
    (x) => x.page === "privacy" && x.version === version,
  );
  return t?.changes ?? null;
}

function clauseHtml(c: PrivacyClause): string {
  return (
    `<h3>${escapeHtml(c.heading)}</h3>` +
    `<p><strong>What we collect:</strong> ${escapeHtml(c.what)}</p>` +
    `<p><strong>Why:</strong> ${escapeHtml(c.why)}</p>` +
    `<p><strong>How long we keep it:</strong> ${escapeHtml(c.howLong)}</p>`
  );
}

/** Active add-ons' clauses, registry order; a bad or throwing manifest is skipped whole. */
function addonClauses(
  facts: SitePolicyFacts,
  taken: Set<string>,
): PrivacyClause[] {
  let manifests: readonly AddonManifest[] = [];
  try {
    manifests = facts.addons.list();
    if (!Array.isArray(manifests)) return [];
  } catch {
    return [];
  }
  const out: PrivacyClause[] = [];
  for (const manifest of manifests) {
    try {
      if (!facts.activeAddons.has(manifest.slug)) continue;
      const raw: unknown = manifest.privacyClauses;
      if (raw === undefined) continue;
      if (!Array.isArray(raw)) continue;
      const picked: PrivacyClause[] = [];
      const ids = new Set<string>();
      for (const entry of raw as unknown[]) {
        if (privacyClauseProblem(entry) !== null) throw new Error("invalid");
        const c = entry as PrivacyClause;
        if (taken.has(c.id) || ids.has(c.id)) throw new Error("duplicate");
        ids.add(c.id);
        picked.push({
          id: c.id,
          heading: c.heading,
          what: c.what,
          why: c.why,
          howLong: c.howLong,
        });
      }
      for (const c of picked) {
        taken.add(c.id);
        out.push(c);
      }
    } catch (err) {
      // Optional contribution: dropped, never breaking the page (PATTERNS registry read).
      // WR-B06: but never silently, since the page then understates what the site collects.
      let slug = "?";
      try {
        slug = String(manifest.slug);
      } catch {
        // a throwing getter; keep "?"
      }
      console.error(
        "[legal] privacy clauses dropped",
        slug,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return out;
}

/**
 * Render one tenant policy page for an explicit template version (CONTEXT A5-Q4: the version
 * the owner acknowledged keeps rendering after CDS publishes a newer one). Throws InvalidInput
 * for an unknown version, a blank legal name, or a privacy contact that is not an email.
 */
export function renderSitePolicy(
  page: SitePolicyPage,
  facts: SitePolicyFacts,
  templateVersion: number,
  templates?: readonly SitePolicyTemplate[],
): RenderedSitePolicy {
  const tpl = templatesOrDefault(templates).find(
    (t) => t.page === page && t.version === templateVersion,
  );
  if (!tpl) {
    throw new InvalidInput(
      `Unknown site policy template: ${String(page)} v${String(templateVersion)}`,
    );
  }
  const legalName = String(facts.legalName ?? "").trim();
  const privacyContact = String(facts.privacyContact ?? "").trim();
  if (legalName === "") throw new InvalidInput("Legal name is required.");
  if (privacyContact === "") {
    throw new InvalidInput("Privacy contact is required.");
  }
  if (privacyContact.length > 254 || !EMAIL_RE.test(privacyContact)) {
    throw new InvalidInput("Privacy contact must be an email address.");
  }
  const businessName = String(facts.businessName ?? "").trim() || legalName;
  const legalRegion =
    String(facts.legalRegion ?? "").trim() || "the place where we are based";
  const vars = {
    legal_name: legalName,
    business_name: businessName,
    privacy_contact: privacyContact,
    legal_region: legalRegion,
  };

  const clauses: PrivacyClause[] = [];
  if (page === "privacy") {
    for (const c of CORE_PRIVACY_CLAUSES) {
      if (c.when(facts)) clauses.push(c);
    }
    clauses.push(
      ...addonClauses(facts, new Set(CORE_PRIVACY_CLAUSES.map((c) => c.id))),
    );
  }

  const lines = tpl.bodyMd.split("\n");
  const at = lines.indexOf(CLAUSES_LINE);
  let body: string;
  if (at >= 0) {
    const before = renderLegalMarkdown(lines.slice(0, at).join("\n"), { vars });
    const after = renderLegalMarkdown(lines.slice(at + 1).join("\n"), {
      vars,
    });
    body = before + clauses.map(clauseHtml).join("") + after;
  } else {
    body = renderLegalMarkdown(tpl.bodyMd, { vars });
  }
  const draftBox = tpl.draft
    ? `<div role="note" data-policy-draft=""><p>${escapeHtml(SITE_POLICY_DRAFT_TEXT)}</p></div>`
    : "";

  return {
    page: tpl.page,
    templateVersion: tpl.version,
    title: tpl.title,
    html: draftBox + body,
    clauseIds: Object.freeze(clauses.map((c) => c.id)),
    coveredLabels: Object.freeze(clauses.map((c) => c.heading)),
    draft: tpl.draft,
  };
}
