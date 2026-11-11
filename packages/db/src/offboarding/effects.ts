// packages/db/src/offboarding/effects.ts (P14, LIFE-01; 14-39). Internal side effects shared
// by offboardings.ts, steps.ts and the retention job: billing end, owner notices, staff
// alerts, org facts. Not in the barrel. Errors are logged by class name only; never a host,
// address or record value.
import type { CdsBilling } from "@cds/core/payments";
import type PocketBase from "pocketbase";
import { raiseAlert } from "../alerts/raise";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { mintSystemContext, type SystemContext } from "../context";
import type { MoveDeps } from "../dns/moves";
import type { DnsProvider } from "../dns/ports";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import type { SendingDomains } from "../email/sending-domains/ports";
import type { EmailTransport } from "../email/transport";
import { staffAlertAddress } from "../media/ops/alerts";
import type { MediaDelivery } from "../media/ports";
import { billingAccountByOrg } from "../payments/accounts";
import { getCdsBilling } from "../payments/factory";
import type { ObjectStore } from "../storage";

export const OFFBOARDING_JOB = "offboarding";
export const LEAVING_HREF = "/hub/leaving";

/** Injectable clock and adapters (every network adapter is injectable). */
export type OffboardingDeps = {
  now?: Date;
  transport?: EmailTransport;
  billing?: CdsBilling;
  sending?: SendingDomains;
  provider?: DnsProvider;
  delivery?: MediaDelivery;
  publicStore?: ObjectStore;
  moveDeps?: MoveDeps;
};

export function sysCtx(): SystemContext {
  return mintSystemContext({ job: OFFBOARDING_JOB });
}

export function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export type OrgFacts = {
  name: string;
  demo: boolean;
  closedReason: string;
  stage: string;
  analytics: Record<string, unknown>;
};

export async function orgFacts(orgId: string): Promise<OrgFacts | null> {
  return withSuperuser(async (pb) => {
    const r = await pb
      .collection("organizations")
      .getOne(orgId, {
        fields: "id,name,demo,closed_reason,stage,analytics",
      })
      .catch(() => null);
    if (!r) return null;
    const a = r.analytics;
    return {
      name: str(r.name) || orgId,
      demo: r.demo === true,
      closedReason: str(r.closed_reason),
      stage: str(r.stage),
      analytics:
        typeof a === "object" && a !== null && !Array.isArray(a)
          ? (a as Record<string, unknown>)
          : {},
    };
  });
}

/** The org's dns_zones rows that are delegated to CDS (`active` or `moved`). */
export async function delegatedZones(
  pb: PocketBase,
  orgId: string,
): Promise<{ id: string; domain: string; status: string }[]> {
  const rows = await pb.collection("dns_zones").getFullList({
    filter: pb.filter(
      "org_id = {:org} && (status = 'active' || status = 'moved')",
      { org: orgId },
    ),
    fields: "id,domain,status",
  });
  return rows.map((r) => ({
    id: r.id,
    domain: str(r.domain),
    status: str(r.status),
  }));
}

async function ownerAddresses(
  pb: PocketBase,
  orgId: string,
): Promise<string[]> {
  const rows = await pb.collection("memberships").getFullList({
    filter: pb.filter("organization = {:org} && role = 'owner'", {
      org: orgId,
    }),
    expand: "user",
    fields: "expand.user.email",
  });
  const out = new Set<string>();
  for (const r of rows) {
    const e = str((r.expand?.user as { email?: unknown } | undefined)?.email);
    if (e !== "") out.add(e);
  }
  return [...out];
}

/**
 * End the CDS subscription at the notice end (`mode: "now"`, no refund; D263) and remove the
 * launch rate lock (D161). Idempotent by state: a canceled account is not cancelled again.
 */
