"use client";
// The hub ticket's rating card, wired (13-42 choices 1-3; STAFF-21, D212). Binds RatingCard to
// rateTicketAction (the only rating write, a POST) and the hub toast. On the ticket page a
// saved rating refreshes the page; on the email link page (`preselect`) Save rating goes on to
// the ticket, scrolled to the card (`#rating`); the toast survives the navigation.
import type { RatingChoice, TicketStatus } from "@cds/core/support";
import { useToast } from "@cds/ui/hub";
import { RatingCard, type RatingSaveInput } from "@cds/ui/hub/support";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { rateTicketAction } from "../../../../../actions/support-rating";

export interface TicketRatingProps {
  number: number;
  status: TicketStatus | string;
  rating: RatingChoice | null;
  comment: string | null;
  canRate: boolean;
  impersonating: boolean;
  preselect?: RatingChoice | null;
}

export function TicketRating({
  number,
  status,
  rating,
  comment,
  canRate,
  impersonating,
  preselect = null,
}: TicketRatingProps) {
  const toast = useToast();
  const router = useRouter();

  const onRate = useCallback(
    async (input: RatingSaveInput) => {
      const res = await rateTicketAction(
        number,
        input.rating,
        ...(input.comment === undefined ? [] : [input.comment]),
      );
      if (!res.ok) return { ok: false as const, message: res.message };
      return {
        ok: true as const,
        rating: res.data.rating,
        comment: res.data.comment,
      };
    },
    [number],
  );

  return (
    <RatingCard
      status={status}
      rating={rating}
      comment={comment}
      canRate={canRate}
      impersonating={impersonating}
      preselect={preselect}
      onRate={onRate}
      notify={(message) => toast.show({ message })}
      onSaved={() =>
        preselect
          ? router.push(`/hub/support/tickets/${number}#rating`)
          : router.refresh()
      }
    />
  );
}
