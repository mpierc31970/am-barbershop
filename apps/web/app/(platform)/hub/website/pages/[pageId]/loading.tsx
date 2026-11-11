// Page builder loading state (03-UI-SPEC "Interaction states": builder block list, 3
// skeleton rows at 56px; 03-UI-REVIEW Fix 3). Same frame as Builder: a header bar, then the
// 360px block list on hub-surface-2 beside the form pane. No spinner.
import { Skeleton } from "@cds/ui/hub";

export default function BuilderLoading() {
  return (
    <div
      className="flex min-h-dvh flex-col font-hub text-hub-ink"
      aria-busy="true"
    >
      <span className="sr-only" role="status">
        Loading page
      </span>
      <div className="flex flex-col gap-2 border-b border-hub-border bg-hub-surface px-4 py-2 md:min-h-16 md:flex-row md:items-center md:justify-between md:gap-6 md:px-8">
        <div className="w-full max-w-80">
          <Skeleton rows={1} rowHeight={32} />
        </div>
        <div className="w-full md:w-64">
          <Skeleton rows={1} rowHeight={40} />
        </div>
      </div>
      <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="bg-hub-surface-2 p-4">
          <Skeleton rows={3} rowHeight={56} ground="surface-2" />
        </div>
        <div className="hidden bg-hub-surface px-8 py-8 lg:block">
          <div className="max-w-[720px]">
            <Skeleton rows={4} rowHeight={64} />
          </div>
        </div>
      </div>
    </div>
  );
}
