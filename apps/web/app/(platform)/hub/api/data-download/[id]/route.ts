// /hub/api/data-download/<id>?exp=<ms>&sig=<b64url>: the Owner's "Download my data" zip
// (11-41; LIFE-04; D284, D285; 11-UI-SPEC "Download my data"; T-11-41-01..04).
//
// Two locks, both required (choice 1): the signed link (HMAC over id + expiry, 11-40
// `verifyDownloadLink`, checked inside `openDataDownload`) AND the Owner session of the org
// that owns the row. A forwarded or leaked link is useless without that Owner's sign-in
// (T-11-41-01). Impersonating staff and every other role get the same 404 as a foreign id
// (T-11-41-03): the route never says whether a download exists. A genuine link past its 7
// days, or a pruned zip, goes to the expired page (UI-SPEC). The zip streams straight from
// storage (`readRange(key, null)` inside openDataDownload) as an attachment, `private,
// no-store`, never sniffed (T-11-41-02). Errors log the class name only, never a storage key
// or message (T-11-41-04). Signed out: to /sign-in (the hub has no return path yet; the
// Ready state in Settings › Business info carries a fresh link after sign-in).
import {
  DownloadLinkExpired,
  openDataDownload,
  type OpenedDownload,
} from "@cds/db";
import { getHubSession } from "../../../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECORD_ID = /^[a-z0-9]{15}$/;
/** Every response: never cached, never content-sniffed (T-11-41-02). */
const SAFE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

/** The UI-SPEC expired page (sign-in frame, outside the hub shell). */
const DATA_DOWNLOAD_EXPIRED_PATH = "/download-expired";

const NOT_FOUND_TITLE = "We couldn't open this download";
const NOT_FOUND_BODY =
  "Only the site owner can open a data download, and only while signed in to that site. If you have more than one site, switch to the one this download is for and open the link again, or ask for a new download from Settings › Business info.";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function redirectTo(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { ...SAFE_HEADERS, Location: location },
  });
}

/** Plain 404 in the sign-in frame's look: no detail about whether the download exists. */
function notFoundPage(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Download unavailable</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c1b1a;background:#f4f2ee}
main{max-width:400px;margin:15vh auto 0;padding:24px;background:#fff;border:1px solid #e3dfd8;border-radius:12px}
h1{font-size:1.5rem;line-height:1.25;margin:0 0 12px}
p{font-size:1rem;line-height:1.5;margin:0 0 20px;color:#4a4744}
a{display:inline-block;padding:8px 14px;border:1px solid #c9c4bd;border-radius:8px;color:#1c1b1a;text-decoration:none}
a:focus-visible{outline:2px solid #2f5d50;outline-offset:2px}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(NOT_FOUND_TITLE)}</h1>
<p>${escapeHtml(NOT_FOUND_BODY)}</p>
<a href="/hub">Go to your hub</a>
</main>
</body>
</html>
`;
  return new Response(html, {
    status: 404,
    headers: { ...SAFE_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}

/** ASCII-only, quote-free filename for Content-Disposition (the slug already is; belt and braces). */
function safeZipName(name: string): string {
  const base = name
    .replace(/\.zip$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  return `${base || "site-data"}.zip`;
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let session: Awaited<ReturnType<typeof getHubSession>>;
  try {
    session = await getHubSession();
  } catch (err) {
    console.error("[downloads] route session failed", errName(err));
    return notFoundPage();
  }
  if (!session) return redirectTo("/sign-in");
  const { ctx } = session;
  // Owner of this org, never staff acting as one (D285; T-11-41-03).
  if (ctx.role !== "owner" || ctx.impersonator) return notFoundPage();

  const { id } = await params;
  if (typeof id !== "string" || !RECORD_ID.test(id)) return notFoundPage();
  const url = new URL(req.url);
  const exp = url.searchParams.get("exp");
  const sig = url.searchParams.get("sig");
  if (!exp || !sig) return notFoundPage();

  let opened: OpenedDownload;
  try {
    opened = await openDataDownload(ctx, id, { exp, sig });
  } catch (err) {
    if (err instanceof DownloadLinkExpired) {
      return redirectTo(DATA_DOWNLOAD_EXPIRED_PATH);
    }
    // NotFound is the expected refusal; anything else is logged by class name only.
    if (errName(err) !== "NotFound") {
      console.error("[downloads] route open failed", errName(err));
    }
    return notFoundPage();
  }

  return new Response(opened.stream, {
    headers: {
      ...SAFE_HEADERS,
      "Content-Type": "application/zip",
      "Content-Length": String(opened.size),
      "Content-Disposition": `attachment; filename="${safeZipName(opened.filename)}"`,
    },
  });
}
