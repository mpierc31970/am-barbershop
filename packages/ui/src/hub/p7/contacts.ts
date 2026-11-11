// @cds/ui/hub P7 contacts (owner 07-16; 07-02 seam).
// Hub area barrel. Hub primitives read only --hub-* tokens and never touch the database
// client or the sanitizer (invariant 1).
export {
  ColumnMatchStep,
  assignColumn,
  normalizeMapping,
} from "../ColumnMatchStep";
export type {
  ColumnMatchStepProps,
  ColumnMatchTarget,
} from "../ColumnMatchStep";
export type {
  AdditiveConfig,
  ColumnMatchConfig,
  ImportExtras,
} from "../CsvImportDialog";
export { ConsentStatusLine } from "../contacts/ConsentStatusLine";
export type { ConsentStatusLineProps } from "../contacts/ConsentStatusLine";
export { ContactDrawer } from "../contacts/ContactDrawer";
export type {
  ContactDrawerProps,
  ContactFormValues,
  ContactSaveResult,
  RestoredNote,
} from "../contacts/ContactDrawer";
export { ContactFilters, SEARCH_DEBOUNCE_MS } from "../contacts/ContactFilters";
export type {
  ContactFilterPatch,
  ContactFiltersProps,
  ContactFilterValues,
} from "../contacts/ContactFilters";
export {
  ContactTagInput,
  TAG_HELPER,
  TAG_TOO_LONG_COPY,
  TAG_TOO_MANY_COPY,
} from "../contacts/ContactTagInput";
export type { ContactTagInputProps } from "../contacts/ContactTagInput";
export { ContactsTable, pageWindow } from "../contacts/ContactsTable";
export type {
  ContactsSort,
  ContactsTableProps,
} from "../contacts/ContactsTable";
export {
  ADD_HELPER,
  CLEAR_FILTERS,
  CONTACTS_COPY,
  CONTACT_MATCH_TARGETS,
  CONTACT_TOASTS,
  DELETE_CONTACT_COPY,
  EMPTY_CONTACTS,
  EMPTY_IMPORT_HELPER,
  FILTERED_EMPTY,
  GONE_COPY,
  IMPORT_CHOOSE_HINT,
  IMPORT_NOTE,
  MATCH_EMAIL_COPY,
  NEWSLETTER_FILTER_OPTIONS,
  NOTE_COPY,
  SEARCH_PLACEHOLDER,
  SOURCE_FILTER_OPTIONS,
  SOURCE_LABELS,
  TAGS_MAX,
  TAG_ALL_LABEL,
  TAG_ALL_PLACEHOLDER,
  TAG_MAX_LEN,
  UNSUBSCRIBE_COPY,
  canUnsubscribe,
  consentLine,
  contactLabel,
  countLine,
  eventIcon,
  formatDay,
  formatWhen,
  importedToast,
  newsletterBadge,
  noteAuthor,
  tagChips,
} from "../contacts/copy";
export type {
  ConsentStatus,
  ConsentView,
  ContactEventView,
  ContactListView,
  ContactNoteView,
  ContactView,
  EventIconName,
  FilterOption,
} from "../contacts/copy";
