// P8 (08-16): the only places assembly contexts are minted; never re-export a minter.
// (TMPL-02, TMPL-04; CONTEXT A2-Q1, A2-Q4, A4-Q1; RESEARCH R-2; invariant 10;
// T-08-16-01, T-08-16-02.)
//
//   - runAssemblyForOrg (queue / hourly sweep): acts with the org owner's rights
//     (`memberships` role owner) with ip `system:assembly` and `systemJob: "assembly"`, so
//     every audit row it writes (page.publish, ...) names no user and carries meta.job
//     (WR-A07); the `site.assembled` audit row is a system-job row
//     (mintSystemContext({ job: "assembly" })). No owner: ledger failed
//     NO_OWNER (attempt counted, so the sweep stops after 3).
//   - assembleSiteAsStaff (site:assemble CLI): staff only (`site_assemble`), acting as the
//     staff member impersonating the owner, so every write is audited with `impersonator`.
// Both send `site.assembled` after a run that created or rebuilt a page, and
// `site.assembly_failed` exactly once after the third failed attempt (failure_emailed).
// A dry run sends nothing.
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import type { AddonRegistry } from "@cds/core/addons";
import { PATHS } from "@cds/core/onboarding";
import type { AssemblyLedger } from "@cds/core/templates";
import type PocketBase from "pocketbase";
import { ClientResponseError } from "pocketbase";
import { withSuperuser } from "../client";
import {
  assertPlatformContext,
  mintOrgContext,
  type OrgContext,
  type PlatformContext,
} from "../context";
import { mapError } from "../repository";
import {
  assembledEmailData,
  sendSiteAssembled,
  sendSiteAssemblyFailed,
  type AssemblyAlertDeps,
} from "./alerts";
import {
  assembleSite,
  type AssemblyDeps,
  type AssemblyOptions,
  type AssemblyResult,
} from "./assemble";
import { parseLedger, readLedger, writeLedger } from "./ledger";

export type AssemblyRunDeps = AssemblyDeps & {
  registry: AddonRegistry;
  /** Staff email transport / send seam (tests capture). */
  email?: AssemblyAlertDeps;
};

export type AssemblyRunOptions = Pick<
  AssemblyOptions,
  "rerun" | "dryRun" | "now"
>;

const ORG_ID = /^[a-z0-9]{15}$/;
const SYSTEM_IP = "system:assembly";
/** After this many failed attempts staff get one email (CONTEXT A2-Q4). */
export const ASSEMBLY_MAX_ATTEMPTS = 3;

