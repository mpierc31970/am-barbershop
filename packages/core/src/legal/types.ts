// Policy and consent text types (AGR-01, AGR-07; CONTEXT A1-Q1, A2-Q1). Pure: the texts are
// compiled by packages/core/scripts/legal-gen.ts into policies.generated.ts, so runtime code
// never reads markdown files (RESEARCH Pitfall 3).

export type PolicyKey =
  | "service-agreement"
  | "acceptable-use"
  | "terms-of-service"
  | "subscription-terms"
  | "dpa";

export type PolicyVersion = {
  key: PolicyKey;
  version: number;
  title: string;
  summary: readonly [string, string, string];
  /** What changed since the previous version; null for version 1. */
  changes: string | null;
  /** YYYY-MM-DD; displayed, never used to schedule. */
  effectiveAt: string;
  draft: boolean;
  /** Canonical body (LF, NFC, substituted, clause markers kept); the hashed text. */
  bodyMd: string;
  /** Rendered body, clause markers stripped. */
  bodyHtml: string;
  /** sha256 hex of utf8(bodyMd). */
  sha256: string;
};

export type ConsentVersion = {
  key: "esign-consent";
  version: number;
  title: string;
  /** The checkbox label (UI-SPEC CONSENT-TEXT). */
  label: string;
  effectiveAt: string;
  draft: boolean;
  bodyMd: string;
  bodyHtml: string;
  sha256: string;
};

export type PolicySet = {
  policies: readonly PolicyVersion[];
  consents: readonly ConsentVersion[];
};

/** Site policy page template (authored and emitted by 09-11). */
export type SitePolicyTemplate = {
  page: "privacy" | "terms";
  version: number;
  title: string;
  changes: string | null;
  draft: boolean;
  bodyMd: string;
  sha256: string;
};
