// Media storage usage and the per-org allowance (07-10, 10-33; CONT-19, BILL-13, D221, D222,
// D225, D278; CONTEXT Area 1 Q5 and resolution d: "count by asset, not by object"; CONTEXT A3:
// the allowance is 2 GB + storage packs, from `mediaAllowance(ctx)` in ./allowance). Usage is the sum of
// media_assets.bytes over every existing row of the org: an asset counts once whether its
// files sit in the private store, the public store or both. Soft-deleted rows still count
// (their objects are still stored); hard-deleted rows are gone. Invariant 1: every read is
// scoped by the context's org through a bound filter. Every check takes an explicit
// allowance (10-33 choice 1): there is no silent 2 GB default in an org-scoped path.
import { Forbidden, InvalidInput } from "@cds/core";
import { ClientResponseError } from "pocketbase";
import { withSuperuser } from "../../client";
import {
  assertOrgContext,
  assertSystemContext,
  isPlatformContext,
  type OrgContext,
  type PlatformContext,
  type SystemContext,
} from "../../context";
import { mapError, requirePermission } from "../../repository";
import { mediaAllowance, mediaAllowancesFor } from "./allowance";

/** The 2 GB base every site gets before packs (2 x 1024^3). An org's real limit is `mediaAllowance(ctx)`. */
export const MEDIA_ALLOWANCE_BYTES = 2 * 1024 ** 3;
export const USAGE_WARN_RATIO = 0.8;

const GB = 1024 ** 3;
const COLLECTION = "media_assets";

export type UsageLevel = "ok" | "warn" | "full";

export type MediaUsage = {
  usedBytes: number;
  allowanceBytes: number;
  ratio: number;
  level: UsageLevel;
  assets: number;
  byKind: { image: number; video: number; audio: number };
  label: string;
};

export function usageLevel(used: number, allowance: number): UsageLevel {
  if (used >= allowance) return "full";
  if (used >= allowance * USAGE_WARN_RATIO) return "warn";
  return "ok";
}

/** One decimal, trailing ".0" dropped: "1.2 GB", "2 GB", "0 GB". */
export function formatGb(bytes: number): string {
  const n = Math.round((Math.max(0, bytes) / GB) * 10) / 10;
  return `${n.toFixed(1).replace(/\.0$/, "")} GB`;
}

/** The UsageMeter label (07-UI-SPEC): "1.2 GB of 7 GB used". */
export function usageLabel(usedBytes: number, allowance: number): string {
  return `${formatGb(usedBytes)} of ${formatGb(allowance)} used`;
}

/**
 * Exact 10-UI-SPEC copy (USAGE-80-PACKS, USAGE-FULL-PACKS, USAGE-FULL-MEMBER; replaces the P7
 * USAGE-80 / USAGE-FULL). Never re-type it elsewhere. `member` is for Admin / Editor and staff
 * impersonating (no purchase offer; 10-43 picks it in the UI).
 */
export const USAGE_COPY = Object.freeze({
  warn: (usedBytes: number, allowance: number): string =>
    `You've used ${formatGb(usedBytes)} of your ${formatGb(allowance)} of media. Delete files you no longer use, or add more storage.`,
  full: (allowance: number): string =>
    `You've used all ${formatGb(allowance)} of your media storage. Add more, or delete something to make room.`,
  member:
    "Media storage is full. Ask your site owner to add more, or delete something to make room.",
});

/** An upload would pass the allowance. Message = USAGE-FULL-PACKS for that allowance. */
export class AllowanceExceeded extends InvalidInput {
  override readonly code = "allowance_exceeded";
  readonly allowanceBytes: number;
  constructor(allowance: number) {
    super(USAGE_COPY.full(allowance));
    this.allowanceBytes = allowance;
  }
}

export type AllowanceCheck = {
  usedAfter: number;
  level: UsageLevel;
  warning: string | null;
};

