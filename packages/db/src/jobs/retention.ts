// The retention job (09-12; LIFE-02, AGR-05, D283, D223, D171, D287, D290, invariant 9;
// CONTEXT A4-Q1..Q4; RESEARCH Pattern 8, Pitfalls 4-6, Open Questions 1-3). It enforces the
// one retention table in @cds/core/legal; every period below is a constant from it.
//
//   1. closed-orgs: orgs with closed_reason set AND status disabled AND closed_at older than
//      CLOSED_ORG_DELETE_DAYS, oldest first, at most RETENTION_ORG_CAP_PER_RUN per run. Each
//      org is re-read and re-checked right before deletion. A lapsed org (disabled, no
//      closed_reason) can never match (invariant 9). Per org: every registry tenant
//      collection (reverse registry order; audit_log and the legal evidence collections are
//      skipped, and so are the payment records, below), orphaned non-staff users (choice 1), every private object under
//      tenants/<org>/ except agreements/ and exports/ (choice 2), the org's public media,
//      then the org row, then one summary audit row (choice 3). Right before the org row is
//      deleted, the org's payment records (billing_invoices, work_orders: plain-text org id,
//      10-04 choice 6) get `retain_until` = run time + PAYMENT_RECORD_RETENTION_YEARS where
//      it is empty (10-28 choice 5, BILL-09, D214); counted in keptPaymentRecordsForDeletedOrgs.
//   2. expired-evidence: agreement_signatures and site_policy_acks past retain_until; a
//      signature's two agreement objects are deleted before its row (D283, AGR-05).
//   2b. expired-payment-records: billing_invoices, then work_orders (invoices reference work
//      orders), with retain_until set and passed, whose org no longer exists (10-28);
//      counted in paymentRecordsExpired.
//   3. audit: audit_log rows older than AUDIT_LOG_RETENTION_DAYS (Pitfall 6), except the
//      LEGAL_EVIDENCE_AUDIT_ACTIONS rows, kept AGREEMENT_RETENTION_YEARS (CR-A02).
//   4. orphan-exports: exports of orgs that no longer exist age out after
//      EXPORT_RETENTION_DAYS (Pitfall 4). Orgs deleted in this run wait for the next run.
//   5. form-drafts: Forms Pro drafts past expires_at (30 days, 10-37, D233) are deleted
//      (purgeExpiredFormDrafts); counted in formDraftsPurged.
//   6. data-downloads (11-40, LIFE-04): ready "Download my data" zips past expires_at
//      (7 days) lose their object and become `expired`; failed rows older than 7 days are
//      deleted (pruneDataDownloads). Then queued requests older than 2 minutes are built
//      (crash recovery for the request's fire-and-forget; not in a dry run). Counted in
//      dataDownloadsExpired, dataDownloadsFailedDeleted, dataDownloadsBuilt.
//
// Step isolation as in jobs/media.ts: a throw is logged (ids only, never names or emails),
// its name lands in failedSteps, and later steps still run. Heartbeat: platform_meta
// RETENTION_HEARTBEAT_KEY (ISO, only when no step failed) and RETENTION_COUNTS_KEY (JSON of
// the result minus deletedOrgs, so no org id or name, every non-dry run). The monitor brief
// (.planning/design/MONITOR-APP-BRIEF.md check 26, D174, D175) documents both; change them
// together. dryRun computes the same selections and counts and writes nothing at all.
// Every filter is bound through pb.filter; lists page 200 rows at a time.
import {
  AGREEMENT_RETENTION_YEARS,
  AUDIT_LOG_RETENTION_DAYS,
  CLOSED_ORG_DELETE_DAYS,
  EXPORT_RETENTION_DAYS,
  LEGAL_EVIDENCE_AUDIT_ACTIONS,
  RETENTION_ORG_CAP_PER_RUN,
} from "@cds/core/legal";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import {
  assertSystemContext,
  mintSystemContext,
  type SystemContext,
} from "../context";
import { assertAddonCollectionsRegistered, pruneExports } from "../export";
import { CLOSED_REASONS, type ClosedReason } from "../org-closure";
import { purgeExpiredFormDrafts } from "../forms/drafts";
import { pruneHubInquiries } from "../hub-inquiries";
import type { EmailTransport } from "../email/transport";
import { alertStaffDomain } from "../offboarding/effects";
import { pruneDataDownloads, runDataDownloads } from "../downloads";
import { readPlatformMeta, writePlatformMeta } from "../platform-meta";
import { allTenantCollections } from "../registry";
import { releaseDeletedOrgIdeas } from "../support/ideas";
import {
  envPrefix,
  getAgreementStore,
  getObjectStore,
  getPublicMediaStore,
  tenantAgreementKey,
  tenantExportPrefix,
  type ObjectStore,
} from "../storage";

