// Your profile and alerts loading state (11-24; 11-UI-SPEC "Interaction states"): the H1 and
// skeleton rows for You, the Alerts table and Quiet hours; no spinner.
import { Skeleton } from "@cds/ui/hub";
import { PROFILE_COPY } from "@cds/ui/hub/alerts";

export default function ProfileLoading() {
  return (
    <div
      className="flex w-full max-w-[880px] flex-col gap-8 font-hub"
      aria-busy="true"
    >
      <h1 className="text-[28px] leading-[1.2] font-semibold text-hub-ink">
        {PROFILE_COPY.title}
      </h1>
      <div className="flex flex-col gap-3" aria-hidden="true">
        <div className="h-6 w-24 rounded bg-hub-surface-2" />
        <Skeleton rows={2} rowHeight={24} />
      </div>
      <div className="flex flex-col gap-3" aria-hidden="true">
        <div className="h-6 w-24 rounded bg-hub-surface-2" />
        <Skeleton rows={6} rowHeight={48} />
      </div>
      <div className="flex flex-col gap-3" aria-hidden="true">
        <div className="h-6 w-32 rounded bg-hub-surface-2" />
        <Skeleton rows={1} rowHeight={40} />
      </div>
    </div>
  );
}