export async function endBillingForOffboarding(
  orgId: string,
  now: Date,
  deps: OffboardingDeps,
): Promise<{ cancelled: boolean; lockRemoved: boolean }> {
  const ctx = sysCtx();
  return withSuperuser(async (pb) => {
    const acct = await billingAccountByOrg(pb, orgId);
    if (!acct) return { cancelled: false, lockRemoved: false };
    let cancelled = false;
    if (acct.subscriptionId !== "" && acct.status !== "canceled") {
      const billing = deps.billing ?? getCdsBilling();
      await billing.cancel({
        subscriptionId: acct.subscriptionId,
        mode: "now",
        idempotencyKey: `offboarding:${orgId}:cancel`,
      });
      cancelled = true;
    }
    const lockRemoved = acct.priceLockedUntil !== null;
    const batch = pb.createBatch();
    if (lockRemoved) {
      batch
        .collection("billing_accounts")
        .update(acct.id, { price_locked_until: "" });
    }
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "offboarding.billing_ended",
        organization: orgId,
        targetCollection: "billing_accounts",
        targetId: acct.id,
        meta: { cancelled, lockRemoved, at: now.toISOString() },
      }),
    );
    await batch.send();
    return { cancelled, lockRemoved };
  });
}

/** Owner email + bell for the start of the notice or an overdue handback. Never throws. */
export async function notifyOwners(
  orgId: string,
  kind: "started" | "overdue",
  data: { endsOn: Date; sourceKey: string },
  deps: OffboardingDeps,
  now: Date,
): Promise<number> {
  const ctx = sysCtx();
  const href = platformUrl(LEAVING_HREF);
  let sent = 0;
  try {
    const to = await withSuperuser((pb) => ownerAddresses(pb, orgId));
    const opts = {
      ...(deps.transport ? { transport: deps.transport } : {}),
      concernsOrg: orgId,
    };
    for (const addr of to) {
      try {
        if (kind === "started") {
          await sendEmail(
            { kind: "cds", ctx },
            "offboarding.started",
            addr,
            { endsOn: data.endsOn, href },
            opts,
          );
        } else {
          await sendEmail(
            { kind: "cds", ctx },
            "offboarding.handback_overdue",
            addr,
            { href },
            opts,
          );
        }
        sent += 1;
      } catch (err) {
        console.error(`[offboarding] owner mail not sent: ${errName(err)}`);
      }
    }
  } catch (err) {
    console.error(`[offboarding] owner mail not sent: ${errName(err)}`);
  }
  // The bell. No `offboarding.handback_overdue` alert type exists (14-03 registry): the
  // overdue bell rides `offboarding.started` ("Leaving CDS") with its own title and key.
  await raiseAlert(
    { orgId, as: ctx },
    kind === "started"
      ? {
          type: "offboarding.started",
          sourceKey: data.sourceKey,
          title: "Your 30-day notice has started",
          safeTitle: "Your 30-day notice has started",
          href: LEAVING_HREF,
          actionLabel: "Open checklist",
        }
      : {
          type: "offboarding.started",
          sourceKey: data.sourceKey,
          title: "Your DNS is still at CDS",
          safeTitle: "Your DNS is still at CDS",
          href: LEAVING_HREF,
          actionLabel: "Open checklist",
        },
    {
      now,
      dedicatedEmail: true,
      ...(deps.transport ? { transport: deps.transport } : {}),
    },
  );
  return sent;
}

/** One staff `staff.domain_alert` (ids, kind and domain only). Never throws. */
export async function alertStaffDomain(
  orgId: string,
  domain: string,
  kind: "handback_overdue",
  deps: { transport?: EmailTransport },
): Promise<boolean> {
  const to = staffAlertAddress();
  if (!to) {
    console.warn("[offboarding] staff alert not sent: no staff alert address");
    return false;
  }
  let business = orgId;
  try {
    const facts = await orgFacts(orgId);
    if (facts) business = facts.name;
  } catch {
    // The id is enough for staff to act on.
  }
  try {
    await sendEmail(
      { kind: "cds", ctx: sysCtx() },
      "staff.domain_alert",
      to,
      {
        kind,
        business,
        orgId,
        domain: domain || "(no domain)",
        href: platformUrl(`/staff/sites/${orgId}?tab=offboarding`),
      },
      deps.transport ? { transport: deps.transport } : {},
    );
    return true;
  } catch (err) {
    console.error(`[offboarding] staff alert not sent: ${errName(err)}`);
    return false;
  }
}
