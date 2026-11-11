// composeAddonRegistry: every build-time refusal for add-on manifests (ADDON-07, ADDON-09,
// ADDON-15; D21, D154, D156; CONTEXT A3-Q1, A3-Q4; invariants 4 and 5). Pure and Edge-safe.
//
// A mistaken manifest must never ship: compose runs at build/test time and throws
// AddonManifestError naming the slug and the rule. Checks: shape, duplicate slug, unknown or
// self requires/conflicts, a slug both required and conflicting, requires cycles, section
// types not prefixed by the slug or colliding with core/another add-on, missing training or
// how-to file, unknown nav target, a collection claiming a non-add-on permission feature,
// and the premium standard (health checks, offsite backups, a declared dependency list with
// a tested fallback per entry, a D155 capture mode or waiver, docs/runbooks/<slug>.md),
// intake contributions naming only the add-on's own records/csv (CONTEXT A3-Q5; intake never
// writes add-on collections, invariant 3) and slug-prefixed, classed email types (EMAIL-01,
// D267). 11-08: the Today element (a card with an id and title, never a core card id or a
// duplicate; needsYou only `true`) and add-on alert types (`<slug>.`-prefixed, feature
// `addon:<slug>`, a known level/access/section, unique across core and every add-on;
// DASH-21, DASH-35, T-11-08-02). Whether the server entry exports `today.card` is checked by
// the registry contract test: core never imports add-on server modules.
import { ALERT_LEVELS } from "../alerts/types";
import { CORE_ALERT_TYPES } from "../alerts/registry";
import { CdsError } from "../errors";
import { CORE_CARD_IDS } from "../today/cards";
import {
  CORE_SECTIONS,
  composeSectionRegistry,
  type SectionTypeDefinition,
} from "../content/registry";
import { NAV_TARGETS } from "./constants";
import { assertManifestShape } from "./define";
import { AddonManifestError } from "./errors";
import type { AddonManifest, AddonRegistry, ComposeOptions } from "./types";

function refuse(slug: string, rule: string): never {
  throw new AddonManifestError(`add-on "${slug}": ${rule}`);
}

