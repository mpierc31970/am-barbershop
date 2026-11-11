"use client";
// SimilarIdeas (12-11 choice 5; CUSTOM-01, D297; 12-UI-SPEC "Suggest a feature form" lines
// 549-552). While the person types an idea title (≥ 3 characters, 250 ms debounce) it shows up
// to 3 existing ideas that share a word with it, under SIMILAR-HEAD, each with its status
// badge and a compact 44×44 VoteButton that votes in place (`onVoted` → the page's toast
// "Vote added to {title}."). An sr-only polite region announces the count ("2 similar
// ideas"); the panel itself is not live. No panel when nothing is similar. Built ideas are not offered
// (nothing left to vote toward). Idea text is React text only (T-12-11-01).
import type { IdeaCard } from "@cds/core/support";
import { useEffect, useState } from "react";
import { Badge } from "../../Badge";
import { SUPPORT_UI_COPY } from "../copy";
import { IDEAS_COPY, ideaStatusTone } from "./IdeaList";
import { VoteButton } from "./VoteButton";

export const SIMILAR_MIN_CHARS = 3;
export const SIMILAR_DEBOUNCE_MS = 250;
export const SIMILAR_MAX = 3;

/** Words of 3+ letters in the title being typed. */
function words(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= SIMILAR_MIN_CHARS),
    ),
  );
}

/** Up to SIMILAR_MAX ideas sharing the most words with `query`, ties in the given order. */
export function findSimilarIdeas(
  ideas: readonly IdeaCard[],
  query: string,
): IdeaCard[] {
  if (query.trim().length < SIMILAR_MIN_CHARS) return [];
  const ws = words(query);
  if (ws.length === 0) return [];
  const scored: { idea: IdeaCard; score: number; at: number }[] = [];
  ideas.forEach((idea, at) => {
    if (idea.status === "built") return;
    const hay = `${idea.title} ${idea.description}`.toLowerCase();
    const score = ws.filter((w) => hay.includes(w)).length;
    if (score > 0) scored.push({ idea, score, at });
  });
  scored.sort((a, b) => b.score - a.score || a.at - b.at);
  return scored.slice(0, SIMILAR_MAX).map((s) => s.idea);
}

export interface SimilarIdeasProps {
  /** The Idea field's current text. */
  query: string;
  /** Candidate ideas (server list, ranked). */
  ideas: readonly IdeaCard[];
  canVote: boolean;
  onToggle(id: string, next: boolean): void | Promise<unknown>;
  /** A vote saved here: the page shows "Vote added to {title}.". */
  onVoted?(message: string): void;
  /** ERR-VOTE to the page's toast. */
  onError?(message: string): void;
}

export function SimilarIdeas({
  query,
  ideas,
  canVote,
  onToggle,
  onVoted,
  onError,
}: SimilarIdeasProps) {
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSettled(query), SIMILAR_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const matches = findSimilarIdeas(ideas, settled);
  // Only the count is live (WR-D06): the panel itself is not, so a pause in typing never
  // re-reads every title and vote button over the person's own typing.
  return (
    <div className="font-hub">
      <p aria-live="polite" className="sr-only" data-similar-count="">
        {matches.length > 0 ? IDEAS_COPY.similarCount(matches.length) : ""}
      </p>
      {matches.length === 0 ? null : (
        <div className="rounded bg-hub-surface-2 p-4">
          <p className="text-sm font-semibold text-hub-ink">
            {SUPPORT_UI_COPY.SIMILAR_HEAD}
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {matches.map((i) => (
              <li
                key={i.id}
                data-similar={i.id}
                className="flex items-center gap-3"
              >
                <VoteButton
                  compact
                  title={i.title}
                  count={i.votes}
                  voted={i.voted}
                  canVote={canVote}
                  onToggle={(next) => onToggle(i.id, next)}
                  onError={onError}
                  onSaved={(next) => {
                    if (next) onVoted?.(IDEAS_COPY.votedToast(i.title));
                  }}
                />
                <span className="min-w-0 flex-1 text-base font-semibold break-words text-hub-ink">
                  {i.title}
                </span>
                <Badge tone={ideaStatusTone(i.status)}>
                  {IDEAS_COPY.status[i.status]}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
