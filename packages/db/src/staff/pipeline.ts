// packages/db/src/staff/pipeline.ts (13-14): the staff console's Pipeline read models
// (STAFF-01, STAFF-03, STAFF-04; D26, D28, D29; P13-P11, P13-P22; T-13-14-01..03).
// Leads wrap listLeads (never re-query the lead set) and mask the owner email; Reveal email is
// a separate audited call. Fit holds read the describeFitCase case. Building / Polish / Launch
// read the stage, the org_intake.assembly ledger, the preview host and the (P14 stand-in)
// launch review. Every function is read-only except revealLeadEmail's audit row. Decisions
// stay where they live: approveFit / declineFit / declinePaidOrg / setOrgStage (13-27).
// Scale is 10-50 orgs: one superuser read per collection, joined in memory.
import { authorizeStaff, NotFound } from "@cds/core";
import {
  abandonedKindOf,
  isAbandonedLead,
  leadStageChip,
  maskEmail,
  type LeadStageChip,
} from "@cds/core/staff";
import type { AssemblyLedger } from "@cds/core/templates";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { parseLedger } from "../assembly/ledger";
import { polishCount, reportRows } from "../assembly/report";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import {
  assertPlatformContext,
  mintOrgContext,
  type PlatformContext,
} from "../context";
import { MOVE_STEPS, openMoveFor, type MoveView } from "../dns/moves";
import { readFitCase, type FitVerdict } from "../fit";
import { launchReviewView } from "../launch-review/review";
import { listHubInquiries } from "../hub-inquiries";
import { INQUIRY_TOPIC_LABELS, listLeads, type Lead } from "../leads";
import { getSitePreviewUrl, type LaunchReviewProgress } from "../org-stage";

const DAY_MS = 86_400_000;
const ID_RE = /^[a-z0-9]{15}$/;
const OPEN_TICKET =
  "(status = 'open' || status = 'in_progress' || status = 'waiting_on_you')";
/**
 * Pitfall 4 (P13-P11): the launch checklist was informational until P14. Kept for the staff
 * barrel; since 14-36 the checklist is the owner's real review and the note is empty.
 */
