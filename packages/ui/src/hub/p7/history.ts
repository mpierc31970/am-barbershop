// @cds/ui/hub P7 history (owner 07-29; 07-02 seam).
// Hub area barrel. Hub primitives read only --hub-* tokens and never touch the database
// client or the sanitizer (invariant 1).
export {
  HISTORY_COPY,
  HistoryDrawer,
  type HistoryDrawerProps,
  type HistoryPartKey,
  type HistoryVersionAuthor,
  type HistoryVersionView,
} from "../HistoryDrawer";
