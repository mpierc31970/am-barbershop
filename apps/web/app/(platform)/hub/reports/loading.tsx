// Reports loading state (11-33; 11-UI-SPEC "Interaction states" Reports: per-section
// skeleton). The H1 stays put; each section shows its heading line and body at about its
// real height (the chart is 160px), no spinner.
import { Skeleton } from "@cds/ui/hub";

const SECTIONS = [
  { rows: 2, height: 24 },
  { rows: 1, height: 160 },
  { rows: 4, height: 40 },
  { rows: 4, height: 40 },
] as const;

export default function ReportsLoading() {
  return (
    <div className="flex max-w-[880px] flex-col gap-6" aria-busy="true">
      <h1 className="font-hub text-[28px] leading-[1.2] font-semibold text-hub-ink">
        Reports
      </h1>
      <div className="flex flex-col gap-8">
        {SECTIONS.map((s, i) => (
          <div key={i} className="flex flex-col gap-3">
            <div
              aria-hidden="true"
              className="h-6 w-48 rounded bg-hub-surface-2"
            />
            <Skeleton rows={s.rows} rowHeight={s.height} />
          </div>
        ))}
      </div>
    </div>
  );
}
