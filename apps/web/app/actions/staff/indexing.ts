"use server";
// Indexing actions (13-39 choice 2; STAFF-17, D190; D-UI-P13-13; T-13-39-01). Public POST
// endpoints (Server Actions, never a GET): every argument is untrusted. Thin callers of the
// @cds/db functions `indexing:run` and the data layer already use:
//   resubmitAction(orgId) -> staffResubmit        (audit indexing.resubmitted, organization)
//   resubmitAllAction()   -> staffResubmitAllLive (live, non-demo; audit indexing.resubmitted_all)
// `indexing` feature, both roles, no step-up. runStaffAction re-reads the staff session and
// STAFF_MATRIX; the db functions check the matrix again. Errors are logged by class name only.
import {
  staffIndexingStatus,
  staffResubmit,
  staffResubmitAllLive,
  type PlatformContext,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import {
  errorName,
  runStaffAction,
  type ActionResult,
} from "../../../lib/staff-action";

type Failure = Extract<ActionResult<never>, { ok: false }>;

const ORG_RE = /^[a-z0-9]{15}$/;
const FEATURE = "indexing";

const SITE_NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "That site wasn't found.",
};

export type ResubmitResult = { message: string; ping: string; sitemap: string };
export type ResubmitAllResult = {
  message: string;
  count: number;
  errors: number;
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Resubmitted Rivera Bakery." plus what failed, if anything. */
function resubmitLine(business: string, ping: string, sitemap: string): string {
  const parts = [`Resubmitted ${business}.`];
  if (ping === "error") parts.push("The ping failed.");
  if (sitemap === "error") parts.push("The sitemap check failed.");
  return parts.join(" ");
}

/** "Resubmitted 14 live sites. 0 sitemap errors." */
function resubmitAllLine(count: number, errors: number): string {
  return `Resubmitted ${plural(count, "live site", "live sites")}. ${plural(errors, "sitemap error", "sitemap errors")}.`;
}

function refresh(org?: string): void {
  try {
    revalidatePath("/staff/health");
    if (org) revalidatePath(`/staff/sites/${org}`);
  } catch (err) {
    console.error("[staff indexing] revalidate failed", errorName(err));
  }
}

/** Resubmit one site: ping its URLs and re-check its sitemap. */
export async function resubmitAction(
  orgId: unknown,
): Promise<ActionResult<ResubmitResult>> {
  const org = typeof orgId === "string" && ORG_RE.test(orgId) ? orgId : null;
  if (!org) return SITE_NOT_FOUND;
  const result = await runStaffAction(
    FEATURE,
    { stepUp: false },
    async (ctx: PlatformContext) => {
      const [site] = await staffIndexingStatus(ctx, { orgId: org });
      const out = await staffResubmit(ctx, org);
      return {
        message: resubmitLine(site?.business || org, out.ping, out.sitemap),
        ping: out.ping,
        sitemap: out.sitemap,
      };
    },
  );
  if (result.ok) refresh(org);
  return result;
}

/** Resubmit every live, non-demo site (confirm-gated in the console). */
export async function resubmitAllAction(): Promise<
  ActionResult<ResubmitAllResult>
> {
  const result = await runStaffAction(
    FEATURE,
    { stepUp: false },
    async (ctx: PlatformContext) => {
      const { count, errors } = await staffResubmitAllLive(ctx);
      return {
        message: resubmitAllLine(count, errors),
        count,
        errors,
      };
    },
  );
  if (result.ok) refresh();
  return result;
}
