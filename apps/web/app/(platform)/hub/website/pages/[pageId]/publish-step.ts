// What a Publish click does (WR-B04). Pure, so the order of the checks is unit tested.
// Unsaved block edits come first: an owner who edited a block on an already-published,
// otherwise clean page must get the save-and-continue dialog, not a silent no-op with a
// "No changes to publish" tooltip that contradicts the screen.
import { headerState, type HeaderPage } from "@cds/ui/builder";

export type PublishStep = "busy" | "guard" | "no_changes" | "publish";

export function publishStep(input: {
  publishing: boolean;
  /** The open block form has unsaved edits. */
  formDirty: boolean;
  /** The page as it is now (read from a ref, never a stale render). */
  page: HeaderPage;
}): PublishStep {
  if (input.publishing) return "busy";
  if (input.formDirty) return "guard";
  if (headerState(input.page).publishDisabled) return "no_changes";
  return "publish";
}

/** The Publish button is enabled while the form is dirty, even on a clean page. */
export function publishLooksDisabled(
  headerDisabled: boolean,
  formDirty: boolean,
): boolean {
  return headerDisabled && !formDirty;
}
