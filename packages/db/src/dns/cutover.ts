// packages/db/src/dns/cutover.ts (P14, DOM-02, DOM-08, CONT-16).
// Owner: 14-23 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// The domain move state machine, part 2 (14-23): the minutes-long launch-day steps that CDS
// approval starts (D26, D169), "prepare early, launch instantly" (D119):
//   6 site_records  apex A -> CDS_EDGE_IPV4, www CNAME -> apex (TTL 300) in the CDS zone
//   7 edge          1.1.1.1 AND 8.8.8.8 answer the edge IP for apex and www; only then the
//                   org_hosts rows are created, verified, so the hosts join the route list
//                   (no route, and no ACME attempt, before public DNS points at the edge:
//                   RESEARCH Pitfall 4, P14-P8, T-14-23-01)
//   8 https         the prober gets 200 and this org's cds-host proof on both hosts
//                   (T-14-23-02); a retry after a failure bumps platform_meta
//                   `edge:retry:<host>` so the edge renames the router and re-issues
//   9 cutover       ONE batch moves the primary to the custom host (T-14-23-03); a launch
//                   move then goes live (setOrgStage stamps launched_at)
//   10 search       sitemap submitted + IndexNow pinged for the new host; never fails
// The runner, persistence and retry live in ./moves (14-22), which loads `LATE_STEPS` lazily.
// A failure in steps 6-9 leaves the site on its current domain with the primary unchanged.
// Every step is idempotent: a re-run after a crash writes nothing new. A hostname owned by
// another org is never reassigned (host_taken, T-14-23-04).
// Errors are logged by class name only; step details carry codes, never hosts or values.
import { authorizeStaff, InvalidInput } from "@cds/core";
import {
  fqdn,
  P14_COPY,
  recordKey,
  type DnsRecord,
  type MoveStepKey,
} from "@cds/core/dns";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { pingAndRecord } from "../content/indexing-record";
import { withOrgLock } from "../content/lock";
import { siteUrls } from "../content/shared";
import { submitAndRecord } from "../content/sitemap-submit";
import {
  assertPlatformContext,
  mintSystemContext,
  scopedOrgId,
  type PlatformContext,
} from "../context";
import { computeAcceptedEmailHash } from "../email/sending-domains/ensure";
import { loadReviewFacts, resubmitNeededOf } from "../launch-review/facts";
import { forgetOrgLive, setOrgStage } from "../org-stage";
import { readPlatformMeta, writePlatformMeta } from "../platform-meta";
import { EDGE_RETRY_KEY_PREFIX, forgetHost, verifyCdsHostProof } from "./edge";
import { getDnsProvider, getDnsResolver, getHttpsProber } from "./factory";
import {
  advanceMove,
  loadMoveRow,
  MOVE_STEPS,
  moveViewOf,
  openMoveFor,
  type MoveDeps,
  type MoveRow,
  type MoveView,
  type StepFn,
  type StepOutcome,
} from "./moves";
import {
  PUBLIC_RESOLVERS,
  type DnsProvider,
  type DnsResolver,
  type ProbeResult,
} from "./ports";
import { readDnsZoneRow } from "./snapshot";

// ---------------------------------------------------------------------------------------
// Constants and small helpers
// ---------------------------------------------------------------------------------------

const SITE_TTL = 300;
const MIN_MS = 60_000;
/** Backoff between checks, minutes (P14-P8): 1, 2, 4, 8, 15, then every 30. */
const BACKOFF_MIN = [1, 2, 4, 8, 15, 30] as const;
/** Step 7 gives up once it has waited this long in one round (choice 2). */
const EDGE_GIVE_UP_MS = 2 * 3_600_000;
/** Step 8 fails on its 6th failed check in one round (choice 3). */
const HTTPS_MAX_CHECKS = 6;
const CNAME_HOPS = 5;
const IPV4_RE =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const META_KEY_RE = /^[a-z0-9:._-]{1,100}$/;
const DNS_ZONES = "dns_zones";
const MOVES = "domain_moves";

