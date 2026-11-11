"use client";
// Booking calendar (embed) item editor (07-08 seam, completed by 07-23; CONT-27, CONT-34,
// D281, D-UI-P7-35; 07-UI-SPEC "Column items" Booking calendar row). Only Calendly and public
// Google Calendar links are accepted (LinkPasteField with Play preview); embed code is never
// stored. Props keep 07-08's ItemEditorProps; `source` is accepted for parity and unused.
import { type EmbedColumnItem, type EmbedProvider } from "@cds/core/content";
import { TextField } from "../../hub/fields";
import type { MediaSource } from "../../hub/media/source";
import { LinkPasteField } from "../LinkPasteField";
import { EMBED_LINK_LABEL } from "./media-item-copy";
import type { ItemEditorProps } from "./types";

export interface EmbedItemEditorProps extends ItemEditorProps<EmbedColumnItem> {
  source?: MediaSource;
}

export function EmbedItemEditor({
  draft,
  patch,
  errors,
  fid,
}: EmbedItemEditorProps) {
  return (
    <>
      <LinkPasteField
        id={fid("link")}
        label={EMBED_LINK_LABEL}
        category="embed"
        provider={draft.provider}
        providerId={draft.provider_id}
        error={errors.link}
        onChange={(link) =>
          patch(
            link
              ? {
                  provider: link.provider as EmbedProvider,
                  provider_id: link.id,
                }
              : { provider: "", provider_id: "" },
          )
        }
      />
      <TextField
        id={fid("title")}
        label="Title"
        helper="For example, Book a consultation"
        required
        maxLength={500}
        value={draft.title}
        error={errors.title}
        onChange={(e) => patch({ title: e.target.value })}
      />
    </>
  );
}
