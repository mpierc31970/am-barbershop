"use client";
// Click-to-load frame island (CONT-34, D279; 07-UI-SPEC "Consent"; D-UI-P7-17; RESEARCH
// Pitfalls 7 and 14; 07-14 choices 1, 2, 8).
//
// Props are plain data only: { provider, id } or a map query, copy and a cover from our own
// store. The frame URL is built here, in the browser, by consentFrameUrl and only after a
// click on this placeholder, an "Accept all" choice, or a stored `cds_consent=all`.
// - First render equals the server markup: the action is a plain link to the provider page
//   (no-JS fallback, opens in a new tab, makes no request until clicked). After mount the
//   same box renders a <button>, so nothing shifts.
// - A click loads this frame only, for this page view, and moves focus into it. Accept all
//   loads every frame without moving focus.
// - Inside a pop-up, `cds:popup-close` remounts a loaded iframe, which stops playback.
// - Focus ring: the global [data-site] :focus-visible rule (--site-focus).
// - The box has its final size from the server (aspect ratio or provider height): no CLS.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AudioLines, CalendarDays, MapPin, Play } from "lucide-react";
import {
  FRAME_ALLOW,
  consentFrameUrl,
  type ConsentFrameKind,
  type ConsentFrameSource,
} from "@cds/core/content";
import { BrandIcon } from "../icons/BrandIcon";
import { brandForProvider } from "../icons/brands";
import { siteButtonClasses } from "../SiteButton";
import { BODY_CLASS } from "../types";
import { CONSENT_EVENT, choiceOf, storedConsent } from "./consent-state";
import { MEDIA_STOP_EVENT } from "./popup-media";

export type ConsentFrameAspect = "16:9" | "9:16" | "1:1";

export interface ConsentFrameIslandProps {
  source: ConsentFrameSource;
  kind: ConsentFrameKind;
  /** Item title (iframe title, accessible names). */
  title: string;
  providerLabel: string;
  /** Provider page (or Google Maps place page): the no-JS link. Never a frame URL. */
  fallbackHref: string;
  /** "Plays from YouTube, which may set cookies." */
  line: string;
  /** Our stored cover (video only). */
  cover?: { src: string; alt: string };
  /** Map: the address shown on the placeholder. */
  address?: string;
  aspect?: ConsentFrameAspect;
  /** Audio and booking: provider frame height in px. */
  height?: number;
}

/** Fired on a pop-up's <dialog> when it closes (popup-media.ts POPUP_CLOSE_EVENT). */
const POPUP_CLOSE = "cds:popup-close";

const ASPECT: Readonly<Record<ConsentFrameAspect, string>> = {
  "16:9": "16 / 9",
  "9:16": "9 / 16",
  "1:1": "1 / 1",
};

const PLAY =
  "inline-flex size-16 items-center justify-center rounded-full bg-site-primary " +
  "text-site-primary-contrast cursor-pointer shadow-site-overlay " +
  "hover:bg-[color-mix(in_oklch,var(--site-primary)_88%,var(--site-text))]";

const BOX =
  "relative w-full overflow-hidden rounded-site-media border border-site-border " +
  "bg-site-surface-raised";

const ICON_PROPS = { size: 24, strokeWidth: 2, "aria-hidden": true } as const;

function actionText(kind: ConsentFrameKind, providerLabel: string): string {
  switch (kind) {
    case "audio":
      return `Play from ${providerLabel}`;
    case "booking":
      return "Show booking calendar";
    case "map":
      return "Show map";
    default:
      return "Play video";
  }
}

function linkLabel(
  kind: ConsentFrameKind,
  title: string,
  providerLabel: string,
): string {
  const lead =
    kind === "video" ? `Play video: ${title}` : actionText(kind, providerLabel);
  return `${lead}, opens ${providerLabel} in a new tab`;
}

function buttonLabel(
  kind: ConsentFrameKind,
  title: string,
  providerLabel: string,
): string | undefined {
  if (kind === "video") return `Play video: ${title}, from ${providerLabel}`;
  if (kind === "audio") return undefined; // visible text names the provider
  return `${actionText(kind, providerLabel)}, from ${providerLabel}`;
}

