// packages/db/src/offboarding/steps.ts (P14, LIFE-01; D282, D284, D263, D161, D58).
// Owner: 14-39 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// The Leaving CDS order and checklist (14-39 choices 3-5b):
//   - assertHandbackDone: every step function (and closeAtNoticeEnd) refuses with
//     "Move your DNS first." until the DNS handback is done or not applicable. The order
//     lives here, server-side, never in the UI (T-14-39-01).
//   - offboardingChecklist: the download, add-on items (from the caller's manifests, P14-P28,
//     P13-P7: @cds/db never imports the registry), connected services (Stripe, sending email,
//     GBP, Shipping, Google Analytics/Search Console) and billing lines, stated before the
//     owner confirms (a preview when no notice is running).
//   - closeAtNoticeEnd: custom hosts removed, sending identity removed, subscription ended,
//     rate lock removed, Connect disconnected, download links expired, CDN purged, then
//     markOrgClosed(cancelled). Each sub-step is idempotent; a failure aborts and the next
//     domains:run resumes. The demo org is never closed here (D293).
import { authorizeStaff, InvalidInput, NotFound, type Action } from "@cds/core";
import type { AddonOffboarding } from "@cds/core/addons";
import { P14_COPY } from "@cds/core/dns";
import { CLOSED_ORG_DELETE_DAYS } from "@cds/core/legal";
import { activeSet } from "../addons/entitlements";
import { appendAudit, auditBody } from "../audit";
import { withSuperuser } from "../client";
import {
  assertPlatformContext,
  assertSystemContext,
  isOrgContext,
  isPlatformContext,
  scopedOrgId,
  type OrgContext,
  type PlatformContext,
  type SystemContext,
} from "../context";
import { forgetHost } from "../dns/edge";
import {
  requestDataDownload,
  type DataDownloadDeps,
} from "../downloads/data-download";
import { longDate } from "../email/render/templates";
import { removeSendingDomain } from "../email/sending-domains/ensure";
import { getMediaDelivery } from "../media/library/delivery";
import { markOrgClosed } from "../org-closure";
import { forgetOrgLive } from "../org-stage";
import { billingAccountByOrg } from "../payments/accounts";
import {
  endConnectForOffboarding,
  gatewayAccountByOrg,
} from "../payments/connect";
import { requirePermission } from "../repository";
import { envPrefix, getPublicMediaStore } from "../storage";
import {
  delegatedZones,
  endBillingForOffboarding,
  errName,
  orgFacts,
  sysCtx,
  type OffboardingDeps,
} from "./effects";
import {
  DAY_MS,
  handbackSettled,
  NOTICE_DAYS,
  noticeEnd,
  OFFBOARDINGS,
  readOffboardingRow,
  type OffboardingOwnerStep,
  type OffboardingRow,
  type OffboardingStepKey,
  type OffboardingSteps,
} from "./model";

/** D282: the one refusal every later step gives before the DNS handback. */
export const MOVE_DNS_FIRST = "Move your DNS first.";
/** The GA4 / Search Console runbook section staff follow on cancellation (P11). */
export const GA4_TRANSFER_RUNBOOK =
  "docs/ops/ga4-search-console.md#4-transfer-on-cancellation";

/** Owner steps an owner (or super_admin) may tick once DNS is settled. */
export type OffboardingTickStep =
  "download" | "addons" | "services" | "billing";
const TICK_STEPS: readonly OffboardingTickStep[] = [
  "download",
  "addons",
  "services",
  "billing",
];

// ---------------------------------------------------------------------------------------
// Authorization (P14-P12, P14-P13, P14-P34)
// ---------------------------------------------------------------------------------------

type ReadCtx = OrgContext | PlatformContext;

/** Owner/Admin read `offboarding:read`; staff read with `domains` (both staff roles). */
export function authorizeOffboarding(
  ctx: ReadCtx,
  action: Extract<Action, "read" | "run">,
): void {
  if (isOrgContext(ctx)) {
    requirePermission(ctx, "offboarding", action);
    return;
  }
  if (isPlatformContext(ctx)) {
    assertPlatformContext(ctx);
    authorizeStaff(ctx.staffRole, action === "run" ? "offboard" : "domains");
    return;
  }
  throw new NotFound();
}

/**
 * Throws InvalidInput("Move your DNS first.") unless the DNS handback is `done` or
 * `not_applicable` (14-39 choice 3, D282). Called first by every step function.
 */
