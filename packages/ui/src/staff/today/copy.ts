// Staff Today copy (13-47; 13-UI-SPEC "Today" lines 340-376, states line 1009). TODAY-EMPTY
// lives in @cds/core/staff P13_COPY; ERR-SECTION's per-row form is "Couldn't count".
export const STAFF_TODAY_COPY = {
  needsAttention: "Needs attention",
  couldntCount: "Couldn't count",
  seeAllOpen: "See all open tickets",
  open: "Open.",
  jobsOk: "Jobs OK",
  jobsLate: (n: number) => `${n} ${n === 1 ? "job" : "jobs"} late`,
  live: (n: number) => `${n} live`,
  building: (n: number) => `${n} building`,
  openTickets: (n: number) => `${n} open ${n === 1 ? "ticket" : "tickets"}`,
  oldest: (days: number) => `oldest ${days}d`,
  oldestSr: (days: number) => `oldest ${days} ${days === 1 ? "day" : "days"}`,
  statusLabel: "Platform status",
  /** Page title with the attention count: "(3) Today". */
  title: (n: number) => (n > 0 ? `(${n}) Today` : "Today"),
} as const;
