// Inbox loading state (07-19; 07-UI-SPEC "Interaction states" Inbox: 5 skeleton rows at 56px).
// The H1 stays put; message rows at their real height, no spinner.
import { Skeleton } from "@cds/ui/hub";

export default function InboxLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <h1 className="text-[1.75rem] leading-tight font-semibold text-hub-ink">
        Inbox
      </h1>
      <Skeleton rows={5} rowHeight={56} />
    </div>
  );
}
