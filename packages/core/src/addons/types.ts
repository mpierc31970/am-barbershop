// Add-on manifest contract (ADDON-01, ADDON-02, D35, D264; CONTEXT A1-Q2). Pure types.
// A manifest never carries a commercial figure: pricing lives in billing (D264).
import type { AlertTypeSpec } from "../alerts/types";
import type { CollectionSpec } from "../collections";
import type { SectionTypeDefinition } from "../content/registry";
import type { CsvSpec } from "../csv/types";
import type { TrainingEntry } from "../../training/entries";
import type { TemplateSlotInput } from "../templates/types";
import type { TodayCardSpec } from "../today/cards";
import type { AddonPath, NavIconKey, NavTarget } from "./constants";

export type AddonNav =
  | { placement: "tab"; item: NavTarget; label: string; icon: NavIconKey }
  | { placement: "sidebar"; label: string; icon: NavIconKey }
  // 10-07 (BILL-14, D233): a manifest-only add-on with no screen of its own (Builder Pro).
  // The hub tab and sidebar builders skip it; `unlocks` finishes the catalog line "No new
  // screen; it unlocks {unlocks}".
  | { placement: "none"; label: string; icon: NavIconKey; unlocks: string };

export type SeedSection = {
  section_type: string;
  content: Record<string, unknown>;
};

export type InstallRecipe = {
  page?: { slug: string; title: string; sections: readonly SeedSection[] };
  records?: { collection: string };
};

/** Uninstall disables and retains (invariant 9). */
export type UninstallPolicy = { retain: "all" };

export type AddonRecordSpec = {
  singular: string;
  plural: string;
  /** Throws InvalidInput with owner-facing copy. */
  validate(raw: unknown): Record<string, unknown>;
  textsOf(v: Record<string, unknown>): string[];
  urlsOf(v: Record<string, unknown>): string[];
  title(v: Record<string, unknown>): string;
  publishedField: "is_published";
  orderField: "sort_order";
  groupField?: string;
};

/**
 * 13-18 (STAFF-14, D291): one request captured by the fail-safe service and synced into
 * `failsafe_requests`, as the add-on's `convertCapture` sees it. A request, never a booking.
 */
export type FailsafeRequestView = {
  id: string;
  orgId: string;
  addon: string;
  captureId: string;
  name: string;
  email: string;
  phone: string;
  preferred: string;
  message: string;
  /** ISO time the visitor sent it. */
  capturedAt: string;
};

/**
 * The org context `convertCapture` receives: the branded OrgContext minted by @cds/db (core
 * cannot name it). The add-on passes it straight to its own repo (invariant 4).
 */
export type CaptureOrgContext = { readonly orgId: string };

/** `ref` = the record the add-on created; `conflict` = why it could not (D269 check). */
export type CaptureConvertResult = { ref: string } | { conflict: string };

/**
 * D155 fail-safe capture mode: requests are captured off the main server during an outage.
 * A premium add-on that takes no inbound customer requests waives it with a reason.
 * 13-18: a capture (not a waiver) must provide `convertCapture`, which turns one pending
 * request into the add-on's own record after running its own conflict check.
 */
export type PremiumCaptureMode =
  | {
      description: string;
      testedBy: string;
      convertCapture?: (
        ctx: CaptureOrgContext,
        request: FailsafeRequestView,
      ) => Promise<CaptureConvertResult>;
      /** The add-on's own "Pending requests" view id (v1.1). */
      pendingRequestsSection?: string;
    }
  | { waived: string };

