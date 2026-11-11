"use client";
// Step 5 · People & proof (06-20; 06-UI-SPEC "5 · People & proof"; ONB-01, ONB-13; CONTEXT
// A3-Q5; D-UI-P6-18; invariant 3). The Team list (setup context; optional, fallback: no team
// section), then "Your add-ons": a proof section for each picked add-on with an intake
// contribution (held on the setup record, nothing installed) and one line per proof add-on
// not picked, linking to its add-on page. Every saved change marks the step saved. An Editor
// sees everything read-only.
import { markStageSavedAction } from "../../../../actions/intake";
import {
  AddonProofSection,
  ProofOfferLine,
} from "../../_intake/AddonProofSection";
import { FieldGroup } from "../../_intake/FieldGroup";
import { TeamSection } from "../../_intake/TeamSection";
import type { StageFormProps } from "../[stage]/stage-forms";

const markSaved = () => void markStageSavedAction("people");

export function PeopleStage({ data, readOnly }: StageFormProps) {
  const hasAddons = data.proof.length > 0 || data.proofOffers.length > 0;
  return (
    <>
      <TeamSection
        data={data.team ?? []}
        readOnly={readOnly}
        context="setup"
        onChanged={markSaved}
      />
      {hasAddons ? (
        <FieldGroup id="group-addons" title="Your add-ons">
          <div className="flex flex-col gap-8">
            {data.proof.map((view) => (
              <AddonProofSection
                key={view.slug}
                view={view}
                readOnly={readOnly}
                onChanged={markSaved}
              />
            ))}
            {data.proofOffers.length > 0 ? (
              <div className="flex flex-col gap-2">
                {data.proofOffers.map((o) => (
                  <ProofOfferLine key={o.slug} offer={o} />
                ))}
              </div>
            ) : null}
          </div>
        </FieldGroup>
      ) : null}
    </>
  );
}
