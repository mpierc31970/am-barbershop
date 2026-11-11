"use client";
// Today cards + From CDS wiring (11-19; DASH-22, DASH-23). Client glue only: the server
// passes plain data; this binds the Customize sheet to saveTodayLayoutAction (then refreshes
// so the page re-renders behind the sheet) and From CDS Dismiss to dismissFromCdsAction (the
// next card appears on the next visit, not instantly). Links go through the nav guard.
import { FromCdsCard, TodayCards, type TodayCardView } from "@cds/ui/hub/today";
import type { FromCdsCard as FromCdsCardData } from "@cds/core/today";
import { useRouter } from "next/navigation";
import {
  dismissFromCdsAction,
  saveTodayLayoutAction,
} from "../../../actions/today";
import { GuardedLink } from "../GuardedLink";

export function TodayCardsPanel(props: {
  cards: TodayCardView[];
  all: { id: string; title: string }[];
  hidden: string[];
  defaultOrder: string[];
  impersonating: boolean;
}) {
  const router = useRouter();
  return (
    <TodayCards
      {...props}
      onSave={saveTodayLayoutAction}
      onSaved={() => router.refresh()}
      LinkComponent={GuardedLink}
    />
  );
}

export function FromCdsPanel({
  card,
  steps,
  impersonating,
}: {
  card: FromCdsCardData;
  steps: { screen: string; action: string; expected: string }[];
  impersonating: boolean;
}) {
  return (
    <FromCdsCard
      card={card}
      steps={steps}
      canDismiss={!impersonating}
      onDismiss={(id) => {
        void dismissFromCdsAction(id);
      }}
      LinkComponent={GuardedLink}
    />
  );
}
