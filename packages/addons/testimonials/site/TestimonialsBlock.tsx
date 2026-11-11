// Testimonials block, site renderer (ADDON-08; D253, D-UI-P5-10..12, D-UI-P5-18; THEME-04;
// invariant 6; 05-UI-SPEC "Site blocks > Testimonials block"). Server component: no hooks,
// no motion, --site-* tokens only. Items arrive from server.ts blockData (featured first,
// filtered, limited); no items renders nothing at all, not even the heading.
import {
  BODY_CLASS,
  HEADING_CLASSES,
  RowRenderer,
  siteImageSrc,
  type AddonSectionProps,
} from "@cds/ui/site";
import { Star } from "lucide-react";
import type { TestimonialView } from "../server";
import type { TestimonialsBlockContent } from "../sections/definition";

const QUOTE_SINGLE =
  "text-[length:var(--site-text-h3)] leading-[1.3] font-normal text-balance";
const QUOTE_GRID = `${BODY_CLASS} font-normal text-pretty`;

/** Grid columns: 2 items stay 2 columns, 3+ go to 3 columns at 1024px (D-UI-P5-12). */
export function gridClasses(count: number): string {
  const cols = count >= 3 ? "md:grid-cols-2 lg:grid-cols-3" : "md:grid-cols-2";
  return `grid grid-cols-1 gap-x-8 gap-y-12 ${cols}`;
}

function Rating({ value }: { value: number }) {
  return (
    <span
      role="img"
      aria-label={`Rated ${value} out of 5`}
      className="flex items-center gap-1"
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          size={20}
          strokeWidth={2}
          className={
            n <= value ? "fill-current text-site-text" : "text-site-text-muted"
          }
        />
      ))}
    </span>
  );
}

function Caption({
  item,
  centered,
}: {
  item: TestimonialView;
  centered: boolean;
}) {
  const src = siteImageSrc(item.photo_url);
  return (
    <figcaption
      className={`flex items-center gap-4 ${centered ? "justify-center text-left" : ""}`}
    >
      {src && item.photo_alt ? (
        <img
          src={src}
          alt={item.photo_alt}
          width={56}
          height={56}
          loading="lazy"
          className="h-14 w-14 shrink-0 rounded-site-media object-cover"
        />
      ) : null}
      <div className="flex flex-col gap-1">
        <span className={`${BODY_CLASS} font-semibold`}>
          {item.author_name}
        </span>
        {item.author_detail ? (
          <span className={`${BODY_CLASS} text-site-text-muted`}>
            {item.author_detail}
          </span>
        ) : null}
        {item.rating !== null ? <Rating value={item.rating} /> : null}
      </div>
    </figcaption>
  );
}

export function TestimonialsBlock({
  content,
  layout,
  background,
  isH1Owner,
  data,
}: AddonSectionProps<TestimonialsBlockContent, TestimonialView[]>) {
  const items = Array.isArray(data) ? data : [];
  if (items.length === 0) return null;
  const heading = typeof content?.heading === "string" ? content.heading : "";
  const Heading = isH1Owner ? "h1" : "h2";
  const single = content?.layout === "single" || items.length === 1;

  return (
    <RowRenderer layout={layout} background={background}>
      <div className="flex flex-col gap-8">
        {heading.trim() !== "" ? (
          <Heading
            className={`${HEADING_CLASSES[isH1Owner ? 1 : 2]} text-balance`}
          >
            {heading}
          </Heading>
        ) : null}
        {single ? (
          <figure className="mx-auto flex max-w-[56ch] flex-col gap-6 text-center">
            <blockquote className={QUOTE_SINGLE}>
              <p>{items[0]!.quote}</p>
            </blockquote>
            <Caption item={items[0]!} centered />
          </figure>
        ) : (
          <div className={gridClasses(items.length)}>
            {items.map((item) => (
              <figure
                key={item.id}
                className="flex flex-col gap-4 border-t border-site-border pt-6"
              >
                <blockquote className={QUOTE_GRID}>
                  <p>{item.quote}</p>
                </blockquote>
                <Caption item={item} centered={false} />
              </figure>
            ))}
          </div>
        )}
      </div>
    </RowRenderer>
  );
}
