// Root not-found. A&M fork: a missing admin-area page (/hub, /staff, /sign-in, ...) gets the
// site's sign-in frame (logo, night look) with a link home; the CDS marketing not-found is gone.
//
// Tenant hosts keep their own 404: the middleware rewrites every tenant request to
// /tenant/<host>/…, whose notFound() renders app/tenant/[host]/not-found.tsx. Next still
// renders this root boundary into every response's RSC payload, so on a tenant request
// (TENANT_HOST_HEADER, set only by the middleware) it returns the neutral tenant default
// words instead.
import { TENANT_HOST_HEADER } from "@cds/core";
import { NOT_FOUND_COPY } from "@cds/ui/site";
import { headers } from "next/headers";
import { AmSignInFrame } from "./(platform)/sign-in/AmSignInFrame";

export default async function RootNotFound() {
  if ((await headers()).get(TENANT_HOST_HEADER)) {
    return (
      <main>
        <h1>{NOT_FOUND_COPY.title}</h1>
        <p>{NOT_FOUND_COPY.body}</p>
      </main>
    );
  }
  // A&M fork: no CDS marketing site here; the admin area's missing pages get the site's
  // sign-in frame (logo, night look) and a way home.
  return (
    <AmSignInFrame title="Page not found">
      <p className="mb-6 text-hub-ink-muted">{NOT_FOUND_COPY.body}</p>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="inline-flex min-h-11 w-full items-center justify-center bg-hub-accent px-4 font-semibold no-underline"
      >
        Back to the homepage
      </a>
    </AmSignInFrame>
  );
}
