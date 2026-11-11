// Setup overview loading state (06-UI-SPEC "Setup overview": skeleton progress line, seven
// 72px rows and the panel). Pure placeholders, hidden from assistive tech.
import { Skeleton } from "@cds/ui/hub";

export default function SetupLoading() {
  return (
    <div className="flex flex-col gap-6 font-hub" aria-busy="true">
      <h1 className="text-[1.75rem] leading-tight font-semibold text-hub-ink">
        Set up your site
      </h1>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="order-2 flex flex-col gap-4 lg:order-1">
          <Skeleton rows={1} rowHeight={24} />
          <Skeleton rows={7} rowHeight={72} />
        </div>
        <div className="order-1 lg:order-2">
          <Skeleton rows={1} rowHeight={320} ground="surface" />
        </div>
      </div>
    </div>
  );
}
