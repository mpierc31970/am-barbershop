"use client";
// Captions row in the video item editor (07-23 choice 9; CONT-17; 07-UI-SPEC "Column items"
// Video › Captions, UPL-CAPTIONS). Captions belong to the library video, so every item using
// that video gets them. The row shows the file and adds, replaces or removes it through
// 07-13's PUT / DELETE /hub/api/media/captions?asset=<id> (the same calls as the Media tab's
// drawer), plus a "Manage in Media" link. The org comes from the session on the server.
import { useEffect, useRef, useState } from "react";
import { Button } from "../../hub/Button";
import { MEDIA_COPY, MEDIA_LIMITS } from "../../hub/media/copy";
import { fetchMediaSource, type MediaSource } from "../../hub/media/source";
import { sendXhr } from "../../hub/media/xhr";
import {
  CAPTIONS_ADDED_COPY,
  CAPTIONS_FILE_NAME,
  CAPTIONS_NONE_COPY,
  CAPTIONS_REMOVED_COPY,
  MANAGE_IN_MEDIA,
  mediaTabHref,
} from "./media-item-copy";

export const CAPTIONS_URL = "/hub/api/media/captions";

export interface VideoCaptionsRowProps {
  assetId: string;
  source?: MediaSource;
  send?: typeof sendXhr;
}

function captionsUrl(assetId: string): string {
  return `${CAPTIONS_URL}?asset=${encodeURIComponent(assetId)}`;
}

function okFile(file: File): boolean {
  return (
    /\.vtt$/i.test(file.name) &&
    file.size > 0 &&
    file.size <= MEDIA_LIMITS.captions
  );
}

function sentence(v: unknown, fallback: string): string {
  return typeof v === "string" && v.includes(" ") ? v : fallback;
}

export function VideoCaptionsRow({
  assetId,
  source = fetchMediaSource,
  send = sendXhr,
}: VideoCaptionsRowProps) {
  const [has, setHas] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputId = `captions-${assetId}`;

  useEffect(() => {
    let live = true;
    void source.items([assetId]).then((res) => {
      if (!live) return;
      setHas(res.ok ? res.data[0]?.hasCaptions === true : false);
    });
    return () => {
      live = false;
    };
  }, [assetId, source]);

  async function run(file: File | null) {
    setError("");
    setStatus("");
    if (file && !okFile(file)) {
      setError(MEDIA_COPY.captions);
      return;
    }
    setBusy(true);
    try {
      const res = await send(
        file
          ? {
              method: "PUT",
              url: captionsUrl(assetId),
              headers: { "Content-Type": "text/vtt" },
              body: file,
            }
          : { method: "DELETE", url: captionsUrl(assetId) },
      );
      if (res.status < 200 || res.status >= 300) {
        setError(sentence(res.json.error, MEDIA_COPY.captions));
        return;
      }
      setHas(file !== null);
      setStatus(file ? CAPTIONS_ADDED_COPY : CAPTIONS_REMOVED_COPY);
    } catch {
      setError(MEDIA_COPY.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="flex flex-col gap-2 font-hub" data-captions-row="">
      <legend className="mb-1 text-sm font-semibold text-hub-ink">
        Captions
      </legend>
      <div className="flex flex-wrap items-center gap-3 text-sm text-hub-ink">
        <span data-captions-state="">
          {has === null ? "" : has ? CAPTIONS_FILE_NAME : CAPTIONS_NONE_COPY}
        </span>
        <input
          ref={fileRef}
          id={inputId}
          type="file"
          accept=".vtt,text/vtt"
          className="sr-only"
          tabIndex={-1}
          aria-label={MEDIA_COPY.captionsLabel}
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (file) void run(file);
          }}
        />
        {has !== null ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {has ? "Replace" : "Add captions file"}
            </Button>
            {has ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void run(null)}
              >
                Remove
              </Button>
            ) : null}
          </>
        ) : null}
        <a
          href={mediaTabHref(assetId)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-hub-accent underline-offset-2 hover:underline"
        >
          {MANAGE_IN_MEDIA}
        </a>
      </div>
      <p className="text-sm text-hub-ink-muted">{MEDIA_COPY.captionsHelper}</p>
      {error ? (
        <p role="alert" className="text-sm text-hub-danger">
          {error}
        </p>
      ) : null}
      <p role="status" className="min-h-5 text-sm text-hub-ink-muted">
        {status}
      </p>
    </fieldset>
  );
}
