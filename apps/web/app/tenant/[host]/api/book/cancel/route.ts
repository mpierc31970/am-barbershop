// POST /api/book/cancel on tenant hosts: the client's "Cancel appointment" button
// (/book/cancel). cancelPublicBooking checks the token, the status and the 2-hour cutoff
// under the studio lock. Always 303 back to the page, which shows the outcome. Logs carry
// the error class only, never the token.
import { RateLimited } from "@cds/core";
import { cancelPublicBooking } from "@cds/db";
import { readCappedFormData } from "../../../../../../lib/capped-body";
import { clientIp } from "../../../../../../lib/session";
import { siteForRoute } from "../../../../../../lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 4 * 1024;

function back(q: Record<string, string>): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: `/book/cancel?${new URLSearchParams(q)}`,
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ host: string }> },
): Promise<Response> {
  const { host } = await params;
  const site = await siteForRoute(host);
  if (!site) return new Response(null, { status: 404 });
  const form = await readCappedFormData(req, MAX_BODY).catch(() => null);
  const t = form?.get("t");
  const token = typeof t === "string" ? t.slice(0, 200) : "";
  try {
    await cancelPublicBooking(site, token, await clientIp());
    return back({ t: token });
  } catch (err) {
    if (err instanceof RateLimited) return back({ t: token, error: "rate" });
    console.error(
      `[book-cancel] failed: ${err instanceof Error ? err.name : "error"}`,
    );
    return back({ t: token });
  }
}