export const RETENTION_HEARTBEAT_KEY = "job:retention:last_success";
export const RETENTION_COUNTS_KEY = "job:retention:last_counts";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 200;
const ORG_ID_RE = /^[a-z0-9]{15}$/;
/**
 * Payment records are tax records: what was charged, and what was quoted and accepted. They
 * are kept this many years after the org is deleted (10-28 choice 5, BILL-09, D214).
 * Confirm the period with the accountant before launch (GO-LIVE, 10-44).
 */
export const PAYMENT_RECORD_RETENTION_YEARS = 7;
/** Deletion order matters: invoices reference work orders. */
const PAYMENT_RECORD_COLLECTIONS = ["billing_invoices", "work_orders"] as const;
/**
 * Never deleted with the org: evidence keeps its own clock, audit rows age out by date and
 * payment records are kept PAYMENT_RECORD_RETENTION_YEARS after the org is deleted.
 */
const KEPT_WITH_ORG = new Set<string>([
  "audit_log",
  "agreement_signatures",
  "site_policy_acks",
  ...PAYMENT_RECORD_COLLECTIONS,
]);
/**
 * The job's selection, shared with retentionStatus so the monitor never counts an org the
 * job would skip (a closed org re-enabled by a staff status edit; WR-A01).
 */
const CLOSED_ORG_DUE_FILTER =
  "closed_reason != '' && status = 'disabled' && closed_at != '' && closed_at <= {:cut}";
/**
 * P14-P27 (14-39; RESEARCH Pitfall 11): an org with a dns_zones row not handed back or
 * deleted is never deleted (its zone would be orphaned in CDS's DNS account). Bound filter.
 */
const OPEN_ZONE_FILTER =
  "org_id = {:org} && status != 'handed_back' && status != 'deleted'";
/** One staff alert per skipped org, ever (platform_meta claim). */
export const RETENTION_ZONE_SKIP_PREFIX = "retention:zone_skip:";
/** Extra closed orgs read per run so zone-skipped ones never starve the cap. */
const ZONE_SKIP_SLACK = 50;
/** Private subtrees that outlive the org (choice 2). */
const KEPT_PREFIXES = ["agreements/", "exports/"];

export type RetentionJobResult = {
  dryRun: boolean;
  orgsDue: number;
  orgsDeleted: number;
  capHit: boolean;
  /** Orgs deleted (or, in a dry run, that would be). Never written to the counts key. */
  deletedOrgs: readonly {
    id: string;
    name: string;
    reason: ClosedReason;
    closedAt: string;
  }[];
  signaturesExpired: number;
  acksExpired: number;
  auditDeleted: number;
  orphanExportsPruned: number;
  /** Forms Pro drafts past expires_at (10-37). */
  formDraftsPurged: number;
  /** Ready data downloads past expires_at: object deleted, row expired (11-40). */
  dataDownloadsExpired: number;
  /** Failed data download rows older than 7 days, deleted (11-40). */
  dataDownloadsFailedDeleted: number;
  /** Queued data downloads the job built (crash recovery, 11-40). */
  dataDownloadsBuilt: number;
  usersDeleted: number;
  /** Signature rows still inside retain_until that belong to orgs deleted in this run. */
  keptAgreementsForDeletedOrgs: number;
  /** billing_invoices + work_orders rows past retain_until, deleted (10-28). */
  paymentRecordsExpired: number;
  /** billing_invoices + work_orders rows of orgs deleted in this run, kept (10-28). */
  keptPaymentRecordsForDeletedOrgs: number;
  /** Closed orgs skipped because a CDS DNS zone is not handed back (P14-P27, 14-39). */
  zoneSkipped: number;
  /** Hub /contact inquiries older than 730 days, deleted (15-07, P15-P14). */
  hubInquiriesDeleted: number;
  failedSteps: string[];
};

