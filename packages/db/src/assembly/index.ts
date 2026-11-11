// P8 assembly barrel (08-16): for in-package callers (the 08-17 queue and sweep) and tests.
// The @cds/db root re-exports only the staff entry point, the version-key helper, the
// ledger parser, the report text helpers and the public types. No context minter here.
export {
  assembleSite,
  assemblyVersionKeys,
  type AssemblyDeps,
  type AssemblyFacts,
  type AssemblyOptions,
  type AssemblyResult,
  type AssemblyStatus,
  type AssemblyErrorCode,
} from "./assemble";
export {
  assembleSiteAsStaff,
  runAssemblyForOrg,
  previewUrl,
  ASSEMBLY_MAX_ATTEMPTS,
  type AssemblyRunDeps,
  type AssemblyRunOptions,
} from "./run";
export { getCopyWriter } from "./copy-writer";
export { assemblyQueue, enqueueAssembly } from "./queue";
export { ensurePreviewHost, previewHostSuffix } from "./preview-host";
export { emptyLedger, parseLedger, parseReport, readLedger } from "./ledger";
export {
  alreadyAssembledLine,
  dayMonth,
  DRY_RUN_FIRST_LINE,
  polishCount,
  polishLines,
  polishSummaryLine,
  reportRows,
  rerunLines,
  summaryLine,
  wouldAssembleLine,
} from "./report";
export type {
  AssemblyLedger,
  AssemblyReport,
  LedgerPage,
  PageOutcome,
} from "@cds/core/templates";
