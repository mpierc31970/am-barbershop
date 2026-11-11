// Today loading state (11-17; 11-UI-SPEC "Interaction states" Today rows). The status line
// and tracker skeleton, then three Needs-you rows; no spinner.
import { NeedsYouSkeleton, StageSkeleton } from "./skeletons";

export default function TodayLoading() {
  return (
    <div className="flex max-w-[880px] flex-col gap-8" aria-busy="true">
      <StageSkeleton />
      <NeedsYouSkeleton />
    </div>
  );
}
