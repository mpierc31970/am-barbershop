"use client";
// Health client islands (13-45 choices 2 and 3; STAFF-13, STAFF-14, CONT-19; 13-UI-SPEC
// "Health" lines 873-903; T-13-45-02):
//   - RefreshHealthButton: ghost sm "Refresh health" (RefreshCw) = router.refresh() with the
//     spinner while the transition runs (the server re-reads staffHealthView).
//   - MediaOverSwitch: "Only over allowance" Switch driving `?tab=media&over=1`.
//   - FailsafeIsland: FailsafeInbox wired to the fail-safe Server Actions; filter and site links
//     are built here (functions can't cross the server/client boundary).
import { Button, Switch } from "@cds/ui/hub";
import {
  FailsafeInbox,
  HEALTH_COPY,
  type FailsafeDeployment,
  type FailsafeFilter,
  type FailsafeRowView,
} from "@cds/ui/staff";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  convertFailsafeRequestAction,
  dismissFailsafeRequestAction,
} from "../../../../actions/staff/health";

export function RefreshHealthButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={<RefreshCw aria-hidden size={16} strokeWidth={2} />}
      loading={pending}
      loadingLabel={HEALTH_COPY.refreshing}
      onClick={() => start(() => router.refresh())}
    >
      {HEALTH_COPY.refresh}
    </Button>
  );
}

export function mediaTabHref(over: boolean): string {
  return over ? "/staff/health?tab=media&over=1" : "/staff/health?tab=media";
}

export function MediaOverSwitch({ over }: { over: boolean }) {
  const router = useRouter();
  return (
    <Switch
      id="media-only-over"
      label={HEALTH_COPY.media.onlyOver}
      checked={over}
      onChange={(next) => router.push(mediaTabHref(next))}
    />
  );
}

export function failsafeTabHref(f: FailsafeFilter): string {
  return f === "pending"
    ? "/staff/health?tab=failsafe"
    : `/staff/health?tab=failsafe&status=${f}`;
}

export function FailsafeIsland({
  rows,
  filter,
  deployment,
}: {
  rows: readonly FailsafeRowView[];
  filter: FailsafeFilter;
  deployment: FailsafeDeployment;
}) {
  return (
    <FailsafeInbox
      rows={rows}
      filter={filter}
      filterHref={failsafeTabHref}
      deployment={deployment}
      convert={convertFailsafeRequestAction}
      dismiss={dismissFailsafeRequestAction}
      siteHref={(orgId) => `/staff/sites/${orgId}`}
    />
  );
}
