// defineAddon: identity plus a shallow shape assert (ADDON-01). Pure and Edge-safe.
import {
  ADDON_PATHS,
  ADDON_SLUG_RE,
  CORE_PRIVACY_CLAUSE_IDS,
  NAV_ICON_KEYS,
  RESERVED_ADDON_SLUGS,
} from "./constants";
import { CORE_ENTITLEMENTS } from "../payments/entitlements";
import { AddonManifestError } from "./errors";
import type { AddonManifest } from "./types";

function fail(slug: unknown, field: string, rule: string): never {
  throw new AddonManifestError(
    `add-on "${String(slug).slice(0, 64)}": ${field} ${rule}`,
  );
}

/** Throws AddonManifestError naming the slug and the field. */
export function assertManifestShape(m: AddonManifest): void {
  if (typeof m !== "object" || m === null)
    fail("?", "manifest", "must be an object");
  const slug = m.slug;
  if (typeof slug !== "string" || !ADDON_SLUG_RE.test(slug)) {
    fail(slug, "slug", "must match /^[a-z][a-z0-9-]{1,39}$/");
  }
  if ((RESERVED_ADDON_SLUGS as readonly string[]).includes(slug)) {
    fail(slug, "slug", "is reserved");
  }
  // WR-B03: a core entitlement key (Care Plan, media packs) is never an add-on slug, or
  // installing that add-on would grant the core entitlement without paying for it.
  if ((CORE_ENTITLEMENTS as readonly string[]).includes(slug)) {
    fail(slug, "slug", "is a core entitlement key");
  }
  if (m.visibility !== "public" && m.visibility !== "private") {
    fail(slug, "visibility", 'must be "public" or "private"');
  }
  for (const key of [
    "paths",
    "requires",
    "conflicts",
    "sections",
    "training",
  ] as const) {
    if (!Array.isArray(m[key])) fail(slug, key, "must be an array");
  }
  if (
    m.externalDependencies !== undefined &&
    !Array.isArray(m.externalDependencies)
  ) {
    fail(slug, "externalDependencies", "must be an array");
  }
  for (const p of m.paths) {
    if (!(ADDON_PATHS as readonly string[]).includes(p)) {
      fail(slug, "paths", `has unknown path "${String(p)}"`);
    }
  }
  if (typeof m.nav !== "object" || m.nav === null)
    fail(slug, "nav", "is missing");
  if (
    m.nav.placement !== "tab" &&
    m.nav.placement !== "sidebar" &&
    m.nav.placement !== "none"
  ) {
    fail(slug, "nav.placement", 'must be "tab", "sidebar" or "none"');
  }
  // 10-07: a manifest-only add-on ("none") says what it unlocks, for the catalog line.
  if (
    m.nav.placement === "none" &&
    (typeof m.nav.unlocks !== "string" || m.nav.unlocks.trim() === "")
  ) {
    fail(slug, "nav.unlocks", "must be non-empty text when placement is none");
  }
  if (!(NAV_ICON_KEYS as readonly string[]).includes(m.nav.icon)) {
    fail(slug, "nav.icon", `"${String(m.nav.icon)}" is not a known icon key`);
  }
  for (const key of ["collections", "records", "install"] as const) {
    const v = m[key];
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      fail(slug, key, "must be an object");
    }
  }
  if (m.uninstall?.retain !== "all") {
    fail(slug, "uninstall.retain", 'must be "all" (invariant 9)');
  }
  assertTemplateSlots(m, slug);
  assertPrivacyClauses(m, slug);
}

