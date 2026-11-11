// Pure view helpers for the signed confirmation at /hub/agreement/signed/<id> (09-18; AGR-04;
// CONTEXT A2-Q4; D-UI-P9-10, D-UI-P9-13; 09-UI-SPEC "Signed confirmation"; T-09-18-05).
// Time zone: the org's business-profile zone when set and valid, else UTC, always labelled
// (09-18 choice 2).
import type { AgreementDocument } from "@cds/db";
import { safeNext } from "./agreement-gate";

export const SIGNED_TITLE = "Your agreement is signed";
export const PROOF_LABEL = "Proof code";
export const PROOF_HELPER =
  "If you ever need to show this agreement wasn't changed, CDS can check it against this code.";
export const SETTINGS_LEGAL = "/hub/settings?tab=legal";

export type ConfirmationAction = { label: string; href: string };

const SETUP: ConfirmationAction = {
  label: "Back to setting up your site",
  href: "/hub/setup",
};

/**
 * The secondary action beside Download. Only a safe same-origin /hub `next` is followed
 * (safeNext); checkout continues to checkout, any other hub path (and every re-accept)
 * continues to the hub, otherwise back to setup while the org is still in setup, and to the
 * hub once it is past it (`inSetup` false; review IN-C07: a Settings › Legal history row of
 * a live site never points back to setup).
 */
export function confirmationActions(
  next: string | null,
  kind: AgreementDocument["signingKind"] = "signup",
  inSetup = true,
): ConfirmationAction {
  const safe = next === null ? "" : safeNext(next, "");
  if (/^\/hub\/checkout(?:[/?#]|$)/.test(safe)) {
    return { label: "Continue to checkout", href: safe };
  }
  if (/^\/hub\/setup(?:[/?#]|$)/.test(safe)) return { ...SETUP, href: safe };
  if (safe !== "") return { label: "Continue to your hub", href: safe };
  if (kind === "reaccept" || !inSetup)
    return { label: "Continue to your hub", href: "/hub" };
  return SETUP;
}

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

export function validZone(tz: string | null): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/**
 * `now` as YYYY-MM-DD in the org's zone (validZone; UTC when unset or invalid). The signing
 * panel's date label uses it so it matches the confirmation and Settings › Legal for the
 * same signature (review IN-C06).
 */
export function localDay(now: Date, tz: string | null): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: validZone(tz),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "8 Oct 2026" and "2:14 pm" in `timeZone`. */
export function dateParts(
  iso: string,
  timeZone: string,
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value ?? "0");
  const h = get("hour") % 24;
  const mi = String(get("minute")).padStart(2, "0");
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return {
    date: `${get("day")} ${MONTHS[get("month") - 1]} ${get("year")}`,
    time: `${h12}:${mi} ${h < 12 ? "am" : "pm"}`,
  };
}

export function formatSignedSentence(
  doc: AgreementDocument,
  orgName: string,
  timeZone: string | null,
): string {
  const tz = validZone(timeZone);
  const { date, time } = dateParts(doc.signedAt, tz);
  return `Signed by ${doc.signerName} for ${orgName} on ${date} at ${time} (${tz}). Your copy records each policy's exact wording and version.`;
}

export type PolicyRow = { key: string; term: string; value: string };

/** One row per policy signed this time (a re-accept lists only the re-signed ones). */
export function policyRows(doc: AgreementDocument): PolicyRow[] {
  return doc.versions.map((v) => ({
    key: v.key,
    term: v.title,
    value: `Version ${v.version}`,
  }));
}

/** COPY-RETAIN. */
export function copyRetain(email: string): string {
  return `We've emailed a link to ${email}. You can download your copy any time from Settings › Legal.`;
}
