"use client";
// StripeConnectPanel (10-19; 10-UI-SPEC "Settings › Payments"; BILL-06, PAY-03, PAY-10;
// D296, D-UI-P10-9, D-UI-P10-10). One panel, max 720px: heading + status badge, intro,
// the fees box (locked D296 copy, never hidden or collapsed), the state block, the help
// link and the no-Stripe line, then the test-mode note. Only the owner, not impersonating,
// gets buttons; Admin and staff see the same panel read-only. There is no Disconnect
// button in v1.0: the owner disconnects from their own Stripe dashboard. Controlled: the
// server builds the view; onConnect starts hosted onboarding (and redirects on success).
import { ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { Badge, type BadgeTone } from "../Badge";
import { Button, buttonClasses } from "../Button";
import { InlineAlert } from "../feedback";
import { useBfcacheReset } from "./page-show";
import type { ConnectPanelView, ConnectState } from "./types";

export const CONNECT_COPY = {
  heading: "Take payments on your site",
  intro:
    "Connect your own Stripe account so customers can pay you online for bookings, events and orders. Money goes straight to your Stripe account, never through CDS.",
  fees: "You own this account, you are the seller, and you pay Stripe's fees directly (for example 2.9% + 30¢ online). CDS takes no cut.",
  helper:
    "Already use Stripe? You can link your account on the next screen. New to Stripe? You'll create a free account; it takes about 10 minutes.",
  noStripe: "No Stripe yet? Customers can still book and pay you in person.",
  help: "Help me set up Stripe",
  testMode: "Test mode: this connects a pretend Stripe account.",
  setupUnfinished:
    "Your Stripe account isn't finished yet, so online payments are off. Pick up where you left off; Stripe saves your progress.",
  restricted:
    "Stripe has paused payments on your account, usually because it needs a detail or a document. Customers can still book and pay in person. Finish what Stripe asks for to turn online payments back on.",
  disconnected:
    "Your Stripe account was disconnected, so online payments are off. Customers can still book and pay in person. Connect it again to turn payments back on.",
  disconnectHelp:
    "To disconnect, remove Connections Design Studios under Settings › Connected accounts in your Stripe dashboard. Online payments on your site stop straight away.",
  impersonating:
    "You're viewing as CDS staff, so Stripe changes are turned off. Only the owner can connect Stripe.",
  adminOnly: "Only the site owner can connect or change Stripe.",
  errConnect:
    "We couldn't open Stripe just now. Nothing changed. Try again in a minute.",
  connect: "Connect your Stripe account",
  finish: "Finish Stripe setup",
  opening: "Opening Stripe…",
  checking: "Checking your Stripe account…",
  checkAgain: "Check again",
  errCheck:
    "We couldn't check your Stripe account just now. Nothing changed. Try again in a minute.",
  dashboard: "Open your Stripe dashboard",
  dashboardNewTab: " (opens Stripe in a new tab)",
  account: "Account",
  onlinePayments: "Online payments",
  on: "On",
  lastChecked: "Last checked",
} as const;

const BADGE: Record<ConnectState, { tone: BadgeTone; word: string }> = {
  not_connected: { tone: "not-connected", word: "Not connected" },
  setup_unfinished: { tone: "stripe-attention", word: "Setup not finished" },
  connected: { tone: "connected", word: "Connected" },
  restricted: { tone: "stripe-attention", word: "Needs attention" },
  disconnected: { tone: "not-connected", word: "Not connected" },
};

const PRIMARY: Record<ConnectState, string | null> = {
  not_connected: CONNECT_COPY.connect,
  setup_unfinished: CONNECT_COPY.finish,
  connected: null,
  restricted: CONNECT_COPY.finish,
  disconnected: CONNECT_COPY.connect,
};

const WARNING: Partial<Record<ConnectState, string>> = {
  setup_unfinished: CONNECT_COPY.setupUnfinished,
  restricted: CONNECT_COPY.restricted,
  disconnected: CONNECT_COPY.disconnected,
};

const LINK =
  "rounded text-sm font-semibold text-hub-accent underline underline-offset-2 hover:text-hub-accent-hover";
const TERM = "text-sm font-semibold text-hub-ink-muted";
const DESC = "text-base text-hub-ink";

export interface StripeConnectPanelProps {
  view: ConnectPanelView;
  onConnect(): Promise<{ ok: boolean; message?: string }>;
  /** Re-reads the account; `false` or a rejection shows ERR-CHECK (WR-C09). */
  onCheckAgain(): Promise<boolean | void>;
}

export function StripeConnectPanel({
  view,
  onConnect,
  onCheckAgain,
}: StripeConnectPanelProps) {
  const headingId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // WR-C04: Back from Stripe's onboarding (bfcache) brings Connect back.
  useBfcacheReset(useCallback(() => setPending(false), []));
  const canAct = view.role === "owner" && !view.impersonating;
  const badge = BADGE[view.state];
  const primary = canAct ? PRIMARY[view.state] : null;
  const warning = WARNING[view.state];

  const connect = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    let result: { ok: boolean; message?: string };
    try {
      result = await onConnect();
    } catch {
      result = { ok: false };
    }
    // Success redirects to Stripe; stay pending until the page leaves.
    if (!result.ok) {
      setPending(false);
      setError(result.message || CONNECT_COPY.errConnect);
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      data-connect-panel={view.state}
      className="flex max-w-[720px] flex-col gap-4 rounded-lg border border-hub-border bg-hub-surface p-6 font-hub text-hub-ink"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-xl leading-tight font-semibold">
          {CONNECT_COPY.heading}
        </h2>
        <Badge tone={badge.tone}>{badge.word}</Badge>
      </div>
      <p className="max-w-[68ch] text-base">{CONNECT_COPY.intro}</p>
      <p data-fees-box="" className="rounded-lg bg-hub-surface-2 p-4 text-base">
        {CONNECT_COPY.fees}
      </p>

      <div aria-live="polite">
        {view.checking ? (
          <p className="flex items-center gap-2 text-sm text-hub-ink-muted">
            <Loader2
              aria-hidden
              size={16}
              strokeWidth={2}
              className="animate-spin motion-reduce:animate-none"
            />
            {CONNECT_COPY.checking}
          </p>
        ) : null}
      </div>

      {view.checking ? null : (
        <div className="flex flex-col gap-4" data-connect-state="">
          {view.impersonating ? (
            <InlineAlert tone="info">{CONNECT_COPY.impersonating}</InlineAlert>
          ) : null}
          {warning ? <InlineAlert tone="warning">{warning}</InlineAlert> : null}
          {view.state === "not_connected" && canAct ? (
            <p className="text-sm text-hub-ink-muted">{CONNECT_COPY.helper}</p>
          ) : null}
          {view.state === "connected" ? (
            <ConnectedBlock
              view={view}
              canAct={canAct}
              onCheckAgain={onCheckAgain}
            />
          ) : null}
          {view.role === "admin" && !view.impersonating ? (
            <p className="text-sm text-hub-ink-muted">
              {CONNECT_COPY.adminOnly}
            </p>
          ) : null}
          {primary ? (
            <div>
              <Button
                variant="primary"
                loading={pending}
                loadingLabel={CONNECT_COPY.opening}
                onClick={() => void connect()}
              >
                {primary}
              </Button>
            </div>
          ) : null}
          {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        </div>
      )}

      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <a href={view.helpHref} className={LINK}>
          {CONNECT_COPY.help}
        </a>
        <span aria-hidden="true" className="text-hub-ink-muted">
          ·
        </span>
        <span className="text-hub-ink-muted">{CONNECT_COPY.noStripe}</span>
      </p>
      {view.testMode ? (
        <p className="text-sm text-hub-ink-muted">{CONNECT_COPY.testMode}</p>
      ) : null}
    </section>
  );
}

function ConnectedBlock({
  view,
  canAct,
  onCheckAgain,
}: {
  view: ConnectPanelView;
  canAct: boolean;
  onCheckAgain(): Promise<boolean | void>;
}) {
  // WR-C09: one check at a time, with a pending state and an error on failure.
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState(false);
  const checkAgain = async () => {
    if (checking) return;
    setChecking(true);
    setCheckError(false);
    try {
      if ((await onCheckAgain()) === false) setCheckError(true);
    } catch {
      setCheckError(true);
    } finally {
      setChecking(false);
    }
  };
  const account =
    view.displayName && view.accountSuffix
      ? `${view.displayName} (acct ending ${view.accountSuffix})`
      : (view.displayName ??
        (view.accountSuffix ? `acct ending ${view.accountSuffix}` : "—"));
  return (
    <>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className={TERM}>{CONNECT_COPY.account}</dt>
          <dd className={DESC}>{account}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className={TERM}>{CONNECT_COPY.onlinePayments}</dt>
          <dd className={DESC}>{CONNECT_COPY.on}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className={TERM}>{CONNECT_COPY.lastChecked}</dt>
          <dd className={`${DESC} flex flex-wrap items-center gap-3`}>
            <span>{view.checkedLabel ?? "—"}</span>
            {canAct ? (
              <Button
                variant="ghost"
                size="sm"
                loading={checking}
                loadingLabel={CONNECT_COPY.checking}
                onClick={() => void checkAgain()}
              >
                {CONNECT_COPY.checkAgain}
              </Button>
            ) : null}
          </dd>
        </div>
      </dl>
      {checkError ? (
        <InlineAlert tone="error">{CONNECT_COPY.errCheck}</InlineAlert>
      ) : null}
      {canAct && view.dashboardHref ? (
        <div>
          <a
            href={view.dashboardHref}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses("secondary", "md")}
          >
            {CONNECT_COPY.dashboard}
            <ExternalLink aria-hidden size={16} strokeWidth={2} />
            <span className="sr-only">{CONNECT_COPY.dashboardNewTab}</span>
          </a>
        </div>
      ) : null}
      {canAct ? (
        <p className="text-sm text-hub-ink-muted">
          {CONNECT_COPY.disconnectHelp}
        </p>
      ) : null}
    </>
  );
}