const sysCtx = () => mintSystemContext({ job: "domains" });

function errName(err: unknown): string {
  return err instanceof Error ? err.name : "Error";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function code(v: string): string {
  const c = v
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 40);
  return c === "" ? "unknown" : c;
}

/** The edge's public IPv4 (CDS_EDGE_IPV4), or null when unset or not an IPv4 address. */
function edgeIp(): string | null {
  const ip = (process.env.CDS_EDGE_IPV4 ?? "").trim();
  return IPV4_RE.test(ip) ? ip : null;
}

function backoffMs(check: number): number {
  const i = Math.min(Math.max(check, 1), BACKOFF_MIN.length) - 1;
  return (BACKOFF_MIN[i] as number) * MIN_MS;
}

/** Total wait before check `check` of a round (checks are 1-based). */
function waitedBefore(check: number): number {
  let ms = 0;
  for (let i = 1; i < check; i++) ms += backoffMs(i);
  return ms;
}

/** The check number stored in a `<prefix>:<n>` detail; 0 starts a new round. */
function checkNo(detail: string | undefined, prefix: string): number {
  const m = new RegExp(`^${prefix}:(\\d{1,3})$`).exec(detail ?? "");
  return m ? Number(m[1]) : 0;
}

/** Apex and www of the move's domain, primary first (P14-P16). */
function hostsOf(move: MoveRow): {
  apex: string;
  www: string;
  primary: string;
  secondary: string;
} {
  const apex = fqdn(move.toHost);
  const www = `www.${apex}`;
  return move.primaryChoice === "www"
    ? { apex, www, primary: www, secondary: apex }
    : { apex, www, primary: apex, secondary: www };
}

function provider(deps: MoveDeps): DnsProvider {
  return deps.provider ?? getDnsProvider();
}

const done = (detail: string): StepOutcome => ({ status: "done", detail });
const failedStaff = (
  detail: string,
  step: MoveStepKey,
  attempt: number,
): StepOutcome => ({
  status: "failed",
  detail,
  notices: [
    {
      to: "staff",
      key: `${step}_failed:${attempt}`,
      kind: "move_failed",
      step,
    },
  ],
});

// ---------------------------------------------------------------------------------------
// Step 6: site records (choice 1)
// ---------------------------------------------------------------------------------------

/** Add `keys` to dns_zones.cds_keys.cds and re-accept the email hash (P14-P39). */
async function rememberCdsKeys(
  orgId: string,
  domain: string,
  p: DnsProvider,
  zoneId: string,
  keys: readonly string[],
  now: Date,
): Promise<void> {
  await withSuperuser(async (pb) => {
    const zone = await pb.collection(DNS_ZONES).getFirstListItem(
      pb.filter("org_id = {:org} && domain = {:d}", {
        org: orgId,
        d: domain,
      }),
    );
    const raw = (zone.cds_keys ?? {}) as Record<string, unknown>;
    const list = (v: unknown) =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string")
        : [];
    const cds = [...new Set([...list(raw.cds), ...keys])];
    const records = await p.listRecords(zoneId);
    await pb.collection(DNS_ZONES).update(zone.id, {
      cds_keys: { ...raw, cds, owner: list(raw.owner) },
      accepted_email_hash: computeAcceptedEmailHash(records, domain, cds),
      accepted_at: now.toISOString(),
    });
  });
}

