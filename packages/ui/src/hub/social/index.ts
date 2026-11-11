// @cds/ui/hub/social: P11 sub-barrel seam (11-01; 11-UI-SPEC). Hub tokens only (--hub-*).
// Social and Grow components (11-37) add exports here in plan order. Types come from @cds/core, never @cds/db.
export {
  SocialAccountsList,
  CopyLinkButton,
  COPIED_MS,
} from "./SocialAccountsList";
export type {
  SocialAccountsListProps,
  SocialAccountsResult,
  SocialActions,
  CopyLinkButtonProps,
} from "./SocialAccountsList";
export {
  AddAccountPicker,
  AccountForm,
  PlatformIcon,
  checkAccountForm,
} from "./AddSocialAccount";
export type {
  AddAccountPickerProps,
  AccountFormProps,
  AccountFormValues,
} from "./AddSocialAccount";
export { GrowChecklist, growGroups } from "./GrowChecklist";
export type { GrowChecklistProps } from "./GrowChecklist";
export { SocialPanel } from "./SocialPanel";
export type { SocialPanelProps } from "./SocialPanel";
export {
  SOCIAL_UI_COPY,
  GROW_COPY,
  addedCopy,
  addressLabel,
  addressPlaceholder,
  bioFallbackCopy,
  bioLinkLine,
  copiedAnnouncement,
  copyBioLabel,
  growDoneCopy,
  moreLabel,
  removedCopy,
} from "./copy";
