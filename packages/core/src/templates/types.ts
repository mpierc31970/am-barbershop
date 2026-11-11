// The site-template slot contract (TMPL-01, TMPL-03; CONTEXT A1-Q1/Q2; RESEARCH Pattern 1,
// R-1). Pure types: @cds/templates fills them, @cds/db runs them with templates injected.
// No React, no PocketBase, no db type: AssemblyIntake is declared here from structural core
// types so both @cds/templates and @cds/db can import it without a workspace cycle.
import type { AddonPath } from "../addons/constants";
import type { AddonManifest } from "../addons/types";
import type { PresetBlock } from "../content/presets";
import type { ServiceInput, TeamMemberInput } from "../intake";
import type { QuoteSelections } from "../pricing";
import type { MoodboardProposal } from "../theme";

/** One intake field with its fallback already applied (ONB-03, CONTEXT A3-Q3). */
export type AssembledValue<T> = {
  value: T;
  source: "provided" | "fallback";
};

/**
 * A live media asset as the template sees it. `alt` is the owner's intake description;
 * `alt_reviewed` is true when that description is non-empty (CONTEXT A3-Q5, A4-Q2).
 * Snake_case on purpose: the same key the gallery block item uses (`GalleryImage.alt_reviewed`).
 */
export type AssemblyMediaRef = {
  id: string;
  alt: string;
  alt_reviewed: boolean;
};

/** A service row, structurally identical to the db package's `Service`. */
export type AssemblyService = ServiceInput & { id: string; sortOrder: number };

/** A team member row, structurally identical to the db package's `TeamMember`. */
export type AssemblyTeamMember = TeamMemberInput & {
  id: string;
  sortOrder: number;
  photoId: string | null;
};

/** Add-on intake config by slug (the db package's `AddonIntakeConfig` is assignable). */
export type AssemblyAddonConfig = Readonly<
  Record<
    string,
    {
      fields: Record<string, unknown>;
      records: readonly Record<string, unknown>[];
      /** Stable per-record keys (db keeps them aligned with `records`). */
      keys?: readonly string[];
    }
  >
>;

/** Everything the build reads about one org, fallbacks applied (ONB-03, R-1). */
export type AssemblyIntake = {
  orgId: string;
  path: string;
  fields: Record<string, AssembledValue<unknown>>;
  team: readonly AssemblyTeamMember[];
  services: readonly AssemblyService[];
  /** Live media only (removed rows never appear), in display order. */
  media: {
    logo: AssemblyMediaRef | null;
    hero: AssemblyMediaRef | null;
    gallery: readonly AssemblyMediaRef[];
  };
  addonConfig: AssemblyAddonConfig;
  selections: QuoteSelections;
  moodboardProposal: MoodboardProposal | null;
};

/**
 * What an add-on's `templateSlots[].content()` receives (invariant 4; 08-REVIEW WR-B04):
 * org context plus this add-on's own slice of the intake only. `fields` holds the core
 * intake fields and this add-on's own `addon_<slug>_*` fields, never another add-on's;
 * `addonConfig` is this add-on's own intake config (null when it has none). No team,
 * services, selections or moodboard.
 */
export type TemplateSlotInput = {
  orgId: string;
  path: string;
  fields: Readonly<Record<string, AssembledValue<unknown>>>;
  addonConfig: AssemblyAddonConfig[string] | null;
};

/**
 * A typed, already-parsed view of the intake (the parser `readFacts` lives in
 * @cds/templates, 08-12). Strings are "" when absent. Keep this shape stable.
 */
export type AssemblyFacts = {
  businessName: string;
  businessTypeId: string;
  businessTypeLabel: string;
  copyGroup?: string;
  tagline: string;
  headline: string;
  about: string;
  mission: string;
  city: string;
  street: string;
  serviceArea: string;
  phone: string;
  email: string;
  hasHours: boolean;
  hasAddress: boolean;
  heroAsset: AssemblyMediaRef | null;
  logoAsset: AssemblyMediaRef | null;
  galleryAssets: readonly AssemblyMediaRef[];
  /** Published services only. */
  services: readonly AssemblyService[];
  /** Published team members only. */
  team: readonly AssemblyTeamMember[];
  fieldSources: Readonly<Record<string, "provided" | "fallback">>;
};