export function assertHandbackDone(
  row: Pick<OffboardingRow, "steps"> | null | undefined,
): void {
  if (!row || !handbackSettled(row.steps)) {
    throw new InvalidInput(MOVE_DNS_FIRST);
  }
}

async function writeSteps(
  ctx: OrgContext | PlatformContext | SystemContext,
  row: OffboardingRow,
  steps: OffboardingSteps,
  action: string,
  meta: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await withSuperuser(async (pb) => {
    const batch = pb.createBatch();
    batch.collection(OFFBOARDINGS).update(row.id, { steps, ...extra });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action,
        organization: row.orgId,
        targetCollection: OFFBOARDINGS,
        targetId: row.id,
        meta,
      }),
    );
    await batch.send();
  });
}

async function noticeRowFor(orgId: string): Promise<OffboardingRow> {
  const row = await readOffboardingRow(orgId);
  if (!row || row.status !== "notice") {
    throw new InvalidInput("Moving away hasn't started for this site.");
  }
  return row;
}

// ---------------------------------------------------------------------------------------
// Step functions (each asserts the DNS handback first)
// ---------------------------------------------------------------------------------------

/**
 * The owner (or a super_admin) ticks one of the later checklist steps. Refused before the DNS
 * handback (D282).
 */
export async function completeOffboardingStep(
  ctx: ReadCtx,
  orgId: string | undefined,
  step: OffboardingTickStep,
  opts: { now?: Date } = {},
): Promise<{ step: OffboardingTickStep; status: "done" }> {
  const org = scopedOrgId(ctx, orgId);
  authorizeOffboarding(ctx, "run");
  if (!TICK_STEPS.includes(step)) throw new InvalidInput("unknown step");
  const row = await noticeRowFor(org);
  assertHandbackDone(row);
  const at = (opts.now ?? new Date()).toISOString();
  if (row.steps[step].status !== "done") {
    const steps = { ...row.steps, [step]: { status: "done" as const, at } };
    await writeSteps(ctx, row, steps, "offboarding.step_done", { step });
  }
  return { step, status: "done" };
}

/**
 * Step 2: the D284 data download (the zip gains `dns/zone.txt` in 14-40), offered once the
 * DNS is settled. Owner only (the P11 download is the Owner's; impersonation refused there).
 */
export async function requestOffboardingDownload(
  ctx: OrgContext,
  orgId?: string,
  deps: DataDownloadDeps = {},
): Promise<{ id: string }> {
  const org = scopedOrgId(ctx, orgId);
  authorizeOffboarding(ctx, "run");
  const row = await noticeRowFor(org);
  assertHandbackDone(row);
  const res = await requestDataDownload(ctx, deps);
  const at = (deps.now ?? new Date()).toISOString();
  const steps = { ...row.steps, download: { status: "done" as const, at } };
  await writeSteps(ctx, row, steps, "offboarding.step_done", {
    step: "download",
  });
  return res;
}

/**
 * The DNS handback is finished (14-40's reverse gate passed and the delegation moved away):
 * `dns_handback` done and every locked later step opens. System or staff only.
 */
export async function recordHandbackDone(
  ctx: SystemContext | PlatformContext,
  orgId: string,
  opts: { now?: Date } = {},
): Promise<void> {
  if (isPlatformContext(ctx)) {
    assertPlatformContext(ctx);
    authorizeStaff(ctx.staffRole, "domains");
  } else {
    assertSystemContext(ctx);
  }
  const org = scopedOrgId(ctx, orgId);
  const row = await noticeRowFor(org);
  if (handbackSettled(row.steps)) return;
  const at = (opts.now ?? new Date()).toISOString();
  const steps: OffboardingSteps = { ...row.steps };
  steps.dns_handback = { status: "done", at };
  for (const k of [...TICK_STEPS, "close"] as const) {
    if (steps[k].status === "locked") steps[k] = { status: "open" };
  }
  await writeSteps(ctx, row, steps, "offboarding.handback_done", {});
}

// ---------------------------------------------------------------------------------------
// Checklist (14-39 choice 4)
// ---------------------------------------------------------------------------------------

/** The manifests' Leaving CDS data (the caller maps the registry; P13-P7). */
export type OffboardingManifestInput = {
  slug: string;
  name: string;
  offboarding?: AddonOffboarding;
};

