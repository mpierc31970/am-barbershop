// Deny-by-default evidence (D187). The evidence JSON is hashed (evidence_sha256) and stored
// write-once; it never contains document_sha256 (RESEARCH Pattern 2). toEvidence() picks only
// the approved fields, validates each one and rebuilds nested objects from their own approved
// keys, so an extra input key (password, token, session...) can never reach the hash or the
// signed copy (AGR-03, CONTEXT A2-Q2, T-09-07-02). Pure.
import { InvalidInput } from "../errors";
import { isPolicyKey } from "./policies";
import type { PolicyKey } from "./types";

export const EVIDENCE_FIELDS: readonly string[] = Object.freeze([
  "auth_method",
  "consent",
  "consent_ticked",
  "format",
  "format_version",
  "ip",
  "kind",
  "order_snapshot",
  "org_name",
  "organization",
  "policies",
  "policies_ticked",
  "retain_until",
  "signature_id",
  "signed_at",
  "signer",
  "signer_email",
  "signer_name",
  "user_agent",
]);

export type OrderSnapshot = {
  path: string;
  cadence: string;
  buildCents: number | null;
  installments: number;
  monthlyItems: readonly { label: string; monthlyCents: number | null }[];
  monthlyTotalCents: number | null;
} | null;

export type EvidencePolicy = {
  key: PolicyKey;
  version: number;
  title: string;
  sha256: string;
  effective_at: string;
};

export type AgreementEvidence = {
  format: "cds-agreement-evidence";
  format_version: 1;
  signature_id: string;
  organization: string;
  org_name: string;
  signer: string;
  signer_email: string;
  signer_name: string;
  policies: readonly EvidencePolicy[];
  consent: { key: "esign-consent"; version: number; sha256: string };
  consent_ticked: true;
  policies_ticked: readonly PolicyKey[];
  ip: string;
  user_agent: string;
  auth_method: "otp" | "password" | "unknown";
  signed_at: string;
  kind: "signup" | "reaccept";
  order_snapshot: OrderSnapshot;
  retain_until: string;
};

const HEX64 = /^[0-9a-f]{64}$/;
const ISO_MS_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const AUTH_METHODS = ["otp", "password", "unknown"] as const;
const KINDS = ["signup", "reaccept"] as const;
/** User agents are capped so a hostile header cannot bloat the 7-year record. */
const USER_AGENT_MAX = 512;
const TEXT_MAX = 1000;

/** IPv4 or IPv6 shape (light check), or the literal "unknown" so a gap is explicit (D81). */
const IP_SHAPE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9A-Fa-f:]*:[0-9A-Fa-f:.]*)$/;
export const UNKNOWN_IP = "unknown";

/** WR-B03: the IP to record: the caller's address when it looks like one, else "unknown". */
export function evidenceIp(v: unknown): string {
  return typeof v === "string" && v.length <= 64 && IP_SHAPE.test(v.trim())
    ? v.trim()
    : UNKNOWN_IP;
}

function bad(field: string, why: string): never {
  throw new InvalidInput(`evidence ${field} ${why}`);
}

function obj(v: unknown, field: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    bad(field, "must be an object");
  }
  return v as Record<string, unknown>;
}

function text(v: unknown, field: string, max = TEXT_MAX): string {
  if (typeof v !== "string" || v.trim() === "")
    bad(field, "must be a non-empty string");
  if (v.length > max) bad(field, "is too long");
  return v;
}

function posInt(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) {
    bad(field, "must be a positive integer");
  }
  return v;
}

function cents(v: unknown, field: string): number | null {
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
    bad(field, "must be integer cents or null");
  }
  return v;
}

function isoMs(v: unknown, field: string): string {
  if (
    typeof v !== "string" ||
    !ISO_MS_Z.test(v) ||
    Number.isNaN(Date.parse(v))
  ) {
    bad(field, "must be ISO-8601 UTC with milliseconds and Z");
  }
  return v;
}

function hex(v: unknown, field: string): string {
  if (typeof v !== "string" || !HEX64.test(v))
    bad(field, "must be 64 lowercase hex");
  return v;
}

function oneOf<T extends string>(
  v: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    bad(field, `must be one of ${allowed.join(", ")}`);
  }
  return v as T;
}

function policyKey(v: unknown, field: string): PolicyKey {
  if (typeof v !== "string" || !isPolicyKey(v))
    bad(field, "is not a policy key");
  return v;
}

