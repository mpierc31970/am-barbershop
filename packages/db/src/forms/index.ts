// @cds/db P7 area barrel: Forms engine (owner 07-15, then 07-28).
// Named exports only; never export a PocketBase client, a context minter or an internal
// writer helper (invariant 1). Wired into src/index.ts with `export *` (07-02).
export {
  createForm,
  deleteForm,
  duplicateForm,
  formUsedOn,
  getForm,
  listForms,
  saveForm,
} from "./forms";
export type { FormListRow, FormRecord, FormUsedOn } from "./forms";
export { readPublicForms } from "./public";
export { FormTooLarge, submitForm } from "./submit";
export type { SubmitMeta, SubmitResult } from "./submit";
export {
  countSubmissions,
  deleteSubmission,
  exportSubmissionsCsv,
  getSubmission,
  listSubmissions,
  markNotSpam,
  setSubmissionRead,
} from "./submissions";
export type {
  SubmissionDetail,
  SubmissionFile,
  SubmissionPage,
  SubmissionRow,
} from "./submissions";
// 10-38: Forms Pro file uploads. deleteFormFiles stays internal (raw org id; deleteSubmission
// calls it).
export {
  FORM_UPLOAD_TYPES,
  FORM_UPLOAD_WARN_RATIO,
  acceptFormFiles,
  formUploadSlots,
  formUploadUsage,
  readFormFile,
} from "./uploads";
export type {
  FormFileRead,
  FormUploadFile,
  FormUploadLevel,
  FormUploadUsage,
} from "./uploads";
export {
  clamdPing,
  createClamdScanner,
  getFileScanner,
  unavailableScanner,
} from "./scanner";
export type { ClamdOptions } from "./scanner";
// 10-40: save and finish later on tenant sites (site-context visitor calls, like submitForm).
// purgeExpiredFormDrafts stays internal (the retention job calls it).
export { deleteFormDraft, resumeFormDraft, saveFormDraft } from "./drafts";
export type { ResumedDraft, SaveDraftInput, SaveDraftResult } from "./drafts";
export { formsStatus } from "./status";
export type { FormsStatus } from "./status";
