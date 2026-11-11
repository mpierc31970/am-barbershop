// Policy texts mirrored into policy_versions (AGR-01, AGR-07, D81; CONTEXT A1-Q2; RESEARCH
// Open Question 4). The compiled set in @cds/core/legal is the source; the DB row is the
// evidence anchor every signed hash points at. Rules:
// - A stored (key, version) whose sha256 differs from the compiled one throws
//   PolicyVersionConflict before any write ("bump the version, never edit a signed one").
// - Missing versions are created; any older active row of the key is retired (the only
//   update the 09-03 hook allows). Each row commits with its audit row in one PB batch.
// - activePolicies() / activeConsentVersion() resolve only after a successful sync in this
//   process (memoised; a failure clears the memo so the next call retries), so signing can
//   never happen against text that is not mirrored.
// Writes run under a system context (job "policy-sync"). The e-sign consent is stored too
// (key esign-consent, summary [label]) so every hash a signature cites has a row.
import { InvalidInput } from "@cds/core";
import {
  activeConsent,
  activePolicyVersions,
  consentVersion,
  isPolicyKey,
  POLICY_SET,
  policyVersion,
  type ConsentVersion,
  type PolicySet,
  type PolicyVersion,
} from "@cds/core/legal";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { mintSystemContext } from "../context";
import { newRecordId } from "../repository";

const COLLECTION = "policy_versions";
const CONSENT_KEY = "esign-consent";

/** An already-published (key, version) no longer matches the compiled text. */
export class PolicyVersionConflict extends InvalidInput {
  override readonly code: string = "policy_version_conflict";
}

export type PolicySyncResult = {
  inserted: number;
  retired: number;
  unchanged: number;
};

type Compiled = PolicyVersion | ConsentVersion;

type StoredRow = {
  id: string;
  key: string;
  version: number;
  sha256: string;
  status: "active" | "retired";
};

let testSet: PolicySet | null = null;
let synced: Promise<PolicySyncResult> | null = null;

function currentSet(): PolicySet {
  return testSet ?? POLICY_SET;
}

/**
 * TEST ONLY (T-09-08-04): swap the compiled set (the v2 bump fixture) and reset the memo.
 * Never exported from a barrel; tests import it from "../src/legal/policy-versions".
 */
export function __setPolicySetForTests(set: PolicySet | null): void {
  testSet = set;
  synced = null;
}

function compiledRows(set: PolicySet): Compiled[] {
  return [...set.policies, ...set.consents];
}

function pbDate(ymd: string): string {
  return `${ymd} 00:00:00.000Z`;
}

function rowBody(c: Compiled, status: "active" | "retired") {
  const isConsent = c.key === CONSENT_KEY;
  return {
    key: c.key,
    version: c.version,
    title: c.title,
    summary: isConsent
      ? [(c as ConsentVersion).label]
      : [...(c as PolicyVersion).summary],
    changes: isConsent ? "" : ((c as PolicyVersion).changes ?? ""),
    body_md: c.bodyMd,
    sha256: c.sha256,
    effective_at: pbDate(c.effectiveAt),
    status,
    draft: c.draft,
  };
}

