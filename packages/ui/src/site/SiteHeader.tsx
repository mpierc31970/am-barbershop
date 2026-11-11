// Site header (CONT-13; D253, D-UI-P7-19, D-UI-P7-28, D-UI-P7-29; 07-25 choices 8, 9, 12;
// UI-SPEC "SiteHeader").
//
// Server component: hook-free, async-free and no next/* imports, so the hub's client
// preview can render it too (07-18/07-19 FormMarkup rule). <header> on surface with a 1px
// bottom border, container 1120px, 80px tall (64px below 1024px), NOT sticky (D-UI-P7-19).
// Logo link to "/" with the org logo (alt = business name), else the wordmark at the h3
// size in the heading face, 600 (never a heading element: the page owns its one H1).
// The menu itself is the NavDisclosure island (disclosure buttons, <details> without JS).
// Search and Translate are slots (choice 9): 07-26 passes searchHref and utilities.
// `layout` forces the phone or computer layout for previews (choice 12).
import type { ResolvedNav } from "@cds/core/content";
import type { ReactNode } from "react";
import { NavDisclosure, type ChromeLayout } from "./client/NavDisclosure";
import { mediaSrc, mediaSrcSet } from "./items/media";
import type { ResolvedMedia } from "./types";
import { text } from "./urls";

export interface SiteHeaderProps {
  brand: { name: string; logo?: ResolvedMedia | null };
  nav: ResolvedNav;
  searchHref?: string | null;
  utilities?: ReactNode;
  layout?: ChromeLayout;
}

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus)]";

function Brand({ name, logo }: SiteHeaderProps["brand"]) {
  const label = text(name);
  const src = logo ? mediaSrc(logo.src) : "";
  const srcSet = logo ? mediaSrcSet(logo.srcSet) : "";
  return (
    <a
      href="/"
      className={`inline-flex min-h-11 shrink-0 items-center text-site-text no-underline ${FOCUS}`}
    >
      {src !== "" ? (
        <img
          src={src}
          {...(srcSet !== "" ? { srcSet, sizes: "240px" } : {})}
          {...(logo?.width ? { width: logo.width } : {})}
          {...(logo?.height ? { height: logo.height } : {})}
          alt={label}
          className="block h-auto max-h-12 w-auto max-w-[240px] object-contain"
        />
      ) : (
        <span className="font-site-heading text-[length:var(--site-text-h3)] leading-[1.3] font-semibold">
          {label}
        </span>
      )}
    </a>
  );
}

export function SiteHeader({
  brand,
  nav,
  searchHref = null,
  utilities,
  layout = "auto",
}: SiteHeaderProps) {
  return (
    <header
      data-site-header=""
      className="border-b border-site-border bg-site-surface text-site-text"
    >
      <div className="mx-auto max-w-[1120px] px-6">
        <NavDisclosure
          brand={<Brand name={brand.name} logo={brand.logo} />}
          entries={nav.entries}
          cta={nav.cta}
          layout={layout}
          searchHref={searchHref}
          utilities={utilities}
        />
      </div>
    </header>
  );
}