export type RetentionJobDeps = {
  privateStore?: ObjectStore;
  publicStore?: ObjectStore;
  agreementStore?: ObjectStore;
  writeMeta?: (ctx: SystemContext, key: string, value: string) => Promise<void>;
  /** Test seam: runs after selection, before the per-org re-check. */
  beforeOrgDelete?: (orgId: string) => Promise<void>;
  /** The zone-skip staff alert transport (14-39); defaults to the configured one. */
  transport?: EmailTransport;
};

export type RetentionJobOptions = {
  now?: Date;
  dryRun?: boolean;
  deps?: RetentionJobDeps;
};

// ------------------------------------------------------------------ single-key mutex
let chain: Promise<unknown> = Promise.resolve();

function withJobLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ------------------------------------------------------------------ helpers
function toDate(v: unknown): Date | null {
  if (typeof v !== "string" || v === "") return null;
  const d = new Date(v.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function logFailure(what: string, id: string, err: unknown): void {
  // Ids only: never a name or an email address.
  console.error(`[jobs/retention] ${what} failed for ${id}: ${message(err)}`);
}

function tenantRoot(orgId: string): string {
  return `${envPrefix()}tenants/${orgId}/`;
}

/** Every matching row, paged PAGE at a time, listed before anything is deleted. */
async function listRows(
  collection: string,
  filter: string,
  params: Record<string, unknown>,
  fields = "id",
): Promise<RecordModel[]> {
  return withSuperuser(async (pb: PocketBase) => {
    const out: RecordModel[] = [];
    for (let page = 1; ; page++) {
      const res = await pb.collection(collection).getList(page, PAGE, {
        filter: pb.filter(filter, params),
        sort: "id",
        fields,
      });
      out.push(...res.items);
      if (page >= res.totalPages || res.items.length === 0) return out;
    }
  });
}

async function countRows(
  collection: string,
  filter: string,
  params: Record<string, unknown>,
): Promise<number> {
  return withSuperuser(
    async (pb) =>
      (
        await pb.collection(collection).getList(1, 1, {
          filter: pb.filter(filter, params),
          fields: "id",
        })
      ).totalItems,
  );
}

/** `now` plus PAYMENT_RECORD_RETENTION_YEARS UTC years. */
function paymentRetainUntil(now: Date): Date {
  const out = new Date(now.getTime());
  out.setUTCFullYear(out.getUTCFullYear() + PAYMENT_RECORD_RETENTION_YEARS);
  return out;
}

/** The org's kept payment rows (both collections), with their retain_until. */
async function paymentRowsOf(
  orgId: string,
): Promise<{ collection: string; row: RecordModel }[]> {
  const out: { collection: string; row: RecordModel }[] = [];
  for (const collection of PAYMENT_RECORD_COLLECTIONS) {
    const rows = await listRows(
      collection,
      "organization = {:org}",
      { org: orgId },
      "id,retain_until",
    );
    for (const row of rows) out.push({ collection, row });
  }
  return out;
}

/** Stamp retain_until on the org's payment rows where it is empty; returns how many. */
async function stampPaymentRows(
  rows: readonly { collection: string; row: RecordModel }[],
  until: Date,
): Promise<number> {
  let n = 0;
  for (const { collection, row } of rows) {
    if (String(row.retain_until ?? "") !== "") continue;
    await withSuperuser((pb) =>
      pb.collection(collection).update(row.id, {
        retain_until: until.toISOString(),
      }),
    );
    n += 1;
  }
  return n;
}

async function deleteRow(collection: string, id: string): Promise<void> {
  await withSuperuser((pb) => pb.collection(collection).delete(id));
}

/** Delete rows one by one; a row that fails is logged and the step fails at the end. */
async function deleteRows(
  collection: string,
  rows: readonly RecordModel[],
  before?: (row: RecordModel) => Promise<void>,
): Promise<number> {
  let n = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (before) await before(row);
      await deleteRow(collection, row.id);
      n += 1;
    } catch (err) {
      failed += 1;
      logFailure(`${collection} delete`, row.id, err);
    }
  }
  if (failed > 0) {
    throw new Error(`${failed} ${collection} row(s) could not be deleted`);
  }
  return n;
}

type DueOrg = {
  id: string;
  name: string;
  reason: ClosedReason;
  closedAt: Date;
};

