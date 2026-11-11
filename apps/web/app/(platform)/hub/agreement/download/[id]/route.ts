// /hub/agreement/download/<id>: the signer's own copy of a signed agreement (09-18; AGR-04,
// AGR-06; CONTEXT A2-Q4; D81; D-UI-P9-11, D-UI-P9-16; T-09-18-01..04).
//
// Streams the stored HTML through this session-checked route rather than 302ing to a
// time-limited signed URL (09-18 choice 1, RESEARCH "Download route"): the local-disk
// stand-in has no presigned URLs, and streaming never hands out a bearer link, so the link
// in the agreement.signed email never expires. Owner/Admin of the org only (agreements:read);
// impersonating staff act as the impersonated role (choice 4). The org comes from the session
// ctx only; another org's id or a missing object is ERR-DOWNLOAD (404), never a storage
// error (choice 3). Exempt from the re-accept gate (getHubSession, not requireHubSession; the
// path is also on agreement-gate's opt-out list). Served as an attachment, never sniffed, so
// the tenant-typed strings in the HTML never run in the app origin (T-09-18-02).
import { can } from "@cds/core";
import { readSignedCopy, type SignedCopy } from "@cds/db";
import {
  getDeclinedSession,
  getHubSession,
} from "../../../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECORD_ID = /^[a-z0-9]{15}$/;
/** Every response: never cached (T-09-18-03), never content-sniffed (T-09-18-02). */
const SAFE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;
const SETTINGS_LEGAL = "/hub/settings?tab=legal";

const ERR_DOWNLOAD =
  "We couldn't open that copy right now. Try again in a minute; your agreement is still safely stored. If it keeps happening, contact CDS Support.";

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

/** Minimal hub-styled error page: ERR-DOWNLOAD and a way back to Settings › Legal. */
function errorPage(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Download unavailable</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c1b1a;background:#faf9f7}
main{max-width:560px;margin:15vh auto 0;padding:0 24px}
h1{font-size:1.25rem;line-height:1.3;margin:0 0 12px}
p{font-size:1rem;line-height:1.5;margin:0 0 20px;color:#4a4744}
a{display:inline-block;padding:8px 14px;border:1px solid #c9c4bd;border-radius:8px;color:#1c1b1a;text-decoration:none}
a:focus-visible{outline:2px solid #2f5d50;outline-offset:2px}
</style>
</head>
<body>
<main>
<h1>Download unavailable</h1>
<p>${escapeHtml(ERR_DOWNLOAD)}</p>
<a href="${escapeHtml(SETTINGS_LEGAL)}">Back to Settings › Legal</a>
</main>
</body>
</html>
`;
  return new Response(html, {
    status: 404,
    headers: {
      ...SAFE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // No agreement gate (D-UI-P9-16). 10-32: a declined site's Owner/Admin can still
  // download the signed copy from the declined notice until deletion (DECLINED-KEEP).
  const session = (await getHubSession()) ?? (await getDeclinedSession());
  if (!session) return redirectTo("/sign-in");
  const { ctx } = session;
  if (!can(ctx, "agreements", "read")) return redirectTo("/hub");

  const { id } = await params;
  if (typeof id !== "string" || !RECORD_ID.test(id)) return errorPage();

  let copy: SignedCopy | null = null;
  try {
    copy = await readSignedCopy(ctx, id);
  } catch (err) {
    // Ids only: never the error message (it may carry a storage key or path).
    console.error(
      `[agreement] download failed for ${id}`,
      err instanceof Error ? err.name : typeof err,
    );
    return errorPage();
  }
  if (!copy) return errorPage();

  return new Response(new Uint8Array(copy.bytes), {
    headers: {
      ...SAFE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${copy.filename}"`,
    },
  });
}
