"use client";
// Settings › Payments client island (10-25; 10-UI-SPEC "Settings › Payments"; BILL-06, PAY-03,
// PAY-10; D296, D-UI-P10-9). Wraps the controlled StripeConnectPanel (10-19):
//   - Connect your Stripe account / Finish Stripe setup -> startConnectAction, then navigate to
//     the returned URL (the panel stays "Opening Stripe…"); a refusal or failure shows its copy
//     or ERR-CONNECT.
//   - `?connect=return`: shows "Checking your Stripe account…", runs checkConnectAction once,
//     then the state; on Connected, the toast. The param is stripped so a reload never re-toasts.
//   - Check again: the same re-check, no toast.
//   - Help me set up Stripe: opens the baked how-to (connect-steps.ts) in the TrainingDrawer;
//     without JS the link loads `?help=stripe`, which opens it on load (10-25 choice 2).
import { TrainingDrawer, useToast } from "@cds/ui/hub";
import { StripeConnectPanel, type ConnectPanelView } from "@cds/ui/hub/billing";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  checkConnectAction,
  startConnectAction,
} from "../../../actions/connect";
import { CONNECT_HELP_TITLE, CONNECT_STEPS } from "./connect-steps";
import { CONNECTED_TOAST, PAYMENTS_TAB } from "./payments-view";

export interface PaymentsPanelProps {
  view: ConnectPanelView;
  /** Arrived from Stripe (`?connect=return`): re-check on mount. */
  returning: boolean;
  /** `?help=stripe`: the how-to drawer starts open. */
  helpOpen: boolean;
}

const REFUSAL_CODES: ReadonlySet<string> = new Set([
  "forbidden",
  "impersonation_denied",
  "signed_out",
  "agreement_required",
]);

/** Navigate to the onboarding URL (a seam for tests; jsdom has no navigation). */
export const navigation = {
  go(url: string): void {
    window.location.assign(url);
  },
};

export function PaymentsPanel({
  view,
  returning,
  helpOpen,
}: PaymentsPanelProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "/hub/settings";
  const toast = useToast();
  const [current, setCurrent] = useState<ConnectPanelView>(
    returning ? { ...view, checking: true } : view,
  );
  const [help, setHelp] = useState(helpOpen);
  const checked = useRef(false);

  /** Re-reads the account; false when the check failed (the panel shows ERR-CHECK). */
  async function recheck(fromReturn: boolean): Promise<boolean> {
    const res = await checkConnectAction().catch(() => null);
    if (res?.ok) {
      setCurrent({ ...res.data, checking: false });
      if (fromReturn && res.data.state === "connected") {
        toast.show({ message: CONNECTED_TOAST });
      }
      return true;
    }
    setCurrent((v) => ({ ...v, checking: false }));
    return false;
  }

  useEffect(() => {
    if (!returning || checked.current) return;
    checked.current = true;
    // One-time: strip ?connect=return so a reload never re-checks or re-toasts.
    router.replace(`${pathname}?tab=payments`, { scroll: false });
    void recheck(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returning]);

  async function onConnect(): Promise<{ ok: boolean; message?: string }> {
    const res = await startConnectAction();
    if (!res.ok) {
      // Refusals and sign-out keep their own copy; anything else is ERR-CONNECT (the panel's
      // default), never the generic "changes weren't saved".
      return REFUSAL_CODES.has(res.code)
        ? { ok: false, message: res.message }
        : { ok: false };
    }
    navigation.go(res.data.url);
    return { ok: true };
  }

  /** The panel's help link is a plain anchor; open the drawer in place instead. */
  function onClickCapture(e: MouseEvent<HTMLDivElement>): void {
    const target = e.target as Element | null;
    const link = target?.closest?.("a[href]");
    if (!link || link.getAttribute("href") !== current.helpHref) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    setHelp(true);
  }

  return (
    <div onClickCapture={onClickCapture}>
      <StripeConnectPanel
        view={current}
        onConnect={onConnect}
        onCheckAgain={() => recheck(false)}
      />
      <TrainingDrawer
        open={help}
        onClose={() => {
          setHelp(false);
          if (helpOpen) router.replace(PAYMENTS_TAB, { scroll: false });
        }}
        title={CONNECT_HELP_TITLE}
        steps={CONNECT_STEPS}
      />
    </div>
  );
}
