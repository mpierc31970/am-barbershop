// Panel settings/demo: filled by 13-46
// Panel settings/demo (13-46 choice 3; STAFF-18, D293, P13-P13; 13-UI-SPEC "Settings" Demo
// tenant). The area page already required `staff_roles` (super_admin; `demo_reset` is
// super_admin too). Reads: findDemoOrgId + staffGetSite (name, preview host), platform_meta
// `demo:last_reset` (every finished reset, job or staff) and `job:demo:last_counts` (the
// nightly job's counts). Next reset = the next 3:30 am America/Chicago (the hourly trigger runs
// at :30 and acts in the 3 am hour). Reset now runs resetDemoAction in DemoIsland.
import {
  DEMO_JOB_COUNTS_KEY,
  DEMO_LAST_RESET_KEY,
  DEMO_NAME,
  DEMO_RESET_HOUR,
  DEMO_RESET_TIME_ZONE,
  findDemoOrgId,
  readPlatformMeta,
  staffGetSite,
} from "@cds/db";
import { formatHealthTime, type DemoPanelView } from "@cds/ui/staff";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { DemoIsland } from "../SettingsIslands";

/** Reset minute within the reset hour (the Coolify task runs at :30). */
const RESET_MINUTE = 30;

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** "Oct 17, 3:30 am (America/Chicago)": the next nightly reset after `now`. */
export function nextDemoResetText(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEMO_RESET_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const minutes = n("hour") * 60 + n("minute");
  const today = minutes < DEMO_RESET_HOUR * 60 + RESET_MINUTE;
  // Calendar arithmetic on the local date (noon UTC avoids any DST edge).
  const day = new Date(
    Date.UTC(n("year"), n("month") - 1, n("day") + (today ? 0 : 1), 12),
  );
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(day);
  return `${date}, ${DEMO_RESET_HOUR}:${String(RESET_MINUTE).padStart(2, "0")} am (${DEMO_RESET_TIME_ZONE})`;
}

function parseCounts(
  raw: string | null,
): { rowsDeleted: number; rowsSeeded: number; ok: boolean } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as {
      rowsDeleted?: unknown;
      rowsSeeded?: unknown;
      failedSteps?: unknown;
      reset?: unknown;
    };
    if (typeof v.rowsDeleted !== "number" || typeof v.rowsSeeded !== "number")
      return null;
    if (v.reset === 0) return null;
    return {
      rowsDeleted: v.rowsDeleted,
      rowsSeeded: v.rowsSeeded,
      ok: !Array.isArray(v.failedSteps) || v.failedSteps.length === 0,
    };
  } catch {
    return null;
  }
}

export async function loadDemoView(
  session: StaffPanelProps["session"],
  now: Date = new Date(),
): Promise<DemoPanelView> {
  const orgId = await findDemoOrgId();
  const site = orgId ? await staffGetSite(session.ctx, orgId) : null;
  const [lastReset, countsRaw] = await Promise.all([
    readPlatformMeta(DEMO_LAST_RESET_KEY),
    readPlatformMeta(DEMO_JOB_COUNTS_KEY),
  ]);
  const counts = parseCounts(countsRaw);
  return {
    name: site?.name || DEMO_NAME,
    orgId,
    host: site?.previewHost ?? null,
    lastReset: formatHealthTime(lastReset),
    // demo:last_reset is written only after a finished reset.
    lastResetOk: lastReset ? true : null,
    nextReset: nextDemoResetText(now),
    counts: counts
      ? { rowsDeleted: counts.rowsDeleted, rowsSeeded: counts.rowsSeeded }
      : null,
  };
}

export default async function Panel({ session }: StaffPanelProps) {
  let view: DemoPanelView;
  try {
    view = await loadDemoView(session);
  } catch (err) {
    console.error("[staff] demo view failed", errName(err));
    return <SitesLoadError href="/staff/settings?tab=demo" />;
  }
  return <DemoIsland view={view} />;
}
