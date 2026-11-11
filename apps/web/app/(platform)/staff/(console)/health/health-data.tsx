// Health panel data (13-45 choices 1 and 2; STAFF-13, D154, D-UI-P13-22; 13-UI-SPEC "Health"
// lines 873-899). One read of `staffHealthView` (feature `health`, manifests from
// ADDON_REGISTRY.list(), P13-P7) per panel render, mapped to the @cds/ui/staff/health row views.
// Relative times come from the server clock (one clock for every cell). Thresholds are shown in
// words ("warn > 500 ms · critical > 2 s" -> "Warning above 500 ms · Critical above 2 s"; ages
// read "after"). A failed read logs the class name only.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import {
  healthAgo,
  staffHealthView,
  type StaffHealthJobRow,
  type StaffHealthPremiumRow,
  type StaffHealthRow,
  type StaffHealthView,
} from "@cds/db";
import {
  HealthStatusLine,
  type HealthRowView,
  type JobRowView,
  type PremiumHealthRowView,
} from "@cds/ui/staff";
import type { StaffWebSession } from "../../../../../lib/staff-session";
import { RefreshHealthButton } from "./HealthIslands";

export function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** The health view, or null when the read failed (the panel shows ERR-LOAD). */
export async function loadHealthView(
  session: StaffWebSession,
  now: Date = new Date(),
): Promise<StaffHealthView | null> {
  try {
    return await staffHealthView(session.ctx, {
      now,
      manifests: ADDON_REGISTRY.list(),
    });
  } catch (err) {
    console.error("[staff] health read failed", errName(err));
    return null;
  }
}

const AGE_UNIT = /^(?:\d+(?:\.\d+)?)\s*(?:min|h|days?|d)\b/;

function part(word: string, rest: string): string {
  const v = rest.replace(/^>\s*/, "").trim();
  return `${word} ${AGE_UNIT.test(v) ? "after" : "above"} ${v}`;
}

/** "warn > 26 h · critical > 2 s" -> "Warning after 26 h · Critical above 2 s". */
export function thresholdWords(text: string): string {
  if (!text) return "";
  return text
    .split(/\s*·\s*/)
    .map((p) => {
      const m = /^(warn|critical)\s+(.*)$/i.exec(p.trim());
      if (!m) return p.trim();
      return part(
        m[1]!.toLowerCase() === "warn" ? "Warning" : "Critical",
        m[2]!,
      );
    })
    .join(" · ");
}

export function healthRowView(r: StaffHealthRow): HealthRowView {
  return {
    id: r.id,
    label: r.label,
    reading: r.reading,
    level: r.level,
    threshold: thresholdWords(r.threshold),
    since: r.since,
  };
}

export function jobRowView(r: StaffHealthJobRow, now: Date): JobRowView {
  return {
    id: r.id,
    job: r.job,
    label: r.label,
    schedule: r.schedule,
    lastSuccess: r.lastSuccess,
    lastSuccessAgo: r.lastSuccess ? healthAgo(r.lastSuccess, now) : null,
    level: r.level,
    reading: r.reading,
    warningText: r.warningText,
    criticalText: r.criticalText,
    since: r.since,
  };
}

export function premiumRowView(r: StaffHealthPremiumRow): PremiumHealthRowView {
  return { ...r };
}

/** "12 days ago" / "1 day ago" / "today"; null when never rehearsed. */
export function restoreAgo(days: number | null): string | null {
  if (days === null) return null;
  if (days <= 0) return "today";
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** "Checked 2 min ago · Alerts email m•••@example.com" + Refresh health. */
export function HealthHeader({
  view,
  now,
}: {
  view: StaffHealthView;
  now: Date;
}) {
  return (
    <HealthStatusLine
      checkedAgo={healthAgo(view.generatedAt, now)}
      alertEmail={view.alertEmail}
      refresh={<RefreshHealthButton />}
    />
  );
}
