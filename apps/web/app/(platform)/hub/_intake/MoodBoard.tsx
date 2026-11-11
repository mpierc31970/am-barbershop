"use client";
// The mood board (06-21; 06-UI-SPEC "Mood board"; ONB-05, D47, CONTEXT A4-Q2/Q3, D-UI-P6-28,
// D-UI-P6-29). This is the phase's focal point: the preview card changes the moment a photo
// is picked.
//
//   uploads   ImageUpload kind moodboard, up to 3, the first labelled "Colours come from this
//             one"; reordering puts another photo first and the server recomputes the proposal
//   strip     PaletteStrip from the proposal's swatches (names from the nearest-name table)
//   card      MoodboardPreviewCard + caption, then the owner-named roles and solver notes
//
// On pick the palette is computed in the browser (paletteFromFile, the same extractPalette on
// a <= 128px sample) and shown at once; the upload's own proposal then replaces it silently.
// Only the first mood board drives colours, so picking a second or third photo leaves the
// palette alone. A proposal is data for this preview only: nothing here can apply it to the
// live theme, and there is no "apply" control (D47, T-06-100).
import type { MoodboardProposal } from "@cds/core/theme";
import {
  ImageUpload,
  InlineAlert,
  PaletteStrip,
  type MediaAssetView,
} from "@cds/ui/hub";
import { useRef, useState } from "react";
import {
  removeMediaAction,
  reorderMediaAction,
  restoreMediaAction,
  setMediaAltAction,
} from "../../../actions/media";
import { isProposal, paletteFromFile } from "./client-palette";
import { paletteLabel } from "./colour-names";
import { ColourRoles, MoodboardPreviewCard } from "./MoodboardPreviewCard";
import { reinsertAt } from "./list-helpers";

export const MOODBOARD_MAX = 3;
export const MOODBOARD_INTRO =
  "A photo, a flyer, a screenshot of a site you love. We pull colours from the first one so you can see a first look. Support designs your full theme from all of them.";
export const MOODBOARD_EMPTY = "Add a photo to see a first look.";
export const MOODBOARD_FIRST = "Colours come from this one";
export const MOODBOARD_WARNING =
  "We couldn't read colours from this image. Try another one; Support will still see it.";
export const MOODBOARD_HELPER =
  "Up to 3 photos. Drag one to the front to take colours from it. Leave empty and Support picks colours with you.";

export interface MoodBoardProps {
  initial: MediaAssetView[];
  /** The stored proposal (org_intake.moodboard_proposal), anything; checked here. */
  proposal: unknown;
  pairingId: string;
  businessName: string;
  tagline: string;
  readOnly: boolean;
  /** After any saved change (setup marks the step saved). */
  onChanged?: () => void;
}

export function MoodBoard({
  initial,
  proposal: stored,
  pairingId,
  businessName,
  tagline,
  readOnly,
  onChanged,
}: MoodBoardProps) {
  const [boards, setBoards] = useState(initial);
  const [proposal, setProposal] = useState<MoodboardProposal | null>(
    isProposal(stored) ? stored : null,
  );
  const [warning, setWarning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const removed = useRef(
    new Map<string, { item: MediaAssetView; index: number }>(),
  );
  // Each pick gets a number; a client result is dropped once the server has answered for
  // that pick (or a later one), so the slower path never overwrites the server's result.
  const pick = useRef(0);
  const answered = useRef(0);

  function applyServer(p: unknown) {
    if (p === null) {
      setProposal(null);
      return;
    }
    if (isProposal(p)) {
      setProposal(p);
      setWarning(false);
    }
  }

  function onPick(file: File) {
    if (boards.length > 0) return; // only the first mood board drives colours
    const seq = ++pick.current;
    paletteFromFile(file).then(
      (p) => {
        if (answered.current >= seq) return;
        setProposal(p);
        setWarning(false);
      },
      () => {
        if (answered.current >= seq) return;
        setWarning(true);
      },
    );
  }

  const showCard = boards.length > 0 || proposal !== null;
  const swatches = proposal?.swatches ?? [];

  const uploads = (
    <div className="flex flex-col gap-4">
      <ImageUpload
        id="field-moodboard-upload"
        kind="moodboard"
        label="Mood board photos"
        helper={MOODBOARD_HELPER}
        value={boards}
        multiple
        max={MOODBOARD_MAX}
        firstLabel={MOODBOARD_FIRST}
        readOnly={readOnly}
        onPick={onPick}
        onUploaded={(asset, p) => {
          answered.current = pick.current;
          setError(null);
          setBoards((b) => [...b, asset]);
          if (p !== undefined) applyServer(p);
          onChanged?.();
        }}
        onAltChange={(id, alt) =>
          setMediaAltAction(id, alt).then(
            (r) => {
              if (!r.ok) setError(r.message);
              else onChanged?.();
              return r.ok;
            },
            () => false,
          )
        }
        onReorder={(ids) => {
          const before = boards;
          const byId = new Map(boards.map((b) => [b.id, b]));
          setBoards(ids.map((id) => byId.get(id)!).filter(Boolean));
          void reorderMediaAction("moodboard", ids).then((r) => {
            if (!r.ok) {
              setBoards(before);
              setError(r.message);
              return;
            }
            if (r.data && "proposal" in r.data) applyServer(r.data.proposal);
            onChanged?.();
          });
        }}
        onRemove={(id) => {
          const index = boards.findIndex((b) => b.id === id);
          if (index >= 0) {
            removed.current.set(id, { item: boards[index]!, index });
          }
          const before = boards;
          setBoards((b) => b.filter((x) => x.id !== id));
          void removeMediaAction(id).then((r) => {
            if (!r.ok) {
              setBoards(before);
              setError(r.message);
              return;
            }
            if (r.data && "proposal" in r.data) applyServer(r.data.proposal);
          });
        }}
        onRestore={(id) => {
          const back = removed.current.get(id);
          void restoreMediaAction(id).then((r) => {
            if (!r.ok) {
              setError(r.message);
              return;
            }
            // Back in its old place, as the server restores it (C-WR-09): Undo on the
            // first board makes it first again, matching the palette the server returns.
            if (back) setBoards((b) => reinsertAt(b, back.item, back.index));
            if (r.data && "proposal" in r.data) applyServer(r.data.proposal);
          });
        }}
      />
      {warning ? (
        <InlineAlert tone="warning">{MOODBOARD_WARNING}</InlineAlert>
      ) : null}
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {showCard && swatches.length > 0 ? (
        <PaletteStrip swatches={swatches} label={paletteLabel(swatches)} />
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-6" data-moodboard="">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {uploads}
        <div className="flex flex-col gap-6">
          {showCard && proposal ? (
            <>
              <MoodboardPreviewCard
                proposal={proposal}
                pairingId={pairingId}
                businessName={businessName}
                tagline={tagline}
              />
              <ColourRoles proposal={proposal} />
            </>
          ) : (
            <p className="text-base text-hub-ink-muted">{MOODBOARD_EMPTY}</p>
          )}
        </div>
      </div>
    </div>
  );
}
