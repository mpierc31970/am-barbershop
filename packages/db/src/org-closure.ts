// Org closure (LIFE-02, D283, invariant 9; CONTEXT A4-Q2). The single entry point that marks
// an organization closed: P10 decline, P13 takedown and P14 cancellation call markOrgClosed.
// A lapsed org is never a closed reason: a billing lapse only disables (invariant 9), so the
// retention job, which selects on closed_reason + closed_at, can never pick it up.
// Platform or System context only; an OrgContext (even the owner) is refused before any
// read or write. The org update and its audit row commit in one PB batch.
import { InvalidInput, NotFound } from "@cds/core";
import { CLOSED_ORG_DELETE_DAYS } from "@cds/core/legal";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody } from "./audit";
import { withSuperuser } from "./client";
import {
  assertPlatformContext,
  assertSystemContext,
  isPlatformContext,
  type PlatformContext,
  type SystemContext,
} from "./context";

export type ClosedReason = "cancelled" | "declined" | "taken_down";
export const CLOSED_REASONS: readonly ClosedReason[] = Object.freeze([
  "cancelled",
  "declined",
  "taken_down",
]);

/** organizations.status values a reopen may restore (1790000696). */
const REOPEN_STATUSES = ["active", "held", "disabled"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const ID_RE = /^[a-z0-9]{15}$/;

function assertCloser(
  ctx: PlatformContext | SystemContext,
): asserts ctx is PlatformContext | SystemContext {
  if (isPlatformContext(ctx)) {
    assertPlatformContext(ctx);
    return;
  }
  // Throws InvalidContext for an OrgContext or anything not minted by @cds/db.
  assertSystemContext(ctx);
}

function checkOrgId(orgId: string): void {
  if (typeof orgId !== "string" || !ID_RE.test(orgId)) {
    throw new InvalidInput("invalid organization id");
  }
}

async function loadOrg(orgId: string): Promise<RecordModel> {
  return withSuperuser(async (pb) => {
    try {
      return await pb.collection("organizations").getOne(orgId);
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) {
        throw new NotFound();
      }
      throw err;
    }
  });
}

function toDate(v: unknown): Date | null {
  if (typeof v !== "string" || v === "") return null;
  const d = new Date(v.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Mark an organization closed: sets closed_reason, closed_at and status = disabled, audited
 * as organization.close. Closing an already-closed org keeps the original closed_at (the
 * 30-day clock never restarts) and only records the new reason.
 */
export async function markOrgClosed(
  ctx: PlatformContext | SystemContext,
  orgId: string,
  reason: ClosedReason,
  opts: { now?: Date } = {},
): Promise<{ closedAt: string }> {
  assertCloser(ctx);
  if (!(CLOSED_REASONS as readonly string[]).includes(reason)) {
    throw new InvalidInput("unknown closed reason");
  }
  checkOrgId(orgId);
  const now = opts.now ?? new Date();
  const org = await loadOrg(orgId);
  const closedAt = toDate(org.closed_at)?.toISOString() ?? now.toISOString();
  // The status to restore on reopen (WR-A02). A second close keeps the first one's value:
  // by then status is already "disabled" by the closure itself.
  const alreadyClosed = String(org.closed_reason ?? "") !== "";
  const prevStatus = alreadyClosed
    ? String(org.closed_prev_status ?? "")
    : String(org.status ?? "");
  await withSuperuser(async (pb) => {
    const batch = pb.createBatch();
    batch.collection("organizations").update(orgId, {
      closed_reason: reason,
      closed_at: closedAt,
      closed_prev_status: prevStatus,
      status: "disabled",
    });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "organization.close",
        organization: orgId,
        targetCollection: "organizations",
        targetId: orgId,
        meta: { reason, prev_status: prevStatus },
      }),
    );
    await batch.send();
  });
  return { closedAt };
}

/**
 * Undo a closure within CLOSED_ORG_DELETE_DAYS: clears the closure fields and restores the
 * status the org had before markOrgClosed (closed_prev_status; "held" when unknown, never an
 * automatic "active"; WR-A02), audited as organization.reopen. Refused (InvalidInput) for an org that is not closed or
 * whose closure is older than the window (the retention job may already be deleting it).
 */
export async function reopenOrg(
  ctx: PlatformContext | SystemContext,
  orgId: string,
  opts: { now?: Date } = {},
): Promise<void> {
  assertCloser(ctx);
  checkOrgId(orgId);
  const now = opts.now ?? new Date();
  const org = await loadOrg(orgId);
  const reason = String(org.closed_reason ?? "");
  const closedAt = toDate(org.closed_at);
  if (reason === "" || !closedAt) {
    throw new InvalidInput("organization is not closed");
  }
  if (now.getTime() - closedAt.getTime() >= CLOSED_ORG_DELETE_DAYS * DAY_MS) {
    throw new InvalidInput(
      `organization was closed more than ${CLOSED_ORG_DELETE_DAYS} days ago`,
    );
  }
  // Restore the pre-closure status (WR-A02): a held site goes back to fit review and a
  // lapsed (disabled) one stays disabled. Unknown means "held": staff approval decides,
  // never an automatic go-live.
  const prev = String(org.closed_prev_status ?? "");
  const status = (REOPEN_STATUSES as readonly string[]).includes(prev)
    ? prev
    : "held";
  await withSuperuser(async (pb) => {
    const batch = pb.createBatch();
    batch.collection("organizations").update(orgId, {
      closed_reason: "",
      closed_at: "",
      closed_prev_status: "",
      status,
    });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "organization.reopen",
        organization: orgId,
        targetCollection: "organizations",
        targetId: orgId,
        meta: { previousReason: reason, status },
      }),
    );
    await batch.send();
  });
}