function pbRun<T>(fn: (pb: PocketBase) => Promise<T>): Promise<T> {
  return withSuperuser(fn).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

function pathLabel(path: string): string {
  return PATHS.find((p) => p.id === path)?.label ?? path;
}

function pageLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Preview page URL: https in production, else http plus CDS_PREVIEW_PORT when set. */
export function previewUrl(host: string, path: string): string {
  if (process.env.CDS_ENV === "production") return `https://${host}${path}`;
  const port = process.env.CDS_PREVIEW_PORT;
  const suffix = port && /^\d{1,5}$/.test(port) ? `:${port}` : "";
  return `http://${host}${suffix}${path}`;
}

async function orgName(orgId: string): Promise<string> {
  return pbRun(async (pb) => {
    const org = await pb
      .collection("organizations")
      .getOne(orgId, { fields: "id,name" });
    return typeof org.name === "string" ? org.name : "";
  });
}

/** The org's owner user id, or null (first owner membership). */
async function ownerOf(orgId: string): Promise<string | null> {
  return pbRun(async (pb) => {
    const res = await pb.collection("memberships").getList(1, 1, {
      filter: pb.filter("organization = {:org} && role = 'owner'", {
        org: orgId,
      }),
      sort: "created,id",
      fields: "id,user",
    });
    const user = res.items[0]?.user;
    return typeof user === "string" && user !== "" ? user : null;
  });
}

/** NO_OWNER: no context can be minted, so the attempt is counted on the raw row. */
async function recordNoOwner(orgId: string): Promise<AssemblyLedger> {
  return pbRun(async (pb) => {
    const res = await pb.collection("org_intake").getList(1, 1, {
      filter: pb.filter("organization = {:org}", { org: orgId }),
      fields: "id,assembly",
    });
    const row = res.items[0];
    if (!row) throw new NotFound();
    const prev = parseLedger(row.assembly);
    const next = parseLedger({
      ...prev,
      status: "failed",
      attempts: prev.attempts + 1,
      error: { code: "NO_OWNER" },
    });
    const saved = await pb
      .collection("org_intake")
      .update(row.id, { assembly: next });
    return parseLedger(saved.assembly);
  });
}

async function markFailureEmailed(orgId: string): Promise<void> {
  await pbRun(async (pb) => {
    const res = await pb.collection("org_intake").getList(1, 1, {
      filter: pb.filter("organization = {:org}", { org: orgId }),
      fields: "id,assembly",
    });
    const row = res.items[0];
    if (!row) return;
    const ledger = parseLedger(row.assembly);
    await pb
      .collection("org_intake")
      .update(row.id, { assembly: { ...ledger, failure_emailed: true } });
  });
}

/** Send the staff emails a finished or failed run calls for. */
async function notify(
  ctx: OrgContext | null,
  orgId: string,
  result: AssemblyResult,
  deps: AssemblyRunDeps,
  now: Date,
): Promise<AssemblyResult> {
  if (result.dryRun) return result;
  const email = deps.email ?? {};
  if (result.status === "done" && result.report) {
    const report = result.report;
    const built = report.pages.some(
      (p) =>
        p.outcome === "created" ||
        p.outcome === "rebuilt" ||
        p.outcome === "held",
    );
    if (!built) return result;
    const host = result.previewHost;
    const pages = host
      ? report.pages
          .filter(
            (p) => p.outcome !== "deleted" && p.outcome !== "skipped_existing",
          )
          .map((p) => ({ label: p.label, url: previewUrl(host, p.path) }))
      : [];
    const facts = result.facts;
    const assembledAt = result.ledger.assembled_at
      ? new Date(result.ledger.assembled_at)
      : now;
    await sendSiteAssembled(
      assembledEmailData(report, {
        businessName: facts?.businessName || (await orgName(orgId)),
        pathLabel: pathLabel(facts?.path ?? ""),
        businessTypeLabel: facts?.businessTypeLabel ?? "",
        orgId,
        assembledAt,
        pages,
      }),
      email,
    );
    return result;
  }
  if (result.status !== "failed") return result;
  const ledger = result.ledger;
  if (
    ledger.attempts < ASSEMBLY_MAX_ATTEMPTS ||
    ledger.failure_emailed === true
  ) {
    return result;
  }
  const finished = Object.entries(ledger.pages)
    .filter(([, p]) => p.published && p.pending !== true)
    .map(([key]) => pageLabel(key));
  await sendSiteAssemblyFailed(
    {
      businessName: result.facts?.businessName || (await orgName(orgId)),
      errorCode: ledger.error?.code ?? result.errorCode ?? "FAILED",
      page: ledger.error?.page ? pageLabel(ledger.error.page) : "None",
      finishedPages: finished,
      lastTry: now,
      orgId,
      attempts: ledger.attempts,
    },
    email,
  );
  let stored: AssemblyLedger;
  if (ctx) {
    const { rowId, ledger: current } = await readLedger(ctx);
    stored = await writeLedger(ctx, rowId, {
      ...current,
      failure_emailed: true,
    });
  } else {
    await markFailureEmailed(orgId);
    stored = { ...ledger, failure_emailed: true };
  }
  return { ...result, ledger: stored };
}

/**
 * The system run (queue / hourly sweep): assemble one org as its owner, then email staff.
 * The org id comes from the stage query or the queue, never from a request.
 */
export async function runAssemblyForOrg(
  orgId: string,
  deps: AssemblyRunDeps,
  opts: AssemblyRunOptions = {},
): Promise<AssemblyResult> {
  if (typeof orgId !== "string" || !ORG_ID.test(orgId)) {
    throw new InvalidInput("organization id is malformed");
  }
  const now = opts.now ?? new Date();
  const owner = await ownerOf(orgId);
  if (!owner) {
    console.error("[assembly] NO_OWNER");
    if (opts.dryRun === true) {
      return {
        status: "failed",
        ledger: parseLedger(null),
        report: null,
        previewHost: null,
        dryRun: true,
        errorCode: "NO_OWNER",
        facts: null,
      };
    }
    const ledger = await recordNoOwner(orgId);
    const result: AssemblyResult = {
      status: "failed",
      ledger,
      report: null,
      previewHost: null,
      dryRun: false,
      errorCode: "NO_OWNER",
      facts: null,
    };
    return notify(null, orgId, result, deps, now);
  }
  const ctx = mintOrgContext({
    orgId,
    actor: owner,
    role: "owner",
    grants: [],
    systemJob: "assembly",
    ip: SYSTEM_IP,
  });
  const result = await assembleSite(ctx, deps.registry, deps, {
    ...opts,
    now,
    auditAs: "system",
  });
  return notify(ctx, orgId, result, deps, now);
}

/**
 * The staff run (site:assemble CLI; super_admin or support_agent). Acts as the staff member
 * impersonating the owner (invariant 10); the audit row names the staff member.
 */
export async function assembleSiteAsStaff(
  pctx: PlatformContext,
  orgId: string,
  opts: AssemblyRunOptions,
  deps: AssemblyRunDeps,
): Promise<AssemblyResult> {
  assertPlatformContext(pctx);
  authorizeStaff(pctx.staffRole, "site_assemble");
  if (typeof orgId !== "string" || !ORG_ID.test(orgId)) {
    throw new InvalidInput("Give an organization id (15 letters and numbers).");
  }
  await pbRun(async (pb) => {
    const res = await pb.collection("organizations").getList(1, 1, {
      filter: pb.filter("id = {:id}", { id: orgId }),
      fields: "id",
    });
    if (!res.items[0]) throw new NotFound();
  });
  const now = opts?.now ?? new Date();
  const ctx = mintOrgContext({
    orgId,
    actor: pctx.actor,
    role: "owner",
    grants: [],
    impersonator: pctx.actor,
    ip: pctx.ip,
  });
  const result = await assembleSite(ctx, deps.registry, deps, {
    ...opts,
    now,
    auditAs: "context",
  });
  return notify(ctx, orgId, result, deps, now);
}
