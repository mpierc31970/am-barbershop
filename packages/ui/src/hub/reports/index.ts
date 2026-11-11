// @cds/ui/hub/reports: P11 sub-barrel seam (11-01; 11-UI-SPEC). Hub tokens only (--hub-*).
// Reports components (11-33) add exports here in plan order. Types come from @cds/core, never @cds/db.
export {
  REPORTS_COPY,
  REPORT_SECTION_TITLES,
  REPORT_PERIODS,
  DEFAULT_REPORT_PERIOD,
  resolveReportPeriod,
  formatCount,
  formatShare,
  formatDayShort,
  formatDayLong,
  deltaWords,
  plural,
  sourceLabel,
  sourceIcon,
  seoWord,
  formatVital,
} from "./copy";
export type { ReportPeriod, Delta, SeoWord } from "./copy";
export {
  ReportSection,
  NotConnectedNote,
  PeriodControl,
  ReportFigures,
} from "./ReportSection";
export type {
  ReportSectionProps,
  PeriodControlProps,
  ReportFigure,
  ReportFiguresProps,
} from "./ReportSection";
export { VisitorsChart, chartSummary, niceAxisMax } from "./VisitorsChart";
export type { VisitorsChartProps, VisitorsDay } from "./VisitorsChart";
export { MetricTable } from "./MetricTable";
export type { MetricColumn, MetricRow, MetricTableProps } from "./MetricTable";
export { SeoHealthPanel } from "./SeoHealthPanel";
export type { SeoHealthPanelProps } from "./SeoHealthPanel";
export { SpeedPanel, SPEED_MIN_VISITS } from "./SpeedPanel";
export type { SpeedPanelProps, SpeedDevice, SpeedValue } from "./SpeedPanel";
export { SocialReport } from "./SocialReport";
export type { SocialReportProps, SocialReportRow } from "./SocialReport";
export { Ga4Panel, SearchQueriesPanel } from "./AnalyticsPanels";
