// Group B block public exports (owner 07-07): map, table, FAQ, icon list, hours, social.
// Every name carries its block prefix (blocks/index.ts does `export *` from this file and
// exports-a.ts). The definitions (*Section) stay out: CORE_SECTIONS carries them.
// Pure and Edge-safe: no node:, no sanitizer, no next/* imports. Named exports only.
export {
  MAP_HEADING_MAX,
  MAP_LINK_COPY,
  MAP_LOCATION_MAX,
  MAP_SHORT_LINK_COPY,
  defaultMapBlock,
  mapAddressQuery,
  mapDirectionsUrl,
  parseMapLink,
  validateMapBlock,
} from "./map";
export type { MapBlockContent, MapQuery } from "./map";
export {
  TABLE_ALIGNS,
  TABLE_CELL_MAX,
  TABLE_HEADING_MAX,
  TABLE_LIMIT_COPY,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  TABLE_MOBILE_MODES,
  defaultTableBlock,
  newTableCell,
  tableIsEmpty,
  validateTableBlock,
} from "./table";
export type {
  TableAlign,
  TableBlockContent,
  TableCell,
  TableMobile,
} from "./table";
export {
  EMPTY_TABLE_PRO,
  PRO_TABLE_COPY,
  PRO_TABLE_HIGHLIGHT_LABEL_MAX,
  PRO_TABLE_ICONS,
  PRO_TABLE_ICON_LABELS,
  PRO_TABLE_LIMIT_COPY,
  PRO_TABLE_MAX_COLUMNS,
  PRO_TABLE_MAX_ROWS,
  PRO_TABLE_PAGE_SIZE,
  PRO_TABLE_SHAPE_COPY,
  PRO_TABLE_WIDTHS,
  assertTablePlan,
  emptyTablePro,
  tableCellIcon,
  tableForRender,
  tableUsesPro,
} from "./table-pro";
export type { TableColumnWidth, TableIcon, TablePro } from "./table-pro";
export {
  FAQ_HEADING_MAX,
  FAQ_LIMIT_COPY,
  FAQ_MAX_ITEMS,
  FAQ_QUESTION_COPY,
  FAQ_QUESTION_MAX,
  defaultFaqBlock,
  faqEntries,
  validateFaqBlock,
} from "./faq";
export type { FaqBlockContent, FaqItem } from "./faq";
export {
  ICON_LIST_HEADING_MAX,
  ICON_LIST_ICON_IDS,
  ICON_LIST_LIMIT_COPY,
  ICON_LIST_MAX_ITEMS,
  ICON_LIST_TEXT_MAX,
  ICON_LIST_TITLE_MAX,
  defaultIconListBlock,
  validateIconListBlock,
} from "./icon-list";
export type {
  IconListBlockContent,
  IconListIconId,
  IconListItem,
} from "./icon-list";
export {
  HOURS_HEADING_MAX,
  defaultHoursBlock,
  validateHoursBlock,
} from "./hours";
export type { HoursBlockContent } from "./hours";
export {
  SOCIAL_HEADING_MAX,
  SOCIAL_SHARE_DEFAULT,
  SOCIAL_SHARE_TARGETS,
  defaultSocialBlock,
  validateSocialBlock,
} from "./social";
export type { SocialBlockContent, SocialShareTarget } from "./social";
// 08-04: Services and Our team (data-bound, options only). Unlike the blocks above, the
// definitions are exported too: 08-05 registers them in CORE_SECTIONS with their renderer
// and editor (the parity tests need all three in one commit).
export {
  SERVICES_DISPLAYS,
  SERVICES_HEADING_MAX,
  SERVICES_LIMITS,
  defaultServicesBlock,
  servicesSection,
  validateServicesBlock,
} from "./services";
export type {
  ServicesBlockContent,
  ServicesDisplay,
  ServicesLimit,
} from "./services";
export {
  TEAM_HEADING_MAX,
  defaultTeamBlock,
  teamSection,
  validateTeamBlock,
} from "./team";
export type { TeamBlockContent } from "./team";
// 07-24: hours status, social links and share URLs (pure helpers for the renderers).
export {
  formatClock,
  hoursRows,
  openStatus,
  timeZoneLabel,
} from "./hours-status";
export type { HoursOpenStatus, HoursRow } from "./hours-status";
export {
  SOCIAL_PLATFORM_LABELS,
  SOCIAL_SHARE_LABELS,
  socialLinkLabel,
  socialPlatformName,
  socialShareHref,
} from "./social-share";
export type { SocialSharePage } from "./social-share";