export type OffboardingChecklistLine = {
  key: string;
  label: string;
  /** The state word(s): "disconnects on 14 Nov 2026", "not connected", ... */
  state: string;
  /** Staff runbook for this line, when one applies (GA4 transfer). */
  runbook?: string;
};

export type OffboardingChecklistStep = {
  key: OffboardingOwnerStep;
  status: OffboardingSteps[OffboardingOwnerStep]["status"];
};

export type OffboardingChecklist = {
  /** `preview` before a notice runs: the same lines, dated from today. */
  status: "preview" | OffboardingRow["status"];
  noticeEndsAt: string;
  /** True while every step after DNS is locked. */
  locked: boolean;
  steps: OffboardingChecklistStep[];
  download: { availableUntil: string; line: string };
  addons: {
    items: {
      slug: string;
      addon: string;
      key: string;
      label: string;
      line: string;
    }[];
    /** ADDONS-NA when no installed add-on contributes an item. */
    line: string | null;
  };
  services: OffboardingChecklistLine[];
  billing: {
    endsOn: string;
    annual: boolean;
    rateLock: boolean;
    lines: string[];
  };
  close: { closesOn: string; deletedOn: string; line: string };
};

const OWNER_STEP_LIST: readonly OffboardingOwnerStep[] = [
  "dns_handback",
  "download",
  "addons",
  "services",
  "billing",
  "close",
];

function manifestList(manifests: unknown): readonly OffboardingManifestInput[] {
  if (!Array.isArray(manifests)) throw new InvalidInput("invalid manifests");
  return manifests as readonly OffboardingManifestInput[];
}

/**
 * The Leaving CDS checklist (UI-SPEC "/hub/leaving"). Before a notice runs it is a preview
 * dated from `now` (the start page states it before the owner confirms).
 */
export async function offboardingChecklist(
  ctx: ReadCtx,
  orgId: string | undefined,
  opts: {
    manifests: readonly OffboardingManifestInput[];
    now?: Date;
  },
): Promise<OffboardingChecklist> {
  const org = scopedOrgId(ctx, orgId);
  authorizeOffboarding(ctx, "read");
  const manifests = manifestList(opts?.manifests);
  const now = opts.now ?? new Date();
  const facts = await orgFacts(org);
  if (!facts) throw new NotFound();
  const row = await readOffboardingRow(org);
  const running = row && row.status !== "cancelled" ? row : null;
  const end = running
    ? noticeEnd(running, now)
    : new Date(now.getTime() + NOTICE_DAYS * DAY_MS);
  const endsOn = longDate(end);
  const deleted = new Date(end.getTime() + CLOSED_ORG_DELETE_DAYS * DAY_MS);

  const steps: OffboardingChecklistStep[] = running
    ? OWNER_STEP_LIST.map((key) => ({
        key,
        status: running.steps[key].status,
      }))
    : OWNER_STEP_LIST.map((key) => ({ key, status: "open" as const }));

  const data = await withSuperuser(async (pb) => {
    const active = await activeSet(pb, org);
    const gateway = await gatewayAccountByOrg(pb, org);
    const account = await billingAccountByOrg(pb, org);
    const profile = await pb
      .collection("business_profile")
      .getFirstListItem(pb.filter("organization = {:org}", { org }), {
        fields: "id,sending_domain,sending_status",
      })
      .catch(() => null);
    return { active, gateway, account, profile };
  });

  // Add-ons (P14-P28): items from installed add-ons' manifests; all not applicable in v1.0.
  const items: OffboardingChecklist["addons"]["items"] = [];
  for (const m of manifests) {
    if (!m || typeof m.slug !== "string" || !data.active.has(m.slug)) continue;
    for (const it of m.offboarding?.items ?? []) {
      items.push({
        slug: m.slug,
        addon: String(m.name ?? m.slug),
        key: String(it.key),
        label: String(it.label),
        line: String(it.notApplicable),
      });
    }
  }

  // Connected services.
  const g = data.gateway;
  const stripeOn = g !== null && g.status !== "disconnected";
  const sendingOn =
    data.profile !== null &&
    (String(data.profile.sending_domain ?? "") !== "" ||
      !["", "none"].includes(String(data.profile.sending_status ?? "")));
  const a = facts.analytics;
  const hasAnalytics = [
    "ga4_measurement_id",
    "ga4_property_id",
    "gsc_site_url",
  ].some((k) => typeof a[k] === "string" && a[k] !== "");
  const services: OffboardingChecklistLine[] = [
    {
      key: "stripe",
      label: "Stripe",
      state: stripeOn ? `disconnects on ${endsOn}` : "not connected",
    },
    {
      key: "sending",
      label: "Sending email from your domain",
      state: sendingOn ? `removed on ${endsOn}` : "not connected",
    },
    { key: "gbp", label: "Google Business Profile", state: "not connected" },
    { key: "shipping", label: "Shipping", state: "not connected" },
    hasAnalytics
      ? a.owner === "tenant"
        ? {
            key: "analytics",
            label: "Google Analytics and Search Console",
            state: "already in your own Google account",
          }
        : {
            key: "analytics",
            label: "Google Analytics and Search Console",
            state: `Transfer to your own Google account before ${endsOn}`,
            runbook: GA4_TRANSFER_RUNBOOK,
          }
      : {
          key: "analytics",
          label: "Google Analytics and Search Console",
          state: "not connected",
        },
  ];

  // Billing (D263, D161), composed from the plan.
  const acct = data.account;
  const annual = acct?.cadence === "yearly";
  const rateLock =
    acct?.priceLockedUntil !== null &&
    acct?.priceLockedUntil !== undefined &&
    new Date(acct.priceLockedUntil).getTime() > now.getTime();
  const lines = [`Your plan ends on ${endsOn}.`];
  if (annual) lines.push("Your annual prepay isn't refunded.");
  if (rateLock) {
    lines.push(
      "You lose your launch price. If you come back later, current prices apply.",
    );
  }

  return {
    status: running ? running.status : "preview",
    noticeEndsAt: end.toISOString(),
    locked: running ? !handbackSettled(running.steps) : false,
    steps,
    download: {
      availableUntil: end.toISOString(),
      line: `Available until ${endsOn}.`,
    },
    addons: { items, line: items.length === 0 ? P14_COPY.ADDONS_NA : null },
    services,
    billing: { endsOn: end.toISOString(), annual, rateLock, lines },
    close: {
      closesOn: end.toISOString(),
      deletedOn: deleted.toISOString(),
      line: `${endsOn}. Deleted 30 days later, on ${longDate(deleted)}.`,
    },
  };
}
// ---------------------------------------------------------------------------------------
// Notice end (14-39 choice 5)
// ---------------------------------------------------------------------------------------

