// Social links and share URLs (07-24; CONT-27, D198; T-07-24-01).
//
// Share buttons are plain links to each network's share page: no SDK, no script, no
// third-party load until the visitor clicks. Only http(s) page URLs are ever shared; any
// other scheme yields null for every target.
// Pure and Edge-safe: no Node built-ins, no html cleaner, no next/* imports.
import type { SocialShareTarget } from "./social";

export type SocialSharePage = { url: string; title: string };

export const SOCIAL_SHARE_LABELS: Readonly<Record<SocialShareTarget, string>> =
  Object.freeze({
    facebook: "Facebook",
    x: "X",
    linkedin: "LinkedIn",
    pinterest: "Pinterest",
    email: "Email",
    copy: "Copy link",
  });

/** Display names of the business-profile social platforms ("other" names itself by host). */
export const SOCIAL_PLATFORM_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    instagram: "Instagram",
    facebook: "Facebook",
    tiktok: "TikTok",
    youtube: "YouTube",
    linkedin: "LinkedIn",
    x: "X",
    pinterest: "Pinterest",
    threads: "Threads",
    yelp: "Yelp",
    nextdoor: "Nextdoor",
    other: "",
  });

function httpUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/** The share-page URL for one target; null for "copy" or a non-http(s) page URL. */
export function socialShareHref(
  target: SocialShareTarget,
  page: SocialSharePage,
): string | null {
  const u = httpUrl(page?.url);
  if (!u) return null;
  const url = encodeURIComponent(u.href);
  const title = encodeURIComponent(
    typeof page.title === "string" ? page.title : "",
  );
  switch (target) {
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${url}`;
    case "x":
      return `https://x.com/intent/tweet?url=${url}&text=${title}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${url}`;
    case "pinterest":
      return `https://www.pinterest.com/pin/create/button/?url=${url}&description=${title}`;
    case "email":
      return `mailto:?subject=${title}&body=${url}`;
    default:
      return null;
  }
}

/**
 * The platform name shown for a social link: the preset label; for "other" the account's
 * own name (11-35, custom social accounts) or else the host.
 */
export function socialPlatformName(link: {
  platform: string;
  url: string;
  label?: string;
}): string {
  const known = Object.prototype.hasOwnProperty.call(
    SOCIAL_PLATFORM_LABELS,
    link.platform,
  )
    ? SOCIAL_PLATFORM_LABELS[link.platform]!
    : "";
  if (known !== "") return known;
  const own = typeof link.label === "string" ? link.label.trim() : "";
  if (own !== "") return own;
  const u = httpUrl(link.url);
  return u ? u.hostname.replace(/^www\./i, "") : "";
}

/** "Rivera Bakery on Instagram"; without a business name, just "Instagram". */
export function socialLinkLabel(
  name: string,
  link: { platform: string; url: string; label?: string },
): string {
  const platform = socialPlatformName(link);
  const who = typeof name === "string" ? name.trim() : "";
  if (who === "") return platform;
  return platform === "" ? who : `${who} on ${platform}`;
}
