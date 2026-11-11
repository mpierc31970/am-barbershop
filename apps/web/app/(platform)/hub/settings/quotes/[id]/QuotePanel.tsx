"use client";
// The quote page's client half (10-30; 10-UI-SPEC "Quote page"; BILL-20). Wires QuoteDetail
// (10-19) to the work-order Server Actions: Accept and pay navigates to the hosted invoice
// (or the test page) in the same tab and stays pending until the page leaves (10-30 choice 2);
// a refusal or failure keeps the page and shows the action's message (ERR-QUOTE-PAY, or the
// chokepoint's expired / answered / no-card copy). Decline refreshes the page so the server
// renders the declined status block. Never imports @cds/db.
import { QuoteDetail, type QuoteView } from "@cds/ui/hub/billing";
import { useRouter } from "next/navigation";
import {
  acceptQuoteAction,
  declineQuoteAction,
  type AcceptQuoteResult,
} from "../../../../../actions/work-orders";

/** Accept, then follow the invoice URL; the result QuoteDetail shows on failure. */
export async function acceptAndOpen(
  id: string,
  accept: (id: string) => Promise<AcceptQuoteResult>,
  go: (url: string) => void,
  refresh: () => void,
): Promise<{ ok: boolean; message?: string }> {
  const res = await accept(id);
  if (res.ok) {
    go(res.url);
    return { ok: true };
  }
  // The quote may have moved on (accepted elsewhere, expired): the next render shows it.
  refresh();
  return { ok: false, message: res.message };
}

export function QuotePanel({ id, view }: { id: string; view: QuoteView }) {
  const router = useRouter();
  return (
    <QuoteDetail
      view={view}
      onAccept={() =>
        acceptAndOpen(
          id,
          acceptQuoteAction,
          (url) => window.location.assign(url),
          () => router.refresh(),
        )
      }
      onDecline={async () => {
        const res = await declineQuoteAction(id);
        router.refresh();
        return res;
      }}
    />
  );
}
