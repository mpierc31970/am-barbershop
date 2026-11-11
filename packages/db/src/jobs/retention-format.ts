// The retention run report for the staff terminal (09-21; LIFE-02, D290; UI-SPEC
// "retention:run"). Pure: no I/O, no clock. Org names appear here and only here (choice 3):
// never in logs, the job route's response or the heartbeat. Every period in the text comes
// from the one retention table in @cds/core/legal.
import {
  AGREEMENT_RETENTION_YEARS,
  AUDIT_LOG_RETENTION_DAYS,
  CLOSED_ORG_DELETE_DAYS,
  EXPORT_RETENTION_DAYS,
  RETENTION_ORG_CAP_PER_RUN,
} from "@cds/core/legal";
import { HUB_INQUIRY_RETENTION_DAYS } from "../hub-inquiries";
import {
  PAYMENT_RECORD_RETENTION_YEARS,
  type RetentionJobResult,
} from "./retention";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const LABEL_WIDTH = 30;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `2026-10-08 04:30` in UTC. */
function stamp(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** `7 Sep` in UTC; an unreadable date prints as `?`. */
function dayMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "?";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function row(label: string, value: string): string {
  return `${label.padEnd(LABEL_WIDTH)}${value}`;
}

/** The UI-SPEC lines for one run (or dry run) of the retention job. */
export function formatRetentionRun(
  result: RetentionJobResult,
  now: Date,
): string {
  const lines: string[] = [];
  if (result.dryRun) lines.push("Dry run: nothing was deleted.");
  lines.push(`Retention run · ${stamp(now)} UTC`);

  const verb = result.dryRun ? "would delete" : "deleted";
  const names = result.deletedOrgs
    .map((o) => `${o.name} (${o.reason} ${dayMonth(o.closedAt)})`)
    .join(", ");
  lines.push(
    row(
      `Closed sites due (${CLOSED_ORG_DELETE_DAYS} days):`,
      names ? `${result.orgsDue}   ${verb}: ${names}` : String(result.orgsDue),
    ),
  );
  lines.push(
    row(
      `Signatures past ${AGREEMENT_RETENTION_YEARS} years:`,
      String(result.signaturesExpired),
    ),
  );
  lines.push(
    row(
      `Payment records past ${PAYMENT_RECORD_RETENTION_YEARS} years:`,
      String(result.paymentRecordsExpired),
    ),
  );
  lines.push(
    row(
      `Audit rows past ${Math.round(AUDIT_LOG_RETENTION_DAYS / 365)} years:`,
      String(result.auditDeleted),
    ),
  );
  // 15-07: hub /contact inquiries (two years, P15-P14); `hubInquiriesDeleted` in the result.
  lines.push(
    row(
      `Hub inquiries past ${Math.round(HUB_INQUIRY_RETENTION_DAYS / 365)} years:`,
      String(result.hubInquiriesDeleted ?? 0),
    ),
  );
  const kept = result.keptAgreementsForDeletedOrgs;
  if (kept > 0) {
    const noun = kept === 1 ? "signed agreement" : "signed agreements";
    // Each is kept to its own signed_at + 7 years, so no single year is printed (IN-A04).
    lines.push(
      `Kept: ${kept} ${noun} for deleted sites (each ${AGREEMENT_RETENTION_YEARS} years from signing).`,
    );
  }
  const keptPay = result.keptPaymentRecordsForDeletedOrgs;
  if (keptPay > 0) {
    const noun = keptPay === 1 ? "invoice or quote" : "invoices and quotes";
    lines.push(
      `Kept: ${keptPay} ${noun} for deleted sites (${PAYMENT_RECORD_RETENTION_YEARS} years from deletion).`,
    );
  }
  lines.push(
    `Backups and exports age out on their own over ${EXPORT_RETENTION_DAYS} days.`,
  );
  if (result.capHit) {
    const waiting = Math.max(0, result.orgsDue - result.deletedOrgs.length);
    lines.push(
      `Stopped at ${RETENTION_ORG_CAP_PER_RUN} sites this run; ${waiting} more wait for the next run. Check why so many closed.`,
    );
  }
  if (result.failedSteps.length > 0) {
    lines.push(
      `Not finished: ${result.failedSteps.join(", ")}. Run it again; if it fails twice, check the server log.`,
    );
  }
  return lines.join("\n");
}
