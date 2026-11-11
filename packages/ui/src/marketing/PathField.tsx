// Owner: 15-10 (P15-P1). PathField: one path's full-bleed panel (UI-SPEC Home section 2): name, who
// it's for, price line (pathPriceLine; omitted when the catalog failed, never a wrong one),
// included lines (Check 20; unshipped lines carry ComingSoonTag), the Start CTA (the field's
// action pair: white on cobalt / berry) and the About text link. Ramp = the path chip.
import { Check } from "lucide-react";
import {
  MK_COPY,
  MK_PATHS,
  PATH_CHIPS,
  type MkIncludedLine,
  type MkPathKey,
} from "@cds/core/marketing";
import { ChipField } from "./ChipField";
import { ComingSoonTag } from "./ComingSoonTag";
import { MkLinkButton } from "./MkButton";

export type PathFieldProps = {
  path: MkPathKey;
  whoFor: string;
  /** pathPriceLine(): "<build> build, then <monthly> a month", PRICE_SOON, or null (no line). */
  priceLine: string | null;
  included: readonly MkIncludedLine[];
  startHref: string;
  aboutHref: string;
  headingLevel?: 2 | 3;
  className?: string;
};

export function PathField({
  path,
  whoFor,
  priceLine,
  included,
  startHref,
  aboutHref,
  headingLevel = 3,
  className,
}: PathFieldProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <ChipField
      field={PATH_CHIPS[path]}
      as="div"
      className={[
        "flex flex-col gap-6 px-4 py-12 sm:px-6 lg:px-8 lg:py-16",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Heading className="font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]">
        {MK_PATHS[path].name}
      </Heading>
      <p className="max-w-[40ch] text-[18px] leading-[1.55] [text-wrap:pretty]">
        {whoFor}
      </p>
      {priceLine !== null ? (
        <p
          data-mk-path-price=""
          className="mk-figures text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold"
        >
          {priceLine}
        </p>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {included.map((line) => (
          <li
            key={line.text}
            className="flex items-start gap-2 text-[18px] leading-[1.55]"
          >
            <Check
              size={20}
              aria-hidden="true"
              className="mt-[0.2em] shrink-0"
            />
            <span className="flex flex-wrap items-center gap-2">
              {line.text}
              {line.shipped ? null : <ComingSoonTag />}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <MkLinkButton href={startHref} variant="primary" size="md">
          {MK_COPY.PATHS.START[path]}
        </MkLinkButton>
        <MkLinkButton href={aboutHref} variant="text">
          {MK_COPY.PATHS.ABOUT[path]}
        </MkLinkButton>
      </div>
    </ChipField>
  );
}
