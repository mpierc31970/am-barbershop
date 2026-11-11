"use client";
// Translate link island (D237 "no Google script ever"; D-UI-P7-29; CONT-29, CONT-34;
// 07-26 choices 6-8; T-07-26-04, T-07-26-05).
//
// Only a link: no Google script, iframe or fetch, ever. The server renders the anchor
// `hidden` with no href, so no-JS visitors and crawlers see nothing broken and no Google
// address is in the HTML. On mount it builds the public translate.google.com URL from this
// page (origin + path; query and hash dropped) and the browser language, then shows itself,
// unless the page kind hides Translate (`[data-cds-hide-translate]` on <main>, CONT-34).
// `preview` renders the same look as an inert <span> for the hub preview.
// Header utility slot (desktop row) and, through NavDisclosure, the phone menu panel.
import { Languages } from "lucide-react";
import { useEffect, useState } from "react";
import {
  HIDE_TRANSLATE_ATTR,
  SITE_SETTINGS_COPY,
  translateUrl,
} from "@cds/core/content";

export interface TranslateLinkProps {
  /** Hub preview: an inert span with the same look. */
  preview?: boolean;
}

const CLASS =
  "inline-flex min-h-11 items-center gap-2 text-site-text no-underline decoration-1 underline-offset-8 hover:underline " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus)]";

function Label() {
  return (
    <>
      <Languages size={20} aria-hidden="true" />
      {SITE_SETTINGS_COPY.translateLink}
      <span className="sr-only"> {SITE_SETTINGS_COPY.newTab}</span>
    </>
  );
}

export function TranslateLink({ preview = false }: TranslateLinkProps) {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    if (preview) return;
    if (document.querySelector(`[${HIDE_TRANSLATE_ATTR}]`)) return;
    const url = translateUrl(
      window.location.origin + window.location.pathname,
      navigator.language,
    );
    setHref(url);
  }, [preview]);

  if (preview) {
    return (
      <span data-cds-translate="" className={CLASS}>
        <Label />
      </span>
    );
  }
  if (href === null) {
    return (
      <a data-cds-translate="" hidden className={CLASS}>
        <Label />
      </a>
    );
  }
  return (
    <a
      data-cds-translate=""
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      className={CLASS}
    >
      <Label />
    </a>
  );
}
