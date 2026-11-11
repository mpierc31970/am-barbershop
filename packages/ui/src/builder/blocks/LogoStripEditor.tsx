"use client";
// LogoStripEditor (07-22; CONT-27, D119/D120; 07-UI-SPEC row "Logo strip" line 365, Undo copy
// line 664; D311 admin pattern; replaces the 07-06 stub body, name and BUILDER_BLOCKS_A entry
// kept).
//
// Heading (optional) · Logos on 07-21's shared SortableList (noun "Logo": drag or Move up /
// down, Delete with "Logo removed. Undo"), each row a 48px contain thumb, Name (required: it is
// read out to people who can't see the logo) and Link (optional) · Add logos (MediaPicker,
// multi; appends, decision 5) · "Drop logos here, or choose from your media" (uploads, then
// appends) · Show in grey. Bulk picks are named from the library description, else the file
// name (gallery-logic logosFromPicks). Adding stops at 16 with LOGO_STRIP_MAX_COPY; a blank
// name shows LOGO_STRIP_NAME_COPY under its row once the owner leaves it. Limits and copy come
// from @cds/core/content. Hub tokens and hub primitives only.
import { Images } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  LOGO_STRIP_LIMITS,
  LOGO_STRIP_MAX_COPY,
  LOGO_STRIP_NAME_COPY,
  newId,
  type LogoStripLogo,
} from "@cds/core/content";
import { Button } from "../../hub/Button";
import { MediaDropZone } from "../../hub/MediaDropZone";
import { MediaPicker } from "../../hub/MediaPicker";
import { Switch } from "../../hub/Switch";
import { useToast } from "../../hub/Toast";
import { TextField } from "../../hub/fields";
import { MEDIA_COPY, pickedOf, type PickedMedia } from "../../hub/media/copy";
import { fetchMediaSource } from "../../hub/media/source";
import { useMediaUploads } from "../../hub/useMediaUploads";
import { logosFromPicks } from "./gallery-logic";
import { reinsertItem, SortableList, useLatest } from "./SortableList";
import type { CoreBlockEditorProps } from "./types";

type LogoThumb = { thumbUrl: string | null; deleted?: boolean };

function readLogos(content: Record<string, unknown>): LogoStripLogo[] {
  const raw = Array.isArray(content.logos) ? (content.logos as unknown[]) : [];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return raw
    .filter(
      (x): x is Record<string, unknown> =>
        typeof x === "object" && x !== null && !Array.isArray(x),
    )
    .map((x, i) => ({
      id: str(x.id) || `logo-${i}`,
      asset: str(x.asset),
      name: str(x.name),
      link: str(x.link),
    }));
}

