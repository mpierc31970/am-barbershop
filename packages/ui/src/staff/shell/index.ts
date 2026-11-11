// @cds/ui/staff/shell: the console frame (13-09; STAFF-05; 13-UI-SPEC "Shell"). StaffShell,
// sidebar, top bar, Find and the shortcut sheet. Role-agnostic: the web app passes nav and data.
export { STAFF_SHELL_COPY, STAFF_SHORTCUTS, GO_TO_KEYS } from "./copy";
export { StaffShell, type StaffShellProps } from "./StaffShell";
export {
  DevBadge,
  STAFF_NAV_ICONS,
  StaffSidebar,
  formatNavBadge,
  type StaffEnv,
  type StaffNavIcon,
  type StaffNavItem,
  type StaffSidebarProps,
  type StaffSignOutAction,
  type StaffUser,
} from "./StaffSidebar";
export { StaffTopBar, type StaffTopBarProps } from "./StaffTopBar";
export {
  FIND_DEBOUNCE_MS,
  StaffFind,
  filterFindEntries,
  orderTickets,
  ticketNumberQuery,
  type StaffFindEntry,
  type StaffFindProps,
  type StaffFindSearch,
  type StaffFindTicket,
} from "./StaffFind";
export {
  SHORTCUTS_STORAGE_KEY,
  ShortcutSheet,
  isTypingTarget,
  setShortcutsEnabled,
  useShortcutsEnabled,
  type ShortcutSheetProps,
} from "./ShortcutSheet";
