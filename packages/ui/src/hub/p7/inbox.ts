// @cds/ui/hub P7 inbox (owner 07-19; 07-02 seam).
// Hub area barrel. Hub primitives read only --hub-* tokens and never touch the database
// client or the sanitizer (invariant 1).
export { InboxTable } from "../inbox/InboxTable";
export type { InboxTableProps } from "../inbox/InboxTable";
export { InboxToolbar } from "../inbox/InboxToolbar";
export type {
  InboxFilterPatch,
  InboxToolbarProps,
} from "../inbox/InboxToolbar";
export { MessageDrawer } from "../inbox/MessageDrawer";
export type { MessageDrawerProps } from "../inbox/MessageDrawer";
export {
  DELETE_MESSAGE_COPY,
  EMPTY_INBOX,
  INBOX_COPY,
  INBOX_EXPORT_HINT,
  INBOX_FILTERED_EMPTY,
  INBOX_GONE_COPY,
  INBOX_NO_MATCH,
  INBOX_SEARCH_PLACEHOLDER,
  INBOX_TOASTS,
  contactHref,
  drawerMeta,
  drawerTitle,
  filteredTabLabel,
  formFileHref,
  formLabel,
  mailtoHref,
  receivedLabel,
  senderLabel,
} from "../inbox/copy";
export type {
  InboxFormOption,
  MessageDetailView,
  MessageFileView,
  MessageRowView,
} from "../inbox/copy";
