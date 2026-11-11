// Marketing not-found (15-13; UI-SPEC "Not found (marketing)"): card ground, "We can't find that
// page.", links home and to /add-ons. Rendered inside the marketing layout; Next sets the 404
// status and noindex. The add-on detail page (15-17) has its own add-on wording.
import { MK_COPY } from "@cds/core/marketing";
import Link from "next/link";

const NF = MK_COPY.NOT_FOUND;

const LINK =
  "inline-flex min-h-11 items-center text-[18px] leading-[1.55] font-bold";

export default function MarketingNotFound() {
  return (
    <section data-mk-field="card">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-24 sm:px-6 lg:px-8">
        <h1 className="max-w-[20ch] font-mk-display text-[clamp(40px,4vw+24px,72px)] leading-[1.05] font-bold [text-wrap:balance]">
          {NF.H1}
        </h1>
        <p className="max-w-[60ch] text-mk-ink-muted">{NF.BODY}</p>
        <ul className="flex flex-wrap gap-x-8 gap-y-2">
          <li>
            <Link href="/" className={LINK}>
              {NF.HOME}
            </Link>
          </li>
          <li>
            <Link href="/add-ons" className={LINK}>
              {NF.ADDONS}
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}
