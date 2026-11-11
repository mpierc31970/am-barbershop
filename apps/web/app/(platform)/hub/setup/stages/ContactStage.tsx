"use client";
// Step 2 · Contact & hours (06-19; 06-UI-SPEC "2 · Contact & hours", "Hours editor";
// ONB-01, ONB-13, D257). How customers reach you (phone or email, one required), where you
// are (address, service area, time zone prefilled from the device), opening hours and social
// links. Every field saves itself through saveProfileAction("contact", …); hours save
// debounced 800ms. An Editor sees every field disabled.
import { useState } from "react";
import { saveProfileAction } from "../../../../actions/intake";
import { ContactFields } from "../../_intake/ContactFields";
import { HoursSection } from "../../_intake/HoursSection";
import type { Patch } from "../../_intake/useProfileField";
import type { StageFormProps } from "../[stage]/stage-forms";

const save = (patch: Patch) => saveProfileAction("contact", patch);

export function ContactStage({ data, readOnly }: StageFormProps) {
  const p = data.profile;
  const [zone, setZone] = useState(p.time_zone);
  return (
    <>
      <ContactFields
        profile={p}
        readOnly={readOnly}
        onSave={save}
        onTimeZoneChange={setZone}
        hours={
          <HoursSection
            hours={p.hours}
            timeZone={zone}
            readOnly={readOnly}
            onSave={save}
          />
        }
      />
    </>
  );
}
