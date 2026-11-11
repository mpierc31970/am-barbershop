// GET /_site/review/start?t=<review token>[&next=<path>] on a preview host (14-35 choice 1;
// DOM-10, D172; RESEARCH Pattern 7; T-14-35-02). The hub (/hub/review, 14-34) mints a signed
// 60-minute `review.` token for the acting owner; this route checks it (MAC, expiry, org =
// this site, preview host, and reviewContextForToken: still the owner, org at review stage,
// not staff), sets the host-only `cds_rv` cookie and 303s to `next` (a reviewPages path) or the
// first page not yet marked Looks good. The QR / phone link has no `next` and lands on Home.
// Anything else 303s to "/" without a cookie (the normal strip). Every response is no-store.
import { reviewContextForToken, reviewPages, verifyReviewToken } from "@cds/db";
import {
  firstUnreviewed,
  reviewCookieHeader,
  safeReviewPath,
  see303,
} from "../../../../../../lib/review-mode";
import { clientIp } from "../../../../../../lib/session";
import { siteForRoute } from "../../../../../../lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ host: string }> };

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const { host } = await params;
  const site = await siteForRoute(host);
  if (!site) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const url = new URL(req.url);
  const raw = url.searchParams.get("t") ?? "";
  const now = Date.now();
  const v = verifyReviewToken(raw, now);
  if (
    v.status !== "valid" ||
    v.orgId !== site.orgId ||
    site.hostKind !== "preview"
  ) {
    return see303("/");
  }
  const ctx = await reviewContextForToken(raw, { ip: await clientIp(), now });
  if (!ctx || ctx.orgId !== site.orgId) return see303("/");

  let location = "/";
  const next = safeReviewPath(url.searchParams.get("next"));
  if (v.mode === "phone") {
    location = "/";
  } else if (next) {
    location = next;
  } else {
    try {
      location = firstUnreviewed(await reviewPages(ctx))?.path ?? "/";
    } catch (err) {
      console.error(
        "[review] start pages failed",
        err instanceof Error ? err.name : typeof err,
      );
    }
  }
  const maxAge = Math.max(1, Math.floor((v.expiresAt - now) / 1000));
  return see303(
    safeReviewPath(location) ?? "/",
    reviewCookieHeader(raw, maxAge),
  );
}
