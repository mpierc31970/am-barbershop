"use client";
// IdeaList (12-11 choice 5; CUSTOM-01, D297, D-UI-P12-21, D-UI-P12-22; 12-UI-SPEC Ideas lines
// 527-546). A <ul> with dividers, rows min 88px: VoteButton on the left; title + status badge,
// description (2-line clamp, Show more expands in place), "Suggested 9 Oct" + " · You
// suggested this" only when `mine` (a boolean: the component never receives another site's
// name or org, T-12-11-03). Filters by `status` and the search `query` (title and description,
// client side over the server list) and keeps the server's ranking (votes, then newest).
// Empty status: IDEAS-EMPTY-{status}; search no match: IDEAS-NOMATCH with Suggest it. The
// merged-idea notice and the just-posted highlight (2px outline for 2s, held still under
// reduced motion) are props. Idea text is React text only (T-12-11-01).
import type { IdeaCard } from "@cds/core/support";
import { useEffect, useState } from "react";
import type { HubLinkComponent } from "../../AddonCard";
import { Badge, type BadgeTone } from "../../Badge";
import { InlineAlert } from "../../feedback";
import { formatDayMonth } from "../../today/copy";
import { SUPPORT_UI_COPY } from "../copy";
import { VoteButton } from "./VoteButton";

export type IdeaStatus = IdeaCard["status"];

export const IDEA_STATUSES: readonly IdeaStatus[] = Object.freeze([
  "suggested",
  "considering",
  "planned",
  "built",
]);

export const IDEAS_COPY = Object.freeze({
  status: Object.freeze({
    suggested: "Suggested",
    considering: "Considering",
    planned: "Planned",
    built: "Built",
  }) as Readonly<Record<IdeaStatus, string>>,
  suggestedOn: (day: string) => (day ? `Suggested ${day}` : "Suggested"),
  mine: "You suggested this",
  merged: "This idea was merged with a similar one. Your vote carried over.",
  votedToast: (title: string) => `Vote added to ${title}.`,
  /** SimilarIdeas' polite count (12-REVIEW WR-D06; UI-SPEC a11y line 842). */
  similarCount: (n: number) =>
    n === 1 ? "1 similar idea" : `${n} similar ideas`,
});

export const SUGGEST_IDEA_HREF = "/hub/support/tickets/new?type=suggestion";
export const IDEA_HIGHLIGHT_MS = 2000;

export function ideaStatusTone(s: IdeaStatus): BadgeTone {
  return `i-${s}` as BadgeTone;
}

/** Case-insensitive match of every word of `query` in the title or description. */
export function matchIdea(idea: IdeaCard, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${idea.title} ${idea.description}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function filterIdeas(
  ideas: readonly IdeaCard[],
  status: IdeaStatus,
  query: string,
): IdeaCard[] {
  return ideas.filter((i) => i.status === status && matchIdea(i, query));
}

export interface IdeaListProps {
  /** Server-ranked (votes, then newest); merged ideas are never in it. */
  ideas: readonly IdeaCard[];
  /** The search box value. */
  query: string;
  /** `?status=` (default Suggested). */
  status: IdeaStatus;
  canVote: boolean;
  onToggle(id: string, next: boolean): void | Promise<unknown>;
  /** Business time zone for "9 Oct". */
  timeZone: string;
  /** The just-posted idea. */
  highlightId?: string | null;
  /** Opened through a merged idea's old link. */
  mergedNotice?: boolean;
  /** ERR-VOTE to the page's toast. */
  onError?(message: string): void;
  suggestHref?: string;
  LinkComponent?: HubLinkComponent;
}

const LINK =
  "rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

function IdeaRow({
  idea,
  canVote,
  onToggle,
  onError,
  timeZone,
  highlight,
}: {
  idea: IdeaCard;
  canVote: boolean;
  onToggle: IdeaListProps["onToggle"];
  onError?: (message: string) => void;
  timeZone: string;
  highlight: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lit, setLit] = useState(highlight);
  useEffect(() => {
    if (!highlight) return;
    setLit(true);
    const t = setTimeout(() => setLit(false), IDEA_HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlight]);

  const meta = IDEAS_COPY.suggestedOn(formatDayMonth(idea.created, timeZone));
  return (
    <li
      data-idea={idea.id}
      data-highlight={lit ? "" : undefined}
      className={
        "flex min-h-[88px] items-start gap-4 rounded py-4 " +
        "motion-safe:transition-[outline-color] motion-safe:duration-500 " +
        (lit
          ? "outline-2 outline-offset-2 outline-hub-accent"
          : "outline-2 outline-offset-2 outline-transparent")
      }
    >
      <VoteButton
        title={idea.title}
        count={idea.votes}
        voted={idea.voted}
        canVote={canVote}
        onToggle={(next) => onToggle(idea.id, next)}
        onError={onError}
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold break-words text-hub-ink">
            {idea.title}
          </span>
          <Badge tone={ideaStatusTone(idea.status)}>
            {IDEAS_COPY.status[idea.status]}
          </Badge>
        </p>
        {idea.description ? (
          <p
            className={
              "mt-1 max-w-[68ch] text-base break-words whitespace-pre-line text-hub-ink-muted" +
              (expanded ? "" : " line-clamp-2")
            }
          >
            {idea.description}
          </p>
        ) : null}
        {idea.description.length > 140 ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="rounded text-sm text-hub-ink-muted underline underline-offset-2 hover:text-hub-ink"
          >
            {SUPPORT_UI_COPY.BUTTONS.showMore}
          </button>
        ) : null}
        <p className="mt-1 text-sm text-hub-ink-muted">
          {idea.mine ? `${meta} · ${IDEAS_COPY.mine}` : meta}
        </p>
      </div>
    </li>
  );
}

export function IdeaList({
  ideas,
  query,
  status,
  canVote,
  onToggle,
  timeZone,
  highlightId = null,
  mergedNotice = false,
  onError,
  suggestHref = SUGGEST_IDEA_HREF,
  LinkComponent,
}: IdeaListProps) {
  const Link = LinkComponent ?? "a";
  const q = query.trim();
  const inStatus = ideas.filter((i) => i.status === status);
  const rows = filterIdeas(ideas, status, q);

  let body;
  if (inStatus.length === 0 && !q) {
    body = (
      <p className="text-base text-hub-ink-muted">
        {SUPPORT_UI_COPY.IDEAS_EMPTY[status]}
      </p>
    );
  } else if (rows.length === 0) {
    body = (
      <p className="text-base text-hub-ink-muted">
        {SUPPORT_UI_COPY.IDEAS_NOMATCH(q)}{" "}
        <Link href={suggestHref} className={LINK}>
          {SUPPORT_UI_COPY.BUTTONS.suggestIt}
        </Link>{" "}
        {SUPPORT_UI_COPY.IDEAS_NOMATCH_TAIL}
      </p>
    );
  } else {
    body = (
      <ul className="divide-y divide-hub-border">
        {rows.map((i) => (
          <IdeaRow
            key={i.id}
            idea={i}
            canVote={canVote}
            onToggle={onToggle}
            onError={onError}
            timeZone={timeZone}
            highlight={i.id === highlightId}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-4 font-hub">
      {mergedNotice ? (
        <InlineAlert tone="info">{IDEAS_COPY.merged}</InlineAlert>
      ) : null}
      {body}
    </div>
  );
}