async function markSystemStep(
  row: OffboardingRow,
  key: OffboardingStepKey,
  at: string,
  action: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  if (row.steps[key].status === "done") return;
  row.steps = { ...row.steps, [key]: { status: "done", at } };
  await writeSteps(sysCtx(), row, row.steps, action, { step: key, ...meta });
}

/** Delete the org's custom and redirect host rows (the preview row stays; the org closes). */
async function removeCustomHosts(orgId: string): Promise<string[]> {
  const hosts = await withSuperuser(async (pb) => {
    const rows = await pb.collection("org_hosts").getFullList({
      filter: pb.filter(
        "organization = {:org} && (kind = 'custom' || kind = 'redirect')",
        { org: orgId },
      ),
      fields: "id,hostname",
    });
    for (const r of rows) await pb.collection("org_hosts").delete(r.id);
    return rows.map((r) => String(r.hostname ?? ""));
  });
  for (const h of hosts) if (h) forgetHost(h);
  return hosts;
}

/** Expire the org's ready data-download links now (the retention prune removes the zips). */
async function expireDownloadLinks(orgId: string, now: Date): Promise<number> {
  return withSuperuser(async (pb) => {
    const rows = await pb.collection("data_exports").getFullList({
      filter: pb.filter("organization = {:org} && status = 'ready'", {
        org: orgId,
      }),
      fields: "id",
    });
    for (const r of rows) {
      await pb
        .collection("data_exports")
        .update(r.id, { expires_at: now.toISOString() });
    }
    return rows.length;
  });
}

/** Purge the org's public media from the CDN (the app stand-in no-ops). Never throws. */
async function purgePublicMedia(
  orgId: string,
  deps: OffboardingDeps,
): Promise<number> {
  try {
    const store = deps.publicStore ?? getPublicMediaStore();
    const keys = (
      await store.list(`${envPrefix()}tenants/${orgId}/media/`)
    ).map((o) => o.key);
    const delivery = deps.delivery ?? getMediaDelivery();
    for (let i = 0; i < keys.length; i += 100) {
      await delivery.purge(keys.slice(i, i + 100));
    }
    return keys.length;
  } catch (err) {
    console.error(`[offboarding] CDN purge failed: ${errName(err)}`);
    return 0;
  }
}

