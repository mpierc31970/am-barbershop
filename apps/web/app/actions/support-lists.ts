"use server";
// CDS Support list actions (12-25; COMM-04, CUSTOM-01; T-12-25-01, T-12-25-02). Public POST
// endpoints: every argument is untrusted. The tenant, role and impersonation come only from
// the session cookie via runAction; no action takes a tenant id.
//   - toggleIdeaVoteAction: one vote per site. The chokepoint (12-22) requires support:write
//     and refuses impersonation, so a Viewer or staff viewing as the tenant never votes.
//   - markDocumentsReadAction: opening the Documents tab clears the "New" state for this
//     person (a no-op while impersonating).
//   - loadMoreDocumentsAction: the next page of CDS documents or thread files before a
//     `created` cursor. Links are never part of a list; Download mints them on click.
// Nothing here logs titles, names or file names.
import { InvalidInput } from "@cds/core";
import type { CdsDocument, ThreadFile } from "@cds/core/support";
import {
  listCdsDocuments,
  listThreadFiles,
  markDocumentsRead,
  toggleIdeaVote,
} from "@cds/db";
import { SUPPORT_UI_COPY } from "@cds/ui/hub/support";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";

const ID = /^[a-z0-9]{15}$/;
const GONE = "This was removed or moved. Reload the page to see the latest.";
/** One page of a Documents section (listCdsDocuments / listThreadFiles cap at 100). */
const MORE_PAGE = 100;

/** A document as the list takes it (the unread flag travels as unreadIds). */
function withoutUnread<T extends { unread: boolean }>(
  row: T,
): Omit<T, "unread"> {
  const { unread, ...rest } = row;
  void unread;
  return rest;
}

const COPY = { impersonation: SUPPORT_UI_COPY.IMPERSONATING_SUPPORT };

function idOf(raw: unknown): string {
  if (typeof raw !== "string" || !ID.test(raw)) throw new InvalidInput(GONE);
  return raw;
}

function cursorOf(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 40) {
    throw new InvalidInput(GONE);
  }
  const d = new Date(raw.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) throw new InvalidInput(GONE);
  return d.toISOString();
}

function refresh(path: string): void {
  try {
    revalidatePath(path);
    revalidatePath("/hub", "layout");
  } catch (err) {
    console.error(
      "[support] revalidate failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
}

/** Ideas tab vote toggle. Returns the site's vote state and the recounted total. */
export async function toggleIdeaVoteAction(
  ideaId: unknown,
): Promise<ActionResult<{ voted: boolean; votes: number }>> {
  const res = await runAction(
    async (s) => toggleIdeaVote(s.ctx, idOf(ideaId)),
    COPY,
  );
  if (res.ok) refresh("/hub/support");
  return res;
}

/** Opening the Documents tab marks CDS documents read for this person. */
export async function markDocumentsReadAction(): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    await markDocumentsRead(s.ctx);
    return null;
  }, COPY);
  if (res.ok) refresh("/hub/support");
  return res;
}

export type MoreDocuments =
  | { kind: "docs"; rows: CdsDocument[]; full: boolean }
  | { kind: "files"; rows: ThreadFile[]; full: boolean };

/**
 * Documents "Show more" past the first page: `kind` "docs" (Shared by CDS) or "files"
 * (From your tickets and messages), rows created before `before`. `full` = there may be more.
 * `beforeId` is that row's id, so rows saved in the same millisecond are not skipped (IN-C07).
 */
export async function loadMoreDocumentsAction(
  kind: unknown,
  before: unknown,
  beforeId?: unknown,
): Promise<ActionResult<MoreDocuments>> {
  return runAction(async (s): Promise<MoreDocuments> => {
    const at = cursorOf(before);
    const tie = typeof beforeId === "string" ? { beforeId } : {};
    if (kind === "docs") {
      const rows = await listCdsDocuments(s.ctx, {
        limit: MORE_PAGE,
        before: at,
        ...tie,
      });
      return {
        kind: "docs",
        rows: rows.map(withoutUnread),
        full: rows.length === MORE_PAGE,
      };
    }
    if (kind === "files") {
      const rows = await listThreadFiles(s.ctx, {
        from: "all",
        limit: MORE_PAGE,
        before: at,
        ...tie,
      });
      return { kind: "files", rows, full: rows.length === MORE_PAGE };
    }
    throw new InvalidInput(GONE);
  }, COPY);
}