/** The three conditions, checked on a freshly read row. */
function dueOrg(row: RecordModel, cut: Date): DueOrg | null {
  const reason = String(row.closed_reason ?? "");
  const closedAt = toDate(row.closed_at);
  if (!(CLOSED_REASONS as readonly string[]).includes(reason)) return null;
  if (row.status !== "disabled") return null;
  if (!closedAt || closedAt.getTime() > cut.getTime()) return null;
  return {
    id: row.id,
    name: String(row.name ?? ""),
    reason: reason as ClosedReason,
    closedAt,
  };
}

async function rereadDue(orgId: string, cut: Date): Promise<DueOrg | null> {
  const rows = await listRows(
    "organizations",
    "id = {:id}",
    { id: orgId },
    "id,name,status,closed_reason,closed_at",
  );
  return rows[0] ? dueOrg(rows[0], cut) : null;
}

/** Members of the org who would be left with no membership and are not CDS staff. */
async function orphanUsers(orgId: string): Promise<string[]> {
  const members = await listRows(
    "memberships",
    "organization = {:org}",
    { org: orgId },
    "id,user",
  );
  const userIds = [...new Set(members.map((m) => String(m.user ?? "")))].filter(
    Boolean,
  );
  const out: string[] = [];
  for (const user of userIds) {
    const u = await listRows(
      "users",
      "id = {:id} && staff_role = ''",
      { id: user },
      "id",
    );
    if (u.length === 0) continue;
    const elsewhere = await countRows(
      "memberships",
      "user = {:user} && organization != {:org}",
      { user, org: orgId },
    );
    if (elsewhere === 0) out.push(user);
  }
  return out;
}

async function privateObjectsOf(
  store: ObjectStore,
  orgId: string,
): Promise<string[]> {
  const root = tenantRoot(orgId);
  return (await store.list(root))
    .map((o) => o.key)
    .filter((key) => {
      const rest = key.slice(root.length);
      return !KEPT_PREFIXES.some((p) => rest.startsWith(p));
    });
}

/** Tenant collection rows, reverse registry order; a second pass retries what a reference blocked. */
async function deleteTenantRows(orgId: string): Promise<number> {
  const names = Object.keys(allTenantCollections())
    .reverse()
    .filter((n) => !KEPT_WITH_ORG.has(n));
  let total = 0;
  let pending = names;
  for (let pass = 0; pass < 2 && pending.length > 0; pass++) {
    const failed: string[] = [];
    for (const name of pending) {
      try {
        const rows = await listRows(name, "organization = {:org}", {
          org: orgId,
        });
        total += await deleteRows(name, rows);
      } catch (err) {
        failed.push(name);
        if (pass === 1) logFailure(`${name} rows`, orgId, err);
      }
    }
    pending = failed;
  }
  if (pending.length > 0) {
    throw new Error(`tenant rows left in ${pending.join(", ")}`);
  }
  return total;
}

/** One staff alert per org whose deletion a CDS zone blocks (claim in platform_meta). */
async function alertZoneSkipOnce(
  ctx: SystemContext,
  orgId: string,
  domain: string,
  deps: RetentionJobDeps,
): Promise<void> {
  const key = `${RETENTION_ZONE_SKIP_PREFIX}${orgId}`;
  if (await readPlatformMeta(key)) return;
  await writePlatformMeta(ctx, key, new Date().toISOString());
  console.error(`[jobs/retention] closed org ${orgId} kept: DNS zone at CDS`);
  await alertStaffDomain(orgId, domain, "handback_overdue", {
    ...(deps.transport ? { transport: deps.transport } : {}),
  });
}

