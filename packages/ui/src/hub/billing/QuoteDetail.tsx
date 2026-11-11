"use client";
// QuoteDetail (10-19; 10-UI-SPEC "Quote page"; BILL-20, D297, D299, D-UI-P10-15). A 720px
// column: FileSignature + title + status badge, the meta line, "What CDS will do" with the
// scope, the price mini receipt (rows by kind, pre-formatted server-side), the Pay now
// figure, then the action block. Sent + owner: an unticked checkbox (never pre-ticked,
// T-10-19-02) and Accept and pay, aria-disabled with its reason until ticked; a ghost
// Decline opens a danger confirm with Keep quote focused. After acceptance the status
// block replaces it. Impersonating staff see it read-only.
//
// SECURITY (T-10-19-01): `scopeHtml` is sanitised server-side with the P3 sanitizer before
// it reaches this component; this component never sanitises, it only injects.
import { formatCents } from "@cds/core/pricing";
import { FileSignature } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Badge } from "../Badge";
import { Button, buttonClasses } from "../Button";
import { Dialog } from "../Dialog";
import { InlineAlert } from "../feedback";
import { useBfcacheReset } from "./page-show";
import type { QuoteView } from "./types";
import { QUOTE_STATUS_BADGE } from "./WorkOrderCard";

export const QUOTE_COPY = {
  whatCds: "What CDS will do",
  price: "Price",
  payNow: "Pay now",
  tax: "Plus sales tax where applicable.",
  acceptText:
    "I accept this quote and its scope. I understand work starts once the invoice is paid.",
  accept: (amount: string) => `Accept and pay ${amount}`,
  tickReason: "Tick the box above to accept.",
  opening: "Opening your invoice…",
  errPay:
    "We couldn't open your invoice. Your acceptance is saved; try again in a minute.",
  decline: "Decline this quote",
  declineTitle: "Decline this quote?",
  declineBody:
    "CDS is told, and no work starts. You can ask for a new quote any time.",
  declineConfirm: "Decline quote",
  keep: "Keep quote",
  declining: "Declining…",
  declineFailed:
    "We couldn't decline the quote just now. Try again in a minute.",
  accepted: (date: string) =>
    `Accepted on ${date}. Pay the invoice to start the work.`,
  pay: (amount: string) => `Pay ${amount}`,
  started: (date: string | null) =>
    `${date ? `Paid on ${date}. ` : ""}CDS has started the work and will message you when it's ready.`,
  balance: (date: string | null) =>
    `CDS delivered this work${date ? ` on ${date}` : ""}. Pay the balance to finish; your monthly maintenance starts with your next bill.`,
  payBalance: (amount: string) => `Pay the balance ${amount}`,
  declined: (date: string | null) =>
    `You declined this quote${date ? ` on ${date}` : ""}.`,
  expired: (date: string | null) =>
    `This quote expired${date ? ` on ${date}` : ""}. Ask CDS Support for a new one.`,
  impersonating:
    "You're viewing as CDS staff, so payment is turned off. Only the owner can pay.",
} as const;

const SCOPE =
  "max-w-[68ch] text-base leading-[1.6] text-hub-ink [&>*+*]:mt-4 " +
  "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_li+li]:mt-2 " +
  "[&_strong]:font-semibold [&_a]:text-hub-accent [&_a]:underline [&_a]:underline-offset-2";

export interface QuoteDetailProps {
  view: QuoteView;
  onAccept(): Promise<{ ok: boolean; message?: string }>;
  onDecline(): Promise<{ ok: boolean }>;
}

export function QuoteDetail({ view, onAccept, onDecline }: QuoteDetailProps) {
  const headingId = useId();
  const badge = QUOTE_STATUS_BADGE[view.status];
  const amount = formatCents(view.payNowCents);

  return (
    <article
      aria-labelledby={headingId}
      data-quote-kind={view.kind}
      className="flex max-w-[720px] flex-col gap-6 font-hub text-hub-ink"
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id={headingId}
            className="flex items-center gap-2 text-xl leading-tight font-semibold"
          >
            <FileSignature aria-hidden size={20} strokeWidth={2} />
            {view.title}
          </h2>
          <Badge tone={badge.tone}>{badge.word}</Badge>
        </div>
        <p className="text-sm text-hub-ink-muted">{view.metaLine}</p>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">{QUOTE_COPY.whatCds}</h3>
        <div
          data-quote-scope=""
          className={SCOPE}
          dangerouslySetInnerHTML={{ __html: view.scopeHtml }}
        />
      </section>

      <section
        aria-label={QUOTE_COPY.price}
        className="flex flex-col gap-3 rounded-lg bg-hub-surface-2 p-6"
      >
        <ul className="flex flex-col gap-2 text-base">
          {view.priceRows.map((row, i) => (
            <li
              key={`${row.label}-${i}`}
              data-price-row=""
              className="flex flex-wrap justify-between gap-x-4 tabular-nums"
            >
              <span>{row.label}</span>
              <span>{row.amountLabel}</span>
            </li>
          ))}
        </ul>
        <hr className="border-0 border-t border-dashed border-hub-border-strong" />
        <div
          data-pay-now=""
          className="flex flex-wrap items-baseline justify-between gap-x-4"
        >
          <span className="text-base font-semibold">{QUOTE_COPY.payNow}</span>
          <span className="text-[28px] leading-tight font-semibold tabular-nums">
            {amount}
          </span>
        </div>
        <p className="text-sm text-hub-ink-muted">{QUOTE_COPY.tax}</p>
      </section>

      {view.impersonating ? (
        <InlineAlert tone="info">{QUOTE_COPY.impersonating}</InlineAlert>
      ) : null}
      <StatusBlock
        view={view}
        amount={amount}
        onAccept={onAccept}
        onDecline={onDecline}
      />
    </article>
  );
}