export function ConsentFrameIsland({
  source,
  kind,
  title,
  providerLabel,
  fallbackHref,
  line,
  cover,
  address,
  aspect = "16:9",
  height,
}: ConsentFrameIslandProps) {
  const [enhanced, setEnhanced] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const focusOnLoad = useRef(false);
  // Why the frame loaded: a visitor's click on this frame, or the site-wide consent choice.
  // Withdrawing consent unloads only the latter (WR-D01, D279).
  const loadedBy = useRef<"click" | "consent" | null>(null);

  useEffect(() => {
    setEnhanced(true);
    if (storedConsent() === "all") {
      loadedBy.current = "consent";
      setLoaded(true);
    }
    const onConsent = (e: Event) => {
      const choice = choiceOf(e);
      if (choice === "all") {
        loadedBy.current ??= "consent";
        setLoaded(true);
      } else if (choice === "necessary" && loadedBy.current === "consent") {
        loadedBy.current = null;
        setLoaded(false);
      }
    };
    document.addEventListener(CONSENT_EVENT, onConsent);
    const dialog = rootRef.current?.closest("dialog[data-cds-popup]") ?? null;
    const onPopupClose = () => setFrameKey((k) => k + 1);
    dialog?.addEventListener(POPUP_CLOSE, onPopupClose);
    // A hidden tab panel or inactive slide reloads its frame, which stops playback (WR-D03).
    const root = rootRef.current;
    root?.addEventListener(MEDIA_STOP_EVENT, onPopupClose);
    return () => {
      document.removeEventListener(CONSENT_EVENT, onConsent);
      dialog?.removeEventListener(POPUP_CLOSE, onPopupClose);
      root?.removeEventListener(MEDIA_STOP_EVENT, onPopupClose);
    };
  }, []);

  const url = loaded ? consentFrameUrl(source) : null;

  useEffect(() => {
    if (url && focusOnLoad.current) {
      focusOnLoad.current = false;
      frameRef.current?.focus();
    }
  }, [url]);

  const load = () => {
    focusOnLoad.current = true;
    loadedBy.current = "click";
    setLoaded(true);
  };

  const frame = url ? (
    <iframe
      key={frameKey}
      ref={frameRef}
      src={url}
      title={title}
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      allow={FRAME_ALLOW[kind] || undefined}
      allowFullScreen={kind === "video" ? true : undefined}
      className="absolute inset-0 h-full w-full border-0"
    />
  ) : null;

  const lineEl = (
    <p className={`mt-2 ${BODY_CLASS} text-site-text-muted`}>{line}</p>
  );

  if (kind === "video") {
    const action = enhanced ? (
      <button
        type="button"
        className={PLAY}
        aria-label={buttonLabel(kind, title, providerLabel)}
        onClick={load}
      >
        <Play {...ICON_PROPS} />
      </button>
    ) : (
      <a
        href={fallbackHref}
        target="_blank"
        rel="noopener noreferrer"
        className={PLAY}
        aria-label={linkLabel(kind, title, providerLabel)}
      >
        <Play {...ICON_PROPS} />
      </a>
    );
    const style: CSSProperties = { aspectRatio: ASPECT[aspect] };
    return (
      <div ref={rootRef} data-cds-consent-frame={kind} className="w-full">
        <div
          className="relative w-full overflow-hidden rounded-site-media bg-site-surface-raised"
          style={style}
        >
          {frame ?? (
            <>
              {cover ? (
                <img
                  src={cover.src}
                  alt={cover.alt}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : null}
              <div className="absolute inset-0 flex items-center justify-center">
                {action}
              </div>
            </>
          )}
        </div>
        {lineEl}
      </div>
    );
  }

  const text = actionText(kind, providerLabel);
  const actionClass = `${siteButtonClasses("secondary")} shrink-0`;
  const action = enhanced ? (
    <button
      type="button"
      className={actionClass}
      aria-label={buttonLabel(kind, title, providerLabel)}
      onClick={load}
    >
      {text}
    </button>
  ) : (
    <a
      href={fallbackHref}
      target="_blank"
      rel="noopener noreferrer"
      className={actionClass}
      aria-label={linkLabel(kind, title, providerLabel)}
    >
      {text}
    </a>
  );
  const Icon =
    kind === "audio" ? AudioLines : kind === "booking" ? CalendarDays : MapPin;
  const name = kind === "map" ? address || title : title;
  const audioBrand =
    kind === "audio" && source?.kind === "link"
      ? brandForProvider(source.provider)
      : null;
  const sizeStyle: CSSProperties | undefined =
    kind === "map" ? undefined : { height: height ?? 152 };
  const sizeClass = kind === "map" ? " h-[320px] md:h-[400px]" : "";

  return (
    <div ref={rootRef} data-cds-consent-frame={kind} className="w-full">
      <div className={`${BOX}${sizeClass}`} style={sizeStyle}>
        {frame ??
          (kind === "audio" ? (
            <div className="flex h-full items-center gap-4 px-4">
              {/* 07-24: the provider's vendored brand icon when there is one. */}
              {audioBrand ? (
                <BrandIcon
                  id={audioBrand}
                  size={24}
                  className="shrink-0 text-site-text"
                />
              ) : (
                <Icon {...ICON_PROPS} className="shrink-0 text-site-text" />
              )}
              <p
                className={`min-w-0 flex-1 truncate ${BODY_CLASS} font-semibold text-site-text`}
              >
                {name}
              </p>
              {action}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
              <Icon {...ICON_PROPS} className="text-site-text" />
              {name ? (
                <p className={`${BODY_CLASS} font-semibold text-site-text`}>
                  {name}
                </p>
              ) : null}
              {action}
            </div>
          ))}
      </div>
      {lineEl}
    </div>
  );
}