async function runSync(set: PolicySet): Promise<PolicySyncResult> {
  const ctx = mintSystemContext({ job: "policy-sync" });
  return withSuperuser(async (pb) => {
    const stored = (
      await pb.collection(COLLECTION).getFullList({
        fields: "id,key,version,sha256,status",
      })
    ).map((r): StoredRow => ({
      id: r.id,
      key: String(r.key),
      version: Number(r.version),
      sha256: String(r.sha256),
      status: r.status === "retired" ? "retired" : "active",
    }));
    const byKey = new Map<string, StoredRow>();
    for (const r of stored) byKey.set(`${r.key}#${r.version}`, r);

    const compiled = compiledRows(set);
    // Hash guard first: nothing is written when any published text changed.
    for (const c of compiled) {
      const row = byKey.get(`${c.key}#${c.version}`);
      if (row && row.sha256 !== c.sha256) {
        throw new PolicyVersionConflict(
          `${c.key} v${c.version} changed after it was published. Publish it as a new version instead.`,
        );
      }
    }

    let inserted = 0;
    let retired = 0;
    let unchanged = 0;
    const batch = pb.createBatch();
    let ops = 0;
    const keys = [...new Set(compiled.map((c) => c.key))];
    for (const key of keys) {
      const versions = compiled
        .filter((c) => c.key === key)
        .sort((a, b) => a.version - b.version);
      const top = versions[versions.length - 1]!.version;
      for (const c of versions) {
        if (byKey.has(`${c.key}#${c.version}`)) {
          unchanged += 1;
          continue;
        }
        const id = newRecordId();
        const status = c.version === top ? "active" : "retired";
        batch.collection(COLLECTION).create({ id, ...rowBody(c, status) });
        batch.collection("audit_log").create(
          auditBody(ctx, {
            action: "policy_versions.publish",
            organization: null,
            targetCollection: COLLECTION,
            targetId: id,
            meta: { key: c.key, version: c.version, sha256: c.sha256 },
          }),
        );
        ops += 2;
        inserted += 1;
      }
      for (const r of stored) {
        if (r.key !== key || r.status !== "active" || r.version >= top) {
          continue;
        }
        batch.collection(COLLECTION).update(r.id, { status: "retired" });
        batch.collection("audit_log").create(
          auditBody(ctx, {
            action: "policy_versions.retire",
            organization: null,
            targetCollection: COLLECTION,
            targetId: r.id,
            meta: { key: r.key, version: r.version, replacedBy: top },
          }),
        );
        ops += 2;
        retired += 1;
      }
    }
    if (ops > 0) await batch.send();
    return { inserted, retired, unchanged };
  });
}

/**
 * Mirror the compiled set into policy_versions. Always runs a fresh sync; a success also
 * satisfies the memo used by the active lookups, a failure clears it.
 */
export async function syncPolicyVersions(): Promise<PolicySyncResult> {
  const p = runSync(currentSet());
  synced = p;
  p.catch(() => {
    if (synced === p) synced = null;
  });
  return p;
}

function ensureSynced(): Promise<PolicySyncResult> {
  if (synced) return synced;
  return syncPolicyVersions();
}

/** The active signup policies in D216 order, after a successful sync. */
export async function activePolicies(): Promise<readonly PolicyVersion[]> {
  await ensureSynced();
  return activePolicyVersions(currentSet());
}

/** The active e-sign consent, after a successful sync. */
export async function activeConsentVersion(): Promise<ConsentVersion> {
  await ensureSynced();
  const c = activeConsent(currentSet());
  if (!c) throw new InvalidInput("no e-sign consent text is compiled");
  return c;
}

/** The stored hash and status of one (key, version), or null (used by verify, 09-14). */
export async function storedPolicyVersion(
  key: string,
  version: number,
): Promise<{ sha256: string; status: "active" | "retired" } | null> {
  if (!Number.isSafeInteger(version) || version < 1) return null;
  const rows = await withSuperuser((pb) =>
    pb.collection(COLLECTION).getList(1, 1, {
      filter: pb.filter("key = {:key} && version = {:version}", {
        key,
        version,
      }),
      fields: "sha256,status",
    }),
  );
  const r = rows.items[0];
  if (!r) return null;
  return {
    sha256: String(r.sha256),
    status: r.status === "retired" ? "retired" : "active",
  };
}

/** The compiled text of one (key, version) from the current set. */
export function policyText(
  key: string,
  version: number,
): PolicyVersion | ConsentVersion | undefined {
  const set = currentSet();
  if (key === CONSENT_KEY) return consentVersion(version, set);
  if (isPolicyKey(key)) return policyVersion(key, version, set);
  return undefined;
}
