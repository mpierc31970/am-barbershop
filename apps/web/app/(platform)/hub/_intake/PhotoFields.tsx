"use client";
// Main photo and More photos (06-21; 06-UI-SPEC "6 · Photos & look", "Upload field"; ONB-04,
// D280, D-UI-P6-21, D-UI-P6-31). Setup step 6 uses them; Settings can reuse them (06-22).
//
//   HeroField     ImageUpload kind hero, Optional with its fallback helper, description
//                 required once saved (D280). Remove is immediate with Undo.
//   GalleryField  ImageUpload kind gallery, up to 12, a description under each (required),
//                 reorder by drag or Move earlier / Move later.
//
// A saved photo whose description is still empty shows the hint at once; the step counts it
// as a Needed item from the snapshot (photo_descriptions) and never blocks the upload.
// Descriptions save through the stage autosave (header status); every other change goes
// through the media actions, whose chokepoint scopes it to the session's org.
import {
  Badge,
  INVALID_CODE,
  ImageUpload,
  InlineAlert,
  type HubActionResult,
  type MediaAssetView,
} from "@cds/ui/hub";
import { useRef, useState } from "react";
import {
  removeMediaAction,
  reorderMediaAction,
  restoreMediaAction,
  setMediaAltAction,
} from "../../../actions/media";
import { useStageAutosave } from "../setup/[stage]/StageFrame";
import { reinsertAt } from "./list-helpers";

export const HERO_HELPER =
  "The big photo at the top of your home page. Leave empty and we'll use your colours instead of a photo.";
export const GALLERY_HELPER =
  "Your space, your work, your products. Up to 12 for now; you can add more later.";
export const GALLERY_MAX = 12;

const OPTIONAL = <Badge tone="optional">Optional</Badge>;

export interface PhotoFieldProps {
  initial: MediaAssetView[];
  readOnly: boolean;
  /** After a saved change (setup marks the step saved). */
  onChanged?: () => void;
}

/** Remove with Undo, shared by both fields. */
function useRemovable(
  initial: MediaAssetView[],
  setError: (m: string | null) => void,
  single: boolean,
) {
  const [items, setItems] = useState(initial);
  const removed = useRef(
    new Map<string, { item: MediaAssetView; index: number }>(),
  );
  return {
    items,
    setItems,
    remove(id: string) {
      const index = items.findIndex((x) => x.id === id);
      if (index >= 0) removed.current.set(id, { item: items[index]!, index });
      const before = items;
      setItems((l) => l.filter((x) => x.id !== id));
      void removeMediaAction(id).then((r) => {
        if (!r.ok) {
          setError(r.message);
          setItems(before);
        }
      });
    },
    restore(id: string) {
      const back = removed.current.get(id);
      void restoreMediaAction(id).then((r) => {
        if (!r.ok) {
          setError(r.message);
          return;
        }
        if (!back) return;
        setItems((l) =>
          single ? [back.item] : reinsertAt(l, back.item, back.index),
        );
      });
    },
  };
}

export function HeroField({ initial, readOnly, onChanged }: PhotoFieldProps) {
  const [error, setError] = useState<string | null>(null);
  const hero = useRemovable(initial.slice(0, 1), setError, true);
  const alt = useStageAutosave<{ id: string; alt: string }>(
    "media.hero.alt",
    async (v) => {
      const r = await setMediaAltAction(v.id, v.alt);
      if (r.ok) onChanged?.();
      return r;
    },
  );
  return (
    <div className="flex flex-col gap-2">
      <ImageUpload
        id="field-hero"
        kind="hero"
        label="Main photo"
        labelExtra={OPTIONAL}
        helper={HERO_HELPER}
        value={hero.items}
        altRequired
        readOnly={readOnly}
        onUploaded={(asset) => {
          setError(null);
          hero.setItems([asset]);
          onChanged?.();
        }}
        onAltChange={(id, text) => alt.run({ id, alt: text })}
        onRemove={hero.remove}
        onRestore={hero.restore}
      />
      {alt.status === "invalid" && alt.failure ? (
        <p className="text-sm text-hub-danger">{alt.failure.message}</p>
      ) : null}
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
    </div>
  );
}

export function GalleryField({
  initial,
  readOnly,
  onChanged,
}: PhotoFieldProps) {
  const [error, setError] = useState<string | null>(null);
  const gallery = useRemovable(initial, setError, false);
  // One queue for every photo, keyed by id (C-CR-02): descriptions typed while a save is
  // in flight fold together, so no photo's text replaces another's, and a retry resends
  // them all.
  const alt = useStageAutosave<Record<string, string>>(
    "media.gallery.alt",
    async (byId) => {
      let failure: Extract<HubActionResult<unknown>, { ok: false }> | null =
        null;
      let saved = false;
      for (const [id, text] of Object.entries(byId)) {
        const r = await setMediaAltAction(id, text);
        if (r.ok) saved = true;
        // A save failure outranks a refusal, so Try again resends the whole set.
        else if (!failure || failure.code === INVALID_CODE) failure = r;
      }
      if (saved) onChanged?.();
      return failure ?? { ok: true, data: null };
    },
    { merge: (older, newer) => ({ ...older, ...newer }) },
  );
  return (
    <div className="flex flex-col gap-2">
      <ImageUpload
        id="field-gallery"
        kind="gallery"
        label="More photos"
        labelExtra={OPTIONAL}
        helper={GALLERY_HELPER}
        value={gallery.items}
        multiple
        max={GALLERY_MAX}
        altRequired
        readOnly={readOnly}
        onUploaded={(asset) => {
          setError(null);
          gallery.setItems((l) => [...l, asset]);
          onChanged?.();
        }}
        onAltChange={(id, text) => alt.run({ [id]: text })}
        onRemove={gallery.remove}
        onRestore={gallery.restore}
        onReorder={(ids) => {
          const before = gallery.items;
          const byId = new Map(before.map((g) => [g.id, g]));
          gallery.setItems(
            ids
              .map((id) => byId.get(id))
              .filter((g): g is MediaAssetView => Boolean(g)),
          );
          void reorderMediaAction("gallery", ids).then((r) => {
            if (!r.ok) {
              gallery.setItems(before);
              setError(r.message);
              return;
            }
            onChanged?.();
          });
        }}
      />
      {alt.status === "invalid" && alt.failure ? (
        <p className="text-sm text-hub-danger">{alt.failure.message}</p>
      ) : null}
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
    </div>
  );
}
