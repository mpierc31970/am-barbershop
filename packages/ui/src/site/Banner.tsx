// Announcement banner (CONT-11, D117, D123, D-UI-7; RESEARCH Pitfall 9;
// 03-UI-SPEC "Announcement banner").
//
// Site chrome, never a page section (D117, invariant 6). The schedule is evaluated here
// at request time from the raw settings (isBannerVisible(settings, now)), so a cached
// settings record never holds a stale on/off flag and no cron is needed (D123).
// Full-width strip above everything: --site-primary ground, --site-primary-contrast text,
// body size, centered, min-height 44px, padding 8px 24px; the optional link follows the
// message at weight 600, underlined, re-passing the render-time scheme guard. No close
// button (D-UI-7).
import { isBannerVisible, type BannerSettings } from "@cds/core/content";
import { BODY_CLASS } from "./types";
import { siteHref, text } from "./urls";

export interface BannerProps {
  banner: BannerSettings | null;
  now: Date;
}

export function Banner({ banner, now }: BannerProps) {
  if (!banner || !isBannerVisible(banner, now)) return null;
  const message = text(banner.message);
  const linkText = text(banner.link_text);
  const href = siteHref(banner.link_url);

  return (
    <aside
      aria-label="Announcement"
      data-site-banner=""
      className={`flex min-h-11 items-center justify-center bg-site-primary px-6 py-2 text-center text-site-primary-contrast ${BODY_CLASS}`}
    >
      <p className="font-normal">
        {message}
        {linkText && href ? (
          <>
            {" "}
            <a
              href={href}
              className="font-semibold text-site-primary-contrast underline underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-site-primary-contrast"
            >
              {linkText}
            </a>
          </>
        ) : null}
      </p>
    </aside>
  );
}
