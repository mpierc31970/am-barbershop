// /hub/api/support-file/<id>?exp=<ms>&sig=<b64url>: one support attachment or CDS document
// (COMM-04; 12-07 choice 9; RESEARCH Pattern 5; T-12-07-01..03, T-12-07-05).
//
// Two locks, both required: the 15-minute signed link (support-file. HMAC, checked inside
// openSupportFile) AND a hub session with support:read in the org that owns the file. A
// forwarded link is useless without that sign-in. Impersonating staff (the data-download
// precedent; staff use support:show), a foreign id, a file on an internal note, a pending
// file, a tampered link or missing params all get the same 404: the route never says whether
// a file exists. A genuine link past its 15 minutes goes to /support-file-expired (outside
// /hub, like /download-expired). Signed out: to /sign-in.
// Headers: private, no-store, nosniff, a locked-down CSP; the MIME is the detected type;
// images inline, everything else an attachment with a cleaned filename. Errors log the class
// name only, never a key, name or message.
import { can } from "@cds/core";
import {
  openSupportFile,
  SupportLinkExpired,
  type OpenedSupportFile,
} from "@cds/db";
import { getHubSession } from "../../../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECORD_ID = /^[a-z0-9]{15}$/;
/** Every response: never cached, never content-sniffed, never scripted. */
const SAFE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
} as const;

/** The UI-SPEC expired page (sign-in frame, outside the hub shell). */
const SUPPORT_FILE_EXPIRED_PATH = "/support-file-expired";

const NOT_FOUND_TITLE = "We couldn't open this file";
const NOT_FOUND_BODY =
  "The link may be wrong, or the file belongs to another site. If you have more than one site, switch to the one this file is for, then go back to Documents and tap Download again.";

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

/** Plain 404 in the sign-in frame's look: no detail about whether the file exists. */
function notFoundPage(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>File unavailable</title>
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
<a href="/hub/support?tab=documents">Go to Documents</a>
</main>
</body>
</html>
`;
  return new Response(html, {
    status: 404,
    headers: {
      ...SAFE_HEADERS,
      // The 404 page needs its inline style; still no scripts.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

/** ASCII-only, quote-free filename plus an RFC 5987 UTF-8 copy for Content-Disposition. */
function disposition(kind: "inline" | "attachment", name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^A-Za-z0-9]/g, "") : "";
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-. ]+|[-. ]+$/g, "")
    .slice(0, 100);
  const ascii = `${base || "file"}${ext ? `.${ext}` : ""}`;
  const utf8 = encodeURIComponent(name.replace(/[\r\n"]/g, "")).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
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
    console.error("[support-file] route session failed", errName(err));
    return notFoundPage();
  }
  if (!session) return redirectTo("/sign-in");
  const { ctx } = session;
  if (ctx.impersonator || !can(ctx, "support", "read")) return notFoundPage();

  const { id } = await params;
  if (typeof id !== "string" || !RECORD_ID.test(id)) return notFoundPage();
  const url = new URL(req.url);
  const exp = url.searchParams.get("exp");
  const sig = url.searchParams.get("sig");
  if (!exp || !sig) return notFoundPage();

  let opened: OpenedSupportFile;
  try {
    opened = await openSupportFile(ctx, id, { exp, sig });
  } catch (err) {
    if (err instanceof SupportLinkExpired) {
      return redirectTo(SUPPORT_FILE_EXPIRED_PATH);
    }
    // NotFound is the expected refusal; anything else is logged by class name only.
    if (errName(err) !== "NotFound") {
      console.error("[support-file] route open failed", errName(err));
    }
    return notFoundPage();
  }

  const textual = opened.mime.startsWith("text/");
  return new Response(opened.stream, {
    headers: {
      ...SAFE_HEADERS,
      "Content-Type": textual ? `${opened.mime}; charset=utf-8` : opened.mime,
      "Content-Length": String(opened.size),
      "Content-Disposition": disposition(
        opened.inline ? "inline" : "attachment",
        opened.filename,
      ),
    },
  });
}
