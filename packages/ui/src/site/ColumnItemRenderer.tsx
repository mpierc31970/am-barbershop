// One primitive inside a column (CONT-09, CONT-10, CONT-11 markup; D122, D188;
// 03-UI-SPEC "Image item", "List item", "Spacer", "Divider", "Countdown item", "Buttons").
//
// Ported from donor src/components/sections/ColumnItemRenderer.tsx with three swaps:
// - Rich text is sanitized HERE, on the render path, and emitted as server HTML inside
//   .site-prose (defence in depth on top of save/publish; T-03-25). The donor's client
//   RichTextBody rendered nothing on the server behind a mounted gate; not ported.
// - The Next image component becomes a plain <img> (RESEARCH Anti-Patterns): tenant media is remote
//   and unsized, and this package never imports next/*.
// - The donor's hard-coded person-name alt fallback is gone: alt is the item's own alt,
//   else the column's first heading, else "" (decorative).
// Buttons can open a pop-up (aria-haspopup="dialog"); links and image sources re-pass a
// tolerant scheme guard (T-03-26). Unknown kinds render nothing and never throw.
// P7 kinds (07-08) dispatch to ./items/*: video, audio and embed (07-23) and form (07-19).
// An image item with a library `asset` renders from the page's media map (own-property
// lookup via resolveMedia, src guarded by mediaSrc).
import { sanitizeRichText } from "@cds/core/content/sanitize";
import type { ColumnItem } from "@cds/core/content";
import { Countdown } from "./Countdown";
import { AudioItem } from "./items/AudioItem";
import { EmbedItem } from "./items/EmbedItem";
import { FormItem } from "./items/FormItem";
import { mediaSrc, mediaSrcSet, resolveMedia } from "./items/media";
import { VideoItem } from "./items/VideoItem";
import { SiteButton } from "./SiteButton";
import {
  BODY_CLASS,
  HEADING_CLASSES,
  type HeadingLevel,
  type ResolvedMedia,
} from "./types";
import { siteImageSrc, text as clean } from "./urls";

export interface ColumnItemRendererProps {
  item: ColumnItem;
  /** Promote this heading item (the block owns the page h1, or a caller forces a level). */
  headingLevelOverride?: HeadingLevel;
  /** Load this image eagerly with high fetch priority (first block's first image). */
  eagerImage?: boolean;
  /** Alt fallback: the column's first heading. */
  fallbackAlt?: string;
  /** DOM id for a heading item (a pop-up dialog is labelled by its first heading). */
  headingId?: string;
  now: Date;
  /**
   * Pop-ups that can open on this page. A button for any other pop-up (disabled,
   * deleted, or not shown on this page) renders nothing: it would be a dead button
   * announced as opening a dialog (WR-C07). Omitted = no filtering.
   */
  openablePopups?: ReadonlySet<string>;
  /**
   * Assets resolved for this page, keyed by asset id. 07-08's image `asset` / video /
   * audio cases read it by id with an own-property lookup.
   */
  media?: Readonly<Record<string, ResolvedMedia>>;
  /** Public form projections keyed by form id, filled by 07-19's loader. */
  forms?: Readonly<Record<string, unknown>>;
  /** `sizes` for a library image (columnImageSizes for a column of a row layout). */
  imageSizes?: string;
}

/**
 * The image `sizes` hint for column `index` of a row layout ("40-60" -> 40% of the
 * 1056px content box from 768px up, full width below). Unknown -> full width.
 */
export function columnImageSizes(layout: string, index: number): string {
  const pct = Number(String(layout).split("-")[index]);
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
    return "(min-width: 1120px) 1056px, 100vw";
  }
  return `(min-width: 1120px) ${Math.ceil(10.56 * pct)}px, (min-width: 768px) ${pct}vw, 100vw`;
}

const SPACER: Record<string, string> = {
  sm: "h-6",
  md: "h-12",
  lg: "h-16",
};

const STOCK_SITES = Object.freeze({
  unsplash: {
    label: "Unsplash",
    home: "https://unsplash.com/?utm_source=cds_platform&utm_medium=referral",
    hosts: ["unsplash.com", "www.unsplash.com"],
  },
  pexels: {
    label: "Pexels",
    home: "https://www.pexels.com/?utm_source=cds_platform&utm_medium=referral",
    hosts: ["pexels.com", "www.pexels.com"],
  },
});

