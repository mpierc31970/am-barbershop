// Hero block (CONT-03, CONT-04, D31, D-UI-6, D-UI-11; invariants 6 and 7;
// 03-UI-SPEC "Site rendering contract / Hero").
//
// Ported from donor src/components/sections/HeroSection.tsx. The row is always full
// width; the text/image split is part of what a hero is, so the component draws it (only
// when there is an image) instead of borrowing the row layout. Image right at 768px and
// up, stacked above the text on mobile; the donor's column-reverse setting is ignored
// (raw styling, invariant 7). Heading is the page h1 when this block owns it, else h2;
// heading_accent is a flat --site-accent span. The stored small eyebrow line is not
// rendered (D-UI-6). No donor placeholder copy: empty fields render nothing.
// 08-03 (R-3): a media-library photo (image_asset) resolves through the page's own
// coreData.media and wins over image_url; a missing or deleted asset falls back to
// image_url, else the hero is text only. The H1 is balanced (D-UI-P8-9).
import type { HeroContent } from "@cds/core/content";
import { RowRenderer } from "./RowRenderer";
import { SiteButton } from "./SiteButton";
import { BODY_CLASS, HEADING_CLASSES } from "./types";
import { siteImageSrc, text } from "./urls";
import type { SectionComponentProps } from "./types";

export function HeroSection({
  content,
  layout,
  background,
  isH1Owner,
  isFirst,
  coreData,
}: SectionComponentProps<HeroContent>) {
  const c = (content ?? {}) as HeroContent;
  const heading = text(c.heading);
  const accent = text(c.heading_accent);
  const subtitle = text(c.subtitle);
  const trust = text(c.trust_text);
  const asset =
    typeof c.image_asset === "string" && c.image_asset !== ""
      ? coreData?.media?.[c.image_asset]
      : undefined;
  const resolved =
    asset && !asset.deleted && asset.kind === "image" && asset.src
      ? asset
      : undefined;
  const imageUrl = resolved ? resolved.src : siteImageSrc(c.image_url);
  // No alt means decorative (""), never the heading: a screen reader would hear it twice.
  // The editor requires alt whenever an image is set (03-UI-REVIEW Fix 5). Assembled
  // heroes bypass the editor, so a blank stored alt falls back to the media-library
  // description of the resolved asset (WR-C05).
  const imageAlt = text(c.image_alt) || (resolved ? text(resolved.alt) : "");
  const Heading = isH1Owner ? "h1" : "h2";
  const level = isH1Owner ? 1 : 2;

  return (
    <RowRenderer layout={layout} background={background}>
      <div
        className={
          imageUrl ? "grid grid-cols-1 md:grid-cols-2 gap-8 items-center" : ""
        }
      >
        <div className="flex flex-col md:order-first">
          {(heading || accent) && (
            <Heading className={`${HEADING_CLASSES[level]} text-balance`}>
              {heading}
              {heading && accent ? " " : null}
              {accent && <span className="text-site-accent">{accent}</span>}
            </Heading>
          )}
          {subtitle && (
            <p className="mt-6 max-w-[40ch] text-[length:var(--site-text-h3)] font-normal leading-[1.3]">
              {subtitle}
            </p>
          )}
          <div className="mt-8 flex flex-wrap gap-2 empty:hidden">
            <SiteButton
              text={c.cta_primary_text ?? ""}
              style="primary"
              href={c.cta_primary_link}
            />
            <SiteButton
              text={c.cta_secondary_text ?? ""}
              style="secondary"
              href={c.cta_secondary_link}
            />
          </div>
          {trust && (
            <p className={`mt-4 ${BODY_CLASS} text-site-text-muted`}>{trust}</p>
          )}
        </div>
        {imageUrl && (
          <div className="order-first md:order-last">
            <img
              src={imageUrl}
              srcSet={resolved?.srcSet}
              sizes={
                resolved?.srcSet ? "(min-width: 768px) 50vw, 100vw" : undefined
              }
              width={resolved?.width}
              height={resolved?.height}
              alt={imageAlt}
              decoding="async"
              loading={isFirst ? "eager" : "lazy"}
              fetchPriority={isFirst ? "high" : undefined}
              className="block h-auto w-full max-w-full rounded-site-media"
            />
          </div>
        )}
      </div>
    </RowRenderer>
  );
}