export const STAFF_LAUNCH_INFORMATIONAL_NOTE = "(owner review arrives in P14)";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function dateOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function toTime(v: unknown): number | null {
  if (typeof v !== "string" || v === "") return null;
  const t = new Date(v.replace(" ", "T")).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Bound OR of `organization = {:oN}` terms (T-02-13: no template-literal filters). */
function inOrgs(pb: PocketBase, ids: readonly string[]): string {
  return ids
    .map((id, i) =>
      pb.filter("organization = {:o" + i + "}", { ["o" + i]: id }),
    )
    .join(" || ");
}

/** A read-only system OrgContext for the OrgContext-only reads (preview URL, launch review). */
function readCtx(pctx: PlatformContext, orgId: string) {
  return mintOrgContext({
    orgId,
    actor: "",
    role: "owner",
    grants: [],
    systemJob: "staff-pipeline-read",
    ip: pctx.ip,
  });
}

// ---------------------------------------------------------------- leads (STAFF-01)

export type StaffLeadsSince = "7d" | "30d" | "all";

export type StaffLeadRow = {
  id: string;
  /** Hub inquiries are left out here (no stage chip); the Leads panel lists them itself (15-07). */
  kind: Exclude<Lead["kind"], "inquiry">;
  /** The org id when the lead is an org (quotes have none). */
  orgId: string | null;
  /** Org name, else the quote's business name; "" for an unnamed quote ("Unnamed quote"). */
  business: string;
  stage: LeadStageChip;
  /** The listLeads status word ("saved", "intake 3/7", "sent" …). */
  status: string;
  path: string;
  abandoned: boolean;
  /** Whole days since the last activity. */
  abandonedDays: number;
  /** ISO time of the last change. */
  lastActivity: string;
  /** "m•••@example.com"; the full address only through revealLeadEmail (P13-P22). */
  emailMasked: string;
  /** listLeads ASSEMBLED word ("-", "queued", "done 7 Oct" …). */
  assembled: string;
  items: number;
};

function sinceDate(
  since: StaffLeadsSince | undefined,
  now: Date,
): Date | undefined {
  if (since === "7d") return new Date(now.getTime() - 7 * DAY_MS);
  if (since === "30d") return new Date(now.getTime() - 30 * DAY_MS);
  return undefined;
}

/**
 * Every lead with its stage chip, abandoned flag and days, and a masked owner email. Never
 * returns an address. `since` defaults to "30d" (UI-SPEC default); `now` is injectable.
 */
export async function staffLeads(
  ctx: PlatformContext,
  opts: { since?: StaffLeadsSince; now?: Date } = {},
): Promise<StaffLeadRow[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "leads_list");
  const now = opts.now ?? new Date();
  const leads = (
    await listLeads(ctx, {
      since: sinceDate(opts.since ?? "30d", now),
    })
  ).filter(
    (l): l is Lead & { kind: StaffLeadRow["kind"] } => l.kind !== "inquiry",
  );
  const orgIds = leads.filter((l) => l.kind === "org").map((l) => l.id);
  const quoteIds = leads.filter((l) => l.kind === "quote").map((l) => l.id);

  const { names, billing, quoteNames } = await withSuperuser(async (pb) => {
    const names = new Map<string, string>();
    const billing = new Map<
      string,
      { paid: boolean; checkoutAt: string | null }
    >();
    const quoteNames = new Map<string, string>();
    if (orgIds.length > 0) {
      const ors = orgIds
        .map((id, i) => pb.filter("id = {:i" + i + "}", { ["i" + i]: id }))
        .join(" || ");
      const [orgs, accounts] = await Promise.all([
        pb
          .collection("organizations")
          .getFullList({ filter: ors, fields: "id,name" }),
        pb.collection("billing_accounts").getFullList({
          filter: inOrgs(pb, orgIds),
          fields: "organization,paid_at,checkout_session_id,created",
        }),
      ]);
      for (const o of orgs) names.set(o.id, str(o.name));
      for (const a of accounts) {
        billing.set(str(a.organization), {
          paid: str(a.paid_at) !== "",
          // A billing account exists once a checkout starts (10-16); it resets "abandoned".
          checkoutAt:
            str(a.checkout_session_id) || str(a.paid_at)
              ? str(a.created)
              : null,
        });
      }
    }
    if (quoteIds.length > 0) {
      const ors = quoteIds
        .map((id, i) => pb.filter("id = {:q" + i + "}", { ["q" + i]: id }))
        .join(" || ");
      const rows = await pb
        .collection("quotes")
        .getFullList({ filter: ors, fields: "id,business_name" });
      for (const q of rows) quoteNames.set(q.id, str(q.business_name));
    }
    return { names, billing, quoteNames };
  });

  return leads.map((l): StaffLeadRow => {
    const b = l.kind === "org" ? billing.get(l.id) : undefined;
    const facts = { kind: l.kind, status: l.status, paid: b?.paid === true };
    const ab = isAbandonedLead(
      {
        kind: abandonedKindOf(facts),
        lastActivityAt: l.lastChange,
        checkoutStartedAt: b?.checkoutAt ?? null,
      },
      now,
    );
    return {
      id: l.id,
      kind: l.kind,
      orgId: l.kind === "org" ? l.id : null,
      business:
        l.kind === "org"
          ? (names.get(l.id) ?? "")
          : (quoteNames.get(l.id) ?? ""),
      stage: leadStageChip(facts),
      status: l.status,
      path: l.path,
      abandoned: ab.abandoned,
      abandonedDays: ab.days,
      lastActivity: l.lastChange.toISOString(),
      emailMasked: maskEmail(l.email),
      assembled: l.assembled,
      items: l.items,
    };
  });
}

/** A hub /contact inquiry as a Leads row (15-07, A3-Q2): masked email, never the message. */
export type StaffInquiryLeadRow = {
  id: string;
  /** The sender's business, else their name. */
  business: string;
  /** The staff topic word ("Question", "Book a call", "Press"). */
  topicLabel: string;
  /** ISO time the inquiry arrived. */
  lastActivity: string;
  emailMasked: string;
};

