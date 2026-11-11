// /api/email/unsubscribe (RFC 8058 one-click; D138, D-UI-P6-15; T-06-80). The target of a
// reminder's List-Unsubscribe header, with List-Unsubscribe-Post: List-Unsubscribe=One-Click.
//
//   POST ?t=<signed>  the mail provider's one-click: the HMAC-signed, expiring token is the
//                     only authority. Cookies and sessions are never read. 200 once the
//                     suppression exists; 400 (generic) for a bad or expired token.
//   GET  ?t=<signed>  never unsubscribes (link scanners): 303 to the /start/unsubscribe page,
//                     which asks first.
//
// The body is not required to be exactly "List-Unsubscribe=One-Click": the signed token
// already proves the request came from our email, and a strict body check would only turn
// a real unsubscribe from an unusual provider into a lost one (D138). Platform host only:
// on a tenant host the middleware rewrites the path under /tenant, where nothing matches.
import { unsubscribeQuote } from "@cds/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "Content-Type": "text/plain; charset=utf-8",
};

const MAX_TOKEN = 512;

function tokenOf(req: Request): string | null {
  const t = new URL(req.url).searchParams.get("t");
  return t && t.length <= MAX_TOKEN ? t : null;
}

export async function POST(req: Request) {
  const token = tokenOf(req);
  if (!token)
    return new Response("Bad Request", { status: 400, headers: HEADERS });
  let ok: boolean;
  try {
    ok = await unsubscribeQuote(token);
  } catch (err) {
    console.error(
      `[email-unsubscribe] one-click failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    // 5xx lets the provider retry; the reason is never returned.
    return new Response("Try again later", { status: 503, headers: HEADERS });
  }
  return ok
    ? new Response("Unsubscribed", { status: 200, headers: HEADERS })
    : new Response("Bad Request", { status: 400, headers: HEADERS });
}

export function GET(req: Request) {
  const token = tokenOf(req);
  const location = token
    ? `/start/unsubscribe?t=${encodeURIComponent(token)}`
    : "/start/unsubscribe";
  return new Response(null, {
    status: 303,
    headers: { ...HEADERS, Location: location },
  });
}
