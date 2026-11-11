"use client";
// Step 4 · Your words & services (06-20; 06-UI-SPEC "4 · Your words & services"; ONB-01,
// ONB-02, ONB-03, D37). About (2,000, counter), Mission and the Headline ("The first line
// visitors should read"), each optional with its fallback and saved on blur through
// saveProfileAction("words", …); then the Services list (setup context), whose changes mark
// the step saved. An Editor sees every field disabled and the list read-only.
import { TextArea, TextField } from "@cds/ui/hub";
import { useState } from "react";
import {
  markStageSavedAction,
  saveProfileAction,
} from "../../../../actions/intake";
import { OPTIONAL } from "../../_intake/BusinessInfoFields";
import { FieldGroup } from "../../_intake/FieldGroup";
import { ServicesSection } from "../../_intake/ServicesSection";
import { useProfileField, type Patch } from "../../_intake/useProfileField";
import type { StageFormProps } from "../[stage]/stage-forms";

export const WORDS_COPY = {
  about: "About",
  aboutHelper:
    "A few paragraphs in your own words. Don't worry about polish; Support edits it with you. Leave empty and we'll start from your business type and town.",
  mission: "Mission",
  missionHelper:
    "Why you do what you do, in a sentence or two. Leave empty to skip it.",
  headline: "The first line visitors should read",
  headlineHelper:
    "Like 'Real bread, baked before sunrise.' Leave empty and Support writes one for you.",
} as const;

export const ABOUT_MAX = 2000;
export const MISSION_MAX = 600;
export const HEADLINE_MAX = 120;

const save = (patch: Patch) => saveProfileAction("words", patch);

export function WordsStage({ data, readOnly }: StageFormProps) {
  const p = data.profile;
  const [about, setAbout] = useState(p.about);
  const [mission, setMission] = useState(p.mission);
  const [headline, setHeadline] = useState(p.headline);
  const saveAbout = useProfileField("about", p.about, save);
  const saveMission = useProfileField("mission", p.mission, save);
  const saveHeadline = useProfileField("headline", p.headline, save);

  return (
    <>
      <FieldGroup id="group-words" title="About your business">
        <div className="flex flex-col gap-6">
          <TextArea
            id="field-about"
            label={WORDS_COPY.about}
            labelExtra={OPTIONAL}
            helper={WORDS_COPY.aboutHelper}
            rows={8}
            counter={{ value: about.length, max: ABOUT_MAX }}
            value={about}
            disabled={readOnly}
            error={saveAbout.error}
            onChange={(e) => setAbout(e.target.value)}
            onBlur={() => saveAbout.save(about.trim())}
          />
          <TextArea
            id="field-mission"
            label={WORDS_COPY.mission}
            labelExtra={OPTIONAL}
            helper={WORDS_COPY.missionHelper}
            rows={3}
            counter={{ value: mission.length, max: MISSION_MAX }}
            value={mission}
            disabled={readOnly}
            error={saveMission.error}
            onChange={(e) => setMission(e.target.value)}
            onBlur={() => saveMission.save(mission.trim())}
          />
          <TextField
            id="field-headline"
            label={WORDS_COPY.headline}
            labelExtra={OPTIONAL}
            helper={WORDS_COPY.headlineHelper}
            maxLength={HEADLINE_MAX}
            value={headline}
            disabled={readOnly}
            error={saveHeadline.error}
            onChange={(e) => setHeadline(e.target.value)}
            onBlur={() => saveHeadline.save(headline.trim())}
          />
        </div>
      </FieldGroup>
      <ServicesSection
        data={data.services ?? []}
        readOnly={readOnly}
        context="setup"
        onChanged={() => void markStageSavedAction("words")}
      />
    </>
  );
}
