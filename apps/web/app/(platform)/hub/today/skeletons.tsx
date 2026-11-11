// Today skeletons (11-17; 11-UI-SPEC "Interaction states": Today status / stage = skeleton
// line + tracker skeleton, Needs you = 3 skeleton rows). Used by loading.tsx and as each
// section's Suspense fallback. Aria-hidden placeholders; the pulse stops under reduced motion.
import { Skeleton } from "@cds/ui/hub";

export function StageSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-hidden="true">
      <div className="flex flex-col gap-2">
        <div className="h-9 w-64 rounded bg-hub-surface-2" />
        <Skeleton rows={1} rowHeight={24} />
      </div>
      <Skeleton rows={1} rowHeight={160} />
    </div>
  );
}

export function NeedsYouSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <div className="h-6 w-32 rounded bg-hub-surface-2" />
      <Skeleton rows={3} rowHeight={56} />
    </div>
  );
}

/** 11-19: Today cards (card skeleton: title + 3 rows). */
export function CardsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="h-6 w-32 rounded bg-hub-surface-2" />
      <Skeleton rows={3} rowHeight={40} />
    </div>
  );
}

/** 11-19: This week / From CDS rail panels (3 skeleton rows). */
export function RailSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <div className="h-6 w-28 rounded bg-hub-surface-2" />
      <Skeleton rows={3} rowHeight={32} />
    </div>
  );
}
