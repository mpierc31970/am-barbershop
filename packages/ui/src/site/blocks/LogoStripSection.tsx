// LogoStripSection: the published logo strip (07-22; CONT-27; 07-UI-SPEC row "Logo strip"
// line 365, colour row 181, sizes line 89; replaces the 07-06 stub body, name and
// SITE_BLOCKS_A entry kept).
//
// Server component. Logos sit in a centered wrapping row (48px gap at >=768px, 32px
// below), each at most 48px tall and 160px wide, `object-fit: contain`; greyscale is a
// filter, not a colour. Each logo's name is its description. Links were safeHref-checked on
// save (07-06); a render-time allowlist drops anything else (T-07-22-03). A logo whose asset
// is missing is skipped (soft-deleted media keeps showing, D275); none left renders
// nothing. Every URL comes from coreData.media (MediaDelivery). Never an h1 (CONT-35).
import type { LogoStripContent } from "@cds/core/content";
import { RowRenderer } from "../RowRenderer";
import { mediaSrc, mediaSrcSet, resolveMedia } from "../items/media";
import { HEADING_CLASSES, type SectionComponentProps } from "../types";

const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;
const UNSAFE = /[\u0000-\u001f\u007f\\<>"']/;
const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus)]";

/** Render-time guard: https, http, same-site path, mailto or tel only; else "". */
export function logoStripSafeLink(value: unknown): string {
  if (typeof value !== "string") return "";
  const s = value.trim();
  if (s === "" || s.length > 2048 || UNSAFE.test(s)) return "";
  if (s.startsWith("/")) return s.startsWith("//") ? "" : s;
  const lower = s.toLowerCase();
  return ["https://", "http://", "mailto:", "tel:"].some((p) =>
    lower.startsWith(p),
  )
    ? s
    : "";
}

export function LogoStripSection({
  content,
  background,
  isFirst,
  coreData,
  sectionId,
}: SectionComponentProps<LogoStripContent>) {
  const media = coreData?.media ?? {};
  const logos = (Array.isArray(content?.logos) ? content.logos : []).flatMap(
    (logo) => {
      if (!logo || typeof logo !== "object") return [];
      const asset = resolveMedia(media, logo.asset, "image");
      const src = asset ? mediaSrc(asset.src) : "";
      if (!asset || src === "") return [];
      const name = typeof logo.name === "string" ? logo.name.trim() : "";
      return [
        {
          id: logo.id,
          src,
          srcSet: mediaSrcSet(asset.srcSet) || undefined,
          width: asset.width,
          height: asset.height,
          name: name || (typeof asset.alt === "string" ? asset.alt : ""),
          link: logoStripSafeLink(logo.link),
        },
      ];
    },
  );
  if (logos.length === 0) return null;

  const heading =
    typeof content.heading === "string" ? content.heading.trim() : "";
  const key = sectionId && KEY_RE.test(sectionId) ? sectionId : logos[0].id;
  const headingId = heading ? `logo-strip-heading-${key}` : undefined;
  const grey = content.grayscale === true ? " grayscale" : "";

  return (
    <RowRenderer layout="full" background={background}>
      {heading ? (
        <h2 id={headingId} className={`${HEADING_CLASSES[2]} mb-8 text-center`}>
          {heading}
        </h2>
      ) : null}
      <ul
        aria-labelledby={headingId}
        data-logo-strip=""
        className="flex flex-wrap items-center justify-center gap-8 md:gap-12"
      >
        {logos.map((logo, i) => {
          const img = (
            <img
              src={logo.src}
              srcSet={logo.srcSet}
              sizes={logo.srcSet ? "160px" : undefined}
              width={logo.width}
              height={logo.height}
              alt={logo.name}
              decoding="async"
              loading={isFirst && i === 0 ? "eager" : "lazy"}
              className={`block h-auto max-h-12 w-auto max-w-[160px] object-contain${grey}`}
            />
          );
          return (
            <li key={logo.id} className="flex items-center">
              {logo.link ? (
                <a
                  href={logo.link}
                  rel="noopener"
                  className={`inline-flex min-h-11 items-center rounded-site-button ${FOCUS}`}
                >
                  {img}
                </a>
              ) : (
                img
              )}
            </li>
          );
        })}
      </ul>
    </RowRenderer>
  );
}
