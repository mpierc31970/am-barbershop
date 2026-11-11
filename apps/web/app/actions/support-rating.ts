"use server";
// Ticket rating action (13-42 choice 2; STAFF-21, D212, P13-P18; T-13-42-01, T-13-42-02). A
// public POST endpoint: every argument is untrusted. The tenant, role and impersonation come
// only from the session cookie via runAction; no org id is taken from the browser. Thin caller
// of @cds/db rateTicket (support:write, deny-listed under impersonation, so staff viewing as
// the site are refused with the card's impersonation copy). This is the only rating write: the
// email link page renders, and its Save rating button posts here (no write on GET, Pitfall 10).
// Nothing here logs the comment.
import { InvalidInput, NotFound } from "@cds/core";
import {
  RATING_COMMENT_MAX,
  isRatingChoice,
  parseTicketNumber,
  type RatingChoice,
} from "@cds/core/support";
import { rateTicket } from "@cds/db";
import { RATING_CARD_COPY } from "@cds/ui/hub/support";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";

const GONE = "This was removed or moved. Reload the page to see the latest.";
/** Far above the 500 cap; junk payloads are refused before the chokepoint. */
const MAX_COMMENT_RAW = 2_000;

export type RateTicketActionResult = {
  number: number;
  rating: RatingChoice;
  comment: string | null;
  ratedAt: string;
};

function numberOf(raw: unknown): number {
  try {
    return parseTicketNumber(raw);
  } catch {
    throw new NotFound(GONE);
  }
}

/**
 * Rate one of this site's Resolved tickets. `comment` omitted keeps the stored comment; ""
 * clears it.
 */
export async function rateTicketAction(
  number: unknown,
  rating: unknown,
  comment?: unknown,
): Promise<ActionResult<RateTicketActionResult>> {
  const res = await runAction(
    async (s) => {
      const n = numberOf(number);
      if (!isRatingChoice(rating)) {
        throw new InvalidInput("Choose Yes or No.");
      }
      if (
        comment !== undefined &&
        comment !== null &&
        (typeof comment !== "string" || comment.length > MAX_COMMENT_RAW)
      ) {
        throw new InvalidInput(RATING_CARD_COPY.commentTooLong);
      }
      if (
        typeof comment === "string" &&
        comment.trim().length > RATING_COMMENT_MAX
      ) {
        throw new InvalidInput(RATING_CARD_COPY.commentTooLong);
      }
      const done = await rateTicket(s.ctx, {
        number: n,
        rating,
        ...(comment === undefined ? {} : { comment: comment as string | null }),
      });
      return {
        number: done.number,
        rating: done.rating,
        comment: done.comment,
        ratedAt: done.ratedAt,
      };
    },
    { impersonation: RATING_CARD_COPY.impersonating },
  );
  if (res.ok) {
    try {
      revalidatePath(`/hub/support/tickets/${res.data.number}`);
    } catch (err) {
      console.error(
        "[hub] rating revalidate failed",
        err instanceof Error ? err.name : typeof err,
      );
    }
  }
  return res;
}