/** Fixed-wording copy (the stand-in `templateCopy` is 08-06; AI polish is GO-LIVE). */
export interface CopyWriter {
  heroSubtitle(f: AssemblyFacts): string;
  introHeading(f: AssemblyFacts): string;
  servicesHeading(f: AssemblyFacts): string;
  closingCta(f: AssemblyFacts): { heading: string; line: string };
  faqAnswer(
    question: string,
    f: AssemblyFacts,
    placed: ReadonlySet<string>,
  ): string;
}

export type SlotSource = "provided" | "fallback" | "omitted";
export type Band = "main" | "alternate";

export type SlotResult = {
  blocks: readonly PresetBlock[];
  source: SlotSource;
  note?: string;
  polish?: readonly string[];
  /**
   * Media asset ids this slot placed whose `alt_reviewed` is false. Slots never write the
   * photo polish line themselves: the orchestrator collects these across pages, dedupes by
   * asset id and emits one `photoPolishLine` (CONTEXT A4-Q2).
   */
  unreviewedAlt?: readonly string[];
};

export type SlotEnv = {
  templateId: string;
  pageKey: string;
  activeAddons: ReadonlySet<string>;
  /** Structural, so tests pass a stub (08-07 adds `templateSlots` to AddonManifest). */
  addons: { list(): readonly AddonManifest[] };
  copy: CopyWriter;
  /**
   * `contactFormId` is the live contact form record. `contactFormItemId` is the Columns
   * form item id the Contact slot gives that form on THIS page, minted once per page before
   * any slot runs: the public wrapper id is `form-<itemId>` (07 choice 2), so the hero's
   * "Get in touch" anchor targets it (G1, CR-B01).
   */
  refs: { contactFormId: string; contactFormItemId: string };
  /** Slot names already placed on this site (FAQ answers point at them). */
  placed: ReadonlySet<string>;
  /**
   * Slot names already placed earlier on THIS page (08-14). Page-local rules (one map per
   * page: Contact skips its Map after hours-location) read this; absent = nothing placed
   * on this page yet (never the site-wide `placed`).
   */
  pagePlaced?: ReadonlySet<string>;
};

export type Slot = {
  name: string;
  label: string;
  fill(intake: AssemblyIntake, env: SlotEnv): SlotResult;
};

export type TemplatePage = {
  key: string;
  slug: string;
  title(intake: AssemblyIntake): string;
  navLabel: string;
  inNav: boolean;
  slots: readonly Slot[];
};

export type SiteTemplate = {
  id: string;
  version: number;
  label: string;
  paths: readonly AddonPath[];
  pages: readonly TemplatePage[];
};

/** One page the assembly wrote (CONTEXT A2-Q3). `print` is its content fingerprint. */
export type LedgerPage = {
  id: string;
  slug: string;
  print: string;
  pending?: boolean;
  versionKey?: string;
  published: boolean;
};

export type PageOutcome =
  | "created"
  | "rebuilt"
  | "unchanged"
  | "edited"
  | "deleted"
  | "held"
  | "skipped_existing";

export type SlotReportLine = {
  page: string;
  slot: string;
  source: SlotSource;
  note?: string;
};

/** What staff see after a build (email, CLI, P13 console). */
export type AssemblyReport = {
  templateId: string;
  templateVersion: number;
  slots: readonly SlotReportLine[];
  polish: readonly string[];
  pages: readonly {
    key: string;
    label: string;
    outcome: PageOutcome;
    path: string;
  }[];
};

/** The per-org assembly ledger (CONTEXT A2-Q3; stored JSON is parsed by the db package, 08-11). */
export type AssemblyLedger = {
  template_id: string;
  template_version: number;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  started_at?: string;
  assembled_at?: string;
  error?: { code: string; page?: string };
  form_id?: string;
  failure_emailed?: boolean;
  pages: Readonly<Record<string, LedgerPage>>;
  report?: AssemblyReport;
};
