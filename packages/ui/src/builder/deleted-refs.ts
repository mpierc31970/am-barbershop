// Builder "deleted" state labels (07-28; CONT-36, D275; UI-SPEC "Soft-delete in the builder",
// DELETED-REF; choice 9). Pure: the builder page computes, on the server, which of a block's
// referenced forms, pop-ups and media are soft-deleted or missing, and SectionsList shows the
// row label from here. The block keeps rendering; the item editors carry their own alerts.

/** The ids a block references, by kind (the @cds/core SectionRefs shape). */
export type RefIds = {
  readonly forms: readonly string[];
  readonly popups: readonly string[];
  readonly media: readonly string[];
};

/** Row labels, first match in the order form, pop-up, media. */
export const DELETED_REF_LABELS = {
  forms: "Uses a deleted form",
  popups: "Uses a deleted pop-up",
  media: "Uses deleted media",
} as const;

/** The pop-up picker's DELETED-REF variant (a button points at a deleted pop-up). */
export const DELETED_POPUP_COPY =
  "This pop-up was deleted. It still opens here so nothing breaks; choose another pop-up or change this button.";

const ORDER = ["forms", "popups", "media"] as const;

/** The row label for a block whose refs include a deleted id, else null. */
export function deletedRefLabel(
  refs: RefIds | null | undefined,
  deleted: RefIds | null | undefined,
): string | null {
  if (!refs || !deleted) return null;
  for (const kind of ORDER) {
    const gone = new Set(Array.isArray(deleted[kind]) ? deleted[kind] : []);
    const ids = Array.isArray(refs[kind]) ? refs[kind] : [];
    if (ids.some((id) => gone.has(id))) return DELETED_REF_LABELS[kind];
  }
  return null;
}