const siteRecordsStep: StepFn = async ({ move, step, deps, now }) => {
  const ip = edgeIp();
  if (!ip) {
    return failedStaff("edge_ip_unset", "site_records", step.attempts ?? 0);
  }
  const row = await readDnsZoneRow(move.orgId, move.toHost);
  if (!row?.providerZoneId) return { status: "failed", detail: "no_zone" };
  const zoneId = row.providerZoneId;
  const p = provider(deps);
  const { apex, www } = hostsOf(move);
  const a: DnsRecord = {
    type: "A",
    name: apex,
    value: ip,
    ttl: SITE_TTL,
    sources: ["cds"],
  };
  const cname: DnsRecord = {
    type: "CNAME",
    name: www,
    value: apex,
    ttl: SITE_TTL,
    sources: ["cds"],
  };
  // Add the new records first, then remove the old website's, so the names never go empty.
  await p.upsertRecord(zoneId, a);
  await p.upsertRecord(zoneId, cname);
  const keep = new Set([recordKey(a), recordKey(cname)]);
  for (const r of await p.listRecords(zoneId)) {
    const name = fqdn(r.name);
    const site =
      (name === apex && (r.type === "A" || r.type === "AAAA")) ||
      (name === www &&
        (r.type === "A" || r.type === "AAAA" || r.type === "CNAME"));
    if (site && !keep.has(recordKey(r))) await p.deleteRecord(zoneId, r.id);
  }
  await rememberCdsKeys(move.orgId, row.domain, p, zoneId, [...keep], now);
  return done("apex A to the edge · www to apex · TTL 300");
};

// ---------------------------------------------------------------------------------------
// Step 7: edge (choice 2)
// ---------------------------------------------------------------------------------------

/** "yes" when every A answer for `host` (CNAMEs followed) is the edge IP. */
async function pointsAtEdge(
  resolver: DnsResolver,
  host: string,
  server: string,
  ip: string,
): Promise<"yes" | "no" | "error"> {
  let name = host;
  for (let hop = 0; hop < CNAME_HOPS; hop++) {
    const ans = await resolver.resolve(name, "A", { servers: [server] });
    if (ans.status === "error") return "error";
    if (ans.status !== "ok") return "no";
    const as = ans.records.filter((r) => r.type === "A");
    if (as.length > 0) {
      return as.every((r) => r.value.trim() === ip) ? "yes" : "no";
    }
    const c = ans.records.find((r) => r.type === "CNAME");
    if (!c) return "no";
    name = fqdn(c.value);
  }
  return "no";
}

/**
 * Create (or update) the org_hosts rows for apex and www, verified, in one batch. Returns
 * false when either hostname belongs to another org (never reassigned).
 */
async function writeVerifiedHosts(move: MoveRow, now: Date): Promise<boolean> {
  const { primary, secondary } = hostsOf(move);
  const at = now.toISOString();
  return withSuperuser(async (pb) => {
    const rows = await pb.collection("org_hosts").getFullList({
      filter: pb.filter("hostname = {:a} || hostname = {:b}", {
        a: primary,
        b: secondary,
      }),
    });
    if (rows.some((r) => r.organization !== move.orgId)) return false;
    const byHost = new Map(rows.map((r) => [str(r.hostname), r]));
    const want: { host: string; body: Record<string, unknown> }[] = [
      {
        host: primary,
        body: { kind: "custom", redirect_to: "", verified_at: at },
      },
      {
        host: secondary,
        body: { kind: "redirect", redirect_to: primary, verified_at: at },
      },
    ];
    const batch = pb.createBatch();
    for (const w of want) {
      const existing = byHost.get(w.host);
      if (existing) {
        const verified = str(existing.verified_at) !== "";
        batch.collection("org_hosts").update(existing.id, {
          ...w.body,
          verified_at: verified ? existing.verified_at : at,
        });
      } else {
        batch.collection("org_hosts").create({
          hostname: w.host,
          organization: move.orgId,
          primary: false,
          ...w.body,
        });
      }
    }
    await batch.send();
    return true;
  });
}

