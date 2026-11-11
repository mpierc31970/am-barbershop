// /add-ons (15-17; HUB-01, HUB-02, HUB-05; UI-SPEC "Add-ons"; A1-Q1, P15-P3): the shoppable rack
// of the public catalog view in listing order.
// - Filter: server link tabs All · Standard · Studio (?path=standard|studio); anything else
//   (unknown, repeated, prototype keys) reads as All. aria-current="page" on the active tab.
// - Rack: addonBlades(view, catalog, { path }). Price runs come only from the shared label
//   helpers (D264); under All an off-path add-on reads "<Path> · Not on this path". Add to my
//   site -> /start?addon=<slug> only on pickable entries; coming soon shows the tag, no Add.
// - Catalog failure: the reader's manifest-only fallback (all coming soon, nothing pickable),
//   so no Add buttons and never an empty page.
// - Dynamic per request, no ISR, no static params (P15-P3).
import { MK_COPY, type MkPathKey } from "@cds/core/marketing";
import { BladeRack, ChipField, MkLinkButton } from "@cds/ui/marketing";
import type { Metadata } from "next";
import Link from "next/link";
import { hubCanonical, hubRobots } from "../../../../lib/hub-env";
import {
  addonBlades,
  marketingCatalog,
} from "../../../../lib/marketing-catalog";

export const dynamic = "force-dynamic";

const C = MK_COPY.ADDONS;

const WRAP = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8";
const H2 =
  "m-0 font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]";
const BODY = "m-0 text-[18px] leading-[1.55] [text-wrap:pretty]";

/** Underline colour per tab: the path chip, ink for All. */
const TAB_DECORATION: Record<"all" | MkPathKey, string> = {
  all: "decoration-mk-ink",
  standard: "decoration-mk-cobalt",
  studio: "decoration-mk-berry",
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** `?path=` as a hub path, or null (All) for anything else. */
function filterPath(raw: unknown): MkPathKey | null {
  return raw === "standard" || raw === "studio" ? raw : null;
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: MK_COPY.SEO.ADDONS_TITLE,
    description: C.LEAD,
    robots: hubRobots(),
    alternates: { canonical: hubCanonical("/add-ons") },
  };
}

export default async function AddonsPage({ searchParams }: Props) {
  const path = filterPath((await searchParams).path);
  const { catalog, view } = await marketingCatalog();
  const blades = addonBlades(view, catalog, path ? { path } : {});

  return (
    <>
      {/* First viewport + filter + rack (card) */}
      <ChipField field="card" aria-labelledby="mk-addons-h1">
        <div className={`${WRAP} flex flex-col gap-8 py-12 lg:py-16`}>
          <div className="flex flex-col gap-6">
            <h1
              id="mk-addons-h1"
              className="m-0 font-mk-display text-[clamp(48px,6vw+16px,96px)] leading-[0.95] font-bold tracking-[-0.02em] [text-wrap:balance]"
            >
              {C.H1}
            </h1>
            <p className={`max-w-[60ch] ${BODY}`}>{C.LEAD}</p>
          </div>
          <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0">
            {C.FILTER.map((tab) => {
              const active = tab.path === path;
              const href = tab.path ? `/add-ons?path=${tab.path}` : "/add-ons";
              return (
                <li key={tab.label}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "inline-flex min-h-11 items-center text-[18px] leading-[1.55] font-bold text-mk-fg underline-offset-[0.3em]",
                      active
                        ? `underline decoration-[3px] ${TAB_DECORATION[tab.path ?? "all"]}`
                        : "no-underline hover:underline hover:decoration-1",
                    ].join(" ")}
                  >
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </ChipField>

      <ChipField field="stock" as="div">
        <div className={`${WRAP} py-12 lg:py-16`}>
          {blades.length > 0 ? (
            <BladeRack blades={blades} headingLevel={2} aria-label={C.H1} />
          ) : (
            <div className="flex flex-col items-start gap-6">
              <h2 className={H2}>{C.EMPTY_H2}</h2>
              <p className={`max-w-[60ch] ${BODY}`}>{C.EMPTY_BODY}</p>
              <MkLinkButton
                href="/start"
                variant="primary"
                size="lg"
                icon="arrow"
              >
                {C.START}
              </MkLinkButton>
            </div>
          )}
        </div>
      </ChipField>

      {/* Closing CTA (ink) */}
      <ChipField field="ink" aria-labelledby="mk-addons-close">
        <div
          className={`${WRAP} flex flex-col items-start gap-8 py-16 lg:py-24`}
        >
          <h2 id="mk-addons-close" className={H2}>
            {C.CLOSING_H2}
          </h2>
          <div className="flex w-full flex-col items-stretch gap-4 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <MkLinkButton
              href="/start"
              variant="primary"
              size="lg"
              icon="arrow"
            >
              {C.START}
            </MkLinkButton>
            <MkLinkButton
              href="/contact?topic=question"
              variant="secondary"
              size="md"
            >
              {C.ASK_QUESTION}
            </MkLinkButton>
          </div>
        </div>
      </ChipField>
    </>
  );
}
