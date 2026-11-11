// Text & image block (CONT-03, CONT-04, CONT-09, D31; invariants 6 and 7;
// 03-UI-SPEC "Text & image / Text / CTA").
//
// Ported from donor src/components/sections/TextImageSection.tsx. The photo/content split
// is the block's own (only when there is an image), photo first; the donor's column
// reverse setting is ignored (invariant 7). Rich text is sanitized on the render path
// into .site-prose (T-03-25). Alt falls back to the heading, never a hard-coded name.
import { sanitizeRichText } from "@cds/core/content/sanitize";
import type { TextImageContent } from "@cds/core/content";
import { RowRenderer } from "./RowRenderer";
import { SiteButton } from "./SiteButton";
import { BODY_CLASS, HEADING_CLASSES } from "./types";
import { siteImageSrc, telHref, text } from "./urls";
import type { SectionComponentProps } from "./types";

export function TextImageSection({
  content,
  layout,
  background,
  isH1Owner,
  isFirst,
}: SectionComponentProps<TextImageContent>) {
  const c = (content ?? {}) as TextImageContent;
  const heading = text(c.heading);
  const body = sanitizeRichText(c.text);
  const imageUrl = siteImageSrc(c.image_url);
  const imageAlt = text(c.image_alt) || heading;
  const quote = text(c.quote);
  const listItems = Array.isArray(c.list_items)
    ? c.list_items.map(text).filter((s) => s !== "")
    : [];
  const phone = text(c.phone);
  const phoneHref = telHref(phone);
  const Heading = isH1Owner ? "h1" : "h2";

  return (
    <RowRenderer layout={layout} background={background}>
      <div
        className={
          imageUrl ? "grid grid-cols-1 md:grid-cols-2 gap-8 items-center" : ""
        }
      >
        {imageUrl && (
          <div className="order-2 md:order-1">
            <img
              src={imageUrl}
              alt={imageAlt}
              decoding="async"
              loading={isFirst ? "eager" : "lazy"}
              fetchPriority={isFirst ? "high" : undefined}
              className="block h-auto w-full max-w-full rounded-site-media"
            />
          </div>
        )}
        <div className="order-1 flex flex-col gap-6 md:order-2">
          {heading && (
            <Heading className={HEADING_CLASSES[isH1Owner ? 1 : 2]}>
              {heading}
            </Heading>
          )}
          {body.trim() !== "" && (
            <div
              className="site-prose"
              dangerouslySetInnerHTML={{ __html: body }}
            />
          )}
          {quote && (
            <blockquote
              className={`${BODY_CLASS} max-w-[58ch] border-l-2 border-site-border pl-5 italic`}
            >
              {quote}
            </blockquote>
          )}
          {listItems.length > 0 && (
            <ul
              className={`${BODY_CLASS} max-w-[58ch] list-disc space-y-2 pl-6`}
            >
              {listItems.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-4 empty:hidden">
            <SiteButton
              text={c.cta_text ?? ""}
              style="primary"
              href={c.cta_link}
            />
            {phone && phoneHref && (
              <a
                href={phoneHref}
                className={`${BODY_CLASS} text-site-text-muted underline underline-offset-[0.15em] hover:text-site-text`}
              >
                or call {phone}
              </a>
            )}
          </div>
        </div>
      </div>
    </RowRenderer>
  );
}
