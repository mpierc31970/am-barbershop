// Props contract for the P7 builder item editors (07-08). 07-17, 07-18 and 07-23 extend the
// editors; ColumnItemForm renders them with exactly these props.
import type { ColumnItem, FormColumnItem } from "@cds/core/content";

export interface ItemEditorProps<I extends ColumnItem> {
  draft: I;
  /** Merge fields into the draft; the kind never changes. */
  patch: (fields: Partial<I>) => void;
  /** Field name -> message from itemFieldErrors (set on save). */
  errors: Readonly<Record<string, string>>;
  /** DOM id for a field, so saveNow can focus the first error. */
  fid: (field: string) => string;
}

/** One of the site's forms, for the Form item's picker (07-18 supplies the list). */
export interface FormOption {
  id: string;
  name: string;
  deleted?: boolean;
}

export interface FormItemEditorProps extends ItemEditorProps<FormColumnItem> {
  forms?: readonly FormOption[];
}
