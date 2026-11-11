"use client";
// Step 6 · Photos & look (06-21; 06-UI-SPEC "6 · Photos & look", "Upload field", "Mood
// board"; ONB-04, ONB-05, D47, D280, D-UI-P6-21, D-UI-P6-28, D-UI-P6-29).
//
//   Your photos      Main photo (hero, description required once saved) and More photos
//                    (gallery, up to 12, descriptions, reorder)
//   Your mood board  up to 3; "Colours come from this one" on the first; a first-look card
//                    from its palette (a proposal only, never the live theme)
//
// The first upload, description save or reorder marks the step saved (once per visit). An
// Editor sees every field read-only (the frame shows the line; the chokepoint refuses too).
import { useRef } from "react";
import { markStageSavedAction } from "../../../../actions/intake";
import { FieldGroup } from "../../_intake/FieldGroup";
import { MOODBOARD_INTRO, MoodBoard } from "../../_intake/MoodBoard";
import { GalleryField, HeroField } from "../../_intake/PhotoFields";
import type { StageFormProps } from "../[stage]/stage-forms";

export function LookStage({ data, readOnly }: StageFormProps) {
  const p = data.profile;
  const marked = useRef(false);
  const markSaved = () => {
    if (marked.current) return;
    marked.current = true;
    void markStageSavedAction("look").then((r) => {
      if (!r.ok) marked.current = false;
    });
  };
  const ofKind = (kind: string) => data.media.filter((m) => m.kind === kind);

  return (
    <>
      <FieldGroup id="field-photo_descriptions" title="Your photos">
        <HeroField
          initial={ofKind("hero")}
          readOnly={readOnly}
          onChanged={markSaved}
        />
        <GalleryField
          initial={ofKind("gallery")}
          readOnly={readOnly}
          onChanged={markSaved}
        />
      </FieldGroup>
      <FieldGroup
        id="field-moodboard"
        title="Your mood board"
        intro={MOODBOARD_INTRO}
      >
        <MoodBoard
          initial={ofKind("moodboard")}
          proposal={data.moodboardProposal}
          pairingId={p.font_pairing}
          businessName={p.orgName}
          tagline={p.tagline}
          readOnly={readOnly}
          onChanged={markSaved}
        />
      </FieldGroup>
    </>
  );
}
