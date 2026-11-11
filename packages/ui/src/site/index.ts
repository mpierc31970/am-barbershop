// @cds/ui/site: server-rendered public site renderers (CONT-03, CONT-04, CONT-09,
// CONT-10, CONT-11; D31, D117, D122, D188; invariants 5, 6 and 7).
//
// Server components on the neutral --site-* token contract. No next/* imports, no client
// hooks. Rich text is sanitized on this (Node) render path, so import this barrel only
// from server code; client islands live in @cds/ui/site/client.
export { RowRenderer } from "./RowRenderer";
export type { RowRendererProps } from "./RowRenderer";
export { ColumnsSection } from "./ColumnsSection";
export { ColumnItemRenderer } from "./ColumnItemRenderer";
export type { ColumnItemRendererProps } from "./ColumnItemRenderer";
export { SiteButton, siteButtonClasses } from "./SiteButton";
export type { SiteButtonProps, SiteButtonStyle } from "./SiteButton";
export { HeroSection } from "./HeroSection";
export { TextImageSection } from "./TextImageSection";
export { TextOnlySection } from "./TextOnlySection";
export { CtaBannerSection } from "./CtaBannerSection";
export { SectionRenderer, CORE_SECTION_COMPONENTS } from "./SectionRenderer";
export {
  CORE_SECTION_TYPES,
  isRenderableSectionType,
  renderableSections,
} from "./renderable";
export type { RenderableOptions } from "./renderable";
export type {
  SectionRendererProps,
  InjectedSectionRenderer,
} from "./SectionRenderer";
export { PageRenderer } from "./PageRenderer";
export type { PageRendererProps } from "./PageRenderer";
export { Banner } from "./Banner";
export type { BannerProps } from "./Banner";
export { Countdown } from "./Countdown";
export type { CountdownProps } from "./Countdown";
export type {
  AddonSectionProps,
  SectionComponentProps,
  HeadingLevel,
} from "./types";
export { HEADING_CLASSES, BODY_CLASS } from "./types";
export { siteHref, siteImageSrc, text } from "./urls";
export { PopupDialog, popupDialogId } from "./PopupDialog";
export type { PopupDialogProps } from "./PopupDialog";
export {
  PopupHost,
  isPopupOnPage,
  openablePopupIds,
  popupControllerConfig,
} from "./PopupHost";
export type { PopupHostProps } from "./PopupHost";
export { SiteThemeScope } from "./SiteThemeScope";
export type { SiteThemeScopeProps } from "./SiteThemeScope";

// P7 area barrels (07-02): each owning plan fills only its own file.
export * from "./p7/consent";
export * from "./p7/chrome";
export * from "./p7/search";
export * from "./p7/protected";
export * from "./p7/render";
// 07-19: the public form view contract (the loader stamps FormView; the route builds status).
export type {
  FieldErrorCode,
  FormResumeView,
  FormStatusView,
  FormView,
} from "./items/form-view";
export { RESUME_TOKEN_RE } from "./items/form-view";
export { publicFormOf } from "./items/public-form";
// 09-22: tenant /privacy and /terms body (AGR-08, D217).
export { PolicyPage, POLICY_DRAFT_TEXT } from "./PolicyPage";
export type { PolicyPageProps } from "./PolicyPage";