const edgeStep: StepFn = async ({ move, step, deps, now }) => {
  const ip = edgeIp();
  if (!ip) return failedStaff("edge_ip_unset", "edge", step.attempts ?? 0);
  const resolver = deps.resolver ?? getDnsResolver();
  const { apex, www } = hostsOf(move);
  let pointing = true;
  for (const host of [apex, www]) {
    for (const server of PUBLIC_RESOLVERS) {
      if ((await pointsAtEdge(resolver, host, server, ip)) !== "yes") {
        pointing = false;
      }
    }
  }
  if (!pointing) {
    const check = checkNo(step.detail, "waiting_dns") + 1;
    if (waitedBefore(check) >= EDGE_GIVE_UP_MS) {
      return failedStaff("dns_not_pointing", "edge", step.attempts ?? 0);
    }
    return {
      status: "waiting",
      detail: `waiting_dns:${check}`,
      retryInMs: backoffMs(check),
    };
  }
  if (!(await writeVerifiedHosts(move, now))) {
    return failedStaff("host_taken", "edge", step.attempts ?? 0);
  }
  for (const h of [apex, www]) forgetHost(h);
  return done(
    "1.1.1.1 and 8.8.8.8 point to the edge · hosts on the route list",
  );
};

// ---------------------------------------------------------------------------------------
// Step 8: HTTPS (choice 3)
// ---------------------------------------------------------------------------------------

/** Bump `edge:retry:<host>` so the edge renames the router and retries the cert. */
async function bumpEdgeRetry(host: string): Promise<void> {
  const key = `${EDGE_RETRY_KEY_PREFIX}${host}`;
  // platform_meta keys are at most 100 characters: a host longer than 89 keeps its name.
  if (!META_KEY_RE.test(key)) return;
  const prev = Number.parseInt((await readPlatformMeta(key)) ?? "0", 10);
  const n = Number.isSafeInteger(prev) && prev > 0 ? prev + 1 : 1;
  await writePlatformMeta(sysCtx(), key, String(n));
}

function probeFailure(r: ProbeResult, ok200: boolean): string {
  if (r.error) return code(r.error);
  if (!ok200) return r.status === null ? "no_response" : `status_${r.status}`;
  return "bad_proof";
}

const httpsStep: StepFn = async ({ move, step, deps }) => {
  const { primary, secondary } = hostsOf(move);
  if ((step.detail ?? "").startsWith("https_failed")) {
    // A Retry after a failure (staff or owner): force a fresh certificate attempt.
    for (const h of [primary, secondary]) await bumpEdgeRetry(h);
  }
  const prober = deps.prober ?? getHttpsProber();
  let failure: string | null = null;
  let certDays: number | null = null;
  for (const host of [primary, secondary]) {
    const r = await prober.probe(host);
    const ok200 = r.ok && r.status === 200;
    if (!ok200 || !verifyCdsHostProof(host, move.orgId, r.proof)) {
      failure ??= probeFailure(r, ok200);
      continue;
    }
    if (r.certDaysLeft !== null) {
      certDays =
        certDays === null ? r.certDaysLeft : Math.min(certDays, r.certDaysLeft);
    }
  }
  if (failure === null) {
    return done(
      certDays === null
        ? "prober 200 · host proof valid"
        : `prober 200 · cert ${certDays} days`,
    );
  }
  const check = checkNo(step.detail, "waiting_https") + 1;
  if (check >= HTTPS_MAX_CHECKS) {
    return failedStaff(`https_failed:${failure}`, "https", step.attempts ?? 0);
  }
  return {
    status: "waiting",
    detail: `waiting_https:${check}`,
    retryInMs: backoffMs(check),
  };
};

// ---------------------------------------------------------------------------------------
// Step 9: cutover (choice 4)
// ---------------------------------------------------------------------------------------

type HostUpdate = { id: string; body: Record<string, unknown> };

/** Every org_hosts change of the cutover (P14-P5): only real changes are written. */
function cutoverUpdates(
  rows: readonly RecordModel[],
  primary: string,
  secondary: string,
): HostUpdate[] {
  const out: HostUpdate[] = [];
  for (const r of rows) {
    const host = str(r.hostname);
    const kind = str(r.kind);
    let want: Record<string, unknown>;
    if (host === primary) {
      want = { primary: true, kind: "custom", redirect_to: "" };
    } else if (host === secondary) {
      want = { primary: false, kind: "redirect", redirect_to: primary };
    } else if (kind === "preview") {
      // The preview host stays a preview host (drafts and review links), never a redirect.
      want = { primary: false };
    } else {
      // An old custom (or redirect) host now 301s to the new primary.
      want = { primary: false, kind: "redirect", redirect_to: primary };
    }
    const changed = Object.entries(want).some(([k, v]) =>
      k === "primary" ? (r.primary === true) !== v : str(r[k]) !== v,
    );
    if (changed) out.push({ id: r.id, body: want });
  }
  return out;
}

