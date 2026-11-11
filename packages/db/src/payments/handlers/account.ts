// P10 payments: Connect account handlers (PAY-03; CONTEXT A1; T-10-14-03, T-10-14-04).
//
// The event names an account; the row is found by `account_id` (bound filter), so an
// event can only change the org that owns that account. An unknown account id is
// `ignored`. `account.updated` re-fetches the account from the gateway rather than trusting
// the event; `account.deauthorized` marks it disconnected. Both apply through
// `applyAccountState` (one staff alert and one owner email per state change) under the
// org's `billing:<org>` lock. Logs carry org id and status only.
import type { NormalisedEvent, ProviderAccount } from "@cds/core/payments";
import { withSuperuser } from "../../client";
import { withOrgLock } from "../../content/lock";
import { applyAccountState, gatewayAccountById } from "../connect";
import type { HandlerContext, HandlerMap } from "./types";

function accountIdOf(e: NormalisedEvent): string {
  return "accountId" in e && typeof e.accountId === "string" ? e.accountId : "";
}

async function apply(
  e: NormalisedEvent,
  h: HandlerContext,
  fetch: (accountId: string) => Promise<ProviderAccount>,
): Promise<"applied" | "ignored"> {
  const accountId = accountIdOf(e);
  const found = await withSuperuser((pb) => gatewayAccountById(pb, accountId));
  if (!found) return "ignored";
  const orgId = found.organization;
  return withOrgLock(`billing:${orgId}`, () =>
    withSuperuser(async (pb) => {
      const account = await fetch(accountId);
      const r = await applyAccountState(pb, orgId, account, {
        now: h.now,
        transport: h.transport,
      });
      return r ? "applied" : "ignored";
    }),
  );
}

export const accountHandlers: HandlerMap = {
  "account.updated": (e, h) => apply(e, h, (id) => h.gateway.accountStatus(id)),
  "account.deauthorized": (e, h) =>
    apply(e, h, (id) =>
      Promise.resolve({
        accountId: id,
        chargesEnabled: false,
        detailsSubmitted: false,
        displayName: null,
        status: "disconnected",
      }),
    ),
};
