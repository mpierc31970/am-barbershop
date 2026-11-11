// Form column item validator (07-08; CONT-25). The form itself lives in the forms
// collection (07-15/07-18); the item only points at it. The id is strict and checked
// against the organization on save (assertRefsOwned). Pure and Edge-safe.
import type { FormColumnItem } from "../types";
import { own, type Raw } from "../validate-helpers";
import { refId } from "./shared";

export const FORM_ITEM_COPY =
  "Choose a form. You can create one in Website › Forms.";

export function validateFormItem(raw: Raw, id: string): FormColumnItem {
  return {
    id,
    kind: "form",
    form_id: refId(own(raw, "form_id"), FORM_ITEM_COPY),
  };
}
