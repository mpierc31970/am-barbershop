// GET /llms.txt on tenant hosts (07-31 choice 10; CONT-13, CONT-15, CONT-37; D170, D277).
// Derives only from index.json (getSiteIndex). An invitation to AI tools, so it exists only
// on a custom host with the site's AI toggle on; preview hosts, the toggle off, no index yet
// or an unknown host -> 404. Shape: llmstxt.org (llmsTxt).
import { llmsTxt } from "@cds/core/seo";
import {
  notFoundResponse,
  originFor,
  textResponse,
} from "../../../../lib/site-index-route";
import { getSiteIndex } from "../../../../lib/site-cache";
import { siteForRoute } from "../../../../lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ host: string }> };

export async function GET(
  _req: Request,
  { params }: Params,
): Promise<Response> {
  const { host } = await params;
  const site = await siteForRoute(host);
  if (!site || site.hostKind !== "custom") return notFoundResponse();
  // A failed read is treated as no index (never a 500).
  const index = await getSiteIndex(site).catch(() => null);
  if (!index || !index.site.allow_ai_crawlers) return notFoundResponse();
  return textResponse(
    llmsTxt({ origin: originFor(site), index }),
    "text/plain; charset=utf-8",
  );
}
