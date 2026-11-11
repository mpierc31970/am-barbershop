// Owner: 15-09 (P15-P1). MkHeader: the marketing header (UI-SPEC "Header and footer", A3-Q5, HUB-05).
// Card ground, 1px rule bottom border, static. Skip link first (-> #main), wordmark, nav
// Standard · Studio · Add-ons · Pricing · Work, Sign in, primary "Start your site" (-> /start, HUB-02).
// < 1024px: wordmark, the short Start (same accessible name) and the MkMobileMenu island.
// The current section gets aria-current="page" and a 2px underline (cobalt / berry on the path
// pages, ink elsewhere). Labels come from MK_COPY.HEADER.
import { MK_COPY } from "@cds/core/marketing";
import Link from "next/link";
import { MkLinkButton } from "./MkButton";
import { MkMobileMenu } from "./MkMobileMenu";
import { Wordmark } from "./Wordmark";

/** The header section a page belongs to; /add-ons/[slug] passes "add-ons". */
export type MkHeaderSection =
  "standard" | "studio" | "add-ons" | "pricing" | "work";

export type MkHeaderProps = { current: MkHeaderSection | null };

const H = MK_COPY.HEADER;

/** The section a nav href stands for ("/add-ons" -> "add-ons"). */
export function mkSectionOf(href: string): MkHeaderSection | null {
  const s = href.replace(/^\//, "");
  return s === "standard" ||
    s === "studio" ||
    s === "add-ons" ||
    s === "pricing" ||
    s === "work"
    ? s
    : null;
}

/** Underline colour for the current item: the path chip on path pages, ink elsewhere. */
export function mkCurrentDecoration(section: MkHeaderSection): string {
  if (section === "standard") return "decoration-mk-cobalt";
  if (section === "studio") return "decoration-mk-berry";
  return "decoration-mk-ink";
}

export function MkHeader({ current }: MkHeaderProps) {
  return (
    <header data-mk-field="card" className="relative border-b border-mk-rule">
      <a
        href="#main"
        className="sr-only rounded-mk-round bg-mk-ink px-4 py-3 text-[18px] font-bold text-mk-card no-underline focus:not-sr-only focus:absolute focus:top-3 focus:left-4 focus:z-50"
      >
        {H.SKIP}
      </a>
      <div className="mx-auto flex min-h-[72px] max-w-[1440px] items-center gap-4 px-4 sm:px-6 lg:gap-8 lg:px-8">
        <Wordmark tone="ink" />
        <nav aria-label={H.NAV_LABEL} className="hidden lg:block">
          <ul className="flex items-center gap-6">
            {H.NAV.map((item) => {
              const section = mkSectionOf(item.href);
              const isCurrent = section !== null && section === current;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isCurrent ? "page" : undefined}
                    className={[
                      "inline-flex min-h-11 items-center text-[14px] leading-[1.4] font-bold underline-offset-4 xl:text-[18px]",
                      isCurrent
                        ? `underline decoration-2 ${mkCurrentDecoration(section)}`
                        : "no-underline hover:underline hover:decoration-2",
                    ].join(" ")}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2 lg:gap-6">
          <Link
            href="/sign-in"
            className="hidden min-h-11 items-center text-[18px] font-bold lg:inline-flex"
          >
            {H.SIGN_IN}
          </Link>
          {/* Wrapper carries the breakpoint: the button's own inline-flex outranks `hidden` (15-26). */}
          <div className="hidden lg:block">
            <MkLinkButton href="/start" icon="arrow">
              {H.START}
            </MkLinkButton>
          </div>
          <MkLinkButton
            href="/start"
            aria-label={H.START}
            className="lg:hidden"
          >
            {/* 15-28: Lighthouse link-text reads innerText, and a bare "Start" is on its generic
                list. The full label rides along visually hidden; the visible word is unchanged. */}
            <span aria-hidden="true">{H.START_SHORT}</span>
            <span className="sr-only">{H.START}</span>
          </MkLinkButton>
          <div className="lg:hidden">
            <MkMobileMenu current={current} />
          </div>
        </div>
      </div>
    </header>
  );
}
