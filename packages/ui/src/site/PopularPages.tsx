// Popular pages (07-31; CONT-28; 07-UI-SPEC lines 537, 642): the top-level links of the live
// menu, shown under SEARCH-NONE and (07-32) on the 404. A plain <ul> of primary links with
// 44px targets; nothing at all when there are no links. Labels and hrefs arrive resolved
// (resolveNav) and render as React text. Server component: no hooks, no next/* imports.
import { BODY_CLASS, HEADING_CLASSES } from "./types";
import { siteHref, text } from "./urls";

export type PopularLink = { label: string; href: string };

export interface PopularPagesProps {
  links: readonly PopularLink[];
  /** Optional heading (the 404 shows "Popular pages"); search shows none. */
  heading?: string;
}

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus)]";

export function PopularPages({ links, heading }: PopularPagesProps) {
  const safe = links
    .map((l) => ({ label: text(l.label), href: siteHref(l.href) }))
    .filter((l): l is { label: string; href: string } =>
      Boolean(l.label && l.href),
    );
  if (safe.length === 0) return null;
  return (
    <div className={`${BODY_CLASS} flex flex-col gap-3`} data-popular-pages="">
      {heading ? <h2 className={HEADING_CLASSES[3]}>{heading}</h2> : null}
      <ul className="flex flex-col gap-1">
        {safe.map((l, i) => (
          <li key={`${l.href}-${i}`}>
            <a
              href={l.href}
              className={`inline-flex min-h-11 items-center text-site-primary underline-offset-4 hover:underline ${FOCUS}`}
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