function toPolicies(v: unknown): EvidencePolicy[] {
  if (!Array.isArray(v) || v.length === 0)
    bad("policies", "must be a non-empty array");
  return v.map((raw, i) => {
    const p = obj(raw, `policies[${i}]`);
    const effective = p.effective_at;
    if (typeof effective !== "string" || !YMD.test(effective)) {
      bad(`policies[${i}].effective_at`, "must be YYYY-MM-DD");
    }
    return {
      key: policyKey(p.key, `policies[${i}].key`),
      version: posInt(p.version, `policies[${i}].version`),
      title: text(p.title, `policies[${i}].title`),
      sha256: hex(p.sha256, `policies[${i}].sha256`),
      effective_at: effective,
    };
  });
}

function toOrderSnapshot(v: unknown): OrderSnapshot {
  if (v === null) return null;
  const o = obj(v, "order_snapshot");
  const items = o.monthlyItems;
  if (!Array.isArray(items))
    bad("order_snapshot.monthlyItems", "must be an array");
  return {
    path: text(o.path, "order_snapshot.path"),
    cadence: text(o.cadence, "order_snapshot.cadence"),
    buildCents: cents(o.buildCents, "order_snapshot.buildCents"),
    installments: posInt(o.installments, "order_snapshot.installments"),
    monthlyItems: items.map((raw, i) => {
      const it = obj(raw, `order_snapshot.monthlyItems[${i}]`);
      return {
        label: text(it.label, `order_snapshot.monthlyItems[${i}].label`),
        monthlyCents: cents(
          it.monthlyCents,
          `order_snapshot.monthlyItems[${i}].monthlyCents`,
        ),
      };
    }),
    monthlyTotalCents: cents(
      o.monthlyTotalCents,
      "order_snapshot.monthlyTotalCents",
    ),
  };
}

/**
 * Builds the evidence object from the approved field list only. Throws InvalidInput on any
 * missing or invalid field; extra keys (top level and nested) are dropped.
 */
export function toEvidence(input: Record<string, unknown>): AgreementEvidence {
  const i = obj(input, "input");
  if (i.format !== "cds-agreement-evidence") bad("format", "is wrong");
  if (i.format_version !== 1) bad("format_version", "must be 1");
  if (i.consent_ticked !== true) bad("consent_ticked", "must be true");
  const consent = obj(i.consent, "consent");
  if (consent.key !== "esign-consent")
    bad("consent.key", "must be esign-consent");
  if (!Array.isArray(i.policies_ticked))
    bad("policies_ticked", "must be an array");
  if (
    typeof i.ip !== "string" ||
    i.ip.length > 64 ||
    (i.ip !== UNKNOWN_IP && !IP_SHAPE.test(i.ip))
  ) {
    bad("ip", `must be an IP address or "${UNKNOWN_IP}"`);
  }
  if (typeof i.user_agent !== "string") bad("user_agent", "must be a string");

  const policies = toPolicies(i.policies);
  const ticked = i.policies_ticked.map((k, n) =>
    policyKey(k, `policies_ticked[${n}]`),
  );
  // WR-B03: one entry per policy, and the ticked set is exactly the signed set.
  const signedKeys = new Set(policies.map((p) => p.key));
  if (signedKeys.size !== policies.length)
    bad("policies", "has a duplicate key");
  if (new Set(ticked).size !== ticked.length) {
    bad("policies_ticked", "has a duplicate key");
  }
  if (
    ticked.length !== signedKeys.size ||
    !ticked.every((k) => signedKeys.has(k))
  ) {
    bad("policies_ticked", "must match the signed policies");
  }

  const ev: AgreementEvidence = {
    format: "cds-agreement-evidence",
    format_version: 1,
    signature_id: text(i.signature_id, "signature_id", 64),
    organization: text(i.organization, "organization", 64),
    org_name: text(i.org_name, "org_name"),
    signer: text(i.signer, "signer", 64),
    signer_email: text(i.signer_email, "signer_email", 320),
    signer_name: text(i.signer_name, "signer_name", 200),
    policies,
    consent: {
      key: "esign-consent",
      version: posInt(consent.version, "consent.version"),
      sha256: hex(consent.sha256, "consent.sha256"),
    },
    consent_ticked: true,
    policies_ticked: ticked,
    ip: i.ip,
    // IN-B04: by code points, so a surrogate pair is never split.
    user_agent: [...i.user_agent].slice(0, USER_AGENT_MAX).join(""),
    auth_method: oneOf(i.auth_method, AUTH_METHODS, "auth_method"),
    signed_at: isoMs(i.signed_at, "signed_at"),
    kind: oneOf(i.kind, KINDS, "kind"),
    order_snapshot: toOrderSnapshot(i.order_snapshot),
    retain_until: isoMs(i.retain_until, "retain_until"),
  };
  return ev;
}
