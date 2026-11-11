// @cds/ui/hub/help: P11 sub-barrel seam (11-01; 11-UI-SPEC). Hub tokens only (--hub-*).
// Help components (11-46, then 11-48) add exports here in plan order. Types come from @cds/core, never @cds/db.

// 11-46: Help center, Help article.
export { HELP_COPY } from "./copy";
export {
  HelpCenter,
  filterHelpEntries,
  type HelpCenterEntry,
  type HelpCenterGroup,
  type HelpCenterProps,
} from "./HelpCenter";
export {
  HelpArticle,
  inlineMarks,
  type HelpArticleProps,
  type HelpStepView,
} from "./HelpArticle";

// 11-48: first-use tours (coachmark, tour map, replay context).
export {
  TourCoachmark,
  isShown,
  tourAnchor,
  visibleTourSteps,
  type TourCoachmarkProps,
} from "./TourCoachmark";
export {
  TOURS,
  TOUR_IDS,
  TOUR_COPY,
  TOUR_FOR_HELP_ENTRY,
  TOUR_SCREEN_HREF,
  isTourId,
  tourSteps,
  type TourId,
  type TourStepDef,
  type TourStepView,
} from "./tours";
export { TourReplayContext, type TourReplay } from "./tour-context";
