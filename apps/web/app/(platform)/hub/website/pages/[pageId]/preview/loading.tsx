// Draft preview loading state (03-UI-REVIEW Fix 3): the dark preview strip, then the page
// area as skeleton bands, so the preview does not flash the builder or the pages list.
import { Skeleton } from "@cds/ui/hub";

export default function PreviewLoading() {
  return (
    <div className="font-hub" aria-busy="true">
      <div className="flex min-h-11 items-center bg-hub-ink px-4 py-1 text-sm text-hub-surface">
        <p role="status">Loading preview</p>
      </div>
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-8 px-6 py-12 md:px-8 md:py-16">
        <Skeleton rows={1} rowHeight={240} />
        <Skeleton rows={3} rowHeight={96} />
      </div>
    </div>
  );
}
