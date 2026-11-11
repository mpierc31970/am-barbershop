// Staff table copy (13-07; 13-UI-SPEC "Staff status tone map", "Header and toolbar"). The
// per-cell words of the console tables: SLA, priority, filters. Copy IDs (INBOX-EMPTY-H …)
// stay in P13_COPY (@cds/core/staff); these are the cell vocabulary only, kept in one place
// so no cell retypes them.
import type { Priority } from "@cds/core/support";

export const STAFF_TABLE_COPY = {
  selectRow: (label: string) => `Select ${label}`,
  selectAll: "Select all rows",
  slaAtRisk: (left: string) => `At risk · ${left}`,
  slaMissed: (late: string) => `Missed · ${late} late`,
  slaDueIn: (left: string) => `due in ${left}`,
  slaMet: "Met",
  slaNone: "—",
  priority: {
    urgent: "Urgent",
    high: "High",
    normal: "Normal",
    low: "Low",
  } satisfies Record<Priority, string>,
  any: "Any",
  clearFilters: "Clear filters",
  applyFilters: "Apply filters",
  allTimesCentral: "All times Central",
} as const;
