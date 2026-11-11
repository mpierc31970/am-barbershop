// Owner: 15-09 (P15-P1). MkFooter: the ink back cover (UI-SPEC "Header and footer", A3-Q5, D104).
// Wordmark (white) + the pitch line (Heading, leaf rivet); <nav id="footer-nav" aria-label="Footer">
// with the Platform / CDS / Rules columns (Report, Privacy, Terms -> /legal/terms-of-service);
// bottom line "© {year} Connections Design Studios" · Sign in. The year is a prop (the layout
// passes the server clock). This is not the tenant SiteFooter, which stays untouched.
import { MK_COPY, copyrightLine } from "@cds/core/marketing";
import Link from "next/link";
import { RivetMark } from "./RivetMark";
import { Wordmark } from "./Wordmark";

export type MkFooterProps = { year: number };

const F = MK_COPY.FOOTER;

const LINK =
  "inline-flex min-h-11 items-center text-[18px] leading-[1.55] no-underline hover:underline";

export function MkFooter({ year }: MkFooterProps) {
  return (
    <footer data-mk-field="ink">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-12 px-4 py-16 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6">
          <Wordmark tone="white" />
          <p className="flex items-center gap-3 font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]">
            <RivetMark fill="leaf" />
            <span>{F.PITCH}</span>
          </p>
        </div>
        <nav id="footer-nav" aria-label={F.NAV_LABEL}>
          <div className="grid grid-cols-1 gap-12 sm:grid-cols-3">
            {F.COLUMNS.map((col) => (
              <div key={col.title}>
                <h2 className="text-[14px] leading-[1.4] font-bold text-mk-muted">
                  {col.title}
                </h2>
                <ul className="mt-2">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className={LINK}>
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px] leading-[1.4] text-mk-muted">
          <span className="mk-figures">{copyrightLine(year)}</span>
          <span aria-hidden="true">·</span>
          <Link
            href="/sign-in"
            className="inline-flex min-h-11 items-center text-mk-muted"
          >
            {F.SIGN_IN}
          </Link>
        </p>
      </div>
    </footer>
  );
}