/** Premium add-on standard (ADDON-15, D154, D155, D156). */
export type PremiumSpec = {
  healthChecks: readonly { id: string; description: string }[];
  /** Off-server backups are required (D154): `offsite` must be true. */
  backups: { collections: readonly string[]; offsite: boolean };
  /** One tested fallback per entry of the manifest's externalDependencies (D156). */
  dependencies: Readonly<
    Record<string, { fallback: string; testedBy: string }>
  >;
  /**
   * Explicit acknowledgement that the add-on relies on no external service. Without it a
   * premium manifest must list at least one externalDependencies entry (A-WR-07).
   */
  noExternalDependencies?: true;
  captureMode: PremiumCaptureMode;
  /** Must equal docs/runbooks/<slug>.md and exist. */
  runbook: string;
};

/**
 * One owner-facing intake field an add-on contributes (CONTEXT A3-Q5). Every add-on intake
 * field is optional to the owner, so it always carries a fallback (ONB-03).
 */
export type AddonIntakeField = {
  id: string;
  label: string;
  kind: "text" | "textarea" | "url" | "switch";
  max?: number;
  helper: string;
  fallback: string;
};

/**
 * An add-on's intake contribution (CONTEXT A3-Q5, RESEARCH Pattern 7). `records` names one
 * of the add-on's own record collections (and optionally its own CSV spec) that the intake
 * "People & proof" stage collects. Intake never writes add-on collections (invariant 3):
 * collected rows are held on the intake record until the add-on is installed.
 */
export type AddonIntake = {
  fields?: readonly AddonIntakeField[];
  records?: {
    collection: string;
    csv?: string;
    label: string;
    addOneLabel: string;
  };
};

/**
 * An email type an add-on sends (EMAIL-01, D267). The type is prefixed `<slug>.` and every
 * type is classed, so suppression rules always know whether it is transactional or marketing.
 */
export type AddonEmailSpec = {
  type: string;
  class: "transactional" | "marketing";
  description: string;
};

/** 11-08 (DASH-21): the manifest's Today element. */
export type AddonToday = { card?: TodayCardSpec; needsYou?: true };

/**
 * P14 (14-39; LIFE-01, D282, P14-P28): one thing this add-on settles when a site leaves CDS
 * (gift-card balances, future bookings, open orders, memberships). Data only: the Leaving CDS
 * checklist lists it; `notApplicable` is the line shown while nothing needs settling (every
 * v1.0 add-on).
 */
export type AddonOffboardingItem = {
  /** `^[a-z0-9_-]{2,40}$`, unique within the manifest. */
  key: string;
  label: string;
  notApplicable: string;
};

/** P14 (14-39): the manifest's optional Leaving CDS contribution (data only). */
export type AddonOffboarding = { items: readonly AddonOffboardingItem[] };

