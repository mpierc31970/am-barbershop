"use server";
// Paid-service actions on a ticket (12-26 choice 2; SUPPORT-03, D297, D299; T-12-26-01).
// Public POST endpoints: the ticket number is untrusted and goes through parseTicketNumber
// (junk is NotFound, the same as another site's number). The org, role and impersonation come
// only from the session cookie via runAction. Only the Owner may choose: the chokepoint
// (12-23) requires billing:write and refuses impersonation; a refusal comes back as
// PAID-ASK-OWNER. Show me how is a read (the TrainingDrawer), so it has no action here.
// Success revalidates the ticket and the hub layout, so the Needs-you row clears.
import { NotFound } from "@cds/core";
import { parseTicketNumber } from "@cds/core/support";
import {
  requestPaidQuote,
  // Aliased: the "use" prefix is not a React hook (react-hooks/rules-of-hooks).
  useCareHourForTicket as chooseCareHourForTicket,
} from "@cds/db";
import { SUPPORT_UI_COPY } from "@cds/ui/hub/support";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";

const GONE = "This was removed or moved. Reload the page to see the latest.";

const COPY = {
  forbidden: SUPPORT_UI_COPY.PAID_ASK_OWNER,
  impersonation: SUPPORT_UI_COPY.IMPERSONATING_SUPPORT,
};

function numberOf(raw: unknown): number {
  try {
    return parseTicketNumber(raw);
  } catch {
    throw new NotFound(GONE);
  }
}

function refresh(n: number): void {
  try {
    revalidatePath(`/hub/support/tickets/${n}`);
    revalidatePath("/hub/support");
    revalidatePath("/hub", "layout");
  } catch (err) {
    console.error(
      "[support] revalidate failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
}

/** Owner: Get a quote. `requested` is false when a quote was already asked for. */
export async function requestPaidQuoteAction(
  number: unknown,
): Promise<ActionResult<{ requested: boolean }>> {
  let n = 0;
  const res = await runAction(async (s) => {
    n = numberOf(number);
    return requestPaidQuote(s.ctx, n);
  }, COPY);
  if (res.ok) refresh(n);
  return res;
}

/** Owner: Use my Care hour (after the confirm dialog). `chosen` is false on a repeat. */
export async function useCareHourAction(
  number: unknown,
): Promise<ActionResult<{ chosen: boolean }>> {
  let n = 0;
  const res = await runAction(async (s) => {
    n = numberOf(number);
    const out = await chooseCareHourForTicket(s.ctx, n);
    return { chosen: out.chosen };
  }, COPY);
  if (res.ok) refresh(n);
  return res;
}
