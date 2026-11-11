"use client";
// Suggest a feature fields (12-27 choice 2; CUSTOM-01, D297, D119; 12-UI-SPEC lines 546-560,
// D-UI-P12-7). Shown in place of the ticket fields when the Get help form's type is
// `suggestion` (the type cards stay on top so the person can switch back; the text typed in
// either form is kept). In order:
//   1. Idea (TextField, 80, helper "A short name, like 'Gift cards in the store'").
//   2. SimilarIdeas (≥ 3 characters, 250 ms debounce): up to 3 visible, not-built ideas that
//      share a word, each with a compact VoteButton that votes in place
//      (toggleIdeaVoteAction; Toast "Vote added to {title}.", ERR-VOTE on failure).
//   3. Describe it (TextArea, 6 rows, 2,000, helper "What would it help you do?").
//   4. IDEA-PUBLIC, verbatim, as an info InlineAlert before Post (T-12-27-01).
//   5. Footer: "CDS may ask you about it in a ticket. Ideas don't have a reply time.", primary
//      Post idea (submits the surrounding form), ghost Discard.
// Idea text is React text only.
import type { IdeaCard } from "@cds/core/support";
import {
  Button,
  InlineAlert,
  TextArea,
  TextField,
  useToast,
} from "@cds/ui/hub";
import { SUPPORT_UI_COPY, SimilarIdeas } from "@cds/ui/hub/support";
import { Lightbulb } from "lucide-react";
import { toggleIdeaVoteAction } from "../../../../../actions/support-lists";

/** P12-P5 (the chokepoint enforces the same caps). */
export const IDEA_TITLE_MAX = 80;
export const IDEA_DESCRIPTION_MAX = 2000;

export const IDEA_FORM_COPY = Object.freeze({
  h1: "Suggest a feature",
  title: "Idea",
  titleHelper: "A short name, like 'Gift cards in the store'",
  description: "Describe it",
  descriptionHelper: "What would it help you do?",
  footer:
    "CDS may ask you about it in a ticket. Ideas don't have a reply time.",
  titleRequired: "Give your idea a short name.",
  descriptionRequired: "Describe your idea.",
  posted: "Idea posted. Your site voted for it.",
  /** D-UI-P12-26: a scanner-held idea is not listed until CDS reviews it. */
  held: "Idea sent. CDS will review it before it's listed.",
});

export type IdeaField = "ideaTitle" | "ideaDescription";

export interface IdeaFieldsProps {
  title: string;
  description: string;
  onTitle(next: string): void;
  onDescription(next: string): void;
  errors: Partial<Record<IdeaField, string>>;
  /** Visible, not-built ideas for the similar-idea panel. */
  ideas: readonly IdeaCard[];
  sending: boolean;
  onDiscard(): void;
}

export function IdeaFields({
  title,
  description,
  onTitle,
  onDescription,
  errors,
  ideas,
  sending,
  onDiscard,
}: IdeaFieldsProps) {
  const toast = useToast();

  async function vote(id: string): Promise<void> {
    const res = await toggleIdeaVoteAction(id);
    if (!res.ok) throw new Error(res.message);
  }

  return (
    <div className="flex flex-col gap-8" data-idea-form="">
      <div className="flex flex-col gap-4">
        <TextField
          id="idea-title"
          label={IDEA_FORM_COPY.title}
          value={title}
          maxLength={IDEA_TITLE_MAX}
          required
          readOnly={sending}
          helper={IDEA_FORM_COPY.titleHelper}
          error={errors.ideaTitle}
          onChange={(e) => onTitle(e.currentTarget.value)}
        />
        <div data-similar-ideas="">
          <SimilarIdeas
            query={title}
            ideas={ideas}
            canVote
            onToggle={(id) => vote(id)}
            onVoted={(message) => toast.show({ message })}
            onError={(message) => toast.show({ message })}
          />
        </div>
      </div>

      <TextArea
        id="idea-description"
        label={IDEA_FORM_COPY.description}
        value={description}
        rows={6}
        maxLength={IDEA_DESCRIPTION_MAX}
        required
        readOnly={sending}
        helper={IDEA_FORM_COPY.descriptionHelper}
        error={errors.ideaDescription}
        onChange={(e) => onDescription(e.currentTarget.value)}
      />

      <div data-idea-public="">
        <InlineAlert tone="info">{SUPPORT_UI_COPY.IDEA_PUBLIC}</InlineAlert>
      </div>

      <div className="flex flex-col gap-4 border-t border-hub-border pt-6">
        <p className="text-sm text-hub-ink-muted" data-idea-footer="">
          {IDEA_FORM_COPY.footer}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            icon={<Lightbulb aria-hidden size={16} strokeWidth={2} />}
            loading={sending}
            loadingLabel={SUPPORT_UI_COPY.BUTTONS.posting}
          >
            {SUPPORT_UI_COPY.BUTTONS.postIdea}
          </Button>
          <Button variant="ghost" onClick={onDiscard} disabled={sending}>
            {SUPPORT_UI_COPY.BUTTONS.discard}
          </Button>
        </div>
      </div>
    </div>
  );
}