/**
 * Hub inquiries in the same time range as staffLeads (default "30d"), newest first. Masked
 * email only; the full address through revealLeadEmail (audited, target hub_inquiries).
 */
export async function staffInquiryLeads(
  ctx: PlatformContext,
  opts: { since?: StaffLeadsSince; now?: Date } = {},
): Promise<StaffInquiryLeadRow[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "leads_list");
  const now = opts.now ?? new Date();
  const since = sinceDate(opts.since ?? "30d", now);
  const rows = await listHubInquiries(ctx, since ? { since } : {});
  return rows.map((r) => {
    const t = toTime(r.created);
    return {
      id: r.id,
      business: r.business || r.name,
      topicLabel: INQUIRY_TOPIC_LABELS[r.topic],
      lastActivity: t === null ? "" : new Date(t).toISOString(),
      emailMasked: maskEmail(r.email),
    };
  });
}

/**
 * Reveal email (P13-P22, T-13-14-02): the one lead's address, with audit `lead.email_revealed`
 * (actor + IP; `organization` = the lead's org when it has one, meta `{ leadId }`). The lead
 * is found through listLeads, so the address is exactly the one the list masked.
 */
export async function revealLeadEmail(
  ctx: PlatformContext,
  leadId: string,
): Promise<string> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "lead_reveal");
  if (typeof leadId !== "string" || !ID_RE.test(leadId)) {
    throw new NotFound("lead not found");
  }
  const lead = (await listLeads(ctx)).find((l) => l.id === leadId);
  if (!lead || lead.email === "") throw new NotFound("lead not found");
  await withSuperuser(async (pb) => {
    await pb.collection("audit_log").create(
      auditBody(ctx, {
        action: "lead.email_revealed",
        ...(lead.kind === "org" ? { organization: lead.id } : {}),
        targetCollection:
          lead.kind === "org"
            ? "organizations"
            : lead.kind === "inquiry"
              ? "hub_inquiries"
              : "quotes",
        targetId: lead.id,
        meta: { leadId: lead.id },
      }),
    );
  });
  return lead.email;
}

// ---------------------------------------------------------------- fit holds (STAFF-03)

export type StaffFitHold = {
  orgId: string;
  name: string;
  businessType: string;
  description: string;
  verdict: FitVerdict;
  reasons: string[];
  blocked: boolean;
  fields: { field: string; text: string }[];
  /** Pass to approveFit as `reviewed` (13-27). */
  fingerprint: string;
  /** ISO time of the newest fit.hold audit row, else the org's last update. */
  heldSince: string | null;
};

/**
 * Orgs in fit_review with their describeFitCase case, oldest hold first. Read only (`console`:
 * agents see the case; the decisions are super_admin + fit_review in 13-27).
 */
export async function staffFitHolds(
  ctx: PlatformContext,
): Promise<StaffFitHold[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "console");
  const { orgs, holds } = await withSuperuser(async (pb) => {
    const orgs = await pb.collection("organizations").getFullList({
      filter: "stage = 'fit_review'",
      fields: "id,updated",
    });
    const holds = new Map<string, string>();
    if (orgs.length > 0) {
      const rows = await pb.collection("audit_log").getFullList({
        filter:
          "action = 'fit.hold' && (" +
          inOrgs(
            pb,
            orgs.map((o) => o.id),
          ) +
          ")",
        sort: "created,id",
        fields: "organization,created",
      });
      for (const r of rows) holds.set(str(r.organization), str(r.created));
    }
    return { orgs, holds };
  });
  const out: StaffFitHold[] = [];
  for (const o of orgs) {
    const c = await readFitCase(o.id);
    out.push({
      orgId: c.orgId,
      name: c.name,
      businessType: c.businessType,
      description: c.description,
      verdict: c.verdict,
      reasons: c.reasons,
      blocked: c.verdict === "blocked",
      fields: c.fields,
      fingerprint: c.fingerprint,
      heldSince: holds.get(o.id) || dateOrNull(o.updated),
    });
  }
  return out.sort(
    (a, b) => (toTime(a.heldSince) ?? 0) - (toTime(b.heldSince) ?? 0),
  );
}

