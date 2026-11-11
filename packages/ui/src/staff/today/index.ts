// @cds/ui/staff/today (13-47; STAFF-20, D-UI-P13-5, D-UI-P13-20): the Today needs-attention
// rows, the status line and the 60 s / on-focus refresh used by Today and the sidebar badges.
export { STAFF_TODAY_COPY } from "./copy";
export {
  CountRow,
  CountRowList,
  TodayStatusLine,
  countRowName,
  todayMarker,
  type TodayLinkComponent,
  type TodayRowView,
  type TodaySeverity,
  type TodayStatusView,
} from "./CountRow";
export {
  TODAY_REFRESH_MS,
  TodayRefresher,
  useStaffRefresh,
  withAttentionTitle,
} from "./TodayRefresher";