export const PRIVACY_CLAUSE_ID_RE = /^[a-z0-9-]{2,40}$/;
export const PRIVACY_HEADING_MAX = 80;
export const PRIVACY_TEXT_MAX = 400;
const PRIVACY_FORBIDDEN_RE = /[<>]|\{\{/;

/** Problem with one clause, or null when valid (shared with the renderer's defensive re-check). */
export function privacyClauseProblem(
  entry: unknown,
): { field: string; rule: string } | null {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return { field: "", rule: "must be an object" };
  }
  const c = entry as Record<string, unknown>;
  if (typeof c.id !== "string" || !PRIVACY_CLAUSE_ID_RE.test(c.id)) {
    return { field: ".id", rule: "must match /^[a-z0-9-]{2,40}$/" };
  }
  const limits = [
    ["heading", PRIVACY_HEADING_MAX],
    ["what", PRIVACY_TEXT_MAX],
    ["why", PRIVACY_TEXT_MAX],
    ["howLong", PRIVACY_TEXT_MAX],
  ] as const;
  for (const [key, max] of limits) {
    const v = c[key];
    if (typeof v !== "string" || v.trim() === "") {
      return { field: `.${key}`, rule: "must be non-empty text" };
    }
    if (v.length > max) {
      return { field: `.${key}`, rule: `must be at most ${max} characters` };
    }
    if (PRIVACY_FORBIDDEN_RE.test(v)) {
      return { field: `.${key}`, rule: "must be plain text (no <, > or {{)" };
    }
  }
  return null;
}

/** 09-11 (CONTEXT A5-Q1; T-09-11-02): plain-text clauses with length caps and unique ids. */
function assertPrivacyClauses(m: AddonManifest, slug: string): void {
  const clauses: unknown = m.privacyClauses;
  if (clauses === undefined) return;
  if (!Array.isArray(clauses)) fail(slug, "privacyClauses", "must be an array");
  const seen = new Set<string>();
  clauses.forEach((entry: unknown, i) => {
    const field = `privacyClauses[${i}]`;
    const problem = privacyClauseProblem(entry);
    if (problem) fail(slug, `${field}${problem.field}`, problem.rule);
    const id = (entry as { id: string }).id;
    if (seen.has(id)) fail(slug, `${field}.id`, "is a duplicate");
    // WR-B06: a core id would make the renderer drop this add-on's clauses.
    if ((CORE_PRIVACY_CLAUSE_IDS as readonly string[]).includes(id)) {
      fail(slug, `${field}.id`, `"${id}" is a core privacy clause id`);
    }
    seen.add(id);
  });
}

/** 08-07 (CONTEXT A1-Q4; T-08-07-01): contributions may only use this add-on's own sections. */
function assertTemplateSlots(m: AddonManifest, slug: string): void {
  const slots: unknown = m.templateSlots;
  if (slots === undefined) return;
  if (!Array.isArray(slots)) fail(slug, "templateSlots", "must be an array");
  const own = new Set(m.sections.map((s) => s.type));
  slots.forEach((entry: unknown, i) => {
    const field = `templateSlots[${i}]`;
    if (typeof entry !== "object" || entry === null) {
      fail(slug, field, "must be an object");
    }
    const c = entry as Record<string, unknown>;
    if (typeof c.slot !== "string" || !TEMPLATE_KEY_RE.test(c.slot)) {
      fail(slug, `${field}.slot`, "must match /^[a-z][a-z0-9-]{1,39}$/");
    }
    if (
      c.page !== undefined &&
      (typeof c.page !== "string" || !TEMPLATE_KEY_RE.test(c.page))
    ) {
      fail(slug, `${field}.page`, "must match /^[a-z][a-z0-9-]{1,39}$/");
    }
    if (typeof c.section_type !== "string" || !own.has(c.section_type)) {
      fail(
        slug,
        `${field}.section_type`,
        "must be one of this add-on's own sections",
      );
    }
    if (typeof c.content !== "function") {
      fail(slug, `${field}.content`, "must be a function");
    }
  });
}

const TEMPLATE_KEY_RE = /^[a-z][a-z0-9-]{1,39}$/;

export function defineAddon<const M extends AddonManifest>(m: M): M {
  assertManifestShape(m);
  return m;
}
