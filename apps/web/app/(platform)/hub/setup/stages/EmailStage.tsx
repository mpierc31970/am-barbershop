"use client";
// Step 3 · Email (06-22; 06-UI-SPEC "3 · Email", "Email routing"; ONB-01, ONB-09, ONB-10,
// D173). The step intro, then the same "Where should your email go?" component Settings ›
// Email uses. Addresses save on Save and send confirmation; every saved change marks the step
// saved. An Editor sees it read-only.
import { markStageSavedAction } from "../../../../actions/intake";
import { EmailRouting } from "../../_intake/EmailRouting";
import type { StageFormProps } from "../[stage]/stage-forms";

export const EMAIL_STAGE_INTRO =
  "Your site sends you messages and replies to customers for you. Tell us where they should go.";

const markSaved = () => void markStageSavedAction("email");

export function EmailStage({ data, readOnly }: StageFormProps) {
  return (
    <>
      <p className="max-w-[68ch] text-base text-hub-ink">{EMAIL_STAGE_INTRO}</p>
      {data.email ? (
        <EmailRouting
          data={data.email}
          businessName={data.profile.orgName}
          readOnly={readOnly}
          onChanged={markSaved}
        />
      ) : null}
    </>
  );
}
