// agreements:verify core (AGR-01, AGR-04, AGR-05; D81; CONTEXT A2-Q4 and Specifics: "years
// later, staff run agreements:verify and get MATCH on both hashes"; RESEARCH Pattern 6).
//
// Staff only (STAFF_MATRIX.agreements_verify: super_admin, support_agent). Read-only apart
// from one `agreement.verify` audit row per run (choice 2). For every signature row of the
// org, oldest first:
// - the evidence JSON and the HTML copy are read from the agreement store under the key
//   recomputed with tenantAgreementKey (never the stored document_key alone, which must
//   equal it);
// - sha256 of each is compared with the row's evidence_sha256 / document_sha256;
// - the evidence is parsed and re-canonicalised: non-canonical bytes are tampering even
//   when the data is the same;
// - evidence and row must agree on signature_id, organization, signer, ip, signed_at (by
//   Date.parse after PB date normalisation, Pitfall 10), kind and the policy and consent
//   key/version/sha256 sets (choice 3);
// - every cited policy (and the consent) must still hash the same in policy_versions;
// - the `agreement.sign` audit row must exist and carry the same two hashes. It is found by
//   target_id (the signature id), so it still resolves once the org row is deleted, and the
//   retention job keeps it as long as the signature (LEGAL_EVIDENCE_AUDIT_ACTIONS, CR-A02).
// Not re-exported from the @cds/db barrel (choice 1): the CLI imports it relatively.
import { authorizeStaff, Forbidden, NotFound } from "@cds/core";
import { canonicalJson, POLICY_CODES } from "@cds/core/legal";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { appendAudit } from "../audit";
import { withSuperuser } from "../client";
import { isPlatformContext, type PlatformContext } from "../context";
import {
  getAgreementStore,
  tenantAgreementKey,
  type WriteOnceObjectStore,
} from "../storage";
import { sha256Hex } from "./hash";
import { storedPolicyVersion } from "./policy-versions";

const COLLECTION = "agreement_signatures";
const ID_RE = /^[a-z0-9]{15}$/;
const CONSENT_KEY = "esign-consent";

export type HashState = "MATCH" | "MISMATCH" | "missing";

export type SigningCheck = {
  id: string;
  /** ISO 8601 UTC, or "" when the row's date is unreadable. */
  signedAt: string;
  signerName: string;
  kind: string;
  /** "SA1 AUP1 TOS1 SUB1 DPA1 ESC1" */
  codes: string;
  ip: string;
  evidence: HashState;
  document: HashState;
  problems: readonly string[];
};

export type VerifyDeps = {
  store?: WriteOnceObjectStore;
  /** Test seam; defaults to the policy_versions reader. */
  storedPolicyVersion?: typeof storedPolicyVersion;
};

type Cited = { key: string; version: number; sha256: string };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** PocketBase date ("YYYY-MM-DD HH:MM:SS.mmmZ") or ISO -> epoch ms, NaN when unreadable. */
function epochOf(v: unknown): number {
  if (typeof v !== "string" || v === "") return Number.NaN;
  return Date.parse(v.replace(" ", "T"));
}