const hasOwn = (o: object, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

function blank(v: unknown): boolean {
  return typeof v !== "string" || v.trim() === "";
}

function checkGraph(bySlug: Map<string, AddonManifest>): void {
  for (const m of bySlug.values()) {
    for (const r of m.requires) {
      if (r === m.slug) refuse(m.slug, "requires itself");
      if (!bySlug.has(r)) refuse(m.slug, `requires unknown add-on "${r}"`);
    }
    for (const c of m.conflicts) {
      if (c === m.slug) refuse(m.slug, "conflicts with itself");
      if (!bySlug.has(c))
        refuse(m.slug, `conflicts lists unknown add-on "${c}"`);
      if (m.requires.includes(c)) {
        refuse(m.slug, `"${c}" is in both requires and conflicts`);
      }
    }
  }
  // Plain DFS over requires (RESEARCH "No Analog Found").
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (slug: string, trail: string[]): void => {
    if (visited.has(slug)) return;
    if (visiting.has(slug)) {
      refuse(slug, `requires cycle: ${[...trail, slug].join(" -> ")}`);
    }
    visiting.add(slug);
    for (const r of bySlug.get(slug)?.requires ?? [])
      visit(r, [...trail, slug]);
    visiting.delete(slug);
    visited.add(slug);
  };
  for (const slug of bySlug.keys()) visit(slug, []);
}

function checkSections(
  manifests: readonly AddonManifest[],
  core: readonly SectionTypeDefinition[],
): void {
  const seen: SectionTypeDefinition[] = [];
  for (const m of manifests) {
    for (const def of m.sections) {
      const type = def?.type;
      if (
        typeof type !== "string" ||
        (type !== m.slug && !type.startsWith(m.slug + "-"))
      ) {
        refuse(
          m.slug,
          `section type "${String(type)}" must be prefixed by the slug (invariant 5)`,
        );
      }
    }
    try {
      composeSectionRegistry(core, [...seen, ...m.sections]);
    } catch (e) {
      if (e instanceof CdsError) refuse(m.slug, `section: ${e.message}`);
      throw e;
    }
    seen.push(...m.sections);
  }
}

/**
 * WR-B06 (D217): privacy clause ids are unique across add-ons (core ids are refused in
 * defineAddon). The renderer drops a whole add-on's clauses on a collision, which would
 * leave the live /privacy page understating what the site collects.
 */
function checkPrivacyClauseIds(list: readonly AddonManifest[]): void {
  const owner = new Map<string, string>();
  for (const m of list) {
    for (const c of m.privacyClauses ?? []) {
      const prev = owner.get(c.id);
      if (prev !== undefined && prev !== m.slug) {
        refuse(m.slug, `privacy clause id "${c.id}" is also used by "${prev}"`);
      }
      owner.set(c.id, m.slug);
    }
  }
}

function checkOwn(m: AddonManifest, opts: ComposeOptions): void {
  checkIntake(m);
  checkEmails(m);
  checkToday(m);
  checkAlerts(m);
  if (m.training.length === 0) {
    refuse(
      m.slug,
      "training is empty (invariant 4: teachable before complete)",
    );
  }
  for (const t of m.training) {
    if (blank(t?.howTo) || !opts.fileExists(t.howTo)) {
      refuse(m.slug, `training how-to ${String(t?.howTo)} does not exist`);
    }
  }
  if (
    m.nav.placement === "tab" &&
    !(NAV_TARGETS as readonly string[]).includes(m.nav.item)
  ) {
    refuse(
      m.slug,
      `nav.item "${String(m.nav.item)}" is not a known nav target`,
    );
  }
  const feature = `addon:${m.slug}`;
  for (const [name, spec] of Object.entries(m.collections)) {
    if (spec?.feature !== feature) {
      refuse(m.slug, `collection ${name} feature must be "${feature}"`);
    }
    // Visitors read a public collection filtered on is_published and sorted by sort_order
    // (readPublicAddonRecords): it needs record rules and both fields (A-WR-09).
    if (Array.isArray(spec.public) && spec.public.length > 0) {
      if (!hasOwn(m.records, name)) {
        refuse(m.slug, `public collection ${name} needs record rules`);
      }
      const exported: readonly string[] = Array.isArray(spec.export)
        ? spec.export
        : [];
      for (const field of ["is_published", "sort_order"]) {
        if (!exported.includes(field)) {
          refuse(m.slug, `public collection ${name} must export ${field}`);
        }
      }
    }
  }
}

const INTAKE_FIELD_ID = /^[a-z][a-z0-9_]{1,39}$/;
const INTAKE_FIELD_KINDS: readonly string[] = [
  "text",
  "textarea",
  "url",
  "switch",
];

/**
 * An add-on's intake contribution (CONTEXT A3-Q5, RESEARCH Pattern 7, invariant 4, T-06-07):
 * it may only name its own record collection and its own CSV spec, and every field has a
 * unique id, a helper and a fallback (ONB-03). Intake never writes add-on collections
 * (invariant 3); that is enforced where intake records are saved.
 */
function checkIntake(m: AddonManifest): void {
  const intake = m.intake;
  if (intake === undefined) return;
  if (typeof intake !== "object" || intake === null) {
    refuse(m.slug, "intake must be an object");
  }
  const rec = intake.records;
  if (rec !== undefined) {
    if (blank(rec?.collection) || !hasOwn(m.records, rec.collection)) {
      refuse(
        m.slug,
        `intake records collection "${String(rec?.collection)}" is not one of its own records`,
      );
    }
    if (
      rec.csv !== undefined &&
      (blank(rec.csv) || !hasOwn(m.csv ?? {}, rec.csv))
    ) {
      refuse(
        m.slug,
        `intake records csv "${String(rec.csv)}" is not one of its own csv specs`,
      );
    }
    if (blank(rec.label) || blank(rec.addOneLabel)) {
      refuse(m.slug, "intake records need a label and an addOneLabel");
    }
  }
  const fields = intake.fields;
  if (fields === undefined) return;
  if (!Array.isArray(fields)) refuse(m.slug, "intake fields must be a list");
  const ids = new Set<string>();
  for (const f of fields) {
    const id = f?.id;
    if (typeof id !== "string" || !INTAKE_FIELD_ID.test(id)) {
      refuse(m.slug, `intake field id "${String(id)}" is not a valid id`);
    }
    if (ids.has(id)) refuse(m.slug, `intake field id "${id}" is duplicated`);
    ids.add(id);
    if (!INTAKE_FIELD_KINDS.includes(f.kind)) {
      refuse(m.slug, `intake field ${id} has unknown kind "${String(f.kind)}"`);
    }
    if (blank(f.label)) refuse(m.slug, `intake field ${id} needs a label`);
    if (blank(f.helper)) refuse(m.slug, `intake field ${id} needs a helper`);
    if (blank(f.fallback)) {
      refuse(m.slug, `intake field ${id} needs a fallback (ONB-03)`);
    }
  }
}

/**
 * Email types an add-on sends (EMAIL-01, D267, T-06-08): prefixed `<slug>.`, classed
 * transactional or marketing, described, and unique.
 */
function checkEmails(m: AddonManifest): void {
  const emails = m.emails;
  if (emails === undefined) return;
  if (!Array.isArray(emails)) refuse(m.slug, "emails must be a list");
  const seen = new Set<string>();
  for (const e of emails) {
    const type = e?.type;
    if (
      typeof type !== "string" ||
      !type.startsWith(`${m.slug}.`) ||
      type.length <= m.slug.length + 1
    ) {
      refuse(
        m.slug,
        `email type "${String(type)}" must be prefixed "${m.slug}." (EMAIL-01)`,
      );
    }
    if (seen.has(type)) refuse(m.slug, `email type "${type}" is duplicated`);
    seen.add(type);
    if (e.class !== "transactional" && e.class !== "marketing") {
      refuse(
        m.slug,
        `email type "${type}" class "${String(e.class)}" must be transactional or marketing (D267)`,
      );
    }
    if (blank(e.description)) {
      refuse(m.slug, `email type "${type}" needs a description`);
    }
  }
}

/** 11-08 (DASH-21): one card with an id and a title; needsYou is only ever `true`. */
function checkToday(m: AddonManifest): void {
  const today: unknown = m.today;
  if (today === undefined) return;
  if (typeof today !== "object" || today === null || Array.isArray(today)) {
    refuse(m.slug, "today must be an object");
  }
  const t = today as Record<string, unknown>;
  if (t.card !== undefined) {
    const card = t.card as Record<string, unknown> | null;
    if (typeof card !== "object" || card === null) {
      refuse(m.slug, "today.card must be an object");
    }
    if (blank(card.id) || blank(card.title)) {
      refuse(m.slug, "today.card needs a non-empty id and title");
    }
    if (CORE_CARD_IDS.includes(card.id as string)) {
      refuse(m.slug, `today.card id "${String(card.id)}" is a core card id`);
    }
  }
  if (t.needsYou !== undefined && t.needsYou !== true) {
    refuse(m.slug, "today.needsYou must be true when set");
  }
}

/** Hub sections an add-on alert may open: a core item or the add-on's own screen. */
const ALERT_CORE_SECTIONS: readonly string[] = [
  "today",
  "inbox",
  "website",
  "marketing",
  "reports",
  "settings",
  "addons",
  "help",
  "support",
];
/** The actions can() grants on an addon:<slug> feature (permissions ADDON_ACTIONS). */
const ALERT_ACCESS: readonly string[] = ["read", "write"];

/** 11-08 (DASH-35, T-11-08-02): add-on alert types cannot pose as core or billing types. */
function checkAlerts(m: AddonManifest): void {
  const alerts: unknown = m.alerts;
  if (alerts === undefined) return;
  if (!Array.isArray(alerts)) refuse(m.slug, "alerts must be a list");
  const feature = `addon:${m.slug}`;
  const seen = new Set<string>();
  for (const raw of alerts) {
    const a = (raw ?? {}) as Record<string, unknown>;
    const type = a.type;
    if (
      typeof type !== "string" ||
      !type.startsWith(`${m.slug}.`) ||
      type.length <= m.slug.length + 1
    ) {
      refuse(
        m.slug,
        `alert type "${String(type)}" must be prefixed "${m.slug}." (DASH-35)`,
      );
    }
    if (seen.has(type)) refuse(m.slug, `alert type "${type}" is duplicated`);
    seen.add(type);
    if (a.feature !== feature) {
      refuse(m.slug, `alert type "${type}" feature must be "${feature}"`);
    }
    if (!(ALERT_LEVELS as readonly unknown[]).includes(a.level)) {
      refuse(
        m.slug,
        `alert type "${type}" has unknown level "${String(a.level)}"`,
      );
    }
    if (!ALERT_ACCESS.includes(a.access as string)) {
      refuse(
        m.slug,
        `alert type "${type}" access must be read or write, not "${String(a.access)}"`,
      );
    }
    if (
      typeof a.section !== "string" ||
      (!ALERT_CORE_SECTIONS.includes(a.section) && a.section !== feature)
    ) {
      refuse(
        m.slug,
        `alert type "${type}" section "${String(a.section)}" must be a hub section or "${feature}"`,
      );
    }
    if (blank(a.label) || blank(a.example)) {
      refuse(m.slug, `alert type "${type}" needs a label and an example`);
    }
    const ch = a.defaultChannels as Record<string, unknown> | null | undefined;
    if (
      typeof ch !== "object" ||
      ch === null ||
      typeof ch.email !== "boolean" ||
      typeof ch.push !== "boolean"
    ) {
      refuse(
        m.slug,
        `alert type "${type}" needs defaultChannels email and push`,
      );
    }
  }
}

/** Card ids and alert types are unique across core and every add-on (composeAlertTypes). */
function checkCrossToday(list: readonly AddonManifest[]): void {
  const cards = new Map<string, string>();
  const types = new Map<string, string>(
    CORE_ALERT_TYPES.map((t) => [t.type, "core"]),
  );
  for (const m of list) {
    const id = m.today?.card?.id;
    if (id !== undefined) {
      const prev = cards.get(id);
      if (prev !== undefined) {
        refuse(m.slug, `today.card id "${id}" is also used by "${prev}"`);
      }
      cards.set(id, m.slug);
    }
    for (const a of m.alerts ?? []) {
      const prev = types.get(a.type);
      if (prev !== undefined) {
        refuse(m.slug, `alert type "${a.type}" is already defined by ${prev}`);
      }
      types.set(a.type, m.slug);
    }
  }
}

function checkPremium(m: AddonManifest, opts: ComposeOptions): void {
  const p = m.premium;
  if (p === undefined) return;
  if (!Array.isArray(p.healthChecks) || p.healthChecks.length === 0) {
    refuse(m.slug, "premium health checks are empty (D154)");
  }
  const cols = p.backups?.collections;
  if (!Array.isArray(cols) || cols.length === 0) {
    refuse(m.slug, "premium backups list no collections (D154)");
  }
  for (const c of cols) {
    if (!hasOwn(m.collections, c)) {
      refuse(m.slug, `premium backups name undeclared collection ${c}`);
    }
  }
  if (p.backups?.offsite !== true) {
    refuse(m.slug, "premium backups must be offsite (D154)");
  }
  // A premium add-on cannot pass by omitting its dependency list (A-WR-07, D156).
  const external = m.externalDependencies;
  if (!Array.isArray(external)) {
    refuse(m.slug, "premium add-ons must list externalDependencies (D156)");
  }
  if (external.length === 0 && p.noExternalDependencies !== true) {
    refuse(
      m.slug,
      "externalDependencies is empty: set premium.noExternalDependencies to confirm (D156)",
    );
  }
  if (external.length > 0 && p.noExternalDependencies === true) {
    refuse(
      m.slug,
      "noExternalDependencies contradicts the externalDependencies list",
    );
  }
  const deps = p.dependencies ?? {};
  for (const dep of Object.keys(deps)) {
    if (!external.includes(dep)) {
      refuse(
        m.slug,
        `dependency ${dep} is not declared in externalDependencies`,
      );
    }
  }
  const capture = p.captureMode as Record<string, unknown> | undefined;
  if (typeof capture !== "object" || capture === null) {
    refuse(m.slug, "premium captureMode is missing (D155)");
  }
  if (hasOwn(capture, "waived")) {
    if (blank(capture.waived)) {
      refuse(m.slug, "captureMode waiver needs a reason (D155)");
    }
  } else if (blank(capture.description) || blank(capture.testedBy)) {
    refuse(m.slug, "captureMode needs a description and testedBy (D155)");
  } else if (typeof capture.convertCapture !== "function") {
    // 13-18 (STAFF-14): a captured request must convert in one click (D291).
    refuse(m.slug, "captureMode needs a convertCapture hook (D291)");
  }
  for (const dep of external) {
    if (!hasOwn(deps, dep)) {
      refuse(m.slug, `external dependency ${dep} has no fallback (D156)`);
    }
    const d = deps[dep]!;
    if (blank(d?.fallback))
      refuse(m.slug, `dependency ${dep} fallback is empty`);
    if (blank(d?.testedBy))
      refuse(m.slug, `dependency ${dep} testedBy is empty`);
  }
  const runbook = `docs/runbooks/${m.slug}.md`;
  if (p.runbook !== runbook)
    refuse(m.slug, `premium runbook must be ${runbook}`);
  if (!opts.fileExists(runbook))
    refuse(m.slug, `premium runbook ${runbook} is missing`);
}

export function composeAddonRegistry(
  manifests: readonly AddonManifest[],
  opts: ComposeOptions,
): AddonRegistry {
  const bySlug = new Map<string, AddonManifest>();
  for (const m of manifests) {
    assertManifestShape(m);
    if (bySlug.has(m.slug)) refuse(m.slug, "duplicate slug");
    bySlug.set(m.slug, m);
  }
  checkGraph(bySlug);

  const list = Object.freeze(
    [...manifests].sort(
      (a, b) =>
        a.order - b.order || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    ),
  );
  checkSections(list, opts.coreSections ?? CORE_SECTIONS);
  checkPrivacyClauseIds(list);
  for (const m of list) {
    checkOwn(m, opts);
    checkPremium(m, opts);
  }
  checkCrossToday(list);

  const record: Record<string, AddonManifest> = Object.create(null);
  const owners: Record<string, string> = Object.create(null);
  const conflicts: Record<string, string[]> = Object.create(null);
  const dependents: Record<string, string[]> = Object.create(null);
  for (const m of list) {
    record[m.slug] = m;
    for (const s of m.sections) owners[s.type] = m.slug;
    for (const r of m.requires) (dependents[r] ??= []).push(m.slug);
    for (const c of m.conflicts) {
      (conflicts[m.slug] ??= []).push(c);
      (conflicts[c] ??= []).push(m.slug);
    }
  }
  const lookup = <T>(o: Record<string, T>, k: unknown): T | undefined =>
    typeof k === "string" && hasOwn(o, k) ? o[k] : undefined;

  const publicList = Object.freeze(
    list.filter((m) => m.visibility === "public"),
  );
  const sections = Object.freeze(list.flatMap((m) => m.sections));

  return Object.freeze({
    list: () => list,
    publicList: () => publicList,
    get: (slug: unknown) => lookup(record, slug),
    sections: () => sections,
    ownerOf: (type: unknown) => lookup(owners, type),
    dependentsOf: (slug: string) => [...(lookup(dependents, slug) ?? [])],
    conflictsOf: (slug: string) => [...new Set(lookup(conflicts, slug) ?? [])],
  });
}