export function checkAllowance(
  usedBytes: number,
  incomingBytes: number,
  allowance: number,
): AllowanceCheck {
  if (
    typeof allowance !== "number" ||
    !Number.isSafeInteger(allowance) ||
    allowance < 0
  ) {
    throw new InvalidInput("invalid media allowance");
  }
  if (
    typeof incomingBytes !== "number" ||
    !Number.isSafeInteger(incomingBytes) ||
    incomingBytes < 0
  ) {
    throw new InvalidInput("invalid upload size");
  }
  const usedAfter = usedBytes + incomingBytes;
  if (usedAfter > allowance || (usedBytes >= allowance && incomingBytes > 0)) {
    throw new AllowanceExceeded(allowance);
  }
  const level = usageLevel(usedAfter, allowance);
  return {
    usedAfter,
    level,
    warning: level === "ok" ? null : USAGE_COPY.warn(usedAfter, allowance),
  };
}

type Row = { organization?: unknown; kind?: unknown; bytes?: unknown };

function int(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

/** Totals for one org's rows against that org's allowance. */
export function summarise(rows: readonly Row[], allowance: number): MediaUsage {
  const byKind = { image: 0, video: 0, audio: 0 };
  for (const r of rows) {
    const b = int(r.bytes);
    if (r.kind === "video") byKind.video += b;
    else if (r.kind === "audio") byKind.audio += b;
    else byKind.image += b;
  }
  const usedBytes = byKind.image + byKind.video + byKind.audio;
  return {
    usedBytes,
    allowanceBytes: allowance,
    ratio: allowance > 0 ? usedBytes / allowance : 1,
    level: usageLevel(usedBytes, allowance),
    assets: rows.length,
    byKind,
    label: usageLabel(usedBytes, allowance),
  };
}

async function mapped<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  }
}

/**
 * The org's media footprint against its own allowance, 2 GB + packs (content read: Owner /
 * Admin / Editor / Viewer).
 */
export async function mediaUsage(ctx: OrgContext): Promise<MediaUsage> {
  assertOrgContext(ctx);
  requirePermission(ctx, "content", "read");
  const [rows, allowance] = await Promise.all([
    mapped(
      withSuperuser((pb) =>
        pb.collection(COLLECTION).getFullList<Row>({
          filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
          fields: "kind,bytes",
        }),
      ),
    ),
    mapped(mediaAllowance(ctx)),
  ]);
  return summarise(rows, allowance);
}

/**
 * Check an upload against the allowance. Callers (07-12 audio/library upload, 07-13 video
 * init) run it first and re-check under `withOrgLock`: two parallel uploads can each pass once.
 */
export async function assertAllowance(
  ctx: OrgContext,
  incomingBytes: number,
): Promise<AllowanceCheck> {
  const u = await mediaUsage(ctx);
  return checkAllowance(u.usedBytes, incomingBytes, u.allowanceBytes);
}

/**
 * Every org's usage, for 07-27's over-allowance alert and the `media:usage` CLI. Jobs and
 * staff only (an OrgContext is refused); staff authorization (`media_usage`) is the CLI's.
 */
export async function mediaUsageByOrg(
  ctx: SystemContext | PlatformContext,
): Promise<ReadonlyMap<string, MediaUsage>> {
  if (!isPlatformContext(ctx)) {
    try {
      assertSystemContext(ctx);
    } catch {
      throw new Forbidden("usage across organizations needs a job or staff");
    }
  }
  const { rows, allowances } = await mapped(
    withSuperuser(async (pb) => {
      const rows = await pb.collection(COLLECTION).getFullList<Row>({
        fields: "organization,kind,bytes",
      });
      const orgs = rows
        .map((r) => (typeof r.organization === "string" ? r.organization : ""))
        .filter((o) => o !== "");
      // 10-33 choice 2: every listed org's pack quantities in one bound query.
      return { rows, allowances: await mediaAllowancesFor(pb, orgs) };
    }),
  );
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const org = typeof r.organization === "string" ? r.organization : "";
    if (!org) continue;
    const list = groups.get(org);
    if (list) list.push(r);
    else groups.set(org, [r]);
  }
  const out = new Map<string, MediaUsage>();
  for (const [org, list] of groups) {
    out.set(org, summarise(list, allowances.get(org) ?? MEDIA_ALLOWANCE_BYTES));
  }
  return out;
}
