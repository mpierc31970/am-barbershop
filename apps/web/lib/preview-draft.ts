// Draft preview links (14-20, 14-19): the one draft read per request, shared by the tenant
// layout (strip variant) and the catch-all page (what renders). WR-D01: the strip says
// "showing unpublished changes" only when the page on screen is the link's draft, decided by
// the same rule the page uses: the manifest entry at this path is the link's page (or, with
// no published entry, the draft's own slug is this path), and the draft read succeeded.
import type { PublishedPage, SiteManifest } from "@cds/core/content";
import { previewPageForLink, verifyPreviewToken } from "@cds/db";
import { cache } from "react";
import { SECTION_REGISTRY } from "./section-registry";
import { resolveSlug } from "./tenant";

/** The link's draft page (one read per request, shared by layout, metadata and page), or null. */
export const draftFor = cache(async function draftFor(
  orgId: string,
  token: string,
): Promise<PublishedPage | null> {
  try {
    const r = await previewPageForLink({ orgId }, token, SECTION_REGISTRY);
    return r.status === "draft" ? r.page : null;
  } catch (err) {
    console.error(
      "[preview-link] draft read failed",
      err instanceof Error ? err.name : typeof err,
    );
    return null;
  }
});

export type DraftStripVariant = "normal" | "draft" | "expired";

type Verify = (
  token: string,
  now: Date,
) => { status: string; orgId?: string; pageId?: string };

function own<T>(rec: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(rec, key) ? rec[key] : undefined;
}

/** The catch-all slug for a request pathname (`/` is home), or null when no page can own it. */
export function slugForPathname(pathname: string | null): string | null {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return null;
  const segments = pathname.split("/").filter((s) => s !== "");
  return resolveSlug(segments);
}

/**
 * The preview strip variant for this request. No cookie: normal. A cookie that is not a valid
 * token for this org: expired (the page renders published). A valid token: draft only when the
 * page at `pathname` is the link's page and its draft read succeeds; otherwise normal (the
 * page renders published, so the strip must not claim unpublished changes).
 */
export async function previewStripVariantFor(input: {
  token: string | undefined;
  orgId: string;
  pathname: string | null;
  manifest: SiteManifest | null;
  now: Date;
  readDraft?: (orgId: string, token: string) => Promise<PublishedPage | null>;
  verify?: Verify;
}): Promise<DraftStripVariant> {
  const { token, orgId } = input;
  if (token === undefined || token === "") return "normal";
  const v = (input.verify ?? verifyPreviewToken)(token, input.now);
  if (v.status !== "valid" || v.orgId !== orgId || !v.pageId) return "expired";
  const slug = slugForPathname(input.pathname);
  if (slug === null) return "normal";
  const entry = own(input.manifest?.pages ?? {}, slug);
  if (entry && entry.id !== v.pageId) return "normal";
  const read = input.readDraft ?? draftFor;
  const draft = await read(orgId, token);
  if (!draft) return "normal";
  // A draft-only page shows its draft only at its own draft slug.
  if (!entry && draft.page?.slug !== slug) return "normal";
  return "draft";
}
