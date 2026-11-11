"use client";
// Checkout return island (10-22; 10-UI-SPEC "Checkout return"; D-UI-P10-7). Confirming polls
// checkoutStatusAction every 2 s for up to 30 s (10-22 choice 4); the action answers only for
// the caller org's own session. Received shows the paid lines from the mirrored invoice;
// failed goes back to checkout with ERR-PAY; past 30 s shows SLOW-CONFIRM. No confetti.
import { InlineAlert, buttonClasses } from "@cds/ui/hub";
import { CircleCheck, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BILLING_TAB,
  PAID_BODY,
  SLOW_CONFIRM,
  type PaidLines,
} from "../../../../../lib/checkout-order";
import { checkoutStatusAction } from "../../../../actions/checkout";

export const POLL_MS = 2000;
export const POLL_LIMIT_MS = 30_000;

export type ReturnInitial =
  { state: "confirming" } | { state: "received"; paid: PaidLines };

type Shown =
  | { state: "confirming" }
  | { state: "slow" }
  | { state: "received"; paid: PaidLines };

const H1 = "text-[1.75rem] leading-tight font-semibold text-hub-ink";

export function ReturnStatus({
  sessionId,
  initial,
}: {
  sessionId: string;
  initial: ReturnInitial;
}) {
  const router = useRouter();
  const [shown, setShown] = useState<Shown>(initial);

  const polling = shown.state === "confirming";
  useEffect(() => {
    if (!polling) return;
    let stopped = false;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      if (stopped) return;
      if (Date.now() - started >= POLL_LIMIT_MS) {
        setShown({ state: "slow" });
        return;
      }
      try {
        const res = await checkoutStatusAction(sessionId);
        if (stopped) return;
        if (res.ok && res.data.state === "received" && res.data.paid) {
          setShown({ state: "received", paid: res.data.paid });
          router.refresh();
          return;
        }
        if (res.ok && res.data.state === "failed") {
          router.replace("/hub/checkout?payment=failed");
          return;
        }
      } catch {
        // A dropped poll is retried on the next tick.
      }
      if (!stopped) timer = setTimeout(() => void tick(), POLL_MS);
    }
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [polling, sessionId, router]);

  if (shown.state === "received") {
    const { paid } = shown;
    return (
      <div className="flex flex-col gap-6" aria-live="polite">
        <div className="flex items-center gap-3">
          <CircleCheck
            aria-hidden
            size={20}
            strokeWidth={2}
            className="text-hub-success"
          />
          <h1 className={H1}>Payment received</h1>
        </div>
        <p className="max-w-[56ch] text-base text-hub-ink">{PAID_BODY}</p>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-base text-hub-ink">
          <dt className="text-hub-ink-muted">Paid today</dt>
          <dd className="tabular-nums">{paid.paidLabel}</dd>
          <dt className="text-hub-ink-muted">Next bill</dt>
          <dd className="tabular-nums">{paid.nextBillLabel}</dd>
          <dt className="text-hub-ink-muted">Receipt</dt>
          <dd>{paid.receiptLine}</dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Link href="/hub" className={buttonClasses("primary", "md")}>
            Go to your hub
          </Link>
          <Link href={BILLING_TAB} className={buttonClasses("secondary", "md")}>
            See billing and invoices
          </Link>
        </div>
      </div>
    );
  }

  if (shown.state === "slow") {
    return (
      <div className="flex flex-col gap-6" aria-live="polite">
        <h1 className={H1}>Your payment is being confirmed</h1>
        <InlineAlert tone="info">{SLOW_CONFIRM}</InlineAlert>
        <div>
          <Link href="/hub" className={buttonClasses("secondary", "md")}>
            Go to your hub
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <div className="flex items-center gap-3">
        <Loader2
          aria-hidden
          size={20}
          strokeWidth={2}
          className="animate-spin text-hub-ink-muted motion-reduce:animate-none"
        />
        <h1 className={H1}>Confirming your payment…</h1>
      </div>
      <p className="text-base text-hub-ink-muted">
        This usually takes a few seconds.
      </p>
    </div>
  );
}
