// Step loading state (06-UI-SPEC "Interaction states": stage form, skeleton fields).
import { Skeleton } from "@cds/ui/hub";

export default function StageLoading() {
  return (
    <div
      className="flex flex-col gap-6 font-hub lg:flex-row lg:gap-8"
      aria-busy="true"
    >
      <div className="hidden w-60 shrink-0 lg:block">
        <Skeleton rows={8} rowHeight={44} ground="surface" />
      </div>
      <div className="flex w-full max-w-[720px] flex-col gap-8">
        <Skeleton rows={1} rowHeight={36} />
        <Skeleton rows={6} rowHeight={64} />
      </div>
    </div>
  );
}
