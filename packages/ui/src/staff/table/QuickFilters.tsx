// Quick filters (13-07 choice 2; 13-UI-SPEC Inbox toolbar item 1): a segmented row of toggle
// links ("Mine · Unassigned · At risk · Waiting on CDS · All open"), aria-pressed, the active
// one accent tint. URL-driven: each item's href is the filtered view. Server-safe.
import { ChipRow, type ChipItem } from "./cells";

export type QuickFilterItem = ChipItem;

export function QuickFilters({
  label,
  items,
}: {
  /** Group name read by screen readers, e.g. "Quick filters". */
  label: string;
  items: readonly QuickFilterItem[];
}) {
  return <ChipRow label={label} items={items} />;
}
