// Get add-ons loading state (05-UI-SPEC "Interaction states"): the heading and 3 skeleton
// cards at the real 176px card height, no spinner.
export default function AddonsLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <h1 className="text-[1.75rem] leading-tight font-semibold text-hub-ink">
        Get add-ons
      </h1>
      <div
        aria-hidden="true"
        className="grid grid-cols-1 gap-6 md:grid-cols-2 min-[1120px]:grid-cols-3"
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            data-skeleton-card=""
            className="h-44 animate-pulse rounded-lg bg-hub-surface-2 motion-reduce:animate-none"
          />
        ))}
      </div>
    </div>
  );
}
