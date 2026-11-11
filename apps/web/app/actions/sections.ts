"use server";
// Block actions for the page builder (CONT-05, CONT-06, CONT-07; CONTEXT A2-Q3; T-03-53,
// T-03-54, T-03-56). Public POST endpoints: every argument is untrusted. The tenant comes
// only from the session cookie via runAction, and only known fields are forwarded, so a
// smuggled tenant field never reaches @cds/db (which rejects one anyway). Ids are scoped
// there: another site's id reads as not found. Content is validated and sanitized in the
// chokepoint with the composed SECTION_REGISTRY; nothing here trusts the browser's checks.
// ADDON_REGISTRY goes in too, so a block of an add-on that is off is refused (ADDON-05).
import {
  deleteSection,
  reorderSections,
  saveSection,
  setSectionHidden,
  undoDeleteSection,
  type DeletedSection,
  type SaveSectionInput,
  type SectionRow,
} from "@cds/db";
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { runAction, type ActionResult } from "../../lib/action";
import { SECTION_REGISTRY } from "../../lib/section-registry";

const ERR_REORDER =
  "That move didn't save, so the block went back to where it was. Try again.";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function record(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Create a block (no id; afterId places it) or save an existing one's draft. */
export async function saveSectionAction(
  input: SaveSectionInput,
): Promise<ActionResult<SectionRow>> {
  const raw = record(input);
  const clean: SaveSectionInput = {
    pageId: str(raw.pageId),
    section_type: str(raw.section_type),
    row_layout: str(raw.row_layout),
    content: raw.content,
  };
  if (raw.id !== undefined) clean.id = str(raw.id);
  if (raw.settings !== undefined) clean.settings = raw.settings;
  if (raw.afterId === null) clean.afterId = null;
  else if (raw.afterId !== undefined) clean.afterId = str(raw.afterId);
  return runAction((s) =>
    saveSection(s.ctx, SECTION_REGISTRY, clean, ADDON_REGISTRY),
  );
}

/** Save the page's block order in one write (drag, keyboard and Move buttons). */
export async function reorderSectionsAction(
  pageId: string,
  orderedIds: string[],
): Promise<ActionResult<null>> {
  const ids = Array.isArray(orderedIds) ? orderedIds.map(str) : [];
  const res = await runAction(async (s) => {
    await reorderSections(s.ctx, str(pageId), ids);
    return null;
  });
  if (!res.ok && (res.code === "invalid_input" || res.code === "save_failed")) {
    return { ok: false, code: "reorder_failed", message: ERR_REORDER };
  }
  return res;
}

/** Hide a block from the published page (it stays in the draft), or show it again. */
export async function setSectionHiddenAction(
  sectionId: string,
  hidden: boolean,
): Promise<ActionResult<null>> {
  return runAction(async (s) => {
    await setSectionHidden(s.ctx, str(sectionId), hidden === true);
    return null;
  });
}

/** Delete a block; the returned snapshot powers the Undo toast. */
export async function deleteSectionAction(
  sectionId: string,
): Promise<ActionResult<DeletedSection>> {
  return runAction((s) => deleteSection(s.ctx, str(sectionId)));
}

/** Undo a delete. The snapshot is browser data, so it goes through full validation again. */
export async function undoDeleteSectionAction(
  deleted: DeletedSection,
): Promise<ActionResult<SectionRow>> {
  return runAction((s) =>
    undoDeleteSection(s.ctx, SECTION_REGISTRY, deleted, ADDON_REGISTRY),
  );
}
