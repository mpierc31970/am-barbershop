// P10 payments: Care Plan monthly hour tracking (10-27; BILL-19; CONTEXT A4; D297, D298, D299;
// invariants 1 and 9).
//
// `care_plan_time` is append-only: staff log minutes against an org (staff CLI `care:log`, later
// the P12/P13 tickets), the owner's Billing tab reads the month's total. The month is the
// business-time-zone month from `careMonth`; unused minutes never roll over. Logging past 60 is
// refused with the locked copy, so extra edits are always quoted first (D297).
//
// Whether an org "has the Care Plan" comes from the entitlement set (10-17), never the raw
// `care_plan` flag: a lapsed or canceled account pauses the Care Plan, so nothing is logged
// against it and the owner's read reports it off (10-27 choice 4). `past_due` keeps it (D310).
//
// Writers: platform context + `care_log` (super_admin, support_agent) only; the row and its
// `care_plan.log` audit entry commit in one PB batch (T-10-27-01, T-10-27-02). Reader: owner
// only (`billing:read`), scoped by ctx.orgId with bound filters (T-10-27-03).
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import {
  BUSINESS_TIME_ZONE,
  CARE_PLAN_MINUTES,
  careLogCheck,
  careMonth,
  type CareMonth,
} from "@cds/core/payments";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import {
  assertOrgContext,
  assertPlatformContext,
  type OrgContext,
  type PlatformContext,
} from "../context";
import { newRecordId, requirePermission } from "../repository";
import { billingAccountByOrg } from "./accounts";
import { entitlementsFor, PAUSED } from "./entitlements";

const COLLECTION = "care_plan_time";
const MINUTES_MAX = 600;
const NOTE_MAX = 500;
/** Ticket refs are short ids from a future ticket system (choice 1): letters, digits, . _ - # : */
const TICKET_RE = /^[A-Za-z0-9._#:-]{1,64}$/;
const ORG_RE = /^[a-z0-9]{15}$/;
const RECENT = 5;

/** The locked copy (CONTEXT A4): extra edits are quoted, never logged past the hour. */
export const CARE_OVER_HOUR_COPY =
  "Over the hour: send a polish quote (work:quote --kind polish).";
export const CARE_LAPSED_COPY =
  "This site's billing has lapsed: the Care Plan is paused until they pay.";
export const CARE_NOT_ON_COPY = "This site doesn't have the Care Plan.";

export type CareTimeDeps = { now?: () => Date };

export type LogCareTimeInput = {
  orgId: string;
  minutes: number;
  note: string;
  ticketRef?: string;
};

export type CareEntry = { date: string; minutes: number; note: string };

export type CarePlanUsage = {
  on: boolean;
  usedMinutes: number;
  /** "October": the business-time-zone month. */
  monthLabel: string;
  /** "1 Nov": the day the hour resets. */
  resetLabel: string;
  /** Up to 5, newest first. */
  entries: CareEntry[];
  /** All entries this month (the "Show all {n}" count). */
  totalEntries: number;
};

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  day: "numeric",
  month: "short",
});

function dayMonth(d: Date): string {
  return DAY_MONTH.format(d);
}

function validate(input: LogCareTimeInput): {
  orgId: string;
  minutes: number;
  note: string;
  ticketRef: string;
} {
  const { orgId, minutes } = input;
  if (typeof orgId !== "string" || !ORG_RE.test(orgId)) {
    throw new InvalidInput("organization id is not valid");
  }
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MINUTES_MAX) {
    throw new InvalidInput(`minutes must be a whole number 1-${MINUTES_MAX}`);
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note === "" || note.length > NOTE_MAX) {
    throw new InvalidInput(`note must be 1-${NOTE_MAX} characters`);
  }
  const ticketRef =
    input.ticketRef === undefined ? "" : String(input.ticketRef).trim();
  if (ticketRef !== "" && !TICKET_RE.test(ticketRef)) {
    throw new InvalidInput(
      "ticket ref must be 1-64 letters, digits or . _ - # :",
    );
  }
  return { orgId, minutes, note, ticketRef };
}

async function orgExists(pb: PocketBase, orgId: string): Promise<boolean> {
  const res = await pb.collection("organizations").getList(1, 1, {
    filter: pb.filter("id = {:org}", { org: orgId }),
    fields: "id",
  });
  return res.items.length > 0;
}

/** Is the Care Plan on right now (entitlement), and if not, why (choice 4). */
async function careState(
  pb: PocketBase,
  orgId: string,
): Promise<"on" | "lapsed" | "off"> {
  const set = await entitlementsFor(pb, orgId);
  if (set.keys.has("care-plan")) return "on";
  const account = await billingAccountByOrg(pb, orgId);
  return account?.carePlan && PAUSED.has(account.status) ? "lapsed" : "off";
}

