// The agreement item on the Setup "What's still needed" panel (09-19; AGR-02, AGR-07;
// CONTEXT A2-Q5, A3-Q1; D-UI-P9-4; 09-UI-SPEC "Setup item"; RESEARCH Pitfall 15).
//
// One pure rule shared by the Setup panel (loadStageData) and the sidebar "Set up your site"
// count (hub layout), so the two never disagree. Nothing about the agreement shows before
// Send to CDS: the item appears from ready_for_build onward (09-19 choice 1) and stays until
// signed. fit_review is excluded: a held site may still be declined, so the owner is not
// asked to sign before CDS clears it (one thing at a time, D-UI-P9-4).
//
// This module has no server imports (type-only from @cds/db); the layout and loadStageData
// read the status through getAgreementStatus (lib/agreement-gate.ts, request-cached).
import type { AgreementStatus, OrgStage } from "@cds/db";

/**
 * The onboarding stages, in order (packages/db org-stage.ts); the agreement item shows from
 * ready_for_build onward.
 */
export const STAGE_ORDER: readonly Exclude<OrgStage, "">[] = [
  "intake",
  "fit_review",
  "ready_for_build",
  "being_built",
];

/** Stages that show the agreement item: ready_for_build and every later one. */
export const AGREEMENT_STAGES: readonly string[] = STAGE_ORDER.slice(
  STAGE_ORDER.indexOf("ready_for_build"),
);

export type AgreementSetupItem = {
  state: "needed" | "signed" | "outdated";
  /** The Owner, signed in as themselves (never staff impersonating). */
  canSign: boolean;
  /** "8 Oct 2026" when signed, else null. */
  signedOn: string | null;
} | null;

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
] as const;

/** "8 Oct 2026" in `timeZone` (UTC when unset or unknown); null for unreadable input. */
export function signedOnDate(
  iso: string | null,
  timeZone?: string | null,
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = (tz: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(d);
  let p: Intl.DateTimeFormatPart[];
  try {
    p = parts(timeZone || "UTC");
  } catch {
    p = parts("UTC");
  }
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    Number(p.find((x) => x.type === t)?.value ?? "0");
  const month = MONTHS[get("month") - 1];
  if (!month) return null;
  return `${get("day")} ${month} ${get("year")}`;
}

/**
 * The agreement item for this org and viewer, or null when nothing shows (before Send to
 * CDS, past onboarding, or when the status could not be read).
 */
export function agreementSetupItem(
  stage: string,
  status: AgreementStatus | null,
  role: string,
  impersonating: boolean,
  timeZone?: string | null,
): AgreementSetupItem {
  if (!status || !AGREEMENT_STAGES.includes(stage)) return null;
  const canSign = role === "owner" && !impersonating;
  if (status.state === "current") {
    return {
      state: "signed",
      canSign,
      signedOn: signedOnDate(status.lastSignedAt, timeZone),
    };
  }
  if (status.state === "outdated") {
    return { state: "outdated", canSign, signedOn: null };
  }
  return { state: "needed", canSign, signedOn: null };
}

/**
 * True when the item is a required "still needed" item. Only `needed` counts: an outdated
 * Owner never reaches the hub (re-accept gate, 09-15), and other members cannot act on it.
 */
export function countsAsRequired(item: AgreementSetupItem): boolean {
  return item?.state === "needed";
}

/** The sidebar count: the intake must-haves still missing plus the unsigned agreement. */
export function setupNeededCount(
  intakeRequired: number,
  item: AgreementSetupItem,
): number {
  return (
    Math.max(0, Math.floor(intakeRequired)) + (countsAsRequired(item) ? 1 : 0)
  );
}

/** MEMBER-OUTDATED (09-UI-SPEC copy), shown to Admins only. */
export const MEMBER_OUTDATED_COPY =
  "CDS updated its terms. Your site owner needs to accept them; nothing changes for you or your site meanwhile.";

/** The ?notice= value /hub adds for an Admin when the terms are outdated (HubNotice). */
export const TERMS_UPDATED_NOTICE = "terms-updated";

/** The Admin notice on /hub (MEMBER-OUTDATED, D-UI-P9-19): Admins only, terms outdated. */
export function showMemberOutdated(
  status: AgreementStatus | null,
  role: string,
): boolean {
  return status?.state === "outdated" && role === "admin";
}
