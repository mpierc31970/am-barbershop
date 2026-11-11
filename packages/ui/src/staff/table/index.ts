// @cds/ui/staff/table: dense table primitives for the whole console (13-07; D-UI-P13-1,
// D-UI-P13-2). StaffTable and FilterBar are client islands; the rest are server-safe.
export {
  StaffTable,
  type SortDirection,
  type StaffColumn,
  type StaffSort,
  type StaffTableProps,
} from "./StaffTable";
export {
  FilterBar,
  clearFiltersHref,
  type FilterBarProps,
  type FilterField,
  type FilterOption,
  type FilterSearch,
} from "./FilterBar";
export { QuickFilters, type QuickFilterItem } from "./QuickFilters";
export { KeyHint } from "./KeyHint";
export {
  AgeCell,
  PriorityCell,
  SlaCell,
  StageChips,
  compactAge,
  compactHours,
  type AgeCellProps,
  type ChipItem,
  type SlaCellProps,
  type StageChip,
} from "./cells";
export { STAFF_TABLE_COPY } from "./copy";
