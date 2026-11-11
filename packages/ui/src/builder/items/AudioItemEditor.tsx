"use client";
// Audio item editor (07-08 seam, completed by 07-23; CONT-27, CONT-34, D281; 07-UI-SPEC
// "Column items" Audio row). Source: From your media (an MP3, MediaField) or Paste a link
// (Spotify, SoundCloud, Apple Podcasts; LinkPasteField) · Title. Props keep 07-08's
// ItemEditorProps plus an optional `source` (tests inject a fake).
import { useState } from "react";
import { type AudioColumnItem, type AudioProvider } from "@cds/core/content";
import { TextField } from "../../hub/fields";
import { fetchMediaSource, type MediaSource } from "../../hub/media/source";
import { RadioCardGroup } from "../../hub/RadioCardGroup";
import { LinkPasteField } from "../LinkPasteField";
import { MediaField } from "../MediaField";
import { AUDIO_LINK_LABEL } from "./media-item-copy";
import type { ItemEditorProps } from "./types";

export interface AudioItemEditorProps extends ItemEditorProps<AudioColumnItem> {
  source?: MediaSource;
}

type Mode = "media" | "link";

export function AudioItemEditor({
  draft,
  patch,
  errors,
  fid,
  source = fetchMediaSource,
}: AudioItemEditorProps) {
  const [mode, setMode] = useState<Mode>(
    draft.source === "link" ? "link" : "media",
  );
  return (
    <>
      <RadioCardGroup<Mode>
        name={fid("source")}
        legend="Source"
        value={mode}
        onChange={setMode}
        options={[
          {
            value: "media",
            title: "From your media",
            description: "An MP3 you uploaded",
          },
          {
            value: "link",
            title: "Paste a link",
            description: "Spotify, SoundCloud or Apple Podcasts",
          },
        ]}
      />
      {mode === "media" ? (
        <MediaField
          id={fid("link")}
          label="Audio"
          kind="audio"
          value={draft.asset}
          source={source}
          error={errors.link}
          onChange={(picked) => {
            const id = picked[0]?.id ?? "";
            patch(
              id
                ? { source: "media", asset: id, provider: "", provider_id: "" }
                : { asset: "" },
            );
          }}
        />
      ) : (
        <LinkPasteField
          id={fid("link")}
          label={AUDIO_LINK_LABEL}
          category="audio"
          provider={draft.provider}
          providerId={draft.provider_id}
          error={errors.link}
          onChange={(link) =>
            patch(
              link
                ? {
                    source: "link",
                    provider: link.provider as AudioProvider,
                    provider_id: link.id,
                    asset: "",
                  }
                : { provider: "", provider_id: "" },
            )
          }
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
    </>
  );
}
