// @cds/ui/hub/people: P11 sub-barrel seam (11-01; 11-UI-SPEC). Hub tokens only (--hub-*).
// People components (11-39, then 11-41) add exports here in plan order. Types come from @cds/core, never @cds/db.
// 11-39: Settings › People & roles.
export { PeopleTable } from "./PeopleTable";
export type { PeopleTableProps, PeopleViewer } from "./PeopleTable";
export { InviteDialog, RoleAccessFields } from "./InviteDialog";
export type { InviteDialogProps, RoleAccessFieldsProps } from "./InviteDialog";
export { RoleGrantsDrawer } from "./RoleGrantsDrawer";
export type { RoleGrantsDrawerProps } from "./RoleGrantsDrawer";
export {
  INVITABLE_ROLES,
  INVITE_EXPIRED_STATUS,
  PEOPLE_COPY,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  accessSummary,
  inviteExistsCopy,
  invitedStatus,
  isInvitableRole,
  looksLikeEmail,
  lowersAccess,
  roleChangedCopy,
  takesGrants,
} from "./copy";
export type {
  AddonAccessOption,
  InvitableRole,
  InviteView,
  PeopleActions,
  PeopleLists,
  PeopleResult,
  PeopleRole,
  PersonView,
} from "./copy";
// 11-41: Settings › Business info › Your data (Download my data, LIFE-04).
export {
  DATA_COPY,
  DATA_DOWNLOAD_POLL_MS,
  DataDownloadPanel,
  dataDownloadLabel,
  dataLimitCopy,
  dataReadyCopy,
  dataRequestedCopy,
} from "./DataDownloadPanel";
export type {
  DataDownloadPanelProps,
  DataDownloadRequestResult,
  DataDownloadStatus,
  DataDownloadView,
  DataDownloadViewer,
} from "./DataDownloadPanel";
