"use client";
// A&M fork: when a public page fails to render, the visitor still gets the site (header and
// footer come from the tenant layout around this boundary), the logo, a plain line, a retry
// and a way home. The error itself is never shown (it may carry internals).
// Classes are copied from @cds/ui/site (HEADING_CLASSES[1], siteButtonClasses) so this client
// boundary never imports the server-side site package.
const BUTTON =
  "inline-flex min-h-12 items-center justify-center rounded-site-button px-6 " +
  "text-[length:var(--site-text-body)] font-semibold leading-tight text-center no-underline";
const PRIMARY = `${BUTTON} bg-site-primary text-site-primary-contrast`;
const SECONDARY = `${BUTTON} border border-site-text bg-transparent text-site-text hover:bg-site-surface-raised`;

export default function TenantError({ reset }: { reset: () => void }) {
  return (
    <main
      id="content"
      tabIndex={-1}
      className="mx-auto flex max-w-[1120px] flex-col items-start gap-6 px-6 py-12 outline-none md:px-8"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/am-barber/logo.png"
        alt="A&M Barber Studio"
        width={647}
        height={472}
        className="h-auto w-[200px]"
      />
      <h1 className="text-[length:var(--site-text-display)] leading-[1.1] font-semibold tracking-[-0.02em]">
        Something went wrong
      </h1>
      <p className="max-w-[720px] text-[length:var(--site-text-body)] leading-[1.6] text-site-text-muted">
        This page didn&apos;t load. Try again, or head back to the homepage.
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={reset} className={SECONDARY}>
          Try again
        </button>
        {/* A full load: the failed render's client state is left behind. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className={PRIMARY}>
          Back to the homepage
        </a>
      </div>
    </main>
  );
}
