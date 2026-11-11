// Marketing loading state (07-16; 07-UI-SPEC "Interaction states" Contacts: 8 skeleton rows).
// The H1 stays put; contact rows at their real 56px height, no spinner.
import { Skeleton } from "@cds/ui/hub";

export default function MarketingLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <h1 className="text-[1.75rem] leading-tight font-semibold text-hub-ink">
        Marketing
      </h1>
      <Skeleton rows={8} rowHeight={56} />
    </div>
  );
}
