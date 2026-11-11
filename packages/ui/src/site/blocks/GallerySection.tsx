// GallerySection: the published gallery block (07-22; CONT-22, D228; 07-UI-SPEC row
// "Gallery" line 357, colour rows 173-174/188, a11y line 680, motion lines 692-693,
// breakpoints lines 699-700; replaces the 07-06 stub body, name and SITE_BLOCKS_A entry kept).
//
// Server component. Three displays:
// - Grid: 2-6 columns (2 on phones, at most 4 until 1024px), 8px gap, 4:3 cover crops.
// - Mosaic: rows from justifyGalleryRows at >=768px, every photo `flex-grow: aspect` with
//   its own aspect ratio, so rows scale with the container without client JS; the short
//   last row gets a spacer and is never stretched. Below 768px the rows dissolve
//   (`display: contents`) into one wrapping flex line of 160px-tall photos (decision 3).
// - Slider: every photo through 07-20's SliderController (3:2 contain frame on
//   surface-raised), plus the no-JS stacked view (decision 8).
// Grid and mosaic paginate on the server (`?g<sectionId>=N#gallery-<sectionId>`, D228:
// no infinite scroll). With the lightbox on, each photo is a named <button> and the list is
// wrapped in the Lightbox island (imported by path, decision 10). Every URL comes from
// coreData.media (MediaDelivery); captions and descriptions are React text only. Never an h1 (CONT-35).
import {
  justifyGalleryRows,
  sliceGalleryPage,
  type GalleryContent,
} from "@cds/core/content";
import type { CSSProperties, ReactNode } from "react";
import { Pagination } from "../Pagination";
import { RowRenderer } from "../RowRenderer";
import { Lightbox } from "../client/Lightbox";
import { SliderController } from "../client/SliderController";
import {
  BODY_CLASS,
  HEADING_CLASSES,
  type SectionComponentProps,
} from "../types";
import { SLIDER_NOSCRIPT_CSS } from "./SliderSection";
import {
  galleryPageHref,
  galleryPhotos,
  gallerySizes,
  gridColumnsClass,
  type GalleryPhotoView,
} from "./gallery-view";

const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** No-JS view for the slider display: 07-20's constant CSS, scoped to gallery sliders. */
const GALLERY_SLIDER_NOSCRIPT_CSS = SLIDER_NOSCRIPT_CSS.replaceAll(
  "[data-cds-slider]",
  "[data-gallery-slider] [data-cds-slider]",
);

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus)]";
const PHOTO_BUTTON = `block h-full w-full cursor-zoom-in rounded-site-media ${FOCUS}`;
const CAPTION = `${BODY_CLASS} mt-2 text-site-text-muted`;

type ImgOpts = {
  photo: GalleryPhotoView;
  className: string;
  sizes: string;
  eager: boolean;
  /** Inside a named button the button carries the name. */
  decorative: boolean;
};

function Photo({ photo, className, sizes, eager, decorative }: ImgOpts) {
  return (
    <img
      src={photo.src}
      srcSet={photo.srcSet}
      sizes={photo.srcSet ? sizes : undefined}
      width={photo.width}
      height={photo.height}
      alt={decorative ? "" : photo.alt}
      decoding="async"
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      className={className}
    />
  );
}

