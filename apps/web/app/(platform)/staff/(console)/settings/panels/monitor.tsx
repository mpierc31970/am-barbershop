// Panel settings/monitor: filled by 13-46
// Panel settings/monitor (13-46 choice 3; STAFF-16, STAFF-15, D174, D175; 13-UI-SPEC "Settings"
// Monitor; T-13-46-02). The area page already required `staff_roles` (super_admin). Shows the
// endpoint path, whether MONITOR_TOKEN is configured (a boolean only: the value is never read
// into a variable, rendered or logged), the current monitorStatus() overall and each top-level
// section as OK or Degraded (null = its feeder failed, P13-P28), and the brief.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import type { MonitorStatusDoc } from "@cds/core/health";
import { monitorStatus } from "@cds/db";
import { MonitorPanel, type MonitorPanelView } from "@cds/ui/staff";

export const MONITOR_ENDPOINT = "/api/monitor/status";
export const MONITOR_BRIEF_PATH = ".planning/design/MONITOR-APP-BRIEF.md";
const BRIEF_HREF = `https://github.com/mpierc31970/cds-website/blob/main/${MONITOR_BRIEF_PATH}`;

/** Document keys that are metadata, not sections. */
const NOT_SECTIONS = new Set(["generated_at", "version", "overall"]);

export function monitorSections(
  doc: MonitorStatusDoc,
): MonitorPanelView["sections"] {
  return Object.entries(doc)
    .filter(([k]) => !NOT_SECTIONS.has(k))
    .map(([name, value]) => ({ name, ok: value !== null }));
}

export default async function Panel() {
  const tokenConfigured = Boolean(process.env.MONITOR_TOKEN);
  let doc: MonitorStatusDoc | null = null;
  try {
    doc = await monitorStatus({ manifests: ADDON_REGISTRY.list() });
  } catch (err) {
    console.error(
      "[staff] monitor status failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
  return (
    <MonitorPanel
      view={{
        endpoint: MONITOR_ENDPOINT,
        tokenConfigured,
        overall: doc?.overall ?? null,
        sections: doc ? monitorSections(doc) : [],
        briefPath: MONITOR_BRIEF_PATH,
        briefHref: BRIEF_HREF,
      }}
    />
  );
}