/** A stored stock credit re-checked at render (host must be the source's own site). */
function stockCredit(
  raw: unknown,
): { name: string; url: string; label: string; home: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { name, url, source } = raw as {
    name?: unknown;
    url?: unknown;
    source?: unknown;
  };
  if (source !== "unsplash" && source !== "pexels") return null;
  if (typeof name !== "string" || name.trim() === "") return null;
  const site = STOCK_SITES[source];
  try {
    const u = new URL(String(url));
    if (u.protocol !== "https:" || !site.hosts.includes(u.hostname))
      return null;
    return {
      name: name.trim(),
      url: u.href,
      label: site.label,
      home: site.home,
    };
  } catch {
    return null;
  }
}

export function ColumnItemRenderer({
  item,
  headingLevelOverride,
  eagerImage = false,
  fallbackAlt,
  headingId,
  now,
  openablePopups,
  media,
  forms,
  imageSizes = "(min-width: 768px) 50vw, 100vw",
}: ColumnItemRendererProps) {
  switch (item.kind) {
    case "heading": {
      const value = clean(item.text);
      if (value === "") return null;
      const level: HeadingLevel =
        headingLevelOverride ?? (item.level === 3 ? 3 : 2);
      const Tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      return (
        <Tag id={headingId} className={HEADING_CLASSES[level]}>
          {value}
        </Tag>
      );
    }

    case "text": {
      const safe = sanitizeRichText(item.html);
      if (safe.trim() === "") return null;
      return (
        <div
          className="site-prose"
          dangerouslySetInnerHTML={{ __html: safe }}
        />
      );
    }

    case "list": {
      const entries = Array.isArray(item.items)
        ? item.items.map(clean).filter((e) => e !== "")
        : [];
      if (entries.length === 0) return null;
      return (
        <ul className={`${BODY_CLASS} list-disc space-y-2 pl-6`}>
          {entries.map((entry, i) => (
            <li key={i}>{entry}</li>
          ))}
        </ul>
      );
    }

    case "image": {
      const asset = resolveMedia(media, item.asset, "image");
      const assetSrc = asset ? mediaSrc(asset.src) : "";
      if (asset && assetSrc !== "") {
        const srcSet = mediaSrcSet(asset.srcSet);
        return (
          <img
            src={assetSrc}
            srcSet={srcSet || undefined}
            sizes={srcSet ? imageSizes : undefined}
            width={asset.width}
            height={asset.height}
            alt={clean(item.alt) || clean(asset.alt) || clean(fallbackAlt)}
            decoding="async"
            loading={eagerImage ? "eager" : "lazy"}
            fetchPriority={eagerImage ? "high" : undefined}
            className="block h-auto max-w-full rounded-site-media"
          />
        );
      }
      const src = siteImageSrc(item.url);
      if (src === "") return null;
      const img = (
        <img
          src={src}
          alt={clean(item.alt) || clean(fallbackAlt)}
          decoding="async"
          loading={eagerImage ? "eager" : "lazy"}
          fetchPriority={eagerImage ? "high" : undefined}
          className="block h-auto max-w-full rounded-site-media"
        />
      );
      const credit = stockCredit(item.credit);
      if (!credit) return img;
      // 07-30 (CONT-28, UI-SPEC row 347): "Photo by <name> on Unsplash|Pexels", both linked.
      return (
        <figure>
          {img}
          <figcaption className="mt-2 text-sm text-site-text-muted">
            Photo by{" "}
            <a href={credit.url} rel="noopener" className="underline">
              {credit.name}
            </a>{" "}
            on{" "}
            <a href={credit.home} rel="noopener" className="underline">
              {credit.label}
            </a>
          </figcaption>
        </figure>
      );
    }

    case "button":
      if (
        item.action === "popup" &&
        openablePopups !== undefined &&
        !openablePopups.has(item.popup_id)
      ) {
        return null;
      }
      return (
        <div>
          {item.action === "popup" ? (
            <SiteButton
              text={item.text}
              style={item.style}
              popupId={item.popup_id}
            />
          ) : (
            <SiteButton text={item.text} style={item.style} href={item.link} />
          )}
        </div>
      );

    case "spacer":
      return (
        <div className={SPACER[item.height] ?? SPACER.md} aria-hidden="true" />
      );

    case "divider":
      return <hr className="my-6 border-0 border-t border-site-border" />;

    case "countdown":
      return (
        <Countdown
          targetIso={item.target_at}
          zeroMessage={item.zero_message}
          now={now}
        />
      );

    case "video":
      return <VideoItem item={item} media={media} now={now} />;

    case "audio":
      return <AudioItem item={item} media={media} now={now} />;

    case "embed":
      return <EmbedItem item={item} media={media} now={now} />;

    case "form":
      return <FormItem item={item} media={media} forms={forms} now={now} />;

    default:
      return null;
  }
}
