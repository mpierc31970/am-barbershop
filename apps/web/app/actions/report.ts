"use server";
// Public /report (STAFF-24, D249, P13-P24; 13-30 choice 3; T-13-30-01..04). Anonymous: no
// session, never a tenant id from the browser (the org comes from the URL's host inside
// createPublicReport). Order: field checks (lib/report-form validateReport), then the
// per-IP limiter (5/hour, RATE-REPORT), then the Turnstile human check, then the case.
// A report becomes an R-n review case plus a confirmation to the reporter (and a URL +
// category notice to the owner, 13-23); it never creates a ticket.
// Logging is class names only: never the URL, description, name or email.
import { InvalidInput, RateLimited } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import {
  beginReportAction,
  createPublicReport,
  ERR_HUMAN,
  getHumanCheck,
} from "@cds/db";
import {
  REPORT_COPY,
  REPORT_TOKEN_MAX,
  reportValuesFrom,
  validateReport,
  type ReportState,
} from "../../lib/report-form";
import { clientIp } from "../../lib/session";

function logFailure(err: unknown): void {
  console.error(
    `[report] submit failed ${err instanceof Error ? err.name : typeof err}`,
  );
}

/**
 * Turnstile siteverify through the configured HumanCheck: turnstileHumanCheck with the
 * TURNSTILE_SECRET_KEY, Cloudflare's always-pass test secret outside production until the
 * key exists, fail closed in production without it (packages/db human-check).
 */
async function verifyHuman(token: string, ip: string): Promise<boolean> {
  try {
    return await getHumanCheck().verify(token, ip);
  } catch {
    return false;
  }
}

function idle(
  error: string | null,
  fieldErrors: Extract<ReportState, { status: "idle" }>["fieldErrors"] = {},
): ReportState {
  return { status: "idle", error, fieldErrors };
}

export async function submitReportAction(
  _prev: ReportState,
  formData: FormData,
): Promise<ReportState> {
  try {
    const { fieldErrors, report } = validateReport(reportValuesFrom(formData));
    if (!report) return idle(null, fieldErrors);

    const ip = await clientIp();
    beginReportAction(ip);

    const raw = formData.get("cf-turnstile-response");
    const token =
      typeof raw === "string" ? raw.trim().slice(0, REPORT_TOKEN_MAX + 1) : "";
    if (!(await verifyHuman(token, ip))) return idle(ERR_HUMAN);

    const created = await createPublicReport(report);
    return {
      status: "sent",
      ref: created.ref,
      email: report.reporterEmail || null,
    };
  } catch (err) {
    if (err instanceof RateLimited) return idle(P13_COPY.RATE_REPORT);
    if (err instanceof InvalidInput) return idle(err.message);
    logFailure(err);
    return idle(REPORT_COPY.ERR_SEND);
  }
}