function StatusBlock({
  view,
  amount,
  onAccept,
  onDecline,
}: {
  view: QuoteView;
  amount: string;
  onAccept: QuoteDetailProps["onAccept"];
  onDecline: QuoteDetailProps["onDecline"];
}) {
  const canAct = view.canAct && !view.impersonating;
  const date = view.statusDateLabel ?? null;
  const payLink = (label: string) =>
    canAct && view.payHref ? (
      <a href={view.payHref} className={buttonClasses("primary", "md")}>
        {label}
      </a>
    ) : undefined;

  switch (view.status) {
    case "sent":
      return canAct ? (
        <AcceptBlock
          amount={amount}
          onAccept={onAccept}
          onDecline={onDecline}
        />
      ) : null;
    case "accepted":
      return (
        <InlineAlert tone="info" action={payLink(QUOTE_COPY.pay(amount))}>
          {QUOTE_COPY.accepted(view.acceptedLabel ?? "")}
        </InlineAlert>
      );
    case "deposit_paid":
    case "paid":
      return (
        <InlineAlert tone="success">{QUOTE_COPY.started(date)}</InlineAlert>
      );
    case "delivered":
      return (
        <InlineAlert
          tone="info"
          action={payLink(QUOTE_COPY.payBalance(amount))}
        >
          {QUOTE_COPY.balance(view.deliveredLabel)}
        </InlineAlert>
      );
    case "declined":
      return <InlineAlert tone="info">{QUOTE_COPY.declined(date)}</InlineAlert>;
    case "expired":
      return <InlineAlert tone="info">{QUOTE_COPY.expired(date)}</InlineAlert>;
  }
}

function AcceptBlock({
  amount,
  onAccept,
  onDecline,
}: {
  amount: string;
  onAccept: QuoteDetailProps["onAccept"];
  onDecline: QuoteDetailProps["onDecline"];
}) {
  const boxId = useId();
  const reasonId = useId();
  const [ticked, setTicked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  // WR-C04: Back from the hosted invoice (bfcache) brings the buttons back.
  useBfcacheReset(useCallback(() => setPending(false), []));

  const accept = async () => {
    if (!ticked || pending) return;
    setPending(true);
    setError(null);
    let result: { ok: boolean; message?: string };
    try {
      result = await onAccept();
    } catch {
      result = { ok: false };
    }
    // Success redirects to the hosted invoice; stay pending until the page leaves.
    if (!result.ok) {
      setPending(false);
      setError(result.message || QUOTE_COPY.errPay);
    }
  };

  return (
    <section className="flex flex-col gap-3" data-quote-accept="">
      <label
        htmlFor={boxId}
        className="flex min-h-11 cursor-pointer items-center gap-3 text-base"
      >
        <input
          id={boxId}
          type="checkbox"
          checked={ticked}
          onChange={(e) => setTicked(e.currentTarget.checked)}
          className="h-5 w-5 shrink-0 accent-hub-accent"
        />
        <span className="max-w-[68ch]">{QUOTE_COPY.acceptText}</span>
      </label>
      <div className="flex flex-col items-start gap-1">
        <Button
          variant="primary"
          aria-disabled={ticked ? undefined : true}
          aria-describedby={ticked ? undefined : reasonId}
          className={ticked ? undefined : "cursor-not-allowed opacity-50"}
          loading={pending}
          loadingLabel={QUOTE_COPY.opening}
          onClick={() => void accept()}
        >
          {QUOTE_COPY.accept(amount)}
        </Button>
        {ticked ? null : (
          <p id={reasonId} className="text-sm text-hub-ink-muted">
            {QUOTE_COPY.tickReason}
          </p>
        )}
      </div>
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <div>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => setDeclining(true)}
        >
          {QUOTE_COPY.decline}
        </Button>
      </div>
      <DeclineDialog
        open={declining}
        onDecline={onDecline}
        onClose={() => setDeclining(false)}
      />
    </section>
  );
}

function DeclineDialog({
  open,
  onDecline,
  onClose,
}: {
  open: boolean;
  onDecline: QuoteDetailProps["onDecline"];
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) keepRef.current?.focus();
    else {
      setPending(false);
      setError(null);
    }
  }, [open]);

  const close = () => {
    if (!pending) onClose();
  };

  const decline = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    let ok = false;
    try {
      ok = (await onDecline()).ok;
    } catch {
      ok = false;
    }
    setPending(false);
    if (ok) onClose();
    else setError(QUOTE_COPY.declineFailed);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={QUOTE_COPY.declineTitle}
      footer={
        <>
          <Button
            variant="destructive"
            loading={pending}
            loadingLabel={QUOTE_COPY.declining}
            onClick={() => void decline()}
          >
            {QUOTE_COPY.declineConfirm}
          </Button>
          <Button
            ref={keepRef}
            variant="secondary"
            disabled={pending}
            onClick={close}
          >
            {QUOTE_COPY.keep}
          </Button>
        </>
      }
    >
      <p className="max-w-[68ch]">{QUOTE_COPY.declineBody}</p>
      {error ? (
        <div className="mt-4">
          <InlineAlert tone="error">{error}</InlineAlert>
        </div>
      ) : null}
    </Dialog>
  );
}
