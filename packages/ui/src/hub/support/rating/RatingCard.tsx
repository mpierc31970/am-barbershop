"use client";
// RatingCard (13-42 choice 1; STAFF-21, D212, D-UI-P13-16, D-UI-P13-24; 13-UI-SPEC "Rating
// (tenant side)" lines 935-958, a11y line 1107). Under the hub ticket thread, above the
// composer, on --hub-surface-2 (owner input, not CDS speaking: no violet, no accent fill on the
// choice). RATING-Q, then two 44px secondary buttons (ThumbsUp "Yes" / ThumbsDown "No") with
// `aria-pressed` and names that carry the meaning ("Yes, resolved well" / "No, not resolved
// well"): words and icons, never colour alone. Pressed = 2px ink border on --hub-surface (the
// P12 vote rule).
//   - Instant mode (the ticket page): a tap saves at once (optimistic; ERR-SAVE reverts). Taps
//     are saved in order, so the server always ends on the last choice. After a rating: "Thanks.
//     CDS reads every rating." and an optional comment (≤ 500, 3 rows, counter) with Save
//     comment ("Comment saved."). The other button stays available until Closed.
//   - Confirm mode (`preselect`, the email link page; RESEARCH Pitfall 10): the link's choice is
//     pressed but nothing is saved until **Save rating** (a POST). Opening a link never writes.
//   - Hidden unless Resolved, or Closed with a rating ("You rated this Yes."). Hidden for people
//     who cannot rate (Viewers, grants-only). Under impersonation the card is read-only with
//     "Ratings are turned off while viewing as CDS staff." and no write controls.
import {
  RATING_COMMENT_MAX,
  type RatingChoice,
  type TicketStatus,
} from "@cds/core/support";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../Button";
import { TextArea } from "../../fields";
import { SUPPORT_UI_COPY } from "../copy";
import { RATING_CARD_COPY } from "./copy";

const C = RATING_CARD_COPY;

export type RatingSaveInput = {
  rating: RatingChoice;
  /** Omitted keeps the stored comment; "" clears it. */
  comment?: string;
};

export type RatingSaveResult =
  | { ok: true; rating: RatingChoice; comment: string | null }
  | { ok: false; message: string };

export interface RatingCardProps {
  status: TicketStatus | string;
  /** The stored rating, or null. */
  rating: RatingChoice | null;
  comment: string | null;
  /** Owner, Admin, Editor or the filer (`isRater`); everyone else sees nothing. */
  canRate: boolean;
  /** CDS staff viewing as the site: read-only, no write controls. */
  impersonating?: boolean;
  /** Email link page: this choice starts pressed and nothing saves until Save rating. */
  preselect?: RatingChoice | null;
  onRate(input: RatingSaveInput): Promise<RatingSaveResult>;
  /** Toast a message (the page's ToastRegion). Without it messages show inline. */
  notify?(message: string): void;
  /** After a save lands (the link page shows its done state). */
  onSaved?(result: { rating: RatingChoice; comment: string | null }): void;
}

const PANEL =
  "flex flex-col gap-4 rounded-lg bg-hub-surface-2 p-6 font-hub text-hub-ink";

function choiceClass(on: boolean): string {
  return (
    "inline-flex min-h-11 items-center justify-center gap-2 rounded px-4 font-hub " +
    "font-semibold transition-colors duration-150 disabled:cursor-not-allowed " +
    "disabled:opacity-50 " +
    (on
      ? "border-2 border-hub-ink bg-hub-surface text-hub-ink"
      : "border border-hub-border-strong bg-hub-surface text-hub-ink hover:bg-hub-surface-2")
  );
}

function ChoiceButtons({
  value,
  onPick,
  disabled,
}: {
  value: RatingChoice | null;
  onPick(choice: RatingChoice): void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2" data-rating-choices="">
      <button
        type="button"
        aria-pressed={value === "up"}
        aria-label={C.yesName}
        data-rating-choice="up"
        disabled={disabled}
        onClick={() => onPick("up")}
        className={choiceClass(value === "up")}
      >
        <ThumbsUp aria-hidden size={16} strokeWidth={2} />
        {C.yes}
      </button>
      <button
        type="button"
        aria-pressed={value === "down"}
        aria-label={C.noName}
        data-rating-choice="down"
        disabled={disabled}
        onClick={() => onPick("down")}
        className={choiceClass(value === "down")}
      >
        <ThumbsDown aria-hidden size={16} strokeWidth={2} />
        {C.no}
      </button>
    </div>
  );
}

