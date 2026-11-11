// Site button (03-UI-SPEC "Buttons"; CONT-11 markup side, CONT-32; T-03-26).
//
// A link button renders <a href> through the render-time scheme guard; an unsafe or empty
// link renders nothing (donor rule: no text or no link, no button). A pop-up button
// renders <button type="button" aria-haspopup="dialog" data-cds-popup-open="<id>">; the
// pop-up host island (03-09) listens for that attribute. There is no raw HTML anywhere.
// min-height 48px, padding-x 24px, body size at 600, --site-radius-button; primary fill
// mixes toward --site-text on hover (D-UI-P4-8), secondary hovers to surface-raised; the
// focus ring comes from --site-focus in globals.css [data-site].
import { siteHref, text as clean } from "./urls";

export type SiteButtonStyle = "primary" | "secondary";

export interface SiteButtonProps {
  text: string;
  style: SiteButtonStyle;
  href?: string;
  popupId?: string;
}

const POPUP_ID = /^[A-Za-z0-9_-]{1,64}$/;

const BASE =
  "inline-flex min-h-12 items-center justify-center rounded-site-button px-6 " +
  "text-[length:var(--site-text-body)] font-semibold leading-tight text-center " +
  "no-underline transition-colors duration-150 cursor-pointer";

const STYLES: Record<SiteButtonStyle, string> = {
  primary:
    "bg-site-primary text-site-primary-contrast " +
    "hover:bg-[color-mix(in_oklch,var(--site-primary)_88%,var(--site-text))]",
  secondary:
    "border border-site-text bg-transparent text-site-text " +
    "hover:bg-site-surface-raised",
};

export function siteButtonClasses(style: SiteButtonStyle): string {
  return `${BASE} ${STYLES[style] ?? STYLES.primary}`;
}

export function SiteButton({ text, style, href, popupId }: SiteButtonProps) {
  const label = clean(text);
  if (label === "") return null;
  const className = siteButtonClasses(style);

  if (popupId !== undefined) {
    if (!POPUP_ID.test(popupId)) return null;
    return (
      <button
        type="button"
        className={className}
        aria-haspopup="dialog"
        data-cds-popup-open={popupId}
      >
        {label}
      </button>
    );
  }

  const safe = siteHref(href);
  if (safe === "") return null;
  return (
    <a href={safe} className={className}>
      {label}
    </a>
  );
}
