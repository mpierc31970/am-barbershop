// Site footer (CONT-13; D249, D253, D-UI-P7-30; 07-25 choices 7, 12, 14, 15; UI-SPEC
// "SiteFooter").
//
// D249: the Report link cannot be removed: no prop, setting or payload hides it. It always
// renders from `reportHref`, visible text "Report", accessible name "Report this site to
// CDS", same tab, theme-muted.
// 09-22 (AGR-08, AGR-09; D217): once published, "Privacy" (/privacy) and "Terms" (/terms) sit
// in the bottom row before Report, with Report's class; hidden until published (policyLinks).
//
// Server component: hook-free, async-free, no next/* imports (the hub preview renders it).
// Band surface-raised, 1px top border, 48px padding-y, container 1120px. Up to three columns
// (business, Hours, Links), each headed by an <h2> at body size 600; hidden parts collapse
// the grid; stacked below 768px. Socials reuse 07-24's BrandIcon / brandForPlatform and core
// socialLinkLabel (choice 15); hours reuse core hoursRows, with consecutive identical days
// grouped here ("Mon–Fri 9:00 am to 5:00 pm"; closed days omitted; choice 14).
import {
  hoursRows,
  REPORT_ARIA_LABEL,
  REPORT_LABEL,
  socialLinkLabel,
  type HoursRow,
  type ResolvedFooter,
} from "@cds/core/content";
import { Globe } from "lucide-react";
import type { ReactNode } from "react";
import type { ChromeLayout } from "./client/NavDisclosure";
import { BrandIcon } from "./icons/BrandIcon";
import { brandForPlatform } from "./icons/brands";
import { mediaSrc, mediaSrcSet } from "./items/media";
import { BODY_CLASS, type ResolvedMedia } from "./types";
import { telHref, text } from "./urls";

export interface SiteFooterProps {
  footer: ResolvedFooter;
  reportHref: string;
  /** 07-14's CookieChoicesLink, only on sites that show a cookie notice. */
  cookieChoices?: ReactNode;
  /** 09-22: which tenant policy pages are published (both hidden when absent). */
  policyLinks?: { privacy: boolean; terms: boolean };
  layout?: ChromeLayout;
  /** A&M fork: a small lock icon to the owner hub sign-in, last in the bottom row. */
  ownerSignInHref?: string;
  /** A&M fork: the header logo, shown above the business name. */
  logo?: (ResolvedMedia & { alt: string }) | null;
}

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus)]";
const COL_HEADING = "text-[length:var(--site-text-body)] font-semibold";
const LINK = `inline-flex min-h-11 items-center text-site-primary underline-offset-4 hover:underline ${FOCUS}`;
const PLAIN_LINK = `inline-flex min-h-11 items-center text-site-text no-underline underline-offset-4 hover:underline ${FOCUS}`;
/** Bottom-row links: Report and the 09-22 policy links share it (44px targets, muted). */
const ROW_LINK = `inline-flex min-h-11 items-center text-site-text-muted underline-offset-4 hover:underline ${FOCUS}`;

/** Fixed date: the footer never marks "today", so SSR and the preview always agree. */
const NO_TODAY = new Date(0);

function shortDay(row: HoursRow): string {
  return row.label.slice(0, 3);
}

/** Consecutive open days with identical hours become one line; closed days are omitted. */
export function groupHoursRows(rows: HoursRow[]): string[] {
  const lines: string[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    if (row.closed) {
      i += 1;
      continue;
    }
    let j = i;
    while (
      j + 1 < rows.length &&
      !rows[j + 1]!.closed &&
      rows[j + 1]!.text === row.text
    ) {
      j += 1;
    }
    const days =
      j === i ? shortDay(row) : `${shortDay(row)}–${shortDay(rows[j]!)}`;
    lines.push(`${days} ${row.text}`);
    i = j + 1;
  }
  return lines;
}

function gridClass(layout: ChromeLayout, cols: number): string {
  if (cols <= 1) return "grid grid-cols-1 gap-6";
  if (layout === "mobile") return "grid grid-cols-1 gap-6";
  if (layout === "desktop") {
    return cols === 2 ? "grid grid-cols-2 gap-8" : "grid grid-cols-3 gap-8";
  }
  return cols === 2
    ? "grid grid-cols-1 gap-6 md:grid-cols-2 lg:gap-8"
    : "grid grid-cols-1 gap-6 md:grid-cols-3 lg:gap-8";
}

