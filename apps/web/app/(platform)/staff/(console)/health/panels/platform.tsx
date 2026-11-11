// Panel health/platform: filled by 13-45
// Panel health/platform (13-45 choice 2; STAFF-13, D154, D171; 13-UI-SPEC "Platform" lines
// 877-886). The status line ("Checked 2 min ago · Alerts email m•••@…" + Refresh health), the
// components HealthTable (critical first; stand-ins in words with the h-none tone, never as
// errors), then Backups: database offsite, tenant exports and the restore rehearsal row, with
// "Restore last rehearsed N days ago" and the Runbook line. A failed read shows ERR-LOAD.
import { HEALTH_COPY, HealthTable } from "@cds/ui/staff";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import {
  HealthHeader,
  healthRowView,
  loadHealthView,
  restoreAgo,
} from "../health-data";

const HREF = "/staff/health?tab=platform";

export default async function Panel({ session }: StaffPanelProps) {
  const now = new Date();
  const view = await loadHealthView(session, now);
  if (!view) return <SitesLoadError href={HREF} />;
  return (
    <div className="flex flex-col gap-6 font-hub text-hub-ink">
      <HealthHeader view={view} now={now} />
      <HealthTable
        caption={HEALTH_COPY.platformCaption}
        rows={view.components.map(healthRowView)}
      />
      <section aria-labelledby="health-backups" className="flex flex-col gap-3">
        <h2 id="health-backups" className="text-lg font-semibold">
          {HEALTH_COPY.backupsHeading}
        </h2>
        <p className="text-sm text-hub-ink-muted" data-testid="restore-line">
          {HEALTH_COPY.restoreLine(restoreAgo(view.restore.days))}
        </p>
        <HealthTable
          caption={HEALTH_COPY.backupsCaption}
          rows={view.backups.map(healthRowView)}
          sort={false}
          extra={(r) =>
            r.id === "restore" ? (
              <span className="mt-1 block text-sm font-normal text-hub-ink-muted">
                {HEALTH_COPY.runbook}
              </span>
            ) : null
          }
        />
      </section>
    </div>
  );
}