// ---------------------------------------------------------------- building / polish / launch

type OrgRow = {
  id: string;
  name: string;
  stage: string;
  buildNote: string;
  updated: string;
};

async function orgsAt(stages: readonly string[]): Promise<{
  orgs: OrgRow[];
  ledgers: Map<string, AssemblyLedger>;
  paid: Map<string, string>;
}> {
  return withSuperuser(async (pb) => {
    const filter = stages
      .map((s, i) => pb.filter("stage = {:s" + i + "}", { ["s" + i]: s }))
      .join(" || ");
    const rows = await pb.collection("organizations").getFullList({
      filter,
      fields: "id,name,stage,build_note,updated",
    });
    const orgs = rows.map((r: RecordModel) => ({
      id: r.id,
      name: str(r.name),
      stage: str(r.stage),
      buildNote: str(r.build_note),
      updated: str(r.updated),
    }));
    const ledgers = new Map<string, AssemblyLedger>();
    const paid = new Map<string, string>();
    if (orgs.length > 0) {
      const ids = orgs.map((o) => o.id);
      const [intakes, accounts] = await Promise.all([
        pb.collection("org_intake").getFullList({
          filter: inOrgs(pb, ids),
          fields: "organization,assembly",
        }),
        pb.collection("billing_accounts").getFullList({
          filter: inOrgs(pb, ids),
          fields: "organization,paid_at",
        }),
      ]);
      for (const r of intakes)
        ledgers.set(str(r.organization), parseLedger(r.assembly));
      for (const a of accounts) {
        if (str(a.paid_at)) paid.set(str(a.organization), str(a.paid_at));
      }
    }
    return { orgs, ledgers, paid };
  });
}

export type StaffBuildingRow = {
  orgId: string;
  name: string;
  stage: "ready_for_build" | "being_built";
  assembly: {
    state: AssemblyLedger["status"] | "none";
    attempts: number;
    /** assembled_at when done, else started_at; null when never run. */
    lastRun: string | null;
    /** Fallback + omitted slots in the last report (0 without a report). */
    unfilled: number;
    errorCode: string | null;
  };
  buildNote: string;
  paidAt: string | null;
  /** organizations.updated (the stage move is the last org write in practice). */
  inStageSince: string;
};

function hasRun(ledger: AssemblyLedger | undefined): boolean {
  return (
    !!ledger &&
    (ledger.attempts > 0 || !!ledger.started_at || ledger.status !== "queued")
  );
}

function unfilledOf(ledger: AssemblyLedger | undefined): number {
  return ledger?.report
    ? ledger.report.slots.filter((s) => s.source !== "provided").length
    : 0;
}

/** ready_for_build and being_built orgs with their assembly state and build note (oldest first). */
export async function staffBuildingQueue(
  ctx: PlatformContext,
): Promise<StaffBuildingRow[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "console");
  const { orgs, ledgers, paid } = await orgsAt([
    "ready_for_build",
    "being_built",
  ]);
  return orgs
    .map((o): StaffBuildingRow => {
      const l = ledgers.get(o.id);
      const ran = hasRun(l);
      return {
        orgId: o.id,
        name: o.name,
        stage: o.stage as StaffBuildingRow["stage"],
        assembly: {
          state: ran && l ? l.status : "none",
          attempts: l?.attempts ?? 0,
          lastRun:
            (l?.status === "done" ? l.assembled_at : l?.started_at) ?? null,
          unfilled: unfilledOf(l),
          errorCode: l?.error?.code ?? null,
        },
        buildNote: o.buildNote,
        paidAt: paid.get(o.id) ?? null,
        inStageSince: o.updated,
      };
    })
    .sort(
      (a, b) => (toTime(a.inStageSince) ?? 0) - (toTime(b.inStageSince) ?? 0),
    );
}

