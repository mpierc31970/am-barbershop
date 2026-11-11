"use client";
// Video item editor (07-08 seam, completed by 07-23; CONT-17, CONT-34, D119, D219, D220, D281;
// 07-UI-SPEC "Column items" Video row; choices 1-3, 9-10). Fields in UI-SPEC order:
// Where's the video? (From your media / Paste a link) · Title · Cover · Shape · Playback ·
// Captions (MP4 only). Props keep 07-08's ItemEditorProps; `source`, `captureCover` and
// `moveToYouTube` are optional (tests inject fakes; nothing passes moveToYouTube in P7).
//
// Cover capture (choice 2, D119): when a YouTube link parses and the cover is empty, or is the
// cover this editor captured for an earlier link, the editor asks the hub route (debounced
// 400 ms) to copy the cover into the media library once, and uses that stored copy. A cover
// the owner chose is never replaced. A late answer for a link that has since changed is
// ignored.
import { useEffect, useRef, useState } from "react";
import {
  type MediaLink,
  type VideoColumnItem,
  type VideoProvider,
  type VideoShape,
} from "@cds/core/content";
import { InlineAlert } from "../../hub/feedback";
import { Button } from "../../hub/Button";
import { TextField } from "../../hub/fields";
import {
  fetchLinkCover,
  type LinkCoverCapture,
} from "../../hub/media/link-cover";
import { MEDIA_COPY, type VideoStateView } from "../../hub/media/copy";
import { fetchMediaSource, type MediaSource } from "../../hub/media/source";
import { RadioCardGroup } from "../../hub/RadioCardGroup";
import { LinkPasteField } from "../LinkPasteField";
import { MediaField } from "../MediaField";
import {
  AUTOPLAY_HELPER,
  COVER_HELPER,
  LINK_COVER_FAILED_COPY,
  PASTE_INSTEAD,
  VIDEO_LINK_LABEL,
} from "./media-item-copy";
import type { ItemEditorProps } from "./types";
import { VideoCaptionsRow } from "./VideoCaptionsRow";

export interface VideoItemEditorProps extends ItemEditorProps<VideoColumnItem> {
  source?: MediaSource;
  captureCover?: LinkCoverCapture;
  /** Show MOVE-TO-YOUTUBE on an MP4 item (choice 10; nothing sets it in P7). */
  moveToYouTube?: boolean;
}

type Mode = "media" | "link";

export const COVER_DEBOUNCE_MS = 400;

const CHECKBOX =
  "size-4 rounded-sm border-hub-border accent-hub-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

const SHAPE_THUMB: Readonly<Record<VideoShape, string>> = {
  "16:9": "h-[18px] w-8",
  "9:16": "h-8 w-[18px]",
  "1:1": "h-6 w-6",
};

function ShapeThumb({ shape }: { shape: VideoShape }) {
  return (
    <span
      aria-hidden
      className={`block rounded-sm border-2 border-hub-ink-muted ${SHAPE_THUMB[shape]}`}
    />
  );
}

function linkKey(link: { provider: string; id: string }): string {
  return `${link.provider}:${link.id}`;
}