function isoOf(v: unknown): string {
  const t = epochOf(v);
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

function citedList(v: unknown): Cited[] {
  if (!Array.isArray(v)) return [];
  const out: Cited[] = [];
  for (const raw of v) {
    if (raw === null || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    out.push({
      key: str(p.key),
      version: typeof p.version === "number" ? p.version : Number.NaN,
      sha256: str(p.sha256),
    });
  }
  return out;
}

function consentOf(v: unknown): Cited | null {
  if (v === null || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  if (typeof c.version !== "number") return null;
  return { key: CONSENT_KEY, version: c.version, sha256: str(c.sha256) };
}

const citedKey = (c: Cited) => `${c.key}@${c.version}#${c.sha256}`;

function sameCited(a: readonly Cited[], b: readonly Cited[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.map(citedKey).sort();
  const right = b.map(citedKey).sort();
  return left.every((k, i) => k === right[i]);
}

function codeOf(key: string): string {
  return (POLICY_CODES as Readonly<Record<string, string>>)[key] ?? key;
}

const short = (hex: string) => `${hex.slice(0, 4)}…`;

async function readObject(
  store: WriteOnceObjectStore,
  key: string,
): Promise<Uint8Array | null> {
  try {
    return await store.get(key);
  } catch {
    return null;
  }
}

async function checkRow(
  row: RecordModel,
  orgId: string,
  audit: RecordModel | undefined,
  store: WriteOnceObjectStore,
  stored: typeof storedPolicyVersion,
): Promise<SigningCheck> {
  const problems: string[] = [];
  const policies = citedList(row.policies);
  const consent = consentOf(row.consent);
  const codes = [
    ...policies.map((p) => `${codeOf(p.key)}${p.version}`),
    ...(consent ? [`ESC${consent.version}`] : []),
  ].join(" ");

  const htmlKey = tenantAgreementKey(orgId, row.id, "html");
  const jsonKey = tenantAgreementKey(orgId, row.id, "json");
  if (str(row.document_key) !== htmlKey) {
    problems.push("document key differs from the expected key");
  }

  // Evidence JSON: hash, canonical bytes, then the field cross-check.
  let evidence: HashState = "missing";
  const json = await readObject(store, jsonKey);
  if (!json) {
    problems.push("evidence missing");
  } else {
    const storedSha = str(row.evidence_sha256);
    const computed = sha256Hex(json);
    evidence = computed === storedSha ? "MATCH" : "MISMATCH";
    if (evidence === "MISMATCH") {
      problems.push(
        `evidence hash differs (stored ${short(storedSha)}, computed ${short(computed)})`,
      );
    }
    const text = new TextDecoder().decode(json);
    let parsed: Record<string, unknown> | null = null;
    try {
      const v: unknown = JSON.parse(text);
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        parsed = v as Record<string, unknown>;
      }
    } catch {
      parsed = null;
    }
    if (!parsed) {
      evidence = "MISMATCH";
      problems.push("evidence is not valid JSON");
    } else {
      if (canonicalJson(parsed) !== text) {
        evidence = "MISMATCH";
        problems.push("evidence JSON is not canonical");
      }
      const fields: [string, boolean][] = [
        ["signature_id", parsed.signature_id === row.id],
        ["organization", parsed.organization === row.organization],
        ["signer", parsed.signer === row.signer],
        ["ip", str(parsed.ip) === str(row.ip)],
        [
          "signed_at",
          !Number.isNaN(epochOf(row.signed_at)) &&
            epochOf(parsed.signed_at) === epochOf(row.signed_at),
        ],
        ["kind", parsed.kind === row.kind],
        ["policies", sameCited(citedList(parsed.policies), policies)],
        [
          "consent",
          (() => {
            const ec = consentOf(parsed.consent);
            return consent === null
              ? ec === null
              : ec !== null && sameCited([ec], [consent]);
          })(),
        ],
      ];
      for (const [name, ok] of fields) {
        if (!ok) {
          evidence = "MISMATCH";
          problems.push(`evidence ${name} differs from the record`);
        }
      }
    }
  }

  // The signed HTML copy.
  let document: HashState = "missing";
  const html = await readObject(store, htmlKey);
  if (!html) {
    problems.push("document missing");
  } else {
    const storedSha = str(row.document_sha256);
    const computed = sha256Hex(html);
    document = computed === storedSha ? "MATCH" : "MISMATCH";
    if (document === "MISMATCH") {
      problems.push(
        `document hash differs (stored ${short(storedSha)}, computed ${short(computed)})`,
      );
    }
  }

  // Every cited text must still hash the same in policy_versions.
  for (const c of [...policies, ...(consent ? [consent] : [])]) {
    const label = `policy ${codeOf(c.key)} v${c.version}`;
    const s = await stored(c.key, c.version);
    if (!s) problems.push(`${label} has no stored version`);
    else if (s.sha256 !== c.sha256) {
      problems.push(`${label} hash differs from the stored version`);
    }
  }

  // The audit row written in the same batch as the signature.
  if (!audit) {
    problems.push("audit record missing");
  } else {
    const meta = (audit.meta ?? {}) as Record<string, unknown>;
    if (
      meta.evidence_sha256 !== row.evidence_sha256 ||
      meta.document_sha256 !== row.document_sha256
    ) {
      problems.push("audit record hashes differ from the record");
    }
  }

  return {
    id: row.id,
    signedAt: isoOf(row.signed_at),
    signerName: str(row.signer_name),
    kind: str(row.kind),
    codes,
    ip: str(row.ip),
    evidence,
    document,
    problems,
  };
}

/**
 * Re-derive and check every signing of one org (staff only; one audit row per run). Throws
 * Forbidden for anyone but super_admin / support_agent and NotFound for an org with neither
 * an organizations row nor any signature row. A deleted org whose signatures are still kept
 * verifies normally (orgDeleted true, name from the newest org_name snapshot; CR-A01).
 */
export async function verifySignatures(
  ctx: PlatformContext,
  orgId: string,
  deps: VerifyDeps = {},
): Promise<{
  orgName: string;
  orgDeleted: boolean;
  checks: readonly SigningCheck[];
}> {
  if (!isPlatformContext(ctx)) throw new Forbidden("verify is for CDS staff");
  authorizeStaff(ctx.staffRole, "agreements_verify");
  if (typeof orgId !== "string" || !ID_RE.test(orgId)) throw new NotFound();
  const store = deps.store ?? getAgreementStore();
  const stored = deps.storedPolicyVersion ?? storedPolicyVersion;

  const { orgName, orgDeleted, rows, audits } = await withSuperuser(
    async (pb) => {
      // The org row is optional (CR-A01): the retention job deletes it 30 days after closure
      // but keeps the signatures 7 years, and a deleted org is exactly when the evidence is
      // needed. The signature rows key on the org id string, so they still resolve.
      let orgName = "";
      let orgDeleted = false;
      try {
        const org = await pb
          .collection("organizations")
          .getOne(orgId, { fields: "id,name" });
        orgName = str(org.name);
      } catch (err) {
        if (!(err instanceof ClientResponseError && err.status === 404)) {
          throw err;
        }
        orgDeleted = true;
      }
      const rows = await pb.collection(COLLECTION).getFullList({
        filter: pb.filter("organization = {:org}", { org: orgId }),
        sort: "signed_at,id",
      });
      if (orgDeleted && rows.length === 0) throw new NotFound();
      // The newest signing's org_name snapshot stands in for the deleted row's name.
      if (orgDeleted) orgName = str(rows[rows.length - 1]?.org_name);
      // Looked up by the signature id each row records, not by the org relation (CR-A02):
      // deleting the org clears audit_log.organization on every row that named it. A row
      // still naming a different org is never accepted.
      const audits: RecordModel[] = [];
      for (const row of rows) {
        audits.push(
          ...(await pb.collection("audit_log").getFullList({
            filter: pb.filter(
              "action = 'agreement.sign' && target_collection = {:col} && target_id = {:id} && (organization = {:org} || organization = '')",
              { col: COLLECTION, id: row.id, org: orgId },
            ),
            sort: "created,id",
          })),
        );
      }
      return { orgName, orgDeleted, rows, audits };
    },
  );

  const auditById = new Map<string, RecordModel>();
  for (const a of audits) {
    const id = str(a.target_id);
    if (!auditById.has(id)) auditById.set(id, a);
  }
  const checks: SigningCheck[] = [];
  for (const row of rows) {
    checks.push(
      await checkRow(row, orgId, auditById.get(row.id), store, stored),
    );
  }

  await appendAudit(ctx, {
    action: "agreement.verify",
    // A relation to a deleted org would fail validation; meta.org keeps the id.
    organization: orgDeleted ? null : orgId,
    targetCollection: "organizations",
    targetId: orgId,
    meta: {
      org: orgId,
      org_deleted: orgDeleted,
      signings: checks.length,
      failures: checks.filter((c) => c.problems.length > 0).length,
    },
  });
  return { orgName, orgDeleted, checks };
}
