// packages/db/src/dns/index.ts: @cds/db dns barrel. Provider adapters stay out: only factory.ts imports them.
// Owner: 14-02 (P14-P1, 14-EXECUTOR-BRIEF "Module seams"). Fixed: module owners fill bodies, never this file.
// Names must stay unique across modules (export * collisions fail typecheck).
export * from "./ports";
export * from "./factory";
export * from "./fake-world";
// Review 14 WR-A02 (Invariant 1): the context-free job and system entry points of this
// module stay internal (src/jobs/*, scripts and sibling modules import them by relative
// path). Its other exports are listed explicitly; barrel-internals.test.ts checks it.
export {
  DNS_QUERY_CONCURRENCY,
  DNS_ZONES_COLLECTION,
  DnsSweepAtCds,
  DnsSweepFailed,
  pickSnapshot,
  snapshotDomain,
  sweepZone,
  toDnsZoneRow,
} from "./snapshot";
export type {
  DnsZoneRow,
  DnsZoneStatus,
  Snapshot,
  SnapshotDeps,
  SweepResult,
} from "./snapshot";
// Review 14 WR-A02 (Invariant 1): the context-free job and system entry points of this
// module stay internal (src/jobs/*, scripts and sibling modules import them by relative
// path). Its other exports are listed explicitly; barrel-internals.test.ts checks it.
export { ReadBackUnavailable, readBackCopy } from "./gate-runner";
export type { GateRunDeps, GateRunResult } from "./gate-runner";
export * from "./check";
export * from "./edge";
export * from "./preview-links";
// Review 14 WR-A02 (Invariant 1): the context-free job and system entry points of this
// module stay internal (src/jobs/*, scripts and sibling modules import them by relative
// path). Its other exports are listed explicitly; barrel-internals.test.ts checks it.
export {
  MOVE_STEPS,
  acknowledgeFinding,
  getMove,
  moveByCode,
  openMoveFor,
  overrideGateRule,
  retakeSnapshot,
  startMove,
} from "./moves";
export type {
  MoveAck,
  MoveDeps,
  MoveNotice,
  MoveOverride,
  MoveRow,
  MoveStatus,
  MoveStep,
  MoveStepKey,
  MoveView,
  StepFn,
  StepOutcome,
  StepRun,
  StepStatus,
} from "./moves";
export * from "./cutover";
export * from "./health";
export * from "./records";
export * from "./owner";
export * from "./staff";
