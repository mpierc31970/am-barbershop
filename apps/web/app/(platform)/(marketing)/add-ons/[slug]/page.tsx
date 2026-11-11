// /add-ons/[slug] (15-17; HUB-01, HUB-02, HUB-05; UI-SPEC "Add-ons" detail; A1-Q1, P15-P3, P15-P9;
// T-15-17-01..03). The add-on's ring band (No. NN, H1, tagline, per-path price runs, Add to my
// site or, when not pickable, Ask about it), listing screenshots, the description, Works on, then
// 3 more add-ons.
// - Lookup is catalogEntryFor(public view, slug) (own-value compare, so `__proto__` is just an
//   unknown slug); hidden, private and unknown slugs are the same notFound() (T-15-17-01/02).
// - Screenshots are plain <img width height loading="lazy" decoding="async"> with the listing
//   alt (P15-P9); they sit below the band, so all are lazy. Images open nothing.
// - The description is split on blank lines into <p> text nodes: no HTML, no markdown, never
//   raw HTML injection (T-15-17-03).
// - Dynamic per request, no ISR, no static params export: PocketBase is absent at build (P15-P3).
import { addonChip, MK_COPY, swatchNumberLabel } from "@cds/core/marketing";
import {
  BladeRack,
  ChipField,
  ComingSoonTag,
  MkLinkButton,
  PriceRun,
} from "@cds/ui/marketing";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  catalogEntryFor,
  type CatalogEntry,
} from "../../../../../lib/catalog-view";
import { hubCanonical, hubRobots } from "../../../../../lib/hub-env";
import {
  addonBlades,
  addonPriceLines,
  marketingCatalog,
} from "../../../../../lib/marketing-catalog";

export const dynamic = "force-dynamic";

const C = MK_COPY.ADDONS;

const WRAP = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8";
const BODY = "m-0 text-[18px] leading-[1.55] [text-wrap:pretty]";
const SHOTS_MAX = 6;
const MORE_COUNT = 3;

type Props = { params: Promise<{ slug: string }> };

/** The public entry for a slug, or null (hidden, private, unknown: one 404). */
function publicEntry(
  view: readonly CatalogEntry[],
  slug: unknown,
): CatalogEntry | null {
  const entry = catalogEntryFor(view, slug);
  return entry && !entry.private ? entry : null;
}

