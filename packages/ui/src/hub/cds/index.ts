// @cds/ui/hub/cds (12-06): the CDS identity layer (COMM-05, D83). Mark, author chip and the
// tinted surface; tokens live in ./tokens.css (imported by apps/web/app/globals.css).
// Types come from @cds/core, never @cds/db.
export { CdsMark, type CdsMarkProps, type CdsMarkSize } from "./CdsMark";
export { CdsAuthor, type CdsAuthorProps } from "./CdsAuthor";
export { CdsSurface, type CdsSurfaceProps } from "./CdsSurface";
export {
  ImpersonationBanner,
  IMPERSONATION_BANNER_COPY,
  BANNER_REASON_MAX,
  BANNER_WARN_MINUTES,
  minutesLeft,
  truncateReason,
  type ImpersonationBannerProps,
} from "./ImpersonationBanner";