export function LogoStripEditor({
  content,
  onChange,
  errors,
}: CoreBlockEditorProps) {
  const uid = useId();
  const toast = useToast();
  const logos = readLogos(content);
  const latest = useLatest(logos);
  const heading = typeof content.heading === "string" ? content.heading : "";
  const grey = content.grayscale === true;
  const atMax = logos.length >= LOGO_STRIP_LIMITS.maxLogos;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, LogoThumb>>(
    () => new Map(),
  );
  const chain = useRef<Promise<void>>(Promise.resolve());

  const missing = [
    ...new Set(logos.map((l) => l.asset).filter((a) => a && !thumbs.has(a))),
  ].join(",");
  useEffect(() => {
    if (missing === "") return;
    let live = true;
    const ids = missing.split(",").slice(0, LOGO_STRIP_LIMITS.maxLogos);
    void fetchMediaSource.items(ids).then((res) => {
      if (!live || !res.ok) return;
      setThumbs((m) => {
        const next = new Map(m);
        for (const it of res.data) {
          next.set(it.id, {
            thumbUrl: it.thumbUrl,
            ...(it.deleted ? { deleted: true } : {}),
          });
        }
        for (const id of ids) {
          if (!next.has(id)) next.set(id, { thumbUrl: null, deleted: true });
        }
        return next;
      });
    });
    return () => {
      live = false;
    };
  }, [missing]);

  const setLogos = (next: LogoStripLogo[]) => {
    latest.current = next;
    onChange("logos", next);
  };
  const patch = (id: string, p: Partial<LogoStripLogo>) =>
    setLogos(latest.current.map((x) => (x.id === id ? { ...x, ...p } : x)));

  function append(picks: readonly PickedMedia[]) {
    if (picks.length === 0) return;
    setThumbs((m) => {
      const next = new Map(m);
      for (const p of picks) {
        next.set(p.id, {
          thumbUrl: p.thumbUrl,
          ...(p.deleted ? { deleted: true } : {}),
        });
      }
      return next;
    });
    const r = logosFromPicks(latest.current, picks, newId);
    if (r.logos.length !== latest.current.length) setLogos(r.logos);
    if (r.overflow) toast.show({ message: LOGO_STRIP_MAX_COPY });
  }

  const uploads = useMediaUploads({
    kinds: ["image"],
    onUploaded(assetId) {
      chain.current = chain.current.then(async () => {
        const res = await fetchMediaSource.items([assetId]);
        if (res.ok && res.data[0]) append([pickedOf(res.data[0])]);
      });
    },
  });

  return (
    <div className="flex flex-col gap-6 font-hub">
      <TextField
        id={`${uid}-heading`}
        label="Heading"
        labelExtra={
          <span className="text-sm text-hub-ink-muted">Optional</span>
        }
        value={heading}
        error={errors.heading}
        onChange={(e) => onChange("heading", e.currentTarget.value)}
      />

      <section aria-labelledby={`${uid}-logos`} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h3
              id={`${uid}-logos`}
              className="text-sm font-semibold text-hub-ink"
            >
              Logos
            </h3>
            <p className="text-sm tabular-nums text-hub-ink-muted">
              {`${logos.length} of ${LOGO_STRIP_LIMITS.maxLogos}`}
            </p>
          </div>
          <Button
            variant="secondary"
            icon={<Images aria-hidden size={16} strokeWidth={2} />}
            disabled={atMax}
            aria-describedby={atMax ? `${uid}-max` : undefined}
            onClick={() => setPickerOpen(true)}
          >
            Add logos
          </Button>
        </div>
        {atMax ? (
          <p id={`${uid}-max`} className="text-sm text-hub-ink-muted">
            {LOGO_STRIP_MAX_COPY}
          </p>
        ) : null}

        {logos.length > 0 ? (
          <SortableList<LogoStripLogo>
            items={logos}
            noun="Logo"
            label={(logo, i) => logo.name.trim() || `Logo ${i + 1}`}
            onReorder={setLogos}
            onRemove={(i) => setLogos(latest.current.filter((_, k) => k !== i))}
            onRestore={(logo, i) => {
              if (latest.current.length >= LOGO_STRIP_LIMITS.maxLogos) return;
              setLogos(reinsertItem(latest.current, logo, i));
            }}
            renderItem={(logo) => {
              const thumb = thumbs.get(logo.asset);
              const blank =
                logo.name.trim() === "" && touched.has(logo.id)
                  ? LOGO_STRIP_NAME_COPY
                  : undefined;
              return (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <div className="flex w-24 shrink-0 flex-col gap-1">
                    <div className="flex h-12 w-24 items-center justify-center rounded border border-hub-border bg-hub-surface-2 p-1">
                      {thumb?.thumbUrl && !thumb.deleted ? (
                        <img
                          src={thumb.thumbUrl}
                          alt=""
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : null}
                    </div>
                    {thumb?.deleted ? (
                      <span className="text-xs text-hub-ink-muted">
                        {MEDIA_COPY.deletedField}
                      </span>
                    ) : null}
                  </div>
                  <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2">
                    <TextField
                      id={`${uid}-name-${logo.id}`}
                      label="Name"
                      required
                      maxLength={LOGO_STRIP_LIMITS.nameMax}
                      helper="Read out to people who can't see it."
                      error={blank}
                      value={logo.name}
                      onChange={(e) =>
                        patch(logo.id, { name: e.currentTarget.value })
                      }
                      onBlur={() => setTouched((s) => new Set(s).add(logo.id))}
                    />
                    <TextField
                      id={`${uid}-link-${logo.id}`}
                      label="Link"
                      labelExtra={
                        <span className="text-sm text-hub-ink-muted">
                          Optional
                        </span>
                      }
                      type="url"
                      inputMode="url"
                      helper="A web address, like https://acme.com"
                      value={logo.link}
                      onChange={(e) =>
                        patch(logo.id, { link: e.currentTarget.value })
                      }
                    />
                  </div>
                </div>
              );
            }}
          />
        ) : null}

        <MediaDropZone
          accept="image/jpeg,image/png,image/webp"
          prompt="Drop logos here, or"
          chooseLabel="choose from your media"
          disabled={atMax}
          onChoose={() => setPickerOpen(true)}
          onFiles={(files) => {
            const room = LOGO_STRIP_LIMITS.maxLogos - latest.current.length;
            if (files.length > room)
              toast.show({ message: LOGO_STRIP_MAX_COPY });
            if (room > 0) uploads.add(files.slice(0, room));
          }}
        />
        {uploads.tiles.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm text-hub-ink-muted">
            {uploads.tiles.map((tile) => (
              <li key={tile.key} data-logo-upload="">
                {tile.status === "error"
                  ? `${tile.name}: ${tile.message ?? MEDIA_COPY.errLoad}`
                  : `${tile.name}: uploading ${Math.round(tile.pct)}%`}
              </li>
            ))}
          </ul>
        ) : null}
        {errors.logos ? (
          <p role="alert" className="text-sm font-semibold text-hub-danger">
            {errors.logos}
          </p>
        ) : null}
      </section>

      <Switch
        id={`${uid}-grey`}
        label="Show in grey"
        checked={grey}
        onChange={(v) => onChange("grayscale", v)}
      />

      <MediaPicker
        open={pickerOpen}
        kind="image"
        multiple
        onUse={(picked) => {
          setPickerOpen(false);
          append(picked);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}