export type StaffSlotRow = {
  page: string;
  slot: string;
  /** SOURCE_WORDS result word ("Filled", "Default used", "Left out"). */
  result: string;
  note: string;
  source: "provided" | "fallback" | "omitted";
  filled: boolean;
};

export type StaffPolishRow = {
  orgId: string;
  name: string;
  previewUrl: string | null;
  assembledAt: string | null;
  slots: StaffSlotRow[];
  unfilled: number;
  /** polishCount: fallback slots plus report-level polish items. */
  toPolish: number;
  polish: string[];
  buildNote: string;
};

/** being_built orgs whose assembly is done, oldest assembly first, unfilled slots first. */
export async function staffPolishQueue(
  ctx: PlatformContext,
): Promise<StaffPolishRow[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "console");
  const { orgs, ledgers } = await orgsAt(["being_built"]);
  const out: StaffPolishRow[] = [];
  for (const o of orgs) {
    const l = ledgers.get(o.id);
    if (!l || l.status !== "done") continue;
    const report = l.report;
    const words = report ? reportRows(report) : [];
    const slots: StaffSlotRow[] = (report?.slots ?? []).map((s, i) => ({
      page: words[i]?.[0] ?? s.page,
      slot: words[i]?.[1] ?? s.slot,
      result: words[i]?.[2] ?? s.source,
      note: words[i]?.[3] ?? "",
      source: s.source,
      filled: s.source === "provided",
    }));
    slots.sort((a, b) => Number(a.filled) - Number(b.filled));
    out.push({
      orgId: o.id,
      name: o.name,
      previewUrl: await getSitePreviewUrl(readCtx(ctx, o.id)),
      assembledAt: l.assembled_at ?? null,
      slots,
      unfilled: slots.filter((s) => !s.filled).length,
      toPolish: report ? polishCount(report) : 0,
      polish: report ? [...report.polish] : [],
      buildNote: o.buildNote,
    });
  }
  return out.sort(
    (a, b) => (toTime(a.assembledAt) ?? 0) - (toTime(b.assembledAt) ?? 0),
  );
}

/**
 * 14-36 (RESEARCH Pitfall 12): true when the org has a launch move that is not cancelled.
 * Such a site goes live only through Approve launch (the move's cutover), so the org:stage
 * CLI refuses `--to live` for it. Staff only; one bound-param read.
 */
export async function staffHasLaunchMove(
  ctx: PlatformContext,
  orgId: string,
): Promise<boolean> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "console");
  if (!ID_RE.test(orgId)) throw new NotFound();
  return withSuperuser(async (pb) => {
    const res = await pb.collection("domain_moves").getList(1, 1, {
      filter: pb.filter(
        "org_id = {:org} && kind = 'launch' && status != 'cancelled'",
        { org: orgId },
      ),
      fields: "id",
      skipTotal: true,
    });
    return res.items.length > 0;
  });
}

/** The launch move state Pipeline › Launch shows in its Domain column (14-36, UI-SPEC). */
export type StaffLaunchMoveState =
  | "prepared"
  | "waiting_owner"
  | "gate_review"
  | "running"
  | "failed"
  | "cutover_running"
  | "none";

export type StaffLaunchMove = {
  /** `M-<seq>`, or null when no move is open. */
  code: string | null;
  state: StaffLaunchMoveState;
  /** 1-based step number of a failed move (UI "Failed · step 8"). */
  failedStep?: number;
  /** The domain the move connects (`to_host`). */
  domain?: string;
  /** APPROVE-BLOCKED's "waiting on …" words; null when prepared. */
  waitingOn: string | null;
};

export type StaffLaunchRow = {
  orgId: string;
  name: string;
  checklist: LaunchReviewProgress & { informational: boolean; note: string };
  /**
   * The owner's launch review (14-33): submittedAt null until Ready to launch. CR-D01:
   * resubmitNeeded lists pages changed after the send; non-empty means the send is stale.
   */
  review: {
    done: number;
    total: number;
    submittedAt: string | null;
    resubmitNeeded: string[];
  };
  move: StaffLaunchMove;
  openChangeTickets: number;
  openChangeTicketNumbers: number[];
  inReviewSince: string;
  previewUrl: string | null;
};

