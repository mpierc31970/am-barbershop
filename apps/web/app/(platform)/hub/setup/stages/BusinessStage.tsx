"use client";
// Step 1 · Your business (06-19; 06-UI-SPEC "1 · Your business", "Font pairing cards";
// ONB-01, ONB-04, CONTEXT A4-Q4, D-UI-P6-26, D-UI-P6-27). Business name (also renames the
// organization), tagline, business type from the org's path, logo, and the style cards with
// live samples ("Let CDS choose" is the default). Every field saves itself through
// saveProfileAction("business", …); a logo upload marks the step saved. An Editor sees every
// field disabled (the frame shows the read-only line; the chokepoint refuses writes too).
import { useState } from "react";
import {
  markStageSavedAction,
  saveProfileAction,
} from "../../../../actions/intake";
import {
  BusinessInfoFields,
  LogoField,
} from "../../_intake/BusinessInfoFields";
import { FieldGroup } from "../../_intake/FieldGroup";
import { FontPairingPicker } from "../../_intake/FontPairingPicker";
import { useProfileField, type Patch } from "../../_intake/useProfileField";
import type { StageFormProps } from "../[stage]/stage-forms";

const save = (patch: Patch) => saveProfileAction("business", patch);

export function BusinessStage({ data, readOnly }: StageFormProps) {
  const p = data.profile;
  const [name, setName] = useState(p.orgName);
  const [pairing, setPairing] = useState(p.font_pairing);
  const savePairing = useProfileField("font_pairing", p.font_pairing, save);

  return (
    <>
      <FieldGroup id="group-business" title="About your business">
        <BusinessInfoFields
          profile={p}
          path={data.snapshot.path}
          readOnly={readOnly}
          onSave={save}
          onNameChange={setName}
        />
        <LogoField
          initial={data.media.filter((m) => m.kind === "logo").slice(0, 1)}
          businessName={name}
          readOnly={readOnly}
          onUploaded={() => void markStageSavedAction("business")}
        />
      </FieldGroup>
      <FieldGroup id="group-style" title="Your site's style">
        <FontPairingPicker
          value={pairing}
          businessName={name}
          readOnly={readOnly}
          error={savePairing.error}
          onChange={(id) => {
            setPairing(id);
            savePairing.save(id);
          }}
        />
      </FieldGroup>
    </>
  );
}