export type AddonManifest = {
  slug: string;
  name: string;
  summary: string;
  category: string;
  version: string;
  order: number;
  visibility: "public" | "private";
  paths: readonly AddonPath[];
  requires: readonly string[];
  conflicts: readonly string[];
  externalDependencies?: readonly string[];
  nav: AddonNav;
  sections: readonly SectionTypeDefinition[];
  collections: Readonly<Record<string, CollectionSpec>>;
  records: Readonly<Record<string, AddonRecordSpec>>;
  install: InstallRecipe;
  uninstall: UninstallPolicy;
  training: readonly TrainingEntry[];
  /**
   * 11-08 (DASH-21): what this add-on adds to Today. `card` is its one Today card (id unique,
   * never a core card id); `needsYou` says its server module exports `today.needsYou`. The
   * server entry must export `today.card` when `card` is set (registry contract test).
   */
  today?: AddonToday;
  /**
   * 11-08 (DASH-35, T-11-08-02): alert types this add-on raises. Each type is `<slug>.`-prefixed
   * and its feature is `addon:<slug>`, so it can never pose as a core or billing alert.
   * Merged after the core types by composeAlertTypes.
   */
  alerts?: readonly AlertTypeSpec[];
  csv?: Readonly<Record<string, CsvSpec>>;
  settingsSchema?: Readonly<Record<string, unknown>>;
  premium?: PremiumSpec;
  /**
   * P14 (14-39; LIFE-01, P14-P28): what this add-on settles when the site leaves CDS. Data
   * only; `@cds/db` receives manifests from the caller and never imports the registry.
   */
  offboarding?: AddonOffboarding;
  intake?: AddonIntake;
  emails?: readonly AddonEmailSpec[];
  /**
   * 07-30 (CONT-13): JSON-LD nodes for a page while this add-on is active. Called by the tenant
   * route through the registry only; nodes are sanitized by `sanitizeAddonNodes` (type, depth,
   * size, count) before they reach the page. Never import another add-on.
   */
  jsonLd?: (input: {
    pageUrl: string;
    origin: string;
    data: Readonly<Record<string, unknown>>;
  }) => readonly unknown[];
  /**
   * 07-31 (CONT-37, D277): site-index records while this add-on is active. `records` = this
   * add-on's own collections, public fields only, published and not held. Output is sanitized
   * by `sanitizeIndexRecords` (`{ kind, group, title, text, path, lastmod? }`, at most 200) and
   * kept only when its path is an indexable page. Never import another add-on (invariant 4).
   */
  publicIndex?: (input: {
    records: Readonly<
      Record<string, readonly Readonly<Record<string, unknown>>[]>
    >;
  }) => readonly unknown[];
  /**
   * P8 (08-07, CONTEXT A1-Q4): blocks this add-on contributes to named template slots (e.g.
   * `proof`) when it is already active for the org. Read by the assembly provisioner through the
   * registry only; never installs anything (invariant 3) and never imports another add-on
   * (invariant 4). `section_type` must be one of this add-on's own sections.
   */
  templateSlots?: readonly TemplateSlotContribution[];
  /**
   * P9 (AGR-08, D217): what this add-on collects, why and how long; read through the registry
   * by @cds/core/legal renderSitePolicy for the tenant's Privacy policy page while the add-on is
   * active. Plain text (no `<`, `>` or `{{`), escaped at render; validated by defineAddon. Never
   * imports another add-on (invariant 4).
   */
  privacyClauses?: readonly PrivacyClause[];
};

/** One privacy clause an add-on contributes to the tenant Privacy policy (09-11, CONTEXT A5-Q1). */
export type PrivacyClause = {
  /** `^[a-z0-9-]{2,40}$`, unique within the manifest. */
  id: string;
  /** Rendered as an `<h3>`; at most 80 characters. */
  heading: string;
  /** What is collected; at most 400 characters. */
  what: string;
  /** Why; at most 400 characters. */
  why: string;
  /** How long it is kept; at most 400 characters. */
  howLong: string;
};

/** One block an add-on contributes to a named template slot (08-07, CONTEXT A1-Q4). */
export type TemplateSlotContribution = {
  slot: string;
  /** Page key the slot sits on (e.g. "home", "about"); absent = any page with that slot. */
  page?: string;
  section_type: string;
  /** Org context plus this add-on's own intake slice only (invariant 4, WR-B04). */
  content(input: TemplateSlotInput): unknown;
};

export type AddonRegistry = {
  /** Sorted by order, then slug. */
  list(): readonly AddonManifest[];
  /** Visibility "public" only (ADDON-09, D21). */
  publicList(): readonly AddonManifest[];
  /** Non-string -> undefined; own-property lookup only. */
  get(slug: unknown): AddonManifest | undefined;
  /** Every add-on section type, manifest order. */
  sections(): readonly SectionTypeDefinition[];
  ownerOf(sectionType: unknown): string | undefined;
  /** Add-ons whose requires lists slug. */
  dependentsOf(slug: string): readonly string[];
  /** Symmetric closure of conflicts. */
  conflictsOf(slug: string): readonly string[];
};

export type ComposeOptions = {
  /** Defaults to CORE_SECTIONS. */
  coreSections?: readonly SectionTypeDefinition[];
  fileExists(repoRelativePath: string): boolean;
};
