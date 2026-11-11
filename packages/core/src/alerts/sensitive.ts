// Sensitive-practice mode (DASH-37, D305, T-11-05-02): push and email subjects never show a
// client's name or service; only the hub shows the full title.
import type { AlertTypeSpec } from "./types";

/**
 * Business types (onboarding/business-types.ts ids) that start with sensitive-practice mode
 * on: therapy, counseling and health businesses (D305). The owner can switch it off.
 */
export const SENSITIVE_BY_DEFAULT: ReadonlySet<string> = new Set([
  "therapist",
  "counselor",
  "wellness-clinic",
  "med-spa",
]);

/** The business profile value wins; empty falls back to the business type default. */
export function sensitivePracticeOn(
  profileValue: "on" | "off" | "" | null | undefined,
  businessType: string | null | undefined,
): boolean {
  if (profileValue === "on") return true;
  if (profileValue === "off") return false;
  return SENSITIVE_BY_DEFAULT.has((businessType ?? "").trim());
}

/** Push/email subject: the safe title when sensitive (type label if none), else the title. */
export function alertSubject(
  spec: AlertTypeSpec,
  alert: { title: string; safe_title?: string | null },
  sensitive: boolean,
): string {
  if (!sensitive) return alert.title;
  const safe = (alert.safe_title ?? "").trim();
  return safe !== "" ? safe : spec.label;
}