export function GallerySection({
  content,
  background,
  isFirst,
  coreData,
  sectionId,
}: SectionComponentProps<GalleryContent>) {
  const photos = galleryPhotos(content, coreData?.media ?? {});
  if (photos.length === 0) return null;

  const rawKey = sectionId ?? content.images?.[0]?.id ?? "";
  const key = KEY_RE.test(rawKey) ? rawKey : "block";
  const heading =
    typeof content.heading === "string" ? content.heading.trim() : "";
  const headingId = heading ? `gallery-heading-${key}` : undefined;
  const display = content.display;
  const lightbox = content.lightbox !== false;
  const captions = content.show_captions === true;
  const total = photos.length;
  const pages = coreData?.galleryPages ?? {};

  const paged =
    display === "slider"
      ? { items: photos, page: 1, pages: 1 }
      : sliceGalleryPage(photos, content.per_page, pages[key]);
  const shown = paged.items;
  const eagerFirst = isFirst && paged.page === 1;

  /** One photo, wrapped in its Lightbox button when the lightbox is on. */
  const frame = (
    photo: GalleryPhotoView,
    pageIndex: number,
    img: (decorative: boolean) => ReactNode,
  ) =>
    lightbox ? (
      <button
        type="button"
        data-gallery-photo=""
        data-index={pageIndex}
        aria-label={`Open photo ${photo.index + 1} of ${total}: ${photo.alt}`}
        className={PHOTO_BUTTON}
      >
        {img(true)}
      </button>
    ) : (
      img(false)
    );

  const caption = (photo: GalleryPhotoView) =>
    captions && photo.caption ? (
      <figcaption className={CAPTION}>{photo.caption}</figcaption>
    ) : null;

  let body: ReactNode;
  if (display === "slider") {
    body = (
      <div data-gallery-slider="">
        <SliderController
          slides={shown.map((photo, i) => ({
            id: photo.id,
            node: (
              <figure>
                <div className="flex aspect-[3/2] items-center justify-center overflow-hidden rounded-site-media bg-site-surface-raised">
                  {frame(photo, i, (decorative) => (
                    <Photo
                      photo={photo}
                      decorative={decorative}
                      eager={eagerFirst && i === 0}
                      sizes="(min-width: 1120px) 1056px, 100vw"
                      className="block h-full w-full object-contain"
                    />
                  ))}
                </div>
                {caption(photo)}
              </figure>
            ),
          }))}
          labelledBy={headingId}
          direction="ltr"
          arrows
          dots
          autoplay={false}
          intervalMs={5000}
          transition="slide"
        />
        {shown.length > 1 ? (
          <noscript>
            <style>{GALLERY_SLIDER_NOSCRIPT_CSS}</style>
          </noscript>
        ) : null}
      </div>
    );
  } else if (display === "mosaic") {
    const rows = justifyGalleryRows(shown);
    body = (
      <div
        data-gallery-mosaic=""
        className="max-md:flex max-md:flex-wrap max-md:gap-2 md:flex md:flex-col md:gap-2"
      >
        {rows.map((row, r) => (
          <div key={r} className="flex gap-2 max-md:contents">
            {row.items.map(({ index, aspect }) => {
              const photo = shown[index];
              const w = photo.width ?? 1;
              const h = photo.height ?? 1;
              const style = {
                flexGrow: aspect,
                "--gallery-aspect": aspect,
                "--gallery-ratio":
                  photo.width && photo.height ? `${w} / ${h}` : "1 / 1",
              } as CSSProperties;
              return (
                <figure
                  key={photo.id}
                  style={style}
                  className="min-w-0 md:basis-0 max-md:basis-[calc(var(--gallery-aspect)*160px)]"
                >
                  <div className="overflow-hidden rounded-site-media max-md:h-40 md:[aspect-ratio:var(--gallery-ratio)]">
                    {frame(photo, index, (decorative) => (
                      <Photo
                        photo={photo}
                        decorative={decorative}
                        eager={eagerFirst && index === 0}
                        sizes="(min-width: 768px) 33vw, 100vw"
                        className="block h-full w-full object-cover"
                      />
                    ))}
                  </div>
                  {caption(photo)}
                </figure>
              );
            })}
            {row.last && row.spacer > 0 ? (
              <div
                aria-hidden="true"
                data-gallery-spacer=""
                style={{ flexGrow: row.spacer }}
                className="basis-0 max-md:hidden"
              />
            ) : null}
          </div>
        ))}
        <div aria-hidden="true" className="grow-[1000] basis-0 md:hidden" />
      </div>
    );
  } else {
    const sizes = gallerySizes(content.columns);
    body = (
      <ul className={`grid gap-2 ${gridColumnsClass(content.columns)}`}>
        {shown.map((photo, i) => (
          <li key={photo.id}>
            <figure>
              {frame(photo, i, (decorative) => (
                <Photo
                  photo={photo}
                  decorative={decorative}
                  eager={eagerFirst && i === 0}
                  sizes={sizes}
                  className="block aspect-[4/3] h-auto w-full rounded-site-media object-cover"
                />
              ))}
              {caption(photo)}
            </figure>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <RowRenderer layout="full" background={background}>
      <div id={`gallery-${key}`} className="scroll-mt-24">
        {heading ? (
          <h2 id={headingId} className={`${HEADING_CLASSES[2]} mb-8`}>
            {heading}
          </h2>
        ) : null}
        {lightbox ? (
          <Lightbox
            total={total}
            photos={shown.map((p) => ({
              src: p.src,
              srcSet: p.srcSet,
              width: p.width,
              height: p.height,
              alt: p.alt,
              caption: p.caption,
              position: p.index + 1,
            }))}
          >
            {body}
          </Lightbox>
        ) : (
          body
        )}
        {display !== "slider" ? (
          <Pagination
            className="mt-8"
            label="Gallery pages"
            current={paged.page}
            total={paged.pages}
            hrefFor={(n) => galleryPageHref(key, n, pages)}
          />
        ) : null}
      </div>
    </RowRenderer>
  );
}
