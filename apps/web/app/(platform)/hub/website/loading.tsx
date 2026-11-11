// Pages list loading state (UI-SPEC "Interaction states"): 4 skeleton rows at the real
// 56px row height, no spinner.
import { Skeleton } from "@cds/ui/hub";

export default function WebsiteLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <h1 className="text-[1.75rem] leading-tight font-semibold text-hub-ink">
        Website
      </h1>
      <Skeleton rows={4} rowHeight={56} />
    </div>
  );
}