export function SiteFooter({
  footer,
  reportHref,
  cookieChoices,
  policyLinks,
  layout = "auto",
  ownerSignInHref,
  logo = null,
}: SiteFooterProps) {
  const name = text(footer.name);
  const logoSrc = logo ? mediaSrc(logo.src) : "";
  const logoSrcSet = logo ? mediaSrcSet(logo.srcSet) : "";
  const phoneHref = telHref(footer.phone);
  const email = text(footer.email);
  const hours = footer.hours
    ? groupHoursRows(
        hoursRows(footer.hours.weekly, footer.hours.timeZone, NO_TODAY),
      )
    : [];
  const hasBusiness =
    name !== "" ||
    footer.addressLines.length > 0 ||
    phoneHref !== "" ||
    email !== "" ||
    footer.socials.length > 0;
  const columns = [
    hasBusiness,
    hours.length > 0,
    footer.links.length > 0,
  ].filter(Boolean).length;

  return (
    <footer
      data-site-footer=""
      className={`border-t border-site-border bg-site-surface-raised py-12 text-site-text ${BODY_CLASS}`}
    >
      <div className="mx-auto max-w-[1120px] px-6 md:px-8">
        {columns > 0 ? (
          <div className={gridClass(layout, columns)}>
            {hasBusiness ? (
              <div className="flex flex-col gap-2">
                {logo && logoSrc !== "" ? (
                  <a href="/" className={`mb-2 inline-flex w-fit ${FOCUS}`}>
                    <img
                      src={logoSrc}
                      {...(logoSrcSet !== ""
                        ? { srcSet: logoSrcSet, sizes: "200px" }
                        : {})}
                      {...(logo.width ? { width: logo.width } : {})}
                      {...(logo.height ? { height: logo.height } : {})}
                      alt={logo.alt}
                      loading="lazy"
                      className="block h-auto max-h-20 w-auto max-w-[200px] object-contain"
                    />
                  </a>
                ) : null}
                {name !== "" ? <h2 className={COL_HEADING}>{name}</h2> : null}
                {footer.addressLines.length > 0 ? (
                  <address className="not-italic">
                    {footer.addressLines.map((line, i) => (
                      <span key={i} className="block">
                        {line}
                      </span>
                    ))}
                  </address>
                ) : null}
                {phoneHref !== "" ? (
                  <a href={phoneHref} className={LINK}>
                    {footer.phone}
                  </a>
                ) : null}
                {email !== "" ? (
                  <a href={`mailto:${email}`} className={LINK}>
                    {email}
                  </a>
                ) : null}
                {footer.socials.length > 0 ? (
                  <ul className="flex flex-wrap gap-2">
                    {footer.socials.map((s, i) => {
                      const brand = brandForPlatform(s.platform);
                      return (
                        <li key={`${s.platform}-${i}`}>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="me noopener noreferrer"
                            aria-label={socialLinkLabel(name, s)}
                            className={`inline-flex size-11 items-center justify-center rounded-site-button text-site-text transition-colors duration-150 hover:text-site-primary ${FOCUS}`}
                          >
                            {brand ? (
                              <BrandIcon id={brand} size={24} />
                            ) : (
                              <Globe
                                size={24}
                                aria-hidden="true"
                                focusable="false"
                              />
                            )}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {hours.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h2 className={COL_HEADING}>Hours</h2>
                <ul>
                  {hours.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {footer.links.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h2 className={COL_HEADING}>Links</h2>
                <ul>
                  {footer.links.map((l) => (
                    <li key={l.id}>
                      <a
                        href={l.href}
                        {...(l.newTab
                          ? { target: "_blank", rel: "noopener noreferrer" }
                          : {})}
                        className={PLAIN_LINK}
                      >
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        <div
          className={`${columns > 0 ? "mt-6 border-t border-site-border pt-4 " : ""}flex flex-wrap items-center gap-x-6 gap-y-2 text-site-text-muted`}
        >
          {footer.copyright !== "" ? <p>{footer.copyright}</p> : null}
          {cookieChoices}
          {policyLinks?.privacy ? (
            <a href="/privacy" className={ROW_LINK}>
              Privacy
            </a>
          ) : null}
          {policyLinks?.terms ? (
            <a href="/terms" className={ROW_LINK}>
              Terms
            </a>
          ) : null}
          <a
            href={reportHref}
            aria-label={REPORT_ARIA_LABEL}
            className={ROW_LINK}
          >
            {REPORT_LABEL}
          </a>
          {ownerSignInHref ? (
            <a
              href={ownerSignInHref}
              rel="nofollow"
              aria-label="Owner sign in"
              title="Owner sign in"
              className={`inline-flex min-h-11 min-w-11 items-center justify-center text-site-text-muted opacity-60 transition-opacity duration-150 hover:text-site-text hover:opacity-100 focus-visible:opacity-100 ${FOCUS}`}
            >
              <svg
                aria-hidden="true"
                focusable="false"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="5" y="11" width="14" height="10" rx="1" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </a>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
