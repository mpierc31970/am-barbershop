// Panel health/failsafe: filled by 13-45
// Panel health/failsafe (13-45 choice 3; STAFF-14, D155, D269; 13-UI-SPEC "Fail-safe
// requests" lines 892-896; T-13-45-01). Feature `failsafe_requests` (both roles; the area page
// already required it). `?status=` pending (default) · converted · dismissed · all ->
// staffListFailsafeRequests; the deployment line from failsafeStatus ("Capture service: not
// deployed (GO-LIVE)" until the capture service exists). Add-on slugs show as their registry
// names. Convert / Dismiss run in FailsafeIsland. Request contents are never logged.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import {
  failsafeStatus,
  staffListFailsafeRequests,
  type StaffFailsafeRow,
} from "@cds/db";
import {
  formatHealthTime,
  type FailsafeDeployment,
  type FailsafeFilter,
  type FailsafeRowView,
} from "@cds/ui/staff";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { errName } from "../health-data";
import { FailsafeIsland, failsafeTabHref } from "../HealthIslands";

const FILTERS: readonly FailsafeFilter[] = [
  "pending",
  "converted",
  "dismissed",
  "all",
];

export function parseFailsafeFilter(v: unknown): FailsafeFilter {
  return typeof v === "string" && (FILTERS as readonly string[]).includes(v)
    ? (v as FailsafeFilter)
    : "pending";
}

export function failsafeRowView(
  r: StaffFailsafeRow,
  addonNames: ReadonlyMap<string, string>,
): FailsafeRowView {
  return {
    id: r.id,
    orgId: r.orgId,
    business: r.business,
    addon: addonNames.get(r.addon) ?? r.addon,
    name: r.name,
    email: r.email,
    phone: r.phone,
    preferred: r.preferred,
    message: r.message,
    capturedAt: r.capturedAt,
    status: r.status,
    convertedRef: r.convertedRef,
  };
}

async function deployment(): Promise<FailsafeDeployment> {
  try {
    const s = await failsafeStatus();
    return {
      deployed: s.deployed,
      pending: s.pending_requests,
      lastPull: formatHealthTime(s.last_pull),
    };
  } catch (err) {
    console.error("[staff] fail-safe status read failed", errName(err));
    return { deployed: false, pending: 0, lastPull: null };
  }
}

export default async function Panel({ session, params }: StaffPanelProps) {
  const filter = parseFailsafeFilter(params.status);
  let rows: StaffFailsafeRow[];
  try {
    rows = await staffListFailsafeRequests(session.ctx, { status: filter });
  } catch (err) {
    console.error("[staff] fail-safe list failed", errName(err));
    return <SitesLoadError href={failsafeTabHref(filter)} />;
  }
  const names = new Map(ADDON_REGISTRY.list().map((m) => [m.slug, m.name]));
  return (
    <FailsafeIsland
      rows={rows.map((r) => failsafeRowView(r, names))}
      filter={filter}
      deployment={await deployment()}
    />
  );
}
