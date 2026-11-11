// Config-only projection of a page's draft (CONT-08, CONT-31; D187, D253, D254; invariants
// 6 and 7; T-03-32, T-03-33).
//
// The published page JSON and the builder preview are both built here, from the draft rows,
// never by spreading a record:
//   - hidden blocks (is_published === false) are omitted
//   - every row re-runs the registry pipeline (assertSectionType, validate, columns
//     normalize, mapRichText(sanitizeRichText), clampLayout): defence in depth, the writers
//     already did this on save
//   - settings are reduced to { background_variant } (no raw styling, invariant 7)
//   - the page keeps id, slug, title, seo and password_protected only. password_hash never
//     enters the object; a page with a hash, or restored with the flag but no hash (03-03),
//     is marked protected so the visitor gate fails closed.
//   - table blocks follow the org's Builder Pro state (10-42; BILL-14, D233, invariant 9):
//     the stored/published JSON keeps every Pro part, and what the visitor (or preview)
//     receives is `tableForRender(content, { proActive })`, so a lapsed site shows the free
//     table (10 x 200, Pro presentation off) and paying again restores it. Applied at read
//     time (readPublishedPage, previewPage), never at write time (T-10-42-02).
import {
  assertSectionType,
  clampLayout,
  normalizeColumns,
  repairDuplicateItemIds,
  tableForRender,
  tableUsesPro,
  type ColumnsContent,
  type PublishedPage,
  type PublishedSection,
  type SectionRegistry,
  type TableBlockContent,
} from "@cds/core/content";
import { NotFound } from "@cds/core";
import { sanitizeRichText } from "@cds/core/content/sanitize";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import type { OrgContext } from "../context";
import { entitlementsFor } from "../payments/entitlements";
import { assertId, mapError, requirePermission } from "../repository";
import { toPageSummary } from "./pages";
import { scopedGet } from "./shared";

/** One draft row through the full registry pipeline, as a published section. */
export function projectSection(
  row: RecordModel,
  registry: SectionRegistry,
): PublishedSection {
  const def = assertSectionType(registry, String(row.section_type ?? ""));
  const row_layout = clampLayout(def.layouts, row.row_layout);
  // Stored rows are repaired, not refused, when item ids repeat (IN-R02): the page stays
  // publishable and restorable. Writes still refuse duplicates.
  const raw =
    def.type === "columns"
      ? repairDuplicateItemIds(row.content ?? {})
      : (row.content ?? {});
  let content = def.validate(raw, row_layout);
  if (def.type === "columns") {
    content = normalizeColumns(content as ColumnsContent, row_layout);
  }
  content = def.mapRichText(content, sanitizeRichText);
  const settings = row.settings as Record<string, unknown> | null | undefined;
  const variant =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? settings.background_variant
      : undefined;
  return {
    id: row.id,
    section_type: def.type,
    row_layout,
    content,
    settings: {
      background_variant: variant === "alternate" ? "alternate" : "main",
    },
  };
}

/** The visible draft rows of a page, ordered by sort_order. */
export function visibleRows(rows: readonly RecordModel[]): RecordModel[] {
  return rows
    .filter((r) => r.is_published !== false)
    .slice()
    .sort(
      (a, b) =>
        (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/** A page is protected when flagged or when a hash is stored (fail closed, 03-03). */
export function isProtected(page: RecordModel): boolean {
  return (
    page.password_protected === true ||
    (typeof page.password_hash === "string" && page.password_hash !== "")
  );
}

export function projectPublishedPage(
  page: RecordModel,
  rows: readonly RecordModel[],
  registry: SectionRegistry,
  now: Date,
): PublishedPage {
  const summary = toPageSummary(page);
  return {
    version: 1,
    page: {
      id: summary.id,
      slug: summary.slug,
      title: summary.title,
      seo: summary.seo,
      password_protected: isProtected(page),
    },
    sections: visibleRows(rows).map((r) => projectSection(r, registry)),
    published_at: now.toISOString(),
  };
}

/** The add-on key whose entitlement turns the Pro table on (D233). */
export const PRO_TABLE_ADDON = "builder-pro";

function isTable(s: PublishedSection): boolean {
  return (
    s.section_type === "table" &&
    typeof s.content === "object" &&
    s.content !== null
  );
}

/** True when any table section of the page uses a Builder Pro part. */
export function pageUsesProTable(page: PublishedPage): boolean {
  const sections = Array.isArray(page?.sections) ? page.sections : [];
  return sections.some(
    (s) => isTable(s) && tableUsesPro(s.content as TableBlockContent),
  );
}

/**
 * The page as visitors see it under the org's plan (pure): Pro active keeps every table as
 * stored; inactive maps each table through `tableForRender(..., { proActive: false })`.
 * Never mutates `page`, so the stored JSON stays whole (invariant 9).
 */
export function projectTablesForPlan(
  page: PublishedPage,
  proActive: boolean,
): PublishedPage {
  if (proActive || !pageUsesProTable(page)) return page;
  return {
    ...page,
    sections: page.sections.map((s) =>
      isTable(s)
        ? {
            ...s,
            content: tableForRender(s.content as TableBlockContent, {
              proActive: false,
            }),
          }
        : s,
    ),
  };
}

/**
 * Server read (superuser client): applies the org's Builder Pro entitlement to the page's
 * tables. The entitlement is only read when a table uses a Pro part.
 */
export async function publishedPageForPlan(
  pb: PocketBase,
  orgId: string,
  page: PublishedPage,
): Promise<PublishedPage> {
  if (!pageUsesProTable(page)) return page;
  const set = await entitlementsFor(pb, orgId);
  return projectTablesForPlan(page, set.keys.has(PRO_TABLE_ADDON));
}

/** Every draft row of a page (hidden included), scoped to the org. */
export function draftRows(
  pb: PocketBase,
  ctx: OrgContext,
  pageId: string,
): Promise<RecordModel[]> {
  return pb.collection("page_sections").getFullList({
    filter: pb.filter("organization = {:org} && page = {:page}", {
      org: ctx.orgId,
      page: pageId,
    }),
    sort: "sort_order,created,id",
  });
}

/** The builder preview: the draft as it would publish, hidden blocks omitted (CONT-08). */
export async function previewPage(
  ctx: OrgContext,
  pageId: string,
  registry: SectionRegistry,
): Promise<PublishedPage> {
  requirePermission(ctx, "content", "read");
  assertId(pageId);
  if (!registry || typeof registry.get !== "function") {
    throw new Error("previewPage needs the composed section registry");
  }
  try {
    return await withSuperuser(async (pb) => {
      const page = await scopedGet(pb, ctx, "pages", pageId);
      // 11-29: a page in Recently deleted has no preview until restored.
      if (typeof page.deleted_at === "string" && page.deleted_at !== "") {
        throw new NotFound();
      }
      const rows = await draftRows(pb, ctx, page.id);
      const projected = projectPublishedPage(page, rows, registry, new Date());
      return publishedPageForPlan(pb, ctx.orgId, projected);
    });
  } catch (err) {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  }
}
