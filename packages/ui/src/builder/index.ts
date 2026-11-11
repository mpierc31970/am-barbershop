// @cds/ui/builder: the page-builder editing surface (03-08; CONT-05..07, CONT-09, CONT-10,
// CONT-12). Props-driven client components: they take values and callbacks and never
// touch the database client; apps/web wires them to Server Actions (03-13, 03-14).
export { RichTextEditor } from "./RichTextEditor";
export type { RichTextEditorProps } from "./RichTextEditor";
export { RichTextToolbar } from "./RichTextToolbar";
export type { RichTextToolbarProps } from "./RichTextToolbar";
export {
  createRichTextExtensions,
  RichTextBold,
  RichTextItalic,
  RichTextHardBreak,
  RichTextBulletList,
  RichTextOrderedList,
} from "./rich-text-extensions";
export { ColumnItemForm } from "./ColumnItemForm";
export type { ColumnItemFormProps, PopupOption } from "./ColumnItemForm";
export { ItemListEditor, ColumnItemRows } from "./ItemListEditor";
export type {
  ItemListEditorProps,
  ColumnItemRowsProps,
} from "./ItemListEditor";
export { ColumnsEditor } from "./ColumnsEditor";
// The H1 badge must pick the same block PageRenderer does (WR-C08); renderable.ts has no
// component imports, so it is safe in the client builder bundle.
export { renderableSections } from "../site/renderable";
export type { ColumnsEditorHandle, ColumnsEditorProps } from "./ColumnsEditor";
export { preparePastedRichText } from "./paste";
export {
  announce,
  columnDropId,
  insertItemAt,
  itemFieldErrors,
  linesToList,
  listToLines,
  moveInList,
  planItemDrop,
  removeItemAt,
  replaceItemInColumns,
  DRAG_INSTRUCTIONS,
  KIND_LABELS,
  ADD_ITEM_KINDS,
  SPACER_LABELS,
  shrinkNotice,
  applyLayoutChange,
  browserTimeZone,
  localInputToUtcIso,
  utcIsoToLocalInput,
  formatShortInZone,
  itemSummary,
} from "./editor-logic";
export { useBrowserTimeZone } from "./use-browser-time-zone";
// 03-13: block list, block picker, suggested presets and pure builder logic.
export { SectionsList, pausedBlockCopy } from "./SectionsList";
export type { SectionsListProps } from "./SectionsList";
export { BlockTemplatePicker } from "./BlockTemplatePicker";
export type {
  BlockChoice,
  BlockTemplatePickerProps,
  AddonBlockOption,
} from "./BlockTemplatePicker";
export { SUGGESTED_PRESETS, faqStartersFor } from "./presets";
export type { PresetBlock, PresetContext, SuggestedPreset } from "./presets";
// 07-24: builder business context (the builder hours editor stays out of this barrel).
export {
  BuilderBusinessProvider,
  BuilderPlanProvider,
  NO_BUILDER_PLAN,
  useBuilderBusiness,
  useBuilderPlan,
} from "./blocks/business-context";
export type { BuilderBusiness, BuilderPlan } from "./blocks/business-context";
export {
  ALT_REQUIRED_COPY,
  BLOCK_LABELS,
  DRAFT_SAVED_LINE,
  ERR_PUBLISH_COPY,
  ERR_REORDER_COPY,
  ERR_SAVE_COPY,
  HELD_LINE,
  NO_CHANGES_COPY,
  PICKER_ORDER,
  attentionLine,
  blockFieldErrors,
  blockLabel,
  firstInvalidField,
  headerState,
  isDirty,
  normalizeBlockContent,
  previewText,
  sameDraft,
} from "./section-form-logic";
export type {
  BuilderResult,
  BuilderSaveInput,
  BuilderSection,
  HeaderPage,
  HeaderState,
  HeaderStateId,
  LabelRegistry,
} from "./section-form-logic";
export { SectionForm, addonOffCopy } from "./SectionForm";
export type { SectionFormProps, SectionFormAddon } from "./SectionForm";

// P7 area barrels (07-02): each owning plan fills only its own file.
export * from "./p7/media";
// 07-25: site menu and footer editors (Website › Navigation / Footer).
export {
  NavEditor,
  FooterEditor,
  NAV_CTA_POPUP_HELP,
  type NavEditorProps,
  type FooterEditorProps,
  type ChromePageOption,
  type ChromePopupOption,
} from "./chrome";
