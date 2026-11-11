"use client";
// LinkPasteField: the one "paste a link or embed code" field for the video, audio and booking
// calendar editors (07-23; CONT-17, CONT-34, D281; 07-UI-SPEC "Column items" lines 348-351 and
// "Interaction states" Link paste field; replaces 07-08's PastedLinkField).
//
// The text box is local state only: what reaches the draft is the parsed MediaLink (the
// editor stores `{ provider, provider_id }`), never the pasted URL or <iframe> code. Parsing
// is pure and instant, so the "Checking link…" state never shows (it never exceeds 100 ms).
// - Found: a result card with the provider icon, "YouTube video found" (role=status), the
//   provider page link (new tab), our stored cover thumb when given (never a provider
//   thumbnail: the hub shows only our copy), and a ghost Play preview that loads the real
//   player here, src from consentFrameUrl only.
// - Refused: the category's exact copy in the field's error slot; a server error wins.
// Choice 11: lucide icons here; 07-24's brand marks can replace them in one line.
import { useState } from "react";
import { AudioLines, CalendarDays, Film } from "lucide-react";
import {
  AUDIO_NOT_ALLOWED_COPY,
  EMBED_NOT_ALLOWED_COPY,
  FRAME_ALLOW,
  LINK_NOT_ALLOWED_COPY,
  consentFrameUrl,
  mediaLinkFrom,
  parseMediaLink,
  type MediaLink,
  type MediaLinkCategory,
} from "@cds/core/content";
import { Button } from "../hub/Button";
import { TextField } from "../hub/fields";
import { PREVIEW_TITLE, foundLine, openOnLine } from "./items/media-item-copy";

export interface LinkPasteFieldProps {
  id: string;
  label: string;
  helper?: string;
  category: MediaLinkCategory;
  /** The stored pair, shown as its public page link when the editor opens. */
  provider: string;
  providerId: string;
  onChange(link: MediaLink | null): void;
  /** Save-time or server error for this field (wins over the local message). */
  error?: string;
  /** Our stored cover's hub thumb URL (video only). */
  coverThumbUrl?: string;
  /** A note under the card, e.g. the cover could not be copied. */
  coverNote?: string;
}

const REFUSED: Readonly<Record<MediaLinkCategory, string>> = {
  video: LINK_NOT_ALLOWED_COPY,
  audio: AUDIO_NOT_ALLOWED_COPY,
  embed: EMBED_NOT_ALLOWED_COPY,
};

const FRAME_KIND = {
  video: "video",
  audio: "audio",
  embed: "booking",
} as const;

// UI-SPEC provider heights (px) for audio frames; calendars carry theirs on the link.
const AUDIO_HEIGHTS: Readonly<Record<string, number>> = {
  spotify: 152,
  soundcloud: 168,
  "apple-podcasts": 176,
};

const ICONS = { video: Film, audio: AudioLines, embed: CalendarDays } as const;

function linkKey(link: MediaLink): string {
  return `${link.provider}:${link.id}`;
}

export function LinkPasteField({
  id,
  label,
  helper,
  category,
  provider,
  providerId,
  onChange,
  error,
  coverThumbUrl,
  coverNote,
}: LinkPasteFieldProps) {
  const [value, setValue] = useState(
    () => mediaLinkFrom(provider, providerId)?.pageUrl ?? "",
  );
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const parsed = parseMediaLink(value);
  const link =
    parsed.ok && parsed.link.category === category ? parsed.link : null;
  const refused = !link && value.trim() !== "" ? REFUSED[category] : "";
  const shownError = error || refused;

  function change(next: string) {
    setValue(next);
    const result = parseMediaLink(next);
    onChange(
      result.ok && result.link.category === category ? result.link : null,
    );
  }

  const Icon = ICONS[category];
  const previewing = link !== null && previewKey === linkKey(link);
  const frameSrc = previewing
    ? consentFrameUrl({ kind: "link", provider: link.provider, id: link.id })
    : null;
  const allow = FRAME_ALLOW[FRAME_KIND[category]];
  const height =
    link && category !== "video"
      ? (link.height ?? AUDIO_HEIGHTS[link.provider] ?? 152)
      : 0;

  return (
    <div className="flex flex-col gap-2">
      <TextField
        id={id}
        label={label}
        helper={helper}
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={value}
        error={shownError || undefined}
        onChange={(e) => change(e.target.value)}
      />
      <div
        className={
          link && !shownError
            ? "flex flex-col gap-3 rounded border border-hub-border bg-hub-surface-2 p-3 font-hub"
            : ""
        }
        data-link-result={link && !shownError ? "" : undefined}
      >
        <p
          role="status"
          className="flex items-center gap-2 text-sm font-semibold text-hub-ink"
        >
          {link && !shownError ? (
            <Icon
              aria-hidden
              size={20}
              strokeWidth={2}
              className="shrink-0 text-hub-ink-muted"
            />
          ) : null}
          {link && !shownError ? foundLine(link) : ""}
        </p>
        {link && !shownError ? (
          <>
            {category === "video" && coverThumbUrl ? (
              <img
                src={coverThumbUrl}
                alt=""
                className="aspect-video w-40 rounded object-cover"
              />
            ) : null}
            {coverNote ? (
              <p className="text-sm text-hub-ink-muted">{coverNote}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={link.pageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-hub-accent underline-offset-2 hover:underline"
              >
                {openOnLine(link)}
              </a>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={previewing}
                onClick={() => setPreviewKey(previewing ? null : linkKey(link))}
              >
                {previewing ? "Hide preview" : "Play preview"}
              </Button>
            </div>
            {frameSrc ? (
              category === "video" ? (
                <div className="aspect-video w-full overflow-hidden rounded">
                  <iframe
                    src={frameSrc}
                    title={PREVIEW_TITLE(link)}
                    {...(allow ? { allow } : {})}
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="strict-origin-when-cross-origin"
                    className="h-full w-full border-0"
                  />
                </div>
              ) : (
                <div className="max-h-[480px] overflow-auto rounded">
                  <iframe
                    src={frameSrc}
                    title={PREVIEW_TITLE(link)}
                    {...(allow ? { allow } : {})}
                    height={height}
                    loading="lazy"
                    referrerPolicy="strict-origin-when-cross-origin"
                    className="w-full border-0"
                  />
                </div>
              )
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
