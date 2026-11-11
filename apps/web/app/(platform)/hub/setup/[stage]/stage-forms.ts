// The step form map (06-18). /hub/setup/[stage] renders the StageFrame around the form
// registered here for the slug. 06-18 ships "Domain & the rest"; 06-19 adds business and
// contact, 06-20 words and people, 06-21 look (photos and mood board), 06-22 email: all seven
// steps have a form. A slug with no form would render the frame with the load error
// (defensive).
// Kept out of page.tsx because a Next page file may only export the page's own fields.
import type { StageSlug } from "@cds/core/intake";
import type { JSX } from "react";
import type { StageData } from "../../../../../lib/intake";
import { BusinessStage } from "../stages/BusinessStage";
import { ContactStage } from "../stages/ContactStage";
import { EmailStage } from "../stages/EmailStage";
import { LookStage } from "../stages/LookStage";
import { PeopleStage } from "../stages/PeopleStage";
import { TheRestStage } from "../stages/TheRestStage";
import { WordsStage } from "../stages/WordsStage";

export type StageFormProps = { data: StageData; readOnly: boolean };

export const STAGE_FORMS: Partial<
  Record<StageSlug, (props: StageFormProps) => JSX.Element>
> = {
  business: BusinessStage,
  contact: ContactStage,
  email: EmailStage,
  words: WordsStage,
  people: PeopleStage,
  look: LookStage,
  "the-rest": TheRestStage,
};
