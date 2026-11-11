// The suspended-site page (13-22, STAFF-22, D215, D218; 13-UI-SPEC "Suspended-site page";
// D-UI-P13-15). Answered by the middleware for every path on a suspended tenant host: a
// neutral 503 with no tenant theme, logo, name, content, reason, link, branding or script.
// Pure: no database, no tenant data, so it can never leak what is being hidden (T-13-22-01/02).
import { P13_COPY } from "@cds/core/staff";
import { NextResponse } from "next/server";

/** One day: crawlers come back tomorrow rather than dropping the site. */
export const SUSPENDED_RETRY_AFTER_S = 86_400;

const SUSPENDED_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${P13_COPY.SUSPENDED_PAGE_TITLE}</title>
<style>
html{background:#f7f7f5;color:#1c1c1a}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.5}
main{max-width:560px;margin:96px auto 0;padding:0 24px;text-align:center}
h1{font-size:2rem;line-height:1.2;font-weight:600;margin:0 0 12px}
p{font-size:1rem;color:#5c5c57;margin:0}
</style>
</head>
<body>
<main>
<h1>${P13_COPY.SUSPENDED_PAGE_H}</h1>
<p>${P13_COPY.SUSPENDED_PAGE_B}</p>
</main>
</body>
</html>
`;

/** The neutral body (tests read it; the response below serves it). */
export function suspendedHtml(): string {
  return SUSPENDED_HTML;
}

/** 503 + Retry-After + noindex + no-store. The middleware adds the security headers. */
export function suspendedResponse(): NextResponse {
  return new NextResponse(SUSPENDED_HTML, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": String(SUSPENDED_RETRY_AFTER_S),
      "X-Robots-Tag": "noindex",
      "Cache-Control": "no-store",
    },
  });
}