const NO_MOVE: StaffLaunchMove = {
  code: null,
  state: "none",
  waitingOn: "no domain is connected yet",
};

/**
 * Map an open move to its launch state (14-36). Pure: the approve action reads the same row,
 * so the column, the disabled button and the server refusal never disagree.
 */
export function staffLaunchMoveOf(v: MoveView | null): StaffLaunchMove {
  if (!v) return NO_MOVE;
  const base = { code: v.code, domain: v.toHost };
  const n = MOVE_STEPS.indexOf(v.currentStep) + 1;
  if (v.kind !== "launch") {
    return { ...base, state: "running", waitingOn: "a domain move is running" };
  }
  switch (v.status) {
    case "prepared":
      return { ...base, state: "prepared", waitingOn: null };
    case "cutover_running":
      return {
        ...base,
        state: "cutover_running",
        waitingOn: "the launch is already running",
      };
    case "waiting_owner":
      return {
        ...base,
        state: "waiting_owner",
        waitingOn: "waiting on nameservers",
      };
    case "failed": {
      const step = MOVE_STEPS.indexOf(v.failedStep ?? v.currentStep) + 1;
      return {
        ...base,
        state: "failed",
        failedStep: step,
        waitingOn: `step ${step} failed`,
      };
    }
    default:
      if (v.currentStep === "gate" && (v.findings?.length ?? 0) > 0) {
        return {
          ...base,
          state: "gate_review",
          waitingOn: "the gate needs review",
        };
      }
      return {
        ...base,
        state: "running",
        waitingOn: `step ${n} (${v.currentStep}) is still running`,
      };
  }
}

/**
 * ready_for_review orgs with the owner's launch review (14-33 launchReviewView, system read),
 * their open move (14-36: Approve launch needs it `prepared`) and their open change-request
 * tickets. The checklist is no longer informational (P14).
 */
export async function staffLaunchQueue(
  ctx: PlatformContext,
): Promise<StaffLaunchRow[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "console");
  const { orgs, tickets } = await withSuperuser(async (pb) => {
    const orgs = await pb.collection("organizations").getFullList({
      filter: "stage = 'ready_for_review'",
      fields: "id,name,updated",
    });
    const tickets = new Map<string, number[]>();
    if (orgs.length > 0) {
      const rows = await pb.collection("support_threads").getFullList({
        filter:
          "kind = 'ticket' && type = 'change' && " +
          OPEN_TICKET +
          " && (" +
          inOrgs(
            pb,
            orgs.map((o) => o.id),
          ) +
          ")",
        sort: "number",
        fields: "organization,number",
      });
      for (const r of rows) {
        const key = str(r.organization);
        const list = tickets.get(key) ?? [];
        list.push(Number(r.number));
        tickets.set(key, list);
      }
    }
    return { orgs, tickets };
  });
  const out: StaffLaunchRow[] = [];
  for (const o of orgs) {
    const rctx = readCtx(ctx, o.id);
    const view = await launchReviewView(rctx);
    const move = staffLaunchMoveOf(await openMoveFor(ctx, o.id));
    const numbers = tickets.get(o.id) ?? [];
    out.push({
      orgId: o.id,
      name: str(o.name),
      checklist: {
        items: view.items.map((i) => ({
          id: i.id,
          label: i.label,
          done: i.done,
        })),
        done: view.done,
        total: view.total,
        available: view.available,
        informational: false,
        note: "",
      },
      review: {
        done: view.done,
        total: view.total,
        submittedAt: view.submittedAt,
        resubmitNeeded: view.resubmitNeeded,
      },
      move,
      openChangeTickets: numbers.length,
      openChangeTicketNumbers: numbers,
      inReviewSince: str(o.updated),
      previewUrl: await getSitePreviewUrl(rctx),
    });
  }
  return out.sort(
    (a, b) => (toTime(a.inReviewSince) ?? 0) - (toTime(b.inReviewSince) ?? 0),
  );
}
