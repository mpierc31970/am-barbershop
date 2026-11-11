"use client";
// VoteButton (12-11 choice 4; CUSTOM-01, D297, D-UI-P12-20; 12-UI-SPEC Ideas lines 534-538,
// a11y 843-844). A 56×56 toggle (compact 44×44 in SimilarIdeas): ChevronUp 16 over the count.
// `aria-pressed`, name "Vote for {title}, 12 votes" / "Remove your vote for {title}, 13 votes".
// Not voted: --hub-surface, 1px --hub-border-strong. Voted: --hub-surface-2, 2px ink border,
// count 600 ink. No accent colour: voting is not the screen's primary action.
// Optimistic: the count flips at once and a polite live region says "Voted. 13 votes."; a
// rejected `onToggle` reverts and shows ERR-VOTE (through `onError`, which the page wires to
// its toast, else inline). Clicks are ignored until the last accepted one has saved and at
// least 300 ms have passed, so a double tap is one vote and toggles never overlap. Viewers (`canVote` false) get the count in a plain box, sr "12 votes".
import { ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SUPPORT_UI_COPY } from "../copy";

export const VOTE_DEBOUNCE_MS = 300;

export const VOTE_COPY = Object.freeze({
  votes: (n: number) => `${n} ${n === 1 ? "vote" : "votes"}`,
  vote: (title: string, n: number) =>
    `Vote for ${title}, ${VOTE_COPY.votes(n)}`,
  unvote: (title: string, n: number) =>
    `Remove your vote for ${title}, ${VOTE_COPY.votes(n)}`,
  voted: (n: number) => `Voted. ${VOTE_COPY.votes(n)}.`,
  removed: (n: number) => `Vote removed. ${VOTE_COPY.votes(n)}.`,
});

export interface VoteButtonProps {
  /** Idea title, for the accessible name. */
  title: string;
  count: number;
  voted: boolean;
  /** Owner/Admin/Editor; Viewers see a plain count. */
  canVote: boolean;
  /** Persist the new state (true = vote). A rejection reverts the optimistic change. */
  onToggle(next: boolean): void | Promise<unknown>;
  /** 44×44 (SimilarIdeas). */
  compact?: boolean;
  /** Show ERR-VOTE (the page's toast). Without it the error shows inline. */
  onError?(message: string): void;
  /** After a vote is saved (SimilarIdeas: "Vote added to {title}."). */
  onSaved?(next: boolean): void;
}

const SIZE = { full: "h-14 w-14", compact: "h-11 w-11" } as const;

export function VoteButton({
  title,
  count,
  voted,
  canVote,
  onToggle,
  compact = false,
  onError,
  onSaved,
}: VoteButtonProps) {
  const [state, setState] = useState({ voted, count });
  const [said, setSaid] = useState("");
  const [failed, setFailed] = useState(false);
  const locked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A fresh server value (revalidation) replaces the optimistic one.
  useEffect(() => {
    setState({ voted, count });
  }, [voted, count]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const size = compact ? SIZE.compact : SIZE.full;

  if (!canVote) {
    return (
      <div
        className={
          `${size} flex shrink-0 flex-col items-center justify-center rounded ` +
          "border border-hub-border bg-hub-surface font-hub text-hub-ink-muted"
        }
      >
        <span aria-hidden className="text-sm font-semibold tabular-nums">
          {count}
        </span>
        <span className="sr-only">{VOTE_COPY.votes(count)}</span>
      </div>
    );
  }

  function click() {
    if (locked.current) return;
    locked.current = true;
    // The lock holds until BOTH the 300 ms debounce has passed and the save has settled
    // (12-REVIEW WR-D02): the server toggles, so a second click while the first is in
    // flight could leave the server opposite to the person's last click.
    let waiting = 2;
    const release = () => {
      waiting -= 1;
      if (waiting === 0) locked.current = false;
    };
    timer.current = setTimeout(release, VOTE_DEBOUNCE_MS);

    const before = state;
    const next = !before.voted;
    const nextCount = Math.max(0, before.count + (next ? 1 : -1));
    setState({ voted: next, count: nextCount });
    setFailed(false);
    setSaid(next ? VOTE_COPY.voted(nextCount) : VOTE_COPY.removed(nextCount));

    const fail = () => {
      setState(before);
      setSaid("");
      if (onError) onError(SUPPORT_UI_COPY.ERR_VOTE);
      else setFailed(true);
    };
    try {
      void Promise.resolve(onToggle(next))
        .then(() => onSaved?.(next), fail)
        .finally(release);
    } catch {
      fail();
      release();
    }
  }

  const on = state.voted;
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <button
        type="button"
        aria-pressed={on}
        aria-label={
          on
            ? VOTE_COPY.unvote(title, state.count)
            : VOTE_COPY.vote(title, state.count)
        }
        onClick={click}
        className={
          `${size} flex flex-col items-center justify-center rounded font-hub ` +
          "transition-colors duration-150 " +
          (on
            ? "border-2 border-hub-ink bg-hub-surface-2 font-semibold text-hub-ink"
            : "border border-hub-border-strong bg-hub-surface text-hub-ink-muted " +
              "hover:bg-hub-surface-2 hover:text-hub-ink")
        }
      >
        <ChevronUp aria-hidden size={16} strokeWidth={2} />
        <span aria-hidden className="text-sm font-semibold tabular-nums">
          {state.count}
        </span>
      </button>
      <span aria-live="polite" className="sr-only">
        {said}
      </span>
      {failed ? (
        <span
          role="alert"
          className="max-w-40 font-hub text-sm text-hub-danger"
        >
          {SUPPORT_UI_COPY.ERR_VOTE}
        </span>
      ) : null}
    </div>
  );
}
