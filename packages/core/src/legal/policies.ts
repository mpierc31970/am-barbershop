// Policy lookups over the compiled policy set (AGR-01, AGR-07; D216, CONTEXT A1-Q4).
// Pure and Edge-safe. Active version = the highest version per key (effective_at is shown,
// never used to schedule).
import { InvalidInput } from "../errors";
import { clauseMarkers } from "./markdown";
import { POLICY_SET } from "./policies.generated";
import type {
  ConsentVersion,
  PolicyKey,
  PolicySet,
  PolicyVersion,
} from "./types";

/** The five signup policies in D216 order. */
export const POLICY_KEYS: readonly PolicyKey[] = Object.freeze([
  "service-agreement",
  "acceptable-use",
  "terms-of-service",
  "subscription-terms",
  "dpa",
]);

/** Short codes for staff CLI output (UI-SPEC); ESC is the e-sign consent. */
export const POLICY_CODES: Readonly<
  Record<PolicyKey | "esign-consent", string>
> = Object.freeze({
  "service-agreement": "SA",
  "acceptable-use": "AUP",
  "terms-of-service": "TOS",
  "subscription-terms": "SUB",
  dpa: "DPA",
  "esign-consent": "ESC",
});

/** Clause markers each policy's active version must carry (CONTEXT A1-Q4). */
export const REQUIRED_CLAUSES: Readonly<Record<PolicyKey, readonly string[]>> =
  Object.freeze({
    "service-agreement": Object.freeze([
      "gateway-ownership",
      "merchant-of-record",
      "no-payment-processing",
      "commissioned-ip",
      "catalog-credit-12mo",
      "maintenance-fees",
      "private-addon-eol",
      "installments-owed",
      "decline-window",
    ]),
    "acceptable-use": Object.freeze([
      "aup-never-hosted",
      "aup-review-first",
      "takedown-right",
    ]),
    "terms-of-service": Object.freeze([
      "dmca-agent",
      "dmca-takedown",
      "dmca-counter-notice",
      "dmca-restore-10-14",
      "repeat-infringer",
      "report-link-unremovable",
    ]),
    "subscription-terms": Object.freeze([
      "lapse-disables",
      "annual-two-months-free",
    ]),
    dpa: Object.freeze(["retention-table", "sub-processors"]),
  });

export function isPolicyKey(v: string): v is PolicyKey {
  return (POLICY_KEYS as readonly string[]).includes(v);
}

function highest<T extends { version: number }>(
  rows: readonly T[],
): T | undefined {
  let best: T | undefined;
  for (const r of rows) if (!best || r.version > best.version) best = r;
  return best;
}

/** The highest version of each policy present in the set, in D216 order. */
export function activePolicyVersions(
  set: PolicySet = POLICY_SET,
): PolicyVersion[] {
  const out: PolicyVersion[] = [];
  for (const key of POLICY_KEYS) {
    const best = highest(set.policies.filter((p) => p.key === key));
    if (best) out.push(best);
  }
  return out;
}

export function policyVersion(
  key: PolicyKey,
  version: number,
  set: PolicySet = POLICY_SET,
): PolicyVersion | undefined {
  return set.policies.find((p) => p.key === key && p.version === version);
}

export function activeConsent(
  set: PolicySet = POLICY_SET,
): ConsentVersion | undefined {
  return highest(set.consents);
}

export function consentVersion(
  version: number,
  set: PolicySet = POLICY_SET,
): ConsentVersion | undefined {
  return set.consents.find((c) => c.version === version);
}

/**
 * Throws InvalidInput listing every missing `key:clause` pair in the active version of each
 * policy, so a future version can never drop a required clause, and every POLICY_KEYS entry
 * with no version at all (WR-B02: D216 needs all five). Called by legal:gen / legal:check and
 * by the clause test (CONTEXT A1-Q4, T-09-05-03).
 */
export function assertRequiredClauses(set: PolicySet = POLICY_SET): void {
  const missing: string[] = [];
  const active = activePolicyVersions(set);
  for (const key of POLICY_KEYS) {
    if (!active.some((p) => p.key === key)) missing.push(`${key}:(no version)`);
  }
  for (const p of active) {
    const have = new Set(clauseMarkers(p.bodyMd));
    for (const id of REQUIRED_CLAUSES[p.key]) {
      if (!have.has(id)) missing.push(`${p.key}:${id}`);
    }
  }
  if (missing.length > 0) {
    throw new InvalidInput(`required clauses missing: ${missing.join(", ")}`);
  }
}
