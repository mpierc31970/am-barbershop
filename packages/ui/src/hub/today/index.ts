// @cds/ui/hub/today: P11 sub-barrel seam (11-01; 11-UI-SPEC). Hub tokens only (--hub-*).
// Today cards (11-17, then 11-19, then 11-22) add exports here in plan order. Types come from @cds/core, never @cds/db.
// 11-17: status line, stage block (tracker, launch review card, You're live), Needs you.
export {
  NEEDS_YOU_VISIBLE,
  STAGE_BADGE_TONE,
  TODAY_COPY,
  YOURE_LIVE_HREFS,
  formatDayMonth,
  relativeAge,
  youreLiveSteps,
  type YoureLiveStep,
} from "./copy";
export { StatusLine, type StatusLineProps } from "./StatusLine";
export { BuildTracker, type BuildTrackerProps } from "./BuildTracker";
export {
  LaunchReviewCard,
  type LaunchReviewCardProps,
  type LaunchReviewItemView,
} from "./LaunchReviewCard";
export { YoureLive, type YoureLiveProps } from "./YoureLive";
export {
  NeedsYouList,
  TodaySectionError,
  type NeedsYouListProps,
  type TodaySectionErrorProps,
} from "./NeedsYouList";
// 11-19: Today cards, Customize, This week, From CDS, work in progress.
export {
  TODAY_CARDS_COPY,
  TODAY_REPORTS_HREF,
  formatWeekday,
  weekDelta,
  weekRangeLabel,
  type WeekDelta,
} from "./copy";
export { TodayCard, TodayCardError, type TodayCardProps } from "./TodayCard";
export {
  TodayCards,
  applyLayout,
  type TodayCardView,
  type TodayCardsProps,
} from "./TodayCards";
export {
  CustomizeTodaySheet,
  layoutOf,
  type CustomizeCard,
  type CustomizeTodaySheetProps,
  type TodayLayout,
} from "./CustomizeTodaySheet";
export { ThisWeek, type ThisWeekProps, type ThisWeekRow } from "./ThisWeek";
export { FromCdsCard, type FromCdsCardProps } from "./FromCdsCard";
export {
  BuildWorkCard,
  type BuildWorkCardProps,
  type BuildWorkJob,
  type BuildWorkStep,
} from "./BuildWorkCard";
// 11-22: Phone alerts card (one-time Today opt-in) and its browser helpers.
export {
  PHONE_ALERTS_COPY,
  PhoneAlertsCard,
  type PhoneAlertsCardProps,
} from "./PhoneAlertsCard";
export {
  HUB_SW_SCOPE,
  HUB_SW_URL,
  canTurnOn,
  deviceFamily,
  FORGET_TIMEOUT_MS,
  forgetThisBrowser,
  isStandalone,
  pushSupported,
  readPushEnv,
  sameKey,
  subscribeThisDevice,
  urlBase64ToUint8Array,
  type DeviceFamily,
  type PushEnv,
  type SaveSubscription,
  type SubscribeOutcome,
} from "./push-client";