function monthFilter(pb: PocketBase, orgId: string, m: CareMonth): string {
  return pb.filter(
    "organization = {:org} && logged_at >= {:start} && logged_at < {:end}",
    { org: orgId, start: m.start, end: m.end },
  );
}

async function monthRows(pb: PocketBase, orgId: string, m: CareMonth) {
  return pb.collection(COLLECTION).getFullList({
    filter: monthFilter(pb, orgId, m),
    fields: "id,minutes,note,logged_at",
    sort: "-logged_at,-created",
  });
}

function sumMinutes(rows: readonly RecordModel[]): number {
  return rows.reduce(
    (n, r) => n + (typeof r.minutes === "number" ? r.minutes : 0),
    0,
  );
}

/**
 * Staff: log Care Plan minutes against an org (BILL-19). Refused (InvalidInput, nothing
 * written) when the org lacks the Care Plan, when its billing is lapsed or canceled, or when
 * the month's total would pass 60 (message: "that would make N of 60 minutes." + the locked copy).
 * Note: two staff logging at the same instant could both pass the check; at 10-50 tenants and
 * one support desk that race is accepted (the audit log shows both entries).
 */
export async function logCareTime(
  pctx: PlatformContext,
  input: LogCareTimeInput,
  deps: CareTimeDeps = {},
): Promise<{ usedMinutes: number; monthLabel: string }> {
  assertPlatformContext(pctx);
  authorizeStaff(pctx.staffRole, "care_log");
  const { orgId, minutes, note, ticketRef } = validate(input);
  const now = (deps.now ?? (() => new Date()))();
  const month = careMonth(now);

  return withSuperuser(async (pb) => {
    if (!(await orgExists(pb, orgId))) throw new NotFound();
    const state = await careState(pb, orgId);
    if (state === "lapsed") throw new InvalidInput(CARE_LAPSED_COPY);
    if (state === "off") throw new InvalidInput(CARE_NOT_ON_COPY);

    const used = sumMinutes(await monthRows(pb, orgId, month));
    const check = careLogCheck(used, minutes);
    if (!check.ok) {
      throw new InvalidInput(
        `that would make ${check.total} of ${CARE_PLAN_MINUTES} minutes. ${CARE_OVER_HOUR_COPY}`,
      );
    }

    const id = newRecordId();
    const batch = pb.createBatch();
    batch.collection(COLLECTION).create({
      id,
      organization: orgId,
      minutes,
      note,
      ticket_ref: ticketRef,
      staff: pctx.actor,
      logged_at: now.toISOString(),
    });
    batch.collection("audit_log").create(
      auditBody(pctx, {
        action: "care_plan.log",
        organization: orgId,
        targetCollection: COLLECTION,
        targetId: id,
        meta: {
          minutes,
          usedMinutes: check.total,
          month: `${month.year}-${String(month.month).padStart(2, "0")}`,
          ticketRef: ticketRef || null,
        },
      }),
    );
    await batch.send();
    return { usedMinutes: check.total, monthLabel: month.label };
  });
}

/**
 * Owner: this month's Care Plan use for the Billing tab ("25 of 60 minutes used in October",
 * CARE-RESET, up to 5 recent entries). `on: false` with no entries while the Care Plan is off
 * or paused by a lapse (choice 3).
 */
export async function carePlanUsage(
  ctx: OrgContext,
  deps: CareTimeDeps = {},
): Promise<CarePlanUsage> {
  assertOrgContext(ctx);
  requirePermission(ctx, "billing", "read");
  const month = careMonth((deps.now ?? (() => new Date()))());
  const base = {
    monthLabel: month.label,
    resetLabel: dayMonth(month.end),
  };
  return withSuperuser(async (pb) => {
    if ((await careState(pb, ctx.orgId)) !== "on") {
      return {
        on: false,
        usedMinutes: 0,
        ...base,
        entries: [],
        totalEntries: 0,
      };
    }
    const rows = await monthRows(pb, ctx.orgId, month);
    return {
      on: true,
      usedMinutes: sumMinutes(rows),
      ...base,
      entries: rows.slice(0, RECENT).map((r) => ({
        date: dayMonth(new Date(String(r.logged_at).replace(" ", "T"))),
        minutes: typeof r.minutes === "number" ? r.minutes : 0,
        note: typeof r.note === "string" ? r.note : "",
      })),
      totalEntries: rows.length,
    };
  });
}
