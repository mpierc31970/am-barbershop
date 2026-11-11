// Add-on chokepoint types (ADDON-04, ADDON-05, ADDON-06, ADDON-07, ADDON-09; CONTEXT A2).
// The installer, the entitlement reads and addonRepo live inside @cds/db (invariant 1):
// add-on packages never hold a privileged context, @cds/db interprets their data.
import type { AddonRegistry } from "@cds/core/addons";
import type { PublishDeps } from "../content/publish";
import type { BillingGate } from "./billing";

/** Who asked for the install: the owner hub, staff, site assembly (P8) or billing (P10). */
export type InstallSource = "hub" | "staff" | "assembly" | "billing";

export type AddonDeps = PublishDeps & {
  addons: AddonRegistry;
  /** Defaults to getBillingGate() (the billing-backed gate, 10-20). */
  billing?: BillingGate;
  now?: () => Date;
};

/** The idempotency ledger: what the installer created, so a rerun never seeds twice. */
export type Seeded = {
  /**
   * The seeded page. `pending: true` while its blocks and publish are not done yet
   * (A-WR-01): a later install resumes them instead of leaving an empty draft forever.
   * `draft` is the fingerprint of the page as the installer last left it (R2-WR-02): the
   * resume runs only while the page still matches it, so owner edits are never published.
   */
  page?: { id: string; slug: string; pending?: true; draft?: string };
  /**
   * One marker per records key (A-CR-01): `{ count, at }`, written in the same batch as the
   * records. Rows written before that fix hold the id list instead; both mean "seeded".
   */
  records?: Record<string, SeededRecordsMarker>;
};

/** A seeded records key: a count marker, or (legacy) the list of created ids. */
export type SeededRecordsMarker = { count: number; at: string } | string[];

export type OrgAddonRow = {
  id: string;
  addon: string;
  status: "active" | "disabled";
  disabled_reason: string;
  source: InstallSource;
  installed_version: string;
  seeded: Seeded;
  installed_at: string;
  disabled_at: string;
};

export type InstallOptions = {
  /** Records to seed into manifest.install.records.collection (P8 intake). */
  records?: readonly Record<string, unknown>[];
  /** Seeds once per key (the intake id). Required with records. */
  recordsKey?: string;
  /** The Add dialog's confirm token (CR-C01), handed to BillingGate.approve. */
  chargeToken?: string;
};

export type InstallResult = {
  slug: string;
  outcome: "installed" | "reinstalled" | "unchanged";
  page: { id: string; slug: string } | null;
};

export type UninstallResult = {
  slug: string;
  outcome: "removed" | "unchanged";
};

export type AddonRecord = { id: string } & Record<string, unknown>;
