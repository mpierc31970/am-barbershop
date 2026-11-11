// Props contract for the P7 site item components (07-08). 07-19 and 07-23 fill the
// components; the dispatch in ColumnItemRenderer and these props stay as they are.
import type { FormColumnItem } from "@cds/core/content";
import type { ResolvedMedia } from "../types";

export interface ItemComponentProps<I> {
  item: I;
  /** Assets resolved for this page, keyed by asset id (read with resolveMedia only). */
  media?: Readonly<Record<string, ResolvedMedia>>;
  now: Date;
}

export interface FormItemProps extends ItemComponentProps<FormColumnItem> {
  /** Public form projections keyed by form id (07-19's loader fills them). */
  forms?: Readonly<Record<string, unknown>>;
}

// 07-19: the narrowed coreData.forms entry a FormItem renders (see form-view.ts).
export type { FieldErrorCode, FormStatusView, FormView } from "./form-view";