export function RatingCard({
  status,
  rating,
  comment,
  canRate,
  impersonating = false,
  preselect = null,
  onRate,
  notify,
  onSaved,
}: RatingCardProps) {
  const id = useId();
  const confirmMode = preselect !== null;
  const [choice, setChoice] = useState<RatingChoice | null>(
    preselect ?? rating,
  );
  const [text, setText] = useState(comment ?? "");
  const [savingComment, setSavingComment] = useState(false);
  const [savingRating, setSavingRating] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  // The last choice that saved on the server (what an ERR-SAVE reverts to).
  const saved = useRef<RatingChoice | null>(rating);
  // Taps save in order; only the newest tap's failure reverts.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const seq = useRef(0);

  // A fresh server value (refresh after a save) replaces local state in instant mode.
  useEffect(() => {
    saved.current = rating;
    if (!confirmMode) setChoice(rating);
  }, [rating, confirmMode]);

  function say(text: string, error = false) {
    if (notify) notify(text);
    else setMessage({ text, error });
  }

  if (status === "closed") {
    if (!rating) return null;
    return (
      <p
        className="font-hub text-sm text-hub-ink-muted"
        data-rating-card="closed"
      >
        {C.rated(rating)}
      </p>
    );
  }
  if (status !== "resolved") return null;
  if (!canRate && !impersonating) return null;

  if (impersonating) {
    return (
      <section
        aria-labelledby={`${id}-q`}
        className={PANEL}
        data-rating-card="readonly"
      >
        <p id={`${id}-q`} className="font-semibold">
          {C.question}
        </p>
        <p className="text-sm text-hub-ink">
          {rating ? C.rated(rating) : C.notRated}
        </p>
        <p className="text-sm text-hub-ink-muted">{C.impersonating}</p>
      </section>
    );
  }

  function pickInstant(next: RatingChoice) {
    if (next === choice) return;
    setChoice(next);
    setMessage(null);
    const mine = ++seq.current;
    queue.current = queue.current.then(async () => {
      let res: RatingSaveResult;
      try {
        res = await onRate({ rating: next });
      } catch {
        res = { ok: false, message: SUPPORT_UI_COPY.ERR_SAVE };
      }
      if (res.ok) {
        saved.current = res.rating;
        onSaved?.({ rating: res.rating, comment: res.comment });
      } else if (mine === seq.current) {
        setChoice(saved.current);
        say(res.message || SUPPORT_UI_COPY.ERR_SAVE, true);
      }
    });
  }

  async function saveComment() {
    if (!choice || savingComment) return;
    if (text.length > RATING_COMMENT_MAX) {
      setMessage({ text: C.commentTooLong, error: true });
      return;
    }
    setSavingComment(true);
    setMessage(null);
    const comment = text.trim();
    // WR-E13: run after any pending taps, and carry the rating the server actually holds, so
    // a failed tap that reverts the card never leaves the comment write on another rating.
    const job = queue.current.then(async (): Promise<RatingSaveResult> => {
      const rating = saved.current;
      if (!rating) return { ok: false, message: SUPPORT_UI_COPY.ERR_SAVE };
      try {
        return await onRate({ rating, comment });
      } catch {
        return { ok: false, message: SUPPORT_UI_COPY.ERR_SAVE };
      }
    });
    queue.current = job;
    const res = await job;
    setSavingComment(false);
    if (res.ok) {
      saved.current = res.rating;
      say(C.commentSaved);
      onSaved?.({ rating: res.rating, comment: res.comment });
    } else {
      say(res.message || SUPPORT_UI_COPY.ERR_SAVE, true);
    }
  }

  async function saveRating() {
    if (!choice || savingRating) return;
    if (text.length > RATING_COMMENT_MAX) {
      setMessage({ text: C.commentTooLong, error: true });
      return;
    }
    setSavingRating(true);
    setMessage(null);
    let res: RatingSaveResult;
    try {
      res = await onRate({
        rating: choice,
        ...(text.trim() ? { comment: text.trim() } : {}),
      });
    } catch {
      res = { ok: false, message: SUPPORT_UI_COPY.ERR_SAVE };
    }
    setSavingRating(false);
    if (res.ok) {
      saved.current = res.rating;
      say(C.ratingSaved);
      onSaved?.({ rating: res.rating, comment: res.comment });
    } else {
      say(res.message || SUPPORT_UI_COPY.ERR_SAVE, true);
    }
  }

  const showComment = confirmMode || choice !== null;
  const commentId = `${id}-comment`;

  return (
    <section
      aria-labelledby={`${id}-q`}
      className={PANEL}
      data-rating-card={confirmMode ? "confirm" : "instant"}
    >
      <p id={`${id}-q`} className="font-semibold">
        {C.question}
      </p>
      <ChoiceButtons
        value={choice}
        onPick={(c) => (confirmMode ? setChoice(c) : pickInstant(c))}
        disabled={savingRating}
      />
      {!confirmMode && choice !== null ? (
        <p className="text-sm text-hub-ink" data-rating-thanks="">
          {C.thanks}
        </p>
      ) : null}
      {showComment ? (
        <div className="flex flex-col gap-2">
          <TextArea
            id={commentId}
            label={C.comment}
            rows={3}
            value={text}
            maxLength={RATING_COMMENT_MAX}
            counter={{ value: text.length, max: RATING_COMMENT_MAX }}
            onChange={(ev) => setText(ev.target.value)}
          />
          {confirmMode ? null : (
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={savingComment}
                loadingLabel={C.savingComment}
                onClick={() => void saveComment()}
              >
                {C.saveComment}
              </Button>
            </div>
          )}
        </div>
      ) : null}
      {confirmMode ? (
        <div>
          <Button
            type="button"
            variant="primary"
            loading={savingRating}
            loadingLabel={C.savingRating}
            disabled={choice === null}
            onClick={() => void saveRating()}
          >
            {C.saveRating}
          </Button>
        </div>
      ) : null}
      <p
        role={message?.error ? "alert" : "status"}
        className={
          message
            ? `text-sm ${message.error ? "text-hub-danger" : "text-hub-ink"}`
            : "sr-only"
        }
      >
        {message?.text ?? ""}
      </p>
    </section>
  );
}
