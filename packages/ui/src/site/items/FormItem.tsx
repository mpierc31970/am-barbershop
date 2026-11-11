// FormItem: the public render of a form column item (CONT-25, D231; 07-08 seam, filled by
// 07-19). Narrows coreData.forms[form_id] to a FormView and SSRs the FormEnhancer island around
// 07-18's FormMarkup (via FormShell), so the form works without JS. Held or missing forms
// render nothing. Server component: no next/*, no client hooks.
import { FormEnhancer } from "../client/FormEnhancer";
import { initialFormState } from "./FormShell";
import { formViewOf } from "./form-view";
import type { FormItemProps } from "./types";

export function FormItem({ item, forms, now }: FormItemProps) {
  const entry =
    item.form_id &&
    forms &&
    Object.prototype.hasOwnProperty.call(forms, item.form_id)
      ? forms[item.form_id]
      : undefined;
  const view = formViewOf(entry);
  if (!view) return null;
  return (
    <FormEnhancer
      view={view}
      itemId={item.id}
      startedAt={now.getTime()}
      initial={initialFormState(view, item.id)}
    />
  );
}