// ------------------------------------------------------------------ the run
async function runOnce(opts: RetentionJobOptions): Promise<RetentionJobResult> {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const dryRun = opts.dryRun === true;
  const deps = opts.deps ?? {};
  const ctx = mintSystemContext({ job: "retention" });
  assertSystemContext(ctx);
  const privateStore = () => deps.privateStore ?? getObjectStore();
  const publicStore = () => deps.publicStore ?? getPublicMediaStore();
  const agreementStore = () => deps.agreementStore ?? getAgreementStore();

  const result: RetentionJobResult = {
    dryRun,
    orgsDue: 0,
    orgsDeleted: 0,
    capHit: false,
    deletedOrgs: [],
    signaturesExpired: 0,
    acksExpired: 0,
    auditDeleted: 0,
    orphanExportsPruned: 0,
    formDraftsPurged: 0,
    dataDownloadsExpired: 0,
    dataDownloadsFailedDeleted: 0,
    dataDownloadsBuilt: 0,
    usersDeleted: 0,
    keptAgreementsForDeletedOrgs: 0,
    paymentRecordsExpired: 0,
    keptPaymentRecordsForDeletedOrgs: 0,
    zoneSkipped: 0,
    hubInquiriesDeleted: 0,
    failedSteps: [],
  };
  const deletedOrgs: {
    id: string;
    name: string;
    reason: ClosedReason;
    closedAt: string;
  }[] = [];
  const handledOrgIds = new Set<string>();

  async function step(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      console.error(`[jobs/retention] ${name} failed: ${message(err)}`);
      result.failedSteps.push(name);
    }
  }

  // 1. Closed orgs.
  await step("closed-orgs", async () => {
    assertAddonCollectionsRegistered();
    const cut = new Date(now.getTime() - CLOSED_ORG_DELETE_DAYS * DAY_MS);
    const page = await withSuperuser((pb) =>
      pb
        .collection("organizations")
        .getList(1, RETENTION_ORG_CAP_PER_RUN + ZONE_SKIP_SLACK, {
          filter: pb.filter(CLOSED_ORG_DUE_FILTER, { cut }),
          sort: "closed_at",
          fields: "id",
        }),
    );
    result.orgsDue = page.totalItems;
    result.capHit = page.totalItems > RETENTION_ORG_CAP_PER_RUN;
    let failed = 0;
    let processed = 0;
    for (const picked of page.items) {
      if (processed >= RETENTION_ORG_CAP_PER_RUN) break;
      try {
        if (deps.beforeOrgDelete) await deps.beforeOrgDelete(picked.id);
        const org = await rereadDue(picked.id, cut);
        if (!org || !ORG_ID_RE.test(org.id)) {
          console.error(
            `[jobs/retention] closed-orgs skipped ${picked.id}: no longer due`,
          );
          continue;
        }
        // P14-P27: a CDS zone still serving (not handed_back | deleted) blocks deletion.
        const zones = await withSuperuser((pb) =>
          pb.collection("dns_zones").getFullList({
            filter: pb.filter(OPEN_ZONE_FILTER, { org: org.id }),
            fields: "id,domain",
          }),
        );
        if (zones.length > 0) {
          result.zoneSkipped += 1;
          if (!dryRun) {
            await alertZoneSkipOnce(
              ctx,
              org.id,
              String(zones[0]!.domain ?? ""),
              deps,
            );
          }
          continue;
        }
        processed += 1;
        const orphans = await orphanUsers(org.id);
        const kept = await countRows(
          "agreement_signatures",
          "organization = {:org} && retain_until > {:now}",
          { org: org.id, now },
        );
        const payments = await paymentRowsOf(org.id);
        if (!dryRun) {
          // 12-REVIEW WR-A07: votes recounted, suggested ideas hidden and unlinked.
          await releaseDeletedOrgIdeas(org.id, now);
          const rows = await deleteTenantRows(org.id);
          let users = 0;
          for (const u of orphans) {
            // Re-checked: a membership may have appeared since the scan.
            const still = await countRows("memberships", "user = {:u}", {
              u,
            });
            if (still > 0) continue;
            await deleteRow("users", u);
            users += 1;
          }
          const priv = privateStore();
          const objects = await privateObjectsOf(priv, org.id);
          for (const key of objects) await priv.delete(key);
          const pub = publicStore();
          const media = await pub.list(`${tenantRoot(org.id)}media/`);
          for (const o of media) await pub.delete(o.key);
          // Payment records outlive the org (10-28 choice 5): stamp, then delete the org row.
          const stamped = await stampPaymentRows(
            payments,
            paymentRetainUntil(now),
          );
          await deleteRow("organizations", org.id);
          await withSuperuser((pb) =>
            pb.collection("audit_log").create(
              auditBody(ctx, {
                action: "organization.delete",
                organization: null,
                targetCollection: "organizations",
                targetId: org.id,
                meta: {
                  closed_reason: org.reason,
                  closed_at: org.closedAt.toISOString(),
                  rows,
                  users,
                  privateObjects: objects.length,
                  publicObjects: media.length,
                  keptSignatures: kept,
                  keptPaymentRecords: payments.length,
                  stampedPaymentRecords: stamped,
                },
              }),
            ),
          );
          result.orgsDeleted += 1;
          result.usersDeleted += users;
        } else {
          result.usersDeleted += orphans.length;
        }
        result.keptAgreementsForDeletedOrgs += kept;
        result.keptPaymentRecordsForDeletedOrgs += payments.length;
        handledOrgIds.add(org.id);
        deletedOrgs.push({
          id: org.id,
          name: org.name,
          reason: org.reason,
          closedAt: org.closedAt.toISOString(),
        });
      } catch (err) {
        failed += 1;
        logFailure("closed org", picked.id, err);
      }
    }
    if (failed > 0) throw new Error(`${failed} closed org(s) not deleted`);
  });

  // 2. Expired evidence (signatures: objects first, then the row).
  await step("expired-evidence", async () => {
    const filter = "retain_until <= {:now}";
    const sigs = await listRows(
      "agreement_signatures",
      filter,
      { now },
      "id,organization",
    );
    const acks = await listRows("site_policy_acks", filter, { now });
    if (dryRun) {
      result.signaturesExpired = sigs.length;
      result.acksExpired = acks.length;
      return;
    }
    let error: unknown = null;
    try {
      const store = agreementStore();
      result.signaturesExpired = await deleteRows(
        "agreement_signatures",
        sigs,
        async (row) => {
          const org = String(row.organization ?? "");
          await store.delete(tenantAgreementKey(org, row.id, "json"));
          await store.delete(tenantAgreementKey(org, row.id, "html"));
        },
      );
    } catch (err) {
      error = err;
    }
    result.acksExpired = await deleteRows("site_policy_acks", acks);
    if (error) throw error;
  });

  // 2b. Expired payment records (10-28 choice 5): invoices first, they reference work orders.
  //     Only rows whose org is gone: a live org's rows are never expired, even if stamped.
  await step("expired-payment-records", async () => {
    const goneOrg = new Map<string, boolean>();
    const isGone = async (orgId: string): Promise<boolean> => {
      const known = goneOrg.get(orgId);
      if (known !== undefined) return known;
      const gone =
        (await countRows("organizations", "id = {:id}", { id: orgId })) === 0;
      goneOrg.set(orgId, gone);
      return gone;
    };
    const due: { collection: string; rows: RecordModel[] }[] = [];
    for (const collection of PAYMENT_RECORD_COLLECTIONS) {
      const rows = await listRows(
        collection,
        "retain_until != '' && retain_until <= {:now}",
        { now },
        "id,organization",
      );
      const out: RecordModel[] = [];
      for (const row of rows) {
        if (await isGone(String(row.organization ?? ""))) out.push(row);
      }
      due.push({ collection, rows: out });
    }
    if (dryRun) {
      result.paymentRecordsExpired = due.reduce((n, d) => n + d.rows.length, 0);
      return;
    }
    for (const d of due) {
      result.paymentRecordsExpired += await deleteRows(d.collection, d.rows);
    }
  });

  // 3. Audit rows past AUDIT_LOG_RETENTION_DAYS. Legal evidence rows (agreement.sign and the
  //    other LEGAL_EVIDENCE_AUDIT_ACTIONS) are the second record verify needs, so they are
  //    kept AGREEMENT_RETENTION_YEARS, the same clock as the signatures (CR-A02).
  await step("audit", async () => {
    const cut = new Date(now.getTime() - AUDIT_LOG_RETENTION_DAYS * DAY_MS);
    const legalCut = new Date(now.getTime());
    legalCut.setUTCFullYear(
      legalCut.getUTCFullYear() - AGREEMENT_RETENTION_YEARS,
    );
    const params: Record<string, unknown> = { cut, legalCut };
    const names = LEGAL_EVIDENCE_AUDIT_ACTIONS.map((action, i) => {
      params[`a${i}`] = action;
      return `{:a${i}}`;
    });
    const ordinary = await listRows(
      "audit_log",
      `created <= {:cut} && ${names.map((n) => `action != ${n}`).join(" && ")}`,
      params,
    );
    const legal = await listRows(
      "audit_log",
      `created <= {:legalCut} && (${names.map((n) => `action = ${n}`).join(" || ")})`,
      params,
    );
    const rows = [...ordinary, ...legal];
    result.auditDeleted = dryRun
      ? rows.length
      : await deleteRows("audit_log", rows);
  });

  // 3b. Hub /contact inquiries past HUB_INQUIRY_RETENTION_DAYS (15-07, P15-P14). A dry run
  //     only counts them.
  await step("hub-inquiries", async () => {
    const pruned = await pruneHubInquiries(now, { dryRun });
    result.hubInquiriesDeleted = pruned.deleted;
  });

  // 4. Exports of orgs that no longer exist (Pitfall 4).
  await step("orphan-exports", async () => {
    const store = privateStore();
    const base = `${envPrefix()}tenants/`;
    const ids = new Set<string>();
    for (const o of await store.list(base)) {
      const [id, sub] = o.key.slice(base.length).split("/");
      if (id && sub === "exports") ids.add(id);
    }
    // In a dry run nothing is deleted: the wrapper only records what would be pruned.
    const target: ObjectStore = dryRun
      ? {
          put: () => Promise.reject(new Error("dry run writes nothing")),
          get: (key) => store.get(key),
          list: (prefix) => store.list(prefix),
          delete: () => Promise.resolve(),
        }
      : store;
    for (const id of ids) {
      if (handledOrgIds.has(id)) continue; // deleted this run: ages out from the next run
      try {
        tenantExportPrefix(id);
      } catch {
        continue; // not a key this platform writes
      }
      const live = await countRows("organizations", "id = {:id}", { id });
      if (live > 0) continue;
      const pruned = await pruneExports(target, id, now, EXPORT_RETENTION_DAYS);
      result.orphanExportsPruned += pruned.length;
    }
  });

  // 5. Expired Forms Pro drafts (10-37, D233, T-10-37-04).
  await step("form-drafts", async () => {
    result.formDraftsPurged = await purgeExpiredFormDrafts(ctx, {
      now,
      dryRun,
    });
  });

  // 6. "Download my data" zips (11-40, LIFE-04, choice 7).
  await step("data-downloads", async () => {
    const pruned = await pruneDataDownloads(ctx, {
      now,
      dryRun,
      store: dryRun ? undefined : privateStore(),
    });
    result.dataDownloadsExpired = pruned.expired;
    result.dataDownloadsFailedDeleted = pruned.failedDeleted;
    if (!dryRun) {
      const built = await runDataDownloads(ctx, {
        now,
        store: privateStore(),
      });
      result.dataDownloadsBuilt = built.built.length;
    }
  });

  result.deletedOrgs = deletedOrgs;
  if (!dryRun) {
    const write = deps.writeMeta ?? writePlatformMeta;
    if (result.failedSteps.length === 0) {
      await write(ctx, RETENTION_HEARTBEAT_KEY, now.toISOString());
    }
    // Counts carry no org id or name (T-09-12-05): deletedOrgs is left out.
    const counts = Object.fromEntries(
      Object.entries(result).filter(([k]) => k !== "deletedOrgs"),
    );
    await write(ctx, RETENTION_COUNTS_KEY, JSON.stringify(counts));
  }
  return result;
}

