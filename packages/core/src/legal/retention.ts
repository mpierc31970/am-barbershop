// The one retention table (LIFE-02, D283, D223, D171, D287, invariant 9).
// The DPA renders it at codegen ({{retention_table}}) and the retention job reads the same
// numbers: every constant below is read from a row by id, never written a second time.
// Pure and Edge-safe.

export type RetentionRow = {
  id: string;
  /** Plain-English subject, as the DPA shows it. */
  subject: string;
  /** Plain-English rule, as the DPA shows it. */
  rule: string;
  /** Day count the job enforces; null when nothing is ever deleted by age. */
  days: number | null;
  /** Calendar years (UTC) for rows promised in years, so leap days never shorten them. */
  years?: number;
  note: string;
};

const ROWS: RetentionRow[] = [
  {
    id: "closed-tenant",
    subject: "Cancelled, declined or taken-down sites",
    rule: "Deleted 30 days after the event, then age out of backups over the next 90 days",
    days: 30,
    note: "Selected by closed_reason and closed_at only; signed agreements are kept (D283).",
  },
  {
    id: "backups",
    subject: "Database backups",
    rule: "Age out after 90 days",
    days: 90,
    note: "Offsite backup lifecycle (D171).",
  },
  {
    id: "lapsed-tenant",
    subject: "Sites whose payment lapsed",
    rule: "Held, never deleted",
    days: null,
    note: "A lapse only disables add-ons (invariant 9); the job can never select it.",
  },
  {
    id: "signed-agreements",
    subject: "Signed agreements",
    rule: "Kept 7 years from signing, even after the site is deleted",
    days: null,
    years: 7,
    note: "retain_until = signed_at + 7 UTC years (D81, D287). The signing's audit row (the second record of its hashes) is part of the signed agreement and follows this rule, not the audit-log row (LEGAL_EVIDENCE_AUDIT_ACTIONS).",
  },
  {
    id: "site-policy-acks",
    subject: "Site policy acknowledgements",
    rule: "Kept 7 years from acknowledgement, even after the site is deleted",
    days: null,
    years: 7,
    note: "Same rule as signed agreements (RESEARCH Open Question 3).",
  },
  {
    id: "audit-log",
    subject: "Audit log",
    rule: "Deleted after 2 years (730 days), except the record of a signing, acknowledgement or policy change, which is kept 7 years like the signed agreement",
    days: 730,
    note: "Deleted by age in pages; no append-only hook (RESEARCH Pitfall 6). Legal evidence rows (LEGAL_EVIDENCE_AUDIT_ACTIONS) are kept AGREEMENT_RETENTION_YEARS instead.",
  },
  {
    id: "live-media",
    subject: "Live media",
    rule: "Kept while your site uses it",
    days: null,
    note: "D223; removed with the site when it is deleted.",
  },
  {
    id: "exports",
    subject: "Site exports",
    rule: "Deleted after 90 days",
    days: 90,
    note: "Nightly export prune (TEN-12).",
  },
];

/** The one retention table, in DPA order. Frozen. */
export const RETENTION: readonly RetentionRow[] = Object.freeze(
  ROWS.map((r) => Object.freeze(r)),
);

function rowOf(id: string): RetentionRow {
  const r = RETENTION.find((x) => x.id === id);
  if (!r) throw new Error(`retention row ${id} is missing`);
  return r;
}

function daysOf(id: string): number {
  const d = rowOf(id).days;
  if (d === null) throw new Error(`retention row ${id} has no day count`);
  return d;
}

function yearsOf(id: string): number {
  const y = rowOf(id).years;
  if (y === undefined) throw new Error(`retention row ${id} has no year count`);
  return y;
}

export const CLOSED_ORG_DELETE_DAYS: number = daysOf("closed-tenant");
export const BACKUP_AGE_OUT_DAYS: number = daysOf("backups");
export const AUDIT_LOG_RETENTION_DAYS: number = daysOf("audit-log");
export const EXPORT_RETENTION_DAYS: number = daysOf("exports");
export const AGREEMENT_RETENTION_YEARS: number = yearsOf("signed-agreements");

/**
 * Audit actions that are legal evidence, not activity history (CR-A02). Each is the second,
 * independent record of a signing, an acknowledgement or a policy publication, so verify
 * needs it for as long as the evidence itself: the job keeps these rows
 * AGREEMENT_RETENTION_YEARS (the signed-agreements row), not AUDIT_LOG_RETENTION_DAYS.
 */
export const LEGAL_EVIDENCE_AUDIT_ACTIONS: readonly string[] = Object.freeze([
  "agreement.sign",
  "site_policies.publish",
  "site_policies.review",
  "policy_versions.publish",
  "policy_versions.retire",
]);

/** Job safety cap (CONTEXT A4-Q4), not a retention promise, so not a table row. */
export const RETENTION_ORG_CAP_PER_RUN = 5;

/**
 * signedAt + AGREEMENT_RETENTION_YEARS calendar years in UTC. A 29 February signature rolls
 * forward to 1 March (setUTCFullYear overflow), so the promise is never shortened.
 */
export function retainUntil(signedAt: Date): Date {
  const d = new Date(signedAt.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + AGREEMENT_RETENTION_YEARS);
  return d;
}

/** The table as legal markdown: one `- **{subject}:** {rule}` line per row. */
export function retentionTableMarkdown(): string {
  return RETENTION.map((r) => `- **${r.subject}:** ${r.rule}`).join("\n");
}
