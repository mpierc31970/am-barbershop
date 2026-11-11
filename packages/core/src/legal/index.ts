// @cds/core/legal (P9: LIFE-02, AGR-01, AGR-02, AGR-04). Pure and Edge-safe: no node:*,
// no db package, no HTML sanitizer import. sha256 is computed by the codegen script and the
// db package; this subpath only produces the canonical strings. Never re-exported from the
// @cds/core root.
export {
  AGREEMENT_RETENTION_YEARS,
  AUDIT_LOG_RETENTION_DAYS,
  BACKUP_AGE_OUT_DAYS,
  CLOSED_ORG_DELETE_DAYS,
  EXPORT_RETENTION_DAYS,
  LEGAL_EVIDENCE_AUDIT_ACTIONS,
  RETENTION,
  RETENTION_ORG_CAP_PER_RUN,
  retainUntil,
  retentionTableMarkdown,
} from "./retention";
export type { RetentionRow } from "./retention";
export { canonicalJson } from "./canonical";
export {
  normalizeSignerName,
  SIGNER_NAME_MAX,
  SIGNER_NAME_MIN,
  signerNameValid,
} from "./signer-name";
export {
  EVIDENCE_FIELDS,
  evidenceIp,
  toEvidence,
  UNKNOWN_IP,
} from "./evidence";
export { renderSignedCopy, signedCopyFilename } from "./signed-copy";
export type {
  AgreementEvidence,
  EvidencePolicy,
  OrderSnapshot,
} from "./evidence";
export {
  clauseMarkers,
  lintLegalMarkdown,
  renderLegalMarkdown,
  stripClauseMarkers,
} from "./markdown";
export type { LegalMarkdownOptions } from "./markdown";
export {
  activeConsent,
  activePolicyVersions,
  consentVersion,
  assertRequiredClauses,
  isPolicyKey,
  POLICY_CODES,
  POLICY_KEYS,
  policyVersion,
  REQUIRED_CLAUSES,
} from "./policies";
export { POLICY_SET } from "./policies.generated";
export { SITE_POLICY_TEMPLATES } from "./site-policies.generated";
export {
  CORE_PRIVACY_CLAUSES,
  latestSitePolicyVersion,
  renderSitePolicy,
  SITE_POLICY_DRAFT_TEXT,
  sitePolicyChanges,
} from "./site-policy";
export type {
  RenderedSitePolicy,
  SitePolicyFacts,
  SitePolicyPage,
} from "./site-policy";
export type {
  ConsentVersion,
  PolicyKey,
  PolicySet,
  PolicyVersion,
  SitePolicyTemplate,
} from "./types";