/** Run the retention job once, serialised with any concurrent run in this process. */
export async function runRetentionJob(
  opts: RetentionJobOptions = {},
): Promise<RetentionJobResult> {
  return withJobLock(() => runOnce(opts));
}

// ------------------------------------------------------------------ monitor status
export type RetentionStatusReport = {
  /** ISO time of the last run with no failed step, or null when it never ran clean. */
  last_success: string | null;
  /** The last run found more closed orgs due than the per-run cap. */
  cap_hit: boolean;
  /** Closed orgs past CLOSED_ORG_DELETE_DAYS still present (the job is behind). */
  overdue_closed_orgs: number;
};

/**
 * The retention job's monitor view (09-21; monitor brief check 26, `jobs.retention`; D174,
 * D175). Counts only: never an org id or name (T-09-21-03). A lapsed org (no closed_reason)
 * is never overdue (invariant 9). Unparseable counts read as cap_hit false.
 */
export async function retentionStatus(
  now: Date = new Date(),
): Promise<RetentionStatusReport> {
  const cut = new Date(now.getTime() - CLOSED_ORG_DELETE_DAYS * DAY_MS);
  const overdue = await countRows("organizations", CLOSED_ORG_DUE_FILTER, {
    cut,
  });
  const last = await readPlatformMeta(RETENTION_HEARTBEAT_KEY);
  let capHit = false;
  const raw = await readPlatformMeta(RETENTION_COUNTS_KEY);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      capHit =
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as { capHit?: unknown }).capHit === true;
    } catch {
      capHit = false;
    }
  }
  return {
    last_success: last || null,
    cap_hit: capHit,
    overdue_closed_orgs: overdue,
  };
}
