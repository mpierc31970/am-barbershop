// The CDS hub site frame (15-13; HUB-05, D104; UI-SPEC "Header and footer"; P15-P3, P15-P12).
// Every marketing route renders inside <div data-mk> with the Anybody + Hanken font variables
// on that same element (15-02: the variables must sit on the data-mk element or an ancestor),
// then MkHeader, <main id="main"> (the skip link's target) and MkFooter. The hub marker
// <meta name="cds-surface" content="hub" /> is hoisted to <head> by React 19; `hub:cutover
// check` and monitor check 1b look for exactly that string.
// The current header section comes from the middleware-set PATH_HEADER (client copies are
// stripped; a forged value only moves aria-current, T-15-13-01). Server-only, no client
// pathname hook. Never imports tenant or owner-hub UI. No ISR export (P15-P3).
import { MkFooter, MkHeader, type MkHeaderSection } from "@cds/ui/marketing";
import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { hubMetadataBase } from "../../../lib/hub-env";
import { PATH_HEADER } from "../../../lib/path-header";
import { anybody, hanken } from "./fonts";

/**
 * 15 CR-A02: the base every hub `og:image` (file-based opengraph-image routes) resolves
 * against. Set here, on the marketing layout only, so tenant pages are unaffected. Per
 * request: CDS_ENV is unset at Docker build.
 */
export function generateMetadata(): Metadata {
  return { metadataBase: hubMetadataBase() };
}

const SECTIONS: readonly MkHeaderSection[] = [
  "standard",
  "studio",
  "add-ons",
  "pricing",
  "work",
];

/** "/add-ons/builder-pro?x" -> "add-ons"; anything outside the five sections -> null. */
function headerSectionFor(
  path: string | null | undefined,
): MkHeaderSection | null {
  if (!path) return null;
  const first = path.split(/[?#]/, 1)[0]?.split("/")[1] ?? "";
  return SECTIONS.find((s) => s === first) ?? null;
}

export default async function MarketingLayout({
  children,
}: {
  children: ReactNode;
}) {
  const current = headerSectionFor((await headers()).get(PATH_HEADER));
  return (
    <div
      data-mk=""
      data-mk-field="card"
      className={`${anybody.variable} ${hanken.variable} flex min-h-screen flex-col font-mk-body text-[18px] leading-[1.55] antialiased`}
    >
      <meta name="cds-surface" content="hub" />
      <MkHeader current={current} />
      <main id="main" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <MkFooter year={new Date().getUTCFullYear()} />
    </div>
  );
}
