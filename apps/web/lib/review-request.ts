// The shared guard for review-mode POSTs on the preview host (14-35 choices 2-3; T-14-35-01,
// T-14-35-02). Order: site from the tenant header (404) -> preview host only (403) -> Origin
// equals the preview host (403, CSRF with a Lax cookie) -> form body (urlencoded or multipart,
// 16 KB cap; 403 on anything else) -> `cds_rv` through reviewContextForToken: the owner of
// this org, not impersonating, org at review stage (403 otherwise). Server only.
import {
  reviewContextForToken,
  type OrgContext,
  type SiteContext,
} from "@cds/db";
import { readCappedFormData } from "./capped-body";
import { REVIEW_COOKIE, readCookie, refuse, sameOrigin } from "./review-mode";
import { clientIp } from "./session";
import { siteForRoute } from "./tenant";

const MAX_REVIEW_BODY = 16 * 1024;

export type ReviewPost = { site: SiteContext; ctx: OrgContext; form: FormData };

export async function reviewPost(
  req: Request,
  host: string,
): Promise<ReviewPost | Response> {
  const site = await siteForRoute(host);
  if (!site) return refuse(404);
  if (site.hostKind !== "preview") return refuse(403);
  if (!sameOrigin(req, site.host)) return refuse(403);
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (
    !type.startsWith("application/x-www-form-urlencoded") &&
    !type.startsWith("multipart/form-data")
  ) {
    return refuse(403);
  }
  const token = readCookie(req, REVIEW_COOKIE);
  if (!token) return refuse(403);
  const ctx = await reviewContextForToken(token, {
    ip: await clientIp(),
  });
  if (!ctx || ctx.orgId !== site.orgId) return refuse(403);
  let form: FormData | null;
  try {
    form = await readCappedFormData(req, MAX_REVIEW_BODY);
  } catch {
    return refuse(403);
  }
  if (form === null) return refuse(403);
  return { site, ctx, form };
}

/** A form field as a trimmed string ("" when absent or a file). */
export function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}
