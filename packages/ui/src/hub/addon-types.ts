// Add-on panel and block-form contracts (05-06; ADDON-11..14, invariant 4, D120).
// Every list add-on's admin panel (05-07 Testimonials, 05-09 Credentials, and every later
// one) implements AddonPanelProps; the hub route builds `data` on the server and passes
// Server Actions as `actions`. These types never import @cds/db or an add-on: the panel
// gets its data and callbacks as props (invariant 1 stays in the route).
import type { ImportMode, ImportPreview } from "@cds/core/csv";

/**
 * Structural copy of apps/web/lib/action.ts ActionResult<T>, so a Server Action wrapped
 * in runAction can be passed straight in as a panel action.
 */
export type HubActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; field?: string };

/** One "Use" step of an add-on's how-to (D110): where, what to do, what you see. */
export type HowToStepView = {
  screen: string;
  action: string;
  expected: string;
};

/** One owner record as the panel sees it. `held` = saved but held by the content scan. */
export type AddonRecordView = {
  id: string;
  values: Record<string, unknown>;
  held: boolean;
};

export type BackupReason = "before-import" | "manual" | "before-restore";

export type BackupView = {
  id: string;
  reason: BackupReason;
  /** ISO timestamp. */
  createdAt: string;
  /** How many records the backup holds. */
  count: number;
};

export type AddonPanelData = {
  slug: string;
  /** Owner-facing add-on name, e.g. "Testimonials". */
  name: string;
  /** Lower-case record nouns, e.g. "testimonial" / "testimonials". */
  singular: string;
  plural: string;
  collection: string;
  records: AddonRecordView[];
  /**
   * The seeded page: live, deleted by the owner, or none. `inNav` / `navFull` (07-25) drive
   * the page line's "Add to navigation" control.
   */
  page:
    | {
        id: string;
        slug: string;
        url: string | null;
        inNav?: boolean;
        navFull?: boolean;
      }
    | { deleted: true }
    | null;
  trainingTitle: string;
  trainingSteps: HowToStepView[];
  csvEnabled: boolean;
  /** Existing groups (Credentials categories) for the drawer's datalist. */
  groups?: string[];
};

export type ImportCommitResult = {
  added: number;
  updated: number;
  removed: number;
  backupId: string;
};

export type CsvFile = { filename: string; csv: string };

export type AddonPanelActions = {
  save(
    input: Record<string, unknown>,
  ): Promise<HubActionResult<{ id: string; held: boolean }>>;
  setPublished(
    id: string,
    on: boolean,
  ): Promise<HubActionResult<{ held: boolean }>>;
  reorder(ids: string[]): Promise<HubActionResult<null>>;
  remove(id: string): Promise<HubActionResult<null>>;
  importPreview(
    text: string,
    mode: ImportMode,
  ): Promise<HubActionResult<ImportPreview>>;
  /** Replace all passes the preview's removal ids, the set the owner confirmed (D126). */
  importCommit(
    text: string,
    mode: ImportMode,
    confirmedRemovals?: string[],
  ): Promise<HubActionResult<ImportCommitResult>>;
  exportCsv(): Promise<HubActionResult<CsvFile>>;
  templateCsv(): Promise<HubActionResult<CsvFile>>;
  listBackups(): Promise<HubActionResult<BackupView[]>>;
  saveBackup(): Promise<HubActionResult<BackupView>>;
  restoreBackup(id: string): Promise<HubActionResult<null>>;
  /** Add the add-on's seeded page to the site menu (07-25; resolved server-side). */
  addToNav(): Promise<
    HubActionResult<{ added: boolean; reason?: "exists" | "full" }>
  >;
};

export type AddonPanelProps = {
  data: AddonPanelData;
  actions: AddonPanelActions;
};

/**
 * An add-on block's builder form. Mirrors the P3 SectionForm per-type field wiring: the
 * block's content draft, a per-field setter (SectionForm's `set(name, value)`), and the
 * field errors keyed by content field. `editHref` points at the add-on's tab ("Edit your
 * testimonials in Website → Testimonials").
 */
export type AddonBlockFormProps = {
  content: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  errors: Record<string, string>;
  editHref: string;
};