/**
 * Close a site at the end of its notice (system; called by advanceOffboardings). Refused
 * ("Move your DNS first.") while the DNS handback is open, before the notice ends, and for
 * the demo org. Idempotent: an already-closed offboarding returns its closed_at.
 */
export async function closeAtNoticeEnd(
  orgId: string,
  deps: OffboardingDeps = {},
): Promise<{ closedAt: string }> {
  const org = scopedOrgId(sysCtx(), orgId);
  const row = await readOffboardingRow(org);
  if (!row) throw new NotFound();
  if (row.status === "closed") return { closedAt: row.closedAt ?? "" };
  if (row.status !== "notice") {
    throw new InvalidInput("This offboarding was cancelled.");
  }
  assertHandbackDone(row);
  const now = deps.now ?? new Date();
  if (noticeEnd(row, now).getTime() > now.getTime()) {
    throw new InvalidInput("The notice hasn't ended yet.");
  }
  // WR-A05: a zone delegated to CDS after the notice started (handback was not applicable
  // then) reopens the DNS handback instead of closing the site with live DNS at CDS.
  if (row.steps.dns_handback.status === "not_applicable") {
    const zones = await withSuperuser((pb) => delegatedZones(pb, org));
    if (zones.length > 0) {
      const at0 = now.toISOString();
      const reopened: OffboardingSteps = {
        ...row.steps,
        dns_handback: { status: "open" },
        zone_deleted: { status: "open" },
      };
      for (const k of [...TICK_STEPS, "close"] as const) {
        if (reopened[k].status === "open") reopened[k] = { status: "locked" };
      }
      await writeSteps(
        sysCtx(),
        row,
        reopened,
        "offboarding.handback_reopened",
        { zones: zones.length, at: at0 },
      );
      throw new InvalidInput(MOVE_DNS_FIRST);
    }
  }
  const facts = await orgFacts(org);
  if (!facts) throw new NotFound();
  if (facts.demo) throw new InvalidInput("The demo site never moves away.");
  const at = now.toISOString();

  // 1. Custom hosts (preview row kept).
  const hosts = await removeCustomHosts(org);
  await markSystemStep(row, "hosts_removed", at, "offboarding.hosts_removed", {
    count: hosts.length,
  });
  // 2. Sending identity (SES or the fake) and its records.
  await removeSendingDomain(org, {
    ...(deps.provider ? { provider: deps.provider } : {}),
    ...(deps.sending ? { sending: deps.sending } : {}),
    ...(deps.transport ? { transport: deps.transport } : {}),
    now,
  });
  // 3. Billing: subscription ended now (no refund), launch rate lock removed. Once.
  if (!row.steps.billing_ended_at) {
    await endBillingForOffboarding(org, now, deps);
    row.steps = { ...row.steps, billing_ended_at: at };
    await withSuperuser((pb) =>
      pb.collection(OFFBOARDINGS).update(row.id, { steps: row.steps }),
    );
  }
  // 4. Stripe Connect: CDS creates no more charges on it (the account is the tenant's).
  await endConnectForOffboarding(org, { now });
  // 5. Download links expired; 6. CDN purge (GBP and Shipping have no connection in v1.0).
  const expired = await expireDownloadLinks(org, now);
  const purged = await purgePublicMedia(org, deps);
  await appendAudit(sysCtx(), {
    action: "offboarding.services_ended",
    organization: org,
    targetCollection: OFFBOARDINGS,
    targetId: row.id,
    meta: { downloadsExpired: expired, mediaPurged: purged },
  });
  // 7. The closure (one batch + organization.close audit; keeps the first closed_at).
  const closed = await markOrgClosed(sysCtx(), org, "cancelled", { now });
  forgetOrgLive(org);
  await markSystemStep(row, "site_closed", at, "offboarding.site_closed");
  // 8. The offboarding itself.
  const steps: OffboardingSteps = { ...row.steps };
  for (const k of [...TICK_STEPS, "close"] as const) {
    if (steps[k].status !== "done") steps[k] = { status: "done", at };
  }
  await writeSteps(
    sysCtx(),
    row,
    steps,
    "offboarding.closed",
    {},
    {
      status: "closed",
      closed_at: at,
    },
  );
  return { closedAt: closed.closedAt };
}