/** Plain-text paragraphs: split on blank lines, trimmed, empties dropped. */
function paragraphs(text: string): string[] {
  return text
    .split(/\r?\n[ \t]*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function worksOn(path: CatalogEntry["path"]): {
  text: string;
  dots: ("cobalt" | "berry")[];
} {
  if (path === "both")
    return { text: C.WORKS_ON_BOTH, dots: ["cobalt", "berry"] };
  if (path === "studio") return { text: C.WORKS_ON_STUDIO, dots: ["berry"] };
  return { text: C.WORKS_ON_STANDARD, dots: ["cobalt"] };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug;
  const { view } = await marketingCatalog();
  const entry = publicEntry(view, slug);
  if (!entry) return { robots: { index: false, follow: false } };
  return {
    title: `${entry.name} · CDS add-on`,
    description: entry.tagline,
    robots: hubRobots(),
    alternates: {
      canonical: hubCanonical(`/add-ons/${encodeURIComponent(entry.slug)}`),
    },
  };
}

export default async function AddonDetailPage({ params }: Props) {
  const slug = (await params).slug;
  const { catalog, view } = await marketingCatalog();
  const entry = publicEntry(view, slug);
  if (!entry) notFound();

  const order = view.map((e) => e.slug);
  const { chip, number } = addonChip(entry.slug, order);
  const lines = addonPriceLines(entry, catalog);
  const shots = entry.screenshots.slice(0, SHOTS_MAX);
  const [first, ...rest] = shots;
  const body = paragraphs(entry.description);
  const works = worksOn(entry.path);
  const more = addonBlades(
    view
      .filter((e) => e.slug !== entry.slug && !e.private)
      .slice(0, MORE_COUNT),
    catalog,
    { listingOrder: order },
  );
  const comingSoon = entry.availability !== "available";
  const askHref = `/contact?topic=question&about=${encodeURIComponent(entry.slug)}`;
  const h1Id = "mk-addon-h1";

  return (
    <>
      {/* First viewport: full-bleed band in the add-on's ring chip */}
      <ChipField field={chip} aria-labelledby={h1Id}>
        <div
          className={`${WRAP} flex flex-col items-start gap-6 py-12 lg:py-16`}
        >
          <Link
            href="/add-ons"
            className="inline-flex min-h-11 items-center text-[14px] leading-[1.4] font-bold text-mk-fg underline decoration-1 underline-offset-[0.2em] hover:decoration-2"
          >
            {C.BREADCRUMB}
          </Link>
          <p className="mk-figures m-0 text-[14px] leading-[1.4] font-bold text-mk-fg">
            {swatchNumberLabel(number)}
          </p>
          <h1
            id={h1Id}
            className="m-0 max-w-[20ch] font-mk-display text-[clamp(48px,6vw+16px,96px)] leading-[0.95] font-bold tracking-[-0.02em] [text-wrap:balance]"
          >
            {entry.name}
          </h1>
          <p className={`max-w-[48ch] ${BODY}`}>{entry.tagline}</p>
          <PriceRun lines={lines} size="heading" />
          {entry.pickable ? (
            <MkLinkButton
              href={`/start?addon=${encodeURIComponent(entry.slug)}`}
              variant="primary"
              size="lg"
              icon="arrow"
            >
              {C.ADD}
            </MkLinkButton>
          ) : (
            <div className="flex flex-wrap items-center gap-4">
              {comingSoon ? <ComingSoonTag /> : null}
              <MkLinkButton href={askHref} variant="secondary" size="md">
                {C.ASK}
              </MkLinkButton>
            </div>
          )}
        </div>
      </ChipField>

      {/* Screenshots, description, Works on (card) */}
      <ChipField field="card" as="div">
        <div className={`${WRAP} flex flex-col gap-12 py-16 lg:py-24`}>
          {first ? (
            <div className="flex flex-col gap-4">
              <figure className="m-0 overflow-hidden rounded-mk-blade border border-mk-rule">
                {/* Host-relative /_catalog URL served by the app (13-20, 13-37); P15-P9. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={first.url}
                  alt={first.alt}
                  width={first.w || 1600}
                  height={first.h || 1000}
                  loading="lazy"
                  decoding="async"
                  className="block aspect-[16/10] h-auto w-full object-cover"
                />
              </figure>
              {rest.length > 0 ? (
                <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto lg:overflow-visible">
                  {rest.map((s) => (
                    <figure
                      key={s.id}
                      className="m-0 w-60 shrink-0 snap-start overflow-hidden rounded-mk-blade border border-mk-rule"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.url}
                        alt={s.alt}
                        width={s.w || 1600}
                        height={s.h || 1000}
                        loading="lazy"
                        decoding="async"
                        className="block aspect-[16/10] h-auto w-full object-cover"
                      />
                    </figure>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {body.length > 0 ? (
            <div className="flex max-w-[68ch] flex-col gap-4">
              {body.map((p, i) => (
                <p key={i} className={BODY}>
                  {p}
                </p>
              ))}
            </div>
          ) : null}

          <p className={`flex items-center gap-2 font-bold ${BODY}`}>
            {works.dots.map((d) => (
              <span
                key={d}
                aria-hidden="true"
                data-mk-dot=""
                data-mk-field={d}
                className="inline-block size-3 shrink-0 rounded-mk-round"
              />
            ))}
            {works.text}
          </p>
        </div>
      </ChipField>

      {/* More add-ons (stock) */}
      <ChipField field="stock" as="div">
        <div
          className={`${WRAP} flex flex-col items-start gap-8 py-16 lg:py-24`}
        >
          {more.length > 0 ? (
            <BladeRack blades={more} headingLevel={2} className="w-full" />
          ) : null}
          <Link
            href="/add-ons"
            className="inline-flex min-h-11 items-center text-[18px] leading-[1.55] font-bold text-mk-fg underline decoration-1 underline-offset-[0.2em] hover:decoration-2"
          >
            {C.MORE}
          </Link>
        </div>
      </ChipField>
    </>
  );
}
