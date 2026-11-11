// Root not-found (15-28; carry-over from 15-13 and 15-22). An unmatched URL on the platform
// host used to get Next's default 404; it now gets the marketing not-found (MK_COPY.NOT_FOUND)
// in the marketing frame (header, footer, hub marker), with Next's 404 status and noindex.
//
// Tenant hosts keep their own 404: the middleware rewrites every tenant request to
// /tenant/<host>/…, whose notFound() renders app/tenant/[host]/not-found.tsx. Next still
// renders this root boundary into every response's RSC payload, so on a tenant request
// (TENANT_HOST_HEADER, set only by the middleware) it returns the neutral tenant default
// words instead: no CDS marketing chrome ever ships inside a tenant page, and an unknown
// tenant host shows the same plain line as before.
// A catch-all page in (marketing) was tried first and dropped: it made every internal <a href>
// in the app match a page for @next/next/no-html-link-for-pages.
import { TENANT_HOST_HEADER } from "@cds/core";
import { NOT_FOUND_COPY } from "@cds/ui/site";
import { headers } from "next/headers";
import MarketingLayout from "./(platform)/(marketing)/layout";
import MarketingNotFound from "./(platform)/(marketing)/not-found";

export default async function RootNotFound() {
  if ((await headers()).get(TENANT_HOST_HEADER)) {
    return (
      <main>
        <h1>{NOT_FOUND_COPY.title}</h1>
        <p>{NOT_FOUND_COPY.body}</p>
      </main>
    );
  }
  return (
    <MarketingLayout>
      <MarketingNotFound />
    </MarketingLayout>
  );
}
