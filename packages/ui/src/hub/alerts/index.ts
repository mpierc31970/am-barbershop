// @cds/ui/hub/alerts: P11 sub-barrel seam (11-01; 11-UI-SPEC). Hub tokens only (--hub-*).
// AlertBell, AlertsPanel (11-21), profile parts (11-24) add exports here in plan order. Types come from @cds/core, never @cds/db.
export {
  AlertBell,
  BELL_COUNT_URL,
  BELL_REFRESH_MS,
  useBellRefresh,
  type AlertBellProps,
  type BellCounts,
  type UseBellRefreshOptions,
} from "./AlertBell";
export {
  AlertsPanel,
  type AlertsPanelProps,
  type AlertsPanelState,
} from "./AlertsPanel";
export {
  ALERTS_COPY,
  alertAge,
  alertSectionLabel,
  bellChipText,
  bellLabel,
  groupBellRows,
  newAlertsText,
  type BellGroup,
  type BellRow,
} from "./copy";
// 11-24: Your profile and alerts.
export {
  PROFILE_COPY,
  clockLabel,
  dayMonth,
  deviceLine,
  deviceName,
  halfHourOptions,
  quietHelpCopy,
  roleLine,
  sensitiveOnCopy,
  turnOffLabel,
} from "./copy";
export {
  AlertPrefsTable,
  type AlertPrefsMap,
  type AlertPrefsTableProps,
  type PrefChannel,
} from "./AlertPrefsTable";
export {
  QuietHoursForm,
  type QuietHoursFormProps,
  type QuietHoursValue,
} from "./QuietHoursForm";
export {
  DevicesList,
  THIS_DEVICE_KEY,
  rememberThisDevice,
  type DeviceRow,
  type DevicesListProps,
  type SaveDevice,
} from "./DevicesList";