async function orgBlocked(pb: PocketBase, orgId: string): Promise<boolean> {
  const org = await pb
    .collection("organizations")
    .getOne(orgId, { fields: "id,status,stage" });
  if (
    org.status === "held" ||
    org.status === "disabled" ||
    org.stage === "fit_review"
  ) {
    return true;
  }
  // A re-run after setOrgStage already took the site live is not blocked.
  if (org.stage === "live") return false;
  return (await launchGateRefusal(pb, orgId, str(org.stage))) !== null;
}

/**
 * WR-A03, D172/D26: a launch goes live only from `ready_for_review` with the owner's
 * submitted launch review. Enforced here, not only in the approve action. Null when allowed.
 */
async function launchGateRefusal(
  pb: PocketBase,
  orgId: string,
  stage: string,
): Promise<string | null> {
  if (stage !== "ready_for_review") {
    return "The site isn't ready for review yet.";
  }
  const marks = await pb.collection("launch_review_marks").getList(1, 1, {
    filter: pb.filter("organization = {:org} && kind = 'submitted'", {
      org: orgId,
    }),
    fields: "id",
    skipTotal: true,
  });
  if (marks.items.length === 0) {
    return "The owner hasn't sent Ready to launch yet.";
  }
  return null;
}

const cutoverStep: StepFn = async ({ move, step }) => {
  const { primary, secondary } = hostsOf(move);
  const outcome = await withSuperuser(async (pb) => {
    // A launch can only go live from a stage setOrgStage accepts: check before any write.
    if (move.kind === "launch" && (await orgBlocked(pb, move.orgId))) {
      return "site_blocked" as const;
    }
    const rows = await pb.collection("org_hosts").getFullList({
      filter: pb.filter("organization = {:org}", { org: move.orgId }),
    });
    const target = rows.find((r) => r.hostname === primary);
    if (!target || str(target.verified_at) === "") return "no_host" as const;
    const updates = cutoverUpdates(rows, primary, secondary);
    // ONE batch: every host change and the audit row, or nothing (T-14-23-03).
    const batch = pb.createBatch();
    for (const u of updates) batch.collection("org_hosts").update(u.id, u.body);
    batch.collection("audit_log").create(
      auditBody(sysCtx(), {
        action: "domain.cutover",
        organization: move.orgId,
        targetCollection: MOVES,
        targetId: move.id,
        meta: { code: `M-${move.seq}`, kind: move.kind, hosts: updates.length },
      }),
    );
    await batch.send();
    return rows.map((r) => str(r.hostname));
  });
  if (outcome === "site_blocked" || outcome === "no_host") {
    return failedStaff(outcome, "cutover", step.attempts ?? 0);
  }
  if (move.kind === "launch") {
    // The org lock is already held by the move runner (advanceMove), hence the option.
    await setOrgStage(sysCtx(), move.orgId, "live", {
      callerHoldsOrgLock: true,
    });
  }
  for (const h of outcome) forgetHost(h);
  forgetOrgLive(move.orgId);
  return done(
    move.kind === "launch"
      ? "custom host primary · site live"
      : "custom host primary · old host redirects",
  );
};

// ---------------------------------------------------------------------------------------
// Step 10: search (choice 5)
// ---------------------------------------------------------------------------------------

