// The editable 404 page (CONT-28, D235 #11, D-UI-P7-31; 07-32 choices 8-10; T-07-32-09).
// invariant 1: org from the context only; never return or log a hash, a password or a cookie.
//
// One row per org (07-01's partial unique index idx_pages_org_system404): kind "system-404",
// slug NOT_FOUND_SLUG (reserved, so no builder page can take it), title "We can't find that
// page" (the H1 through PageTitleHeader), seeded with one text-only block. It is created on
// first open from Website > Pages, publishes through the normal publishPage, never counts
// toward the 10 pages (listPages leaves it out) and is shown only by the tenant not-found.
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { sanitizeRichText } from "@cds/core/content/sanitize";
import { ClientResponseError, type RecordModel } from "pocketbase";
import type PocketBase from "pocketbase";
import type { OrgContext } from "../../context";
import { newRecordId, requirePermission, tenantRepo } from "../../repository";
import {
  NOT_FOUND_KIND,
  NOT_FOUND_SLUG,
  toPageSummary,
  type PageSummary,
} from "../pages";
import { commit, run } from "../shared";

export const NOT_FOUND_TITLE = "We can't find that page";
export const NOT_FOUND_TEXT =
  "The page may have moved, or the address may have a typo.";

/** The org's 404 page, or null before it is first opened. */
export async function getNotFoundPage(
  ctx: OrgContext,
): Promise<PageSummary | null> {
  requirePermission(ctx, "content", "read");
  const res = await tenantRepo("pages").list(ctx, {
    perPage: 1,
    filter: "kind = {:kind}",
    params: { kind: NOT_FOUND_KIND },
  });
  const row = res.items[0];
  return row ? toPageSummary(row) : null;
}

async function existing(
  pb: PocketBase,
  ctx: OrgContext,
): Promise<RecordModel | null> {
  const res = await pb.collection("pages").getList(1, 1, {
    filter: pb.filter("organization = {:org} && kind = {:kind}", {
      org: ctx.orgId,
      kind: NOT_FOUND_KIND,
    }),
  });
  return res.items[0] ?? null;
}

let registry: ReturnType<typeof composeSectionRegistry> | null = null;
function textContent(): unknown {
  registry ??= composeSectionRegistry(CORE_SECTIONS, []);
  const def = registry.get("text-only");
  if (!def) throw new Error("text-only block missing");
  const content = def.validate(
    {
      ...(def.defaultContent() as object),
      heading: "",
      text: `<p>${NOT_FOUND_TEXT}</p>`,
    },
    "full",
  );
  return def.mapRichText(content, sanitizeRichText);
}

/** Create the org's 404 page once (idempotent; a concurrent create returns the same row). */
export async function ensureNotFoundPage(
  ctx: OrgContext,
): Promise<PageSummary> {
  requirePermission(ctx, "content", "write");
  try {
    return await run(ctx, async (pb) => {
      const found = await existing(pb, ctx);
      if (found) return toPageSummary(found);
      const id = newRecordId();
      await commit(
        pb,
        ctx,
        [
          {
            collection: "pages",
            op: "create",
            id,
            body: {
              organization: ctx.orgId,
              title: NOT_FOUND_TITLE,
              slug: NOT_FOUND_SLUG,
              seo: {},
              status: "draft",
              kind: NOT_FOUND_KIND,
              has_unpublished_changes: true,
              previous_slugs: [],
              password_protected: false,
            },
          },
          {
            collection: "page_sections",
            op: "create",
            id: newRecordId(),
            body: {
              organization: ctx.orgId,
              page: id,
              page_slug: NOT_FOUND_SLUG,
              section_type: "text-only",
              row_layout: "full",
              content: textContent(),
              settings: { background_variant: "main" },
              sort_order: 1,
              is_published: true,
            },
          },
        ],
        {
          action: "pages.create",
          targetCollection: "pages",
          targetId: id,
          meta: { kind: NOT_FOUND_KIND },
        },
      );
      const row = await pb.collection("pages").getOne(id);
      return toPageSummary(row);
    });
  } catch (err) {
    // The partial unique index refused a racing second create: return the winner.
    if (
      (err instanceof ClientResponseError && err.status === 400) ||
      (err instanceof Error && err.name === "InvalidInput")
    ) {
      const found = await getNotFoundPage(ctx);
      if (found) return found;
    }
    throw err;
  }
}