export function VideoItemEditor({
  draft,
  patch,
  errors,
  fid,
  source = fetchMediaSource,
  captureCover = fetchLinkCover,
  moveToYouTube = false,
}: VideoItemEditorProps) {
  const [mode, setMode] = useState<Mode>(
    draft.source === "link" ? "link" : "media",
  );
  const [videoState, setVideoState] = useState<VideoStateView | null>(null);
  const [coverThumb, setCoverThumb] = useState("");
  const [coverNote, setCoverNote] = useState("");
  const autoCoverRef = useRef<string | null>(null);
  const pendingKey = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // The picked MP4's optimizing state, once per pick or mount (the Media tab polls).
  const asset = mode === "media" ? draft.asset : "";
  useEffect(() => {
    if (asset === "") return;
    let live = true;
    void source.states([asset]).then((res) => {
      if (live) setVideoState(res.ok ? (res.data[asset] ?? null) : null);
    });
    return () => {
      live = false;
    };
  }, [asset, source]);

  function scheduleCover(link: MediaLink) {
    if (timer.current) clearTimeout(timer.current);
    pendingKey.current = null;
    const auto = autoCoverRef.current;
    const coverIsOurs = draft.cover === "" || draft.cover === auto;
    if (!coverIsOurs) return;
    if (!link.thumbnailUrl) {
      // A link without an automatic cover: drop a cover captured for an earlier link.
      if (auto !== null && draft.cover === auto) {
        autoCoverRef.current = null;
        setCoverThumb("");
        patch({ cover: "" });
      }
      setCoverNote("");
      return;
    }
    const key = linkKey(link);
    pendingKey.current = key;
    const title = draft.title;
    timer.current = setTimeout(() => {
      timer.current = null;
      void captureCover({
        provider: link.provider,
        providerId: link.id,
        title,
      }).then((res) => {
        if (pendingKey.current !== key) return;
        pendingKey.current = null;
        if (res.asset) {
          autoCoverRef.current = res.asset;
          setCoverThumb(res.thumbUrl);
          setCoverNote("");
          patch({ cover: res.asset });
        } else {
          setCoverNote(LINK_COVER_FAILED_COPY);
        }
      });
    }, COVER_DEBOUNCE_MS);
  }

  function onLink(link: MediaLink | null) {
    if (!link) {
      if (timer.current) clearTimeout(timer.current);
      pendingKey.current = null;
      patch({ provider: "", provider_id: "" });
      return;
    }
    patch({
      source: "link",
      provider: link.provider as VideoProvider,
      provider_id: link.id,
      asset: "",
      autoplay: false,
    });
    scheduleCover(link);
  }

  const stateAlert =
    mode === "media" && draft.asset !== "" && videoState
      ? videoState === "waiting" || videoState === "optimizing"
        ? { tone: "info" as const, text: MEDIA_COPY.videoProcessing }
        : videoState === "failed"
          ? { tone: "error" as const, text: MEDIA_COPY.videoFailed }
          : videoState === "failed-final"
            ? { tone: "error" as const, text: MEDIA_COPY.videoFailedFinal }
            : null
      : null;

  return (
    <>
      <RadioCardGroup<Mode>
        name={fid("source")}
        legend="Where's the video?"
        value={mode}
        onChange={setMode}
        options={[
          {
            value: "media",
            title: "From your media",
            description: "An MP4 you uploaded",
          },
          {
            value: "link",
            title: "Paste a link",
            description: "YouTube, Vimeo and more",
          },
        ]}
      />
      {mode === "media" ? (
        <>
          <MediaField
            id={fid("link")}
            label="Video"
            kind="video"
            value={draft.asset}
            source={source}
            error={errors.link}
            onChange={(picked) => {
              const id = picked[0]?.id ?? "";
              setVideoState(null);
              patch(
                id
                  ? {
                      source: "media",
                      asset: id,
                      provider: "",
                      provider_id: "",
                    }
                  : { asset: "" },
              );
            }}
          />
          {stateAlert ? (
            <InlineAlert tone={stateAlert.tone}>{stateAlert.text}</InlineAlert>
          ) : null}
          {moveToYouTube && draft.asset !== "" ? (
            <InlineAlert
              tone="info"
              action={
                <Button type="button" size="sm" onClick={() => setMode("link")}>
                  {PASTE_INSTEAD}
                </Button>
              }
            >
              {MEDIA_COPY.moveToYouTube}
            </InlineAlert>
          ) : null}
        </>
      ) : (
        <LinkPasteField
          id={fid("link")}
          label={VIDEO_LINK_LABEL}
          category="video"
          provider={draft.provider}
          providerId={draft.provider_id}
          error={errors.link}
          onChange={onLink}
          coverThumbUrl={coverThumb}
          coverNote={coverNote}
        />
      )}
      <TextField
        id={fid("title")}
        label="Title"
        helper="Used by screen readers and search engines"
        required
        maxLength={500}
        value={draft.title}
        error={errors.title}
        onChange={(e) => patch({ title: e.target.value })}
      />
      <MediaField
        id={fid("cover")}
        label="Cover"
        helper={COVER_HELPER}
        kind="image"
        value={draft.cover}
        source={source}
        error={errors.cover}
        onChange={(picked) => {
          autoCoverRef.current = null;
          pendingKey.current = null;
          setCoverThumb("");
          setCoverNote("");
          patch({ cover: picked[0]?.id ?? "" });
        }}
      />
      <RadioCardGroup<VideoShape>
        name={fid("shape")}
        legend="Shape"
        value={draft.shape}
        onChange={(shape) => patch({ shape })}
        options={[
          {
            value: "16:9",
            title: "Wide",
            description: "16:9",
            adornment: <ShapeThumb shape="16:9" />,
          },
          {
            value: "9:16",
            title: "Tall",
            description: "9:16",
            adornment: <ShapeThumb shape="9:16" />,
          },
          {
            value: "1:1",
            title: "Square",
            description: "1:1",
            adornment: <ShapeThumb shape="1:1" />,
          },
        ]}
      />
      <fieldset className="flex flex-col gap-2 font-hub">
        <legend className="mb-1 text-sm font-semibold text-hub-ink">
          Playback
        </legend>
        <label className="flex min-h-11 items-center gap-3 text-sm text-hub-ink">
          <input
            id={fid("controls")}
            type="checkbox"
            className={CHECKBOX}
            checked={draft.controls}
            onChange={(e) => patch({ controls: e.target.checked })}
          />
          Show controls
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm text-hub-ink">
          <input
            id={fid("loop")}
            type="checkbox"
            className={CHECKBOX}
            checked={draft.loop}
            onChange={(e) => patch({ loop: e.target.checked })}
          />
          Loop
        </label>
        {mode === "media" ? (
          <div className="flex flex-col gap-1">
            <label className="flex min-h-11 items-center gap-3 text-sm text-hub-ink">
              <input
                id={fid("autoplay")}
                type="checkbox"
                className={CHECKBOX}
                checked={draft.autoplay}
                aria-describedby={`${fid("autoplay")}-helper`}
                onChange={(e) => patch({ autoplay: e.target.checked })}
              />
              Play silently when it appears
            </label>
            <p
              id={`${fid("autoplay")}-helper`}
              className="ml-7 text-sm text-hub-ink-muted"
            >
              {AUTOPLAY_HELPER}
            </p>
          </div>
        ) : null}
      </fieldset>
      {mode === "media" && draft.asset !== "" ? (
        <VideoCaptionsRow assetId={draft.asset} source={source} />
      ) : null}
    </>
  );
}
