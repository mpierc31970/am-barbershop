// @cds/db legal area barrel (AGR-01..05, AGR-07; 09-08, 09-10). policy-versions keeps named
// exports so its test seam is deliberately NOT exported here (T-09-08-04); signatures and
// order-snapshot are wildcards so 09-13 can add functions without touching this file.
export { sha256Hex } from "./hash";
export {
  activeConsentVersion,
  activePolicies,
  policyText,
  PolicyVersionConflict,
  storedPolicyVersion,
  syncPolicyVersions,
} from "./policy-versions";
export type { PolicySyncResult } from "./policy-versions";
export * from "./signatures";
export * from "./order-snapshot";
// 09-16 (AGR-08): named exports so the template test seam stays out of the barrel.
export {
  acknowledgeSitePolicies,
  previewSitePolicy,
  readPublishedSitePolicy,
  recordSitePolicyReview,
  SITE_POLICY_INPUTS_MISSING_COPY,
  SitePolicyInputsMissing,
  sitePolicyFacts,
  sitePolicyState,
} from "./site-policy-acks";
export type {
  PublishedSitePolicy,
  SitePolicyRegistry,
  SitePolicyState,
} from "./site-policy-acks";
