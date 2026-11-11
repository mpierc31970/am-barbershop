// @cds/ui/hub/shell: P11 sub-barrel seam (11-01; 11-UI-SPEC). Hub tokens only (--hub-*).
// TopBar, OrgSwitcher, JumpToDialog, ProfileMenu, ScreenHeader, NotLiveYet (11-15); SuspensionNotice (13-22). Types come from @cds/core, never the db package.
export { SHELL_COPY } from "./copy";
export {
  OrgSwitcher,
  sortOrgs,
  type OrgSwitcherProps,
  type ShellOrg,
} from "./OrgSwitcher";
export { ProfileMenu, type ProfileMenuProps } from "./ProfileMenu";
export {
  ScreenHeader,
  ScreenHelp,
  type ScreenHeaderProps,
  type ScreenHelpProps,
} from "./ScreenHeader";
export {
  HelpOpenerContext,
  useHelpOpener,
  type HelpOpener,
} from "./help-opener";
export { NotLiveYet, type NotLiveYetProps } from "./NotLiveYet";
export {
  JUMP_MAX_RESULTS,
  JumpToDialog,
  filterJumpEntries,
  shouldIgnoreJumpShortcut,
  useJumpShortcut,
  type JumpEntry,
  type JumpToDialogProps,
} from "./JumpToDialog";
export { TopBar, type TopBarProps } from "./TopBar";
export {
  SUSPENSION_NOTICE_COPY,
  SuspensionNotice,
  formatFixBy,
  formatSuspendedOn,
  type SuspensionNoticeProps,
} from "./SuspensionNotice";
