// Panel health/premium: filled by 13-45
// Panel health/premium (13-45 choice 2; STAFF-13, D154, P13-P15; 13-UI-SPEC "Premium" lines
// 887-891, PREMIUM-EMPTY line 1040). One row per (site, premium add-on) from staffHealthView:
// health checks, error rate 1 h, DB write p95, failed emails/payments, state. v1.0 installs no
// premium add-on, so the EmptyState PREMIUM-EMPTY-H / -B shows (copy from P13_COPY).
import { P13_COPY } from "@cds/core/staff";
import { EmptyState } from "@cds/ui/hub";
import { PremiumHealthTable } from "@cds/ui/staff";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { HealthHeader, loadHealthView, premiumRowView } from "../health-data";

const HREF = "/staff/health?tab=premium";

export default async function Panel({ session }: StaffPanelProps) {
  const now = new Date();
  const view = await loadHealthView(session, now);
  if (!view) return <SitesLoadError href={HREF} />;
  return (
    <div className="flex flex-col gap-6 font-hub text-hub-ink">
      <HealthHeader view={view} now={now} />
      {view.premium.length === 0 ? (
        <EmptyState
          heading={P13_COPY.PREMIUM_EMPTY_H}
          body={P13_COPY.PREMIUM_EMPTY_B}
        />
      ) : (
        <PremiumHealthTable
          rows={view.premium.map(premiumRowView)}
          siteHref={(orgId) => `/staff/sites/${orgId}`}
        />
      )}
    </div>
  );
}
