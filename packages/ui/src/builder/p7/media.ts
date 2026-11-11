// @cds/ui/builder P7 media (owner 07-17; 07-02 seam). Props-driven client components;
// never touch the database client.
export { MediaField, type MediaFieldProps } from "../MediaField";
// 07-28: builder "deleted" state labels (pure; the builder page computes them on the server).
export {
  DELETED_POPUP_COPY,
  DELETED_REF_LABELS,
  deletedRefLabel,
  type RefIds,
} from "../deleted-refs";