const searchStep: StepFn = async ({ move, now }) => {
  let ping = "error";
  let submit = "error";
  try {
    const urls = await withSuperuser((pb) => siteUrls(pb, move.orgId));
    ping = await pingAndRecord(move.orgId, urls, { now });
  } catch (err) {
    console.error(`[domains] search ping failed: ${errName(err)}`);
  }
  try {
    submit = await submitAndRecord(move.orgId, null, { now });
  } catch (err) {
    console.error(`[domains] sitemap submit failed: ${errName(err)}`);
  }
  // Never fails the launch (D190): the weekly indexing job resubmits anyway.
  return done(`IndexNow ${ping} · sitemap ${submit}`);
};

/** Steps 6-10, loaded lazily by ./moves `advanceMove`. */
export const LATE_STEPS: Record<
  "site_records" | "edge" | "https" | "cutover" | "search",
  StepFn
> = {
  site_records: siteRecordsStep,
  edge: edgeStep,
  https: httpsStep,
  cutover: cutoverStep,
  search: searchStep,
};

// ---------------------------------------------------------------------------------------
// startCutover (choice 6)
// ---------------------------------------------------------------------------------------

function waitingOn(v: MoveView | null): string {
  if (!v) return "no domain is connected yet";
  if (v.status === "cutover_running") return "the launch is already running";
  if (v.kind !== "launch") return "a domain move is running";
  const n = MOVE_STEPS.indexOf(v.currentStep) + 1;
  const tail =
    v.status === "waiting_owner"
      ? " is waiting on the owner"
      : v.status === "failed"
        ? " failed"
        : " is still running";
  return `step ${n} (${v.currentStep})${tail}`;
}

/**
 * CDS approval (D26): start steps 6-10 of the org's prepared launch move. InvalidInput
 * (APPROVE_BLOCKED) unless the open move is a `prepared` launch, and (WR-A03) unless the org
 * is at `ready_for_review` with the owner's `submitted` launch review. Sets `cutover_running`,
 * audits `domain.cutover_started` (same batch), then advances once synchronously; the
 * domains job (advanceMoves) picks up whatever waits. super_admin only (`org_stage`: this
 * takes the site live).
 */
export async function startCutover(
  ctx: PlatformContext,
  orgId: string,
  deps: MoveDeps = {},
): Promise<MoveView> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "org_stage");
  const org = scopedOrgId(ctx, orgId);
  const id = await withOrgLock(org, async () => {
    const open = await openMoveFor(ctx, org);
    if (!open || open.status !== "prepared" || open.kind !== "launch") {
      throw new InvalidInput(
        P14_COPY.APPROVE_BLOCKED({ waitingOn: waitingOn(open) }),
      );
    }
    const m = await loadMoveRow(open.id);
    await withSuperuser(async (pb) => {
      const o = await pb
        .collection("organizations")
        .getOne(org, { fields: "id,stage" });
      const refusal = await launchGateRefusal(pb, org, str(o.stage));
      if (refusal) throw new InvalidInput(refusal);
      // CR-D01: a send older than a page change is stale (the owner is asked to re-send).
      // Checked at approval only: the cutover step keeps the existence gate, so a page
      // published mid-cutover never fails a running launch.
      const stale = resubmitNeededOf(await loadReviewFacts(pb, org));
      if (stale.length > 0) {
        throw new InvalidInput(
          P14_COPY.APPROVE_RESEND({ count: stale.length }),
        );
      }
      const batch = pb.createBatch();
      batch.collection(MOVES).update(m.id, { status: "cutover_running" });
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "domain.cutover_started",
          organization: org,
          targetCollection: MOVES,
          targetId: m.id,
          meta: { code: `M-${m.seq}`, step: m.currentStep },
        }),
      );
      await batch.send();
    });
    return m.id;
  });
  // WR-C03: the cutover_running flip is committed, so the launch has started. An error in
  // the first run (recording a step, sending notices) must not read as "didn't launch":
  // report the stored move instead; the domains job carries it on.
  try {
    return await advanceMove(id, { ...deps, force: true });
  } catch (err) {
    console.error(`[domains] first cutover run failed: ${errName(err)}`);
    return moveViewOf(await loadMoveRow(id));
  }
}
