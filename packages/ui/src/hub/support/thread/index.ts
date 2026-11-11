// @cds/ui/hub/support/thread (12-09): Thread, ThreadMessage, SystemLine, DaySeparator,
// UnreadDivider, AttachmentList / AttachmentChip, the autolinker and the thread time helpers.
// Types come from @cds/core/support, never @cds/db.
export {
  AttachmentChip,
  AttachmentList,
  attachmentReady,
  type AttachmentChipProps,
  type AttachmentListProps,
} from "./AttachmentList";
export { autolinkTokens, type AutolinkToken } from "./autolink";
export {
  THREAD_COPY,
  clockTime,
  dayKey,
  dayLabel,
  screenshotName,
} from "./copy";
export { DaySeparator, UnreadDivider } from "./DaySeparator";
export { SystemLine, type SystemLineProps } from "./SystemLine";
export { Thread, firstUnreadIndex, type ThreadProps } from "./Thread";
export {
  INTERNAL_HATCH,
  INTERNAL_NOTE_LABEL,
  MessageBody,
  ThreadMessage,
  type MessageBodyProps,
  type ThreadMessageProps,
} from "./ThreadMessage";
export {
  COMPOSER_COUNTER_FROM,
  COMPOSER_MAX,
  Composer,
  DRAFT_PREFIX,
  type ComposerProps,
  type ComposerSendResult,
} from "./Composer";
export {
  SUPPORT_UPLOAD_ACCEPT,
  SUPPORT_UPLOAD_EXTENSIONS,
  SUPPORT_UPLOAD_MAX_BYTES,
  SUPPORT_UPLOAD_MAX_FILES,
  SUPPORT_UPLOAD_URL,
  checkSupportFile,
  useSupportUploads,
  type SupportUploadItem,
  type SupportUploadStatus,
  type SupportUploads,
  type UseSupportUploadsOptions,
} from "./useSupportUploads";
