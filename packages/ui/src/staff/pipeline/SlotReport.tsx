// SlotReport (13-34 choice 4; STAFF-04, D29; 13-UI-SPEC "Polish queue" lines 655-664). The
// last assembly's slot report: Slot · Page · Filled from (Intake / Default / Empty) · Status
// (`done` "Filled" / `needed` "Unfilled"), unfilled first, with the counts above. A real
// <table> with a caption; under 640px each row stacks (slot, then status). Server-safe.
import { Badge } from "../../hub/Badge";
import { PIPELINE_COPY, type SlotSourceView } from "./copy";

const C = PIPELINE_COPY.slots;

export interface SlotReportRow {
  page: string;
  slot: string;
  source: SlotSourceView;
  filled: boolean;
  /** The assembly note for the slot ("used the template's photo"); may be "". */
  note: string;
}

export interface SlotReportProps {
  slots: readonly SlotReportRow[];
  /** Visually hidden caption; defaults to "Slot report, unfilled first". */
  caption?: string;
}

/** Unfilled first, then page, then slot (stable). */
export function sortSlots<T extends SlotReportRow>(slots: readonly T[]): T[] {
  return [...slots].sort(
    (a, b) =>
      Number(a.filled) - Number(b.filled) ||
      a.page.localeCompare(b.page) ||
      a.slot.localeCompare(b.slot),
  );
}

const TH =
  "px-4 py-2 text-left text-sm font-semibold text-hub-ink max-sm:sr-only";
const TD = "px-4 py-2 align-middle text-sm text-hub-ink";

export function SlotReport({ slots, caption = C.caption }: SlotReportProps) {
  if (slots.length === 0) {
    return <p className="font-hub text-sm text-hub-ink-muted">{C.empty}</p>;
  }
  const rows = sortSlots(slots);
  const unfilled = rows.filter((s) => !s.filled).length;
  return (
    <div className="flex flex-col gap-2 font-hub">
      <p className="text-sm text-hub-ink-muted tabular-nums">
        {C.counts(rows.length - unfilled, unfilled)}
      </p>
      <table className="w-full border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-hub-surface-2">
          <tr>
            <th scope="col" className={TH}>
              {C.cols.slot}
            </th>
            <th scope="col" className={TH}>
              {C.cols.page}
            </th>
            <th scope="col" className={TH}>
              {C.cols.from}
            </th>
            <th scope="col" className={TH}>
              {C.cols.status}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr
              key={`${s.page}/${s.slot}`}
              className="border-t border-hub-border max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-3 max-sm:py-2"
            >
              <td className={`${TD} max-sm:p-0`}>
                <span className="font-semibold">{s.slot}</span>
                {s.note ? (
                  <span className="block text-hub-ink-muted">{s.note}</span>
                ) : null}
              </td>
              <td className={`${TD} max-sm:hidden`}>{s.page}</td>
              <td className={`${TD} max-sm:hidden`}>{C.from[s.source]}</td>
              <td className={`${TD} max-sm:p-0`}>
                <Badge tone={s.filled ? "done" : "needed"}>
                  {s.filled ? C.filled : C.unfilled}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
