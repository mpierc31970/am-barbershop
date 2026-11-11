// @cds/db P7 area barrel: Contacts data (owner 07-11).
// Named exports only; never export a PocketBase client, a context minter or an internal
// writer helper (invariant 1). Wired into src/index.ts with `export *` (07-02).
// Not exported on purpose: the lock-holding touch helpers (in-package callers only, 07-15),
// the house-list bootstrap, the list-scope resolver and the shared runners.
export { recordContactTouch } from "./touch";
export { listContactLists } from "./lists";
export {
  deleteContact,
  getContact,
  listContacts,
  listContactTags,
  saveContact,
  withdrawConsent,
} from "./contacts";
export type { ContactDetail, ListContactsOptions } from "./contacts";
export { addContactNote, deleteContactNote } from "./notes";
export {
  commitContactImport,
  contactsCsvTemplate,
  exportContactsCsv,
  previewContactImport,
  readContactImportHeader,
} from "./csv";
export type { ContactImportHeader, ContactImportOptions } from "./csv";
export {
  CONTACT_IMPORT_TARGETS,
  MATCH_EMAIL_COPY,
  suggestContactColumns,
} from "./csv-map";
export type { ContactColumnMapping, ContactImportTarget } from "./csv-map";
export { CONSENT_STATUSES, CONTACT_SOURCES, ContactExists } from "./model";
export type {
  ConsentStatus,
  ContactSource,
  ContactTouch,
  MarketingConsent,
} from "./model";
export type {
  ContactEvent,
  ContactList,
  ContactListPage,
  ContactNote,
  ContactRow,
} from "./shared";
