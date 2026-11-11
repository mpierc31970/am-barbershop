// Owner: 15-10 (P15-P1). Blade: one swatch blade (UI-SPEC "BladeDeck contents", "Add-ons", label-grid
// raise: chip -> number -> name -> tagline -> price run, in that order, everywhere).
//   fan / row : the deck's blade. Markup only; BladeDeck's stylesheet lays it out as a fan blade
//               (desktop fine pointer) or a closed-deck row (phones, coarse pointers, < 5 blades).
//   upright   : the /add-ons rack blade (Tailwind; a row blade below 640px), with its Add button
//               above the stretched link as its own focus stop.
// Props only, no fetching: pages build BladeData from the catalog (15-13 reader). Names and
// taglines are plain React text nodes (T-15-10-01). Coming-soon blades are never links.
import Link from "next/link";
import type { CSSProperties } from "react";
import type { MkAddonChip } from "@cds/core/marketing";
import { MK_COPY } from "@cds/core/marketing";
import { ComingSoonTag } from "./ComingSoonTag";
import { MkLinkButton } from "./MkButton";
import { PriceRun } from "./PriceRun";
import { RivetMark } from "./RivetMark";

/** A blade's chip: a path colour, an add-on ring colour, or an outline (Shop: not yet dyed). */
export type BladeChip = "cobalt" | "berry" | MkAddonChip | "outline";

export type BladeData = {
  /** Path key or add-on slug. */
  key: string;
  name: string;
  /** Display swatch number, e.g. "No. 04" (swatchNumberLabel). Empty string hides it. */
  number: string;
  chip: BladeChip;
  /** Detail page; null for coming-soon blades (never a link). */
  href: string | null;
  /** Pre-formatted price lines from the shared label helpers; [] when the catalog failed. */
  priceLines: string[];
  status: "available" | "coming_soon";
  tagline?: string;
  /** Rack Add button target; undefined = /start?addon=<key>, null = no button. */
  addHref?: string | null;
};

export type BladeOrientation = "fan" | "upright" | "row";

export type BladeProps = {
  data: BladeData;
  orientation: BladeOrientation;
  /** Rack blade name heading level (upright only). */
  headingLevel?: 2 | 3;
};

/** "<Name>, <price run as text>": the blade link's accessible name. */
export function bladeLinkName(data: BladeData): string {
  return [data.name, ...data.priceLines].join(", ");
}

const RING_VAR: Record<BladeChip, string> = {
  cobalt: "var(--mk-cobalt)",
  berry: "var(--mk-berry)",
  marigold: "var(--mk-marigold)",
  violet: "var(--mk-violet)",
  teal: "var(--mk-teal)",
  rose: "var(--mk-rose)",
  sky: "var(--mk-sky)",
  outline: "var(--mk-ink)",
};

/** Coming soon (or Shop's outline chip): a 2px outline in the ring colour on card. */
function isOutline(data: BladeData): boolean {
  return data.chip === "outline" || data.status === "coming_soon";
}

function chipProps(data: BladeData): {
  "data-mk-field"?: string;
  "data-mk-chip-outline"?: string;
  style?: CSSProperties;
} {
  if (isOutline(data)) {
    return {
      "data-mk-chip-outline": "",
      style: { borderColor: RING_VAR[data.chip], color: "var(--mk-ink)" },
    };
  }
  return { "data-mk-field": data.chip };
}

const NUMBER =
  "font-mk-display text-[14px] leading-[1.4] font-bold [font-stretch:75%]";
const DECK_NAME =
  "font-mk-display text-[18px] leading-[1.2] font-bold [font-stretch:75%]";

/** Fan / row blade (inside a BladeDeck <li>). */
function DeckBlade({ data }: { data: BladeData }) {
  const soon = data.status === "coming_soon" || data.href === null;
  const body = (
    <>
      <span data-mk-chip="" {...chipProps(data)}>
        <RivetMark />
      </span>
      <span data-mk-body="">
        {data.number ? (
          <span data-mk-num="" className={NUMBER}>
            {data.number}
          </span>
        ) : null}
        <span data-mk-name="" className={DECK_NAME}>
          {data.name}
        </span>
        <PriceRun lines={data.priceLines} />
        {soon ? <ComingSoonTag className="self-start" /> : null}
      </span>
    </>
  );
  if (soon) {
    return (
      <div data-mk-blade="" data-mk-blade-box="">
        {body}
      </div>
    );
  }
  return (
    <Link
      href={data.href!}
      aria-label={bladeLinkName(data)}
      data-mk-blade=""
      data-mk-blade-box=""
    >
      {body}
    </Link>
  );
}

/**
 * The blade is a white card: text drawn in the field vars (Coming soon tag, the secondary Add
 * button) must read ink whatever field the rack sits on (CR-C01). --mk-focus stays the field's.
 */
const CARD_SCOPE = {
  "--mk-fg": "var(--mk-ink)",
  "--mk-muted": "var(--mk-ink-muted)",
} as CSSProperties;

/** /add-ons rack blade: upright >= 640px, a row blade below. */
function UprightBlade({
  data,
  headingLevel = 3,
}: {
  data: BladeData;
  headingLevel?: 2 | 3;
}) {
  const soon = data.status === "coming_soon" || data.href === null;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const addHref = soon
    ? null
    : data.addHref === undefined
      ? `/start?addon=${encodeURIComponent(data.key)}`
      : data.addHref;
  const outline = isOutline(data);
  return (
    <div
      data-mk-blade=""
      style={CARD_SCOPE}
      className="relative flex h-full overflow-hidden rounded-mk-blade bg-mk-card text-mk-ink shadow-mk-rest sm:min-h-[400px] sm:flex-col"
    >
      <div
        {...chipProps(data)}
        className={[
          "flex w-16 shrink-0 flex-col items-start justify-between p-2 sm:h-40 sm:w-auto sm:p-4",
          outline
            ? "rounded-l-mk-blade border-2 sm:rounded-t-mk-blade sm:rounded-bl-none"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {data.number ? <span className={NUMBER}>{data.number}</span> : null}
        <RivetMark className="hidden sm:inline-block" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <Heading className="font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance] max-sm:text-[18px] max-sm:[font-stretch:75%]">
          {soon ? (
            data.name
          ) : (
            <Link
              href={data.href!}
              aria-label={bladeLinkName(data)}
              className="no-underline after:absolute after:inset-0 after:rounded-mk-blade hover:underline"
            >
              {data.name}
            </Link>
          )}
        </Heading>
        {data.tagline ? (
          <p className="line-clamp-3 hidden text-[18px] leading-[1.55] text-mk-ink-muted sm:block">
            {data.tagline}
          </p>
        ) : null}
        <PriceRun lines={data.priceLines} />
        {soon ? <ComingSoonTag className="self-start" /> : null}
        {addHref ? (
          <div className="relative z-10 mt-auto pt-2">
            <MkLinkButton
              href={addHref}
              variant="secondary"
              size="md"
              aria-label={`${MK_COPY.ADDONS.ADD}: ${data.name}`}
            >
              {MK_COPY.ADDONS.ADD}
            </MkLinkButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Blade({ data, orientation, headingLevel }: BladeProps) {
  if (orientation === "upright") {
    return <UprightBlade data={data} headingLevel={headingLevel} />;
  }
  return <DeckBlade data={data} />;
}
