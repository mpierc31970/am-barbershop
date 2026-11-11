// P10 payments: the handler contract (10-09). A handler applies one normalised event and
// must be idempotent by state ("set X", "ensure item exists"; never "increment"), because
// a failed event is run again (RESEARCH Pattern 1). Handlers re-fetch provider objects
// through `billing` / `gateway` rather than trusting the event, and take their own per-org
// lock `billing:<org>` (never `addons:<org>` around an installer call: deadlock).
import type {
  CdsBilling,
  NormalisedEvent,
  NormalisedEventType,
  PaymentGateway,
} from "@cds/core/payments";
import type { AddonDeps } from "../../addons/types";
import type { EmailTransport } from "../../email/transport";

export type HandlerContext = {
  billing: CdsBilling;
  gateway: PaymentGateway;
  now: Date;
  transport?: EmailTransport;
  /** The add-on installer's deps (10-12); without them a paid add-on is logged, not installed. */
  addons?: AddonDeps;
};

export type Handler = (
  e: NormalisedEvent,
  h: HandlerContext,
) => Promise<"applied" | "ignored">;

export type HandlerMap = Partial<Record<NormalisedEventType, Handler>>;
