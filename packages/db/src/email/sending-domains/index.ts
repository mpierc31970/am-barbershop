// packages/db/src/email/sending-domains/index.ts: sending-domains barrel. The fake and SES adapters stay out: only factory.ts imports them.
// Owner: 14-02 (P14-P1, 14-EXECUTOR-BRIEF "Module seams"). Fixed: module owners fill bodies, never this file.
// Names must stay unique across modules (export * collisions fail typecheck).
export * from "./ports";
export * from "./factory";
// Review 14 WR-A02 (Invariant 1): the context-free job and system entry points of this
// module stay internal (src/jobs/*, scripts and sibling modules import them by relative
// path). Its other exports are listed explicitly; barrel-internals.test.ts checks it.
export {
  SENDING_DMARC_VALUE,
  SENDING_JOB,
  SENDING_LOCAL_PART_AUDIT,
  SENDING_VERIFY_WINDOW_MS,
  computeAcceptedEmailHash,
  getSendingView,
  sendingRecords,
  setSendingLocalPart,
} from "./ensure";
export type {
  EnsureSendingResult,
  SendingDeps,
  SendingState,
  SendingView,
} from "./ensure";
