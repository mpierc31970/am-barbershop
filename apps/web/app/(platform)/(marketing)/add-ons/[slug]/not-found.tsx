// Add-on not-found (15-17; UI-SPEC "Add-ons" detail "Not found"): rendered for notFound() from
// /add-ons/[slug] (hidden, private or unknown slug; one wording for all, T-15-17-01). Card ground,
// "We can't find that add-on.", link back to every add-on. Next sets the 404 status and noindex.
import { MK_COPY } from "@cds/core/marketing";
import Link from "next/link";

const NF = MK_COPY.NOT_FOUND;

export default function AddonNotFound() {
  return (
    <section data-mk-field="card">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-24 sm:px-6 lg:px-8">
        <h1 className="max-w-[20ch] font-mk-display text-[clamp(40px,4vw+24px,72px)] leading-[1.05] font-bold [text-wrap:balance]">
          {NF.ADDON_H1}
        </h1>
        <p className="max-w-[60ch] text-mk-ink-muted">{NF.ADDON_BODY}</p>
        <Link
          href="/add-ons"
          className="inline-flex min-h-11 items-center self-start text-[18px] leading-[1.55] font-bold"
        >
          {NF.ADDONS}
        </Link>
      </div>
    </section>
  );
}
