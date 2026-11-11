// Panel health/jobs: filled by 13-45
// Panel health/jobs (13-45 choice 2; STAFF-13, D-UI-P13-13; 13-UI-SPEC "Jobs" lines 897-900).
// Every job heartbeat from staffHealthView in a read-only JobTable (jobs run from the
// scheduler): last success relative to the server clock (absolute time in the title), level,
// threshold in words. HEALTH_ALERT_HREF (`/staff/health?tab=jobs`, 13-44) lands here.
import { JobTable } from "@cds/ui/staff";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { HealthHeader, jobRowView, loadHealthView } from "../health-data";

const HREF = "/staff/health?tab=jobs";

export default async function Panel({ session }: StaffPanelProps) {
  const now = new Date();
  const view = await loadHealthView(session, now);
  if (!view) return <SitesLoadError href={HREF} />;
  return (
    <div className="flex flex-col gap-6 font-hub text-hub-ink">
      <HealthHeader view={view} now={now} />
      <JobTable rows={view.jobs.map((j) => jobRowView(j, now))} />
    </div>
  );
}
