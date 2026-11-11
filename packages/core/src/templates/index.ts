// @cds/core/templates (08-01; TMPL-01, TMPL-03): the slot contract, bands, staff labels and
// the template shape check. Pure; never re-exported from the @cds/core root.
export type {
  AssembledValue,
  AssemblyAddonConfig,
  AssemblyFacts,
  AssemblyIntake,
  AssemblyLedger,
  AssemblyMediaRef,
  AssemblyReport,
  AssemblyService,
  AssemblyTeamMember,
  Band,
  CopyWriter,
  LedgerPage,
  PageOutcome,
  SiteTemplate,
  Slot,
  SlotEnv,
  SlotReportLine,
  SlotResult,
  SlotSource,
  TemplatePage,
  TemplateSlotInput,
} from "./types";
export { assignBands } from "./bands";
export { COPY_PHRASES, copyGroupOf, templateCopy } from "./copy";
export {
  photoPolishLine,
  slotLabel,
  SLOT_LABELS,
  SOURCE_WORDS,
} from "./labels";
export { assertTemplateShape, pickTemplate } from "./validate";
