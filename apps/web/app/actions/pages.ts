"use server";
// Page actions for the Pages tab and builder header (CONT-30; T-03-42, T-03-46). Public
// POST endpoints: arguments are untrusted. The tenant comes only from the session cookie
// via runAction; only the known fields are forwarded, so a smuggled tenant field never
// reaches @cds/db (which also rejects one). Errors come back as UI-SPEC copy.
// 07-25 (choice 13): createPageAction takes `addToNav` (only `=== true` counts); after the
// page exists it is appended to the site menu in its own try/catch, so a menu failure never
// fails page creation (`navAdded: false`, logged without ids).
// 11-28 (choice 4): a PageLimitReached refusal answers `{ ok: false, code: "page_limit",
// message: PAGES-FULL, allowance }` so the Add page row keeps the typed title and shows why.
// 11-30 (DASH-06, DASH-08; UI-SPEC "Page delete and Recently deleted"; T-11-30-01/02):
// pageDeleteCaseAction / deletePageAction / restoreDeletedPageAction. Ids and the redirect
// target are only shape-checked here; @cds/db checks content:write (Viewer refused) and that
// the target is one of this org's live published pages. A restore refused at the allowance
// answers like createPageAction's page_limit, so the row can offer the Owner's buy link.
import { CdsError } from "@cds/core";
import {
  addPageToNav,
  createPage,
  deletePage,
  pageDeleteCase,
  restoreDeletedPage,
  updatePage,
  type PageDeleteCase,
  type PageSummary,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";
import { contentDeps } from "../../lib/content";

/** What the delete dialog shows (11-29 pageDeleteCase). */
export type PageDeleteCaseView = PageDeleteCase;

/** A restore refused at the allowance carries the allowance (PAGES-FULL copy). */
export type RestorePageResult =
  ActionResult<{ id: string; live: boolean }> | PageLimitResult;

const ID_MAX = 64;

/** A record id shape, else "" (@cds/db refuses "" as not found). */
function idOf(v: unknown): string {
  return typeof v === "string" && v.length > 0 && v.length <= ID_MAX ? v : "";
}

/** The hub layout (counts, badges) and the Pages tab read the page list. */
function refreshPages(): void {
  try {
    revalidatePath("/hub", "layout");
    revalidatePath("/hub/website");
  } catch (err) {
    console.error(
      "[hub] pages: revalidate failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
}

type PagePatch = { title?: string; slug?: string; seo?: PageSummary["seo"] };

/** The server refused the create: the site has used its whole page allowance. */
export type PageLimitResult = {
  ok: false;
  code: "page_limit";
  message: string;
  allowance: number;
};

type Created = PageSummary & { navAdded: boolean };

export type CreatePageResult = ActionResult<Created> | PageLimitResult;

/** The allowance a PageLimitReached carries (code "page_limit"), else null. */
function limitOf(err: unknown): number | null {
  if (!(err instanceof CdsError) || err.code !== "page_limit") return null;
  const n = (err as { allowance?: unknown }).allowance;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function createPageAction(input: {
  title: string;
  slug: string;
  addToNav?: boolean;
}): Promise<CreatePageResult> {
  const raw = (typeof input === "object" && input !== null ? input : {}) as {
    title?: unknown;
    slug?: unknown;
    addToNav?: unknown;
  };
  const title = str(raw.title);
  const slug = str(raw.slug);
  const addToNav = raw.addToNav === true;
  const res = await runAction(
    async (s): Promise<{ limit: PageLimitResult } | { page: Created }> => {
      let page: PageSummary;
      try {
        page = await createPage(s.ctx, { title, slug });
      } catch (err) {
        const allowance = limitOf(err);
        if (allowance === null) throw err;
        return {
          limit: {
            ok: false,
            code: "page_limit",
            message: (err as Error).message,
            allowance,
          },
        };
      }
      let navAdded = false;
      if (addToNav) {
        try {
          navAdded = (await addPageToNav(s.ctx, contentDeps(), page.id)).added;
        } catch {
          console.error("[hub] add page to nav failed");
        }
      }
      return { page: { ...page, navAdded } };
    },
  );
  if (!res.ok) return res;
  if ("limit" in res.data) return res.data.limit;
  return { ok: true, data: res.data.page };
}

export async function updatePageAction(
  pageId: string,
  patch: PagePatch,
): Promise<ActionResult<PageSummary>> {
  const raw = (typeof patch === "object" && patch !== null ? patch : {}) as {
    title?: unknown;
    slug?: unknown;
    seo?: unknown;
  };
  const clean: PagePatch = {};
  if (raw.title !== undefined) clean.title = str(raw.title);
  if (raw.slug !== undefined) clean.slug = str(raw.slug);
  if (raw.seo !== undefined) clean.seo = raw.seo as PagePatch["seo"];
  return runAction((s) => updatePage(s.ctx, str(pageId), clean));
}

/** The delete dialog's case: links to the page and where its address can send visitors. */
export async function pageDeleteCaseAction(
  pageId: string,
): Promise<ActionResult<PageDeleteCaseView>> {
  return runAction((s) => pageDeleteCase(s.ctx, idOf(pageId)));
}

/** Delete a page (soft, 30 days in Recently deleted). `redirectTo` null = page not found. */
export async function deletePageAction(
  pageId: string,
  redirectTo: string | null,
): Promise<ActionResult<{ id: string; redirectTo: string | null }>> {
  const id = idOf(pageId);
  // A non-string or "" means "no redirect"; a malformed or foreign id is refused by @cds/db.
  const target =
    typeof redirectTo === "string" && redirectTo !== "" ? redirectTo : null;
  const res = await runAction((s) =>
    deletePage(s.ctx, id, { redirectTo: target }, contentDeps()),
  );
  if (res.ok) refreshPages();
  return res;
}

/** Bring a page back from Recently deleted (the Undo toast and the Restore button). */
export async function restoreDeletedPageAction(
  pageId: string,
): Promise<RestorePageResult> {
  const id = idOf(pageId);
  const res = await runAction(
    async (
      s,
    ): Promise<
      { limit: PageLimitResult } | { done: { id: string; live: boolean } }
    > => {
      try {
        return { done: await restoreDeletedPage(s.ctx, id, contentDeps()) };
      } catch (err) {
        const allowance = limitOf(err);
        if (allowance === null) throw err;
        return {
          limit: {
            ok: false,
            code: "page_limit",
            message: (err as Error).message,
            allowance,
          },
        };
      }
    },
  );
  if (!res.ok) return res;
  if ("limit" in res.data) return res.data.limit;
  refreshPages();
  return { ok: true, data: res.data.done };
}
