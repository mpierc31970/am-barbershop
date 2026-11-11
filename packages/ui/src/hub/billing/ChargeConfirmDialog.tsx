"use client";
// ChargeConfirmDialog (10-13; 10-UI-SPEC `ChargeConfirmDialog`, D-UI-P10-14, D186): the
// one confirm for every charge on the saved card (post-launch add-ons, media packs, the
// Care Plan). Title, one line of what it is, a mini receipt (Today with its period, Then
// with cadence and date, tax and card line), primary with the amount (autofocus, P5 add
// rule) and ghost Not now. While charging the dialog cannot be dismissed. A decline shows
// ERR-CARD with Update card and nothing else changes: installs happen only after the
// invoice is paid (CONTEXT). Every figure comes from the server's preview; this component
// formats cents and adds nothing up. The confirm sends the preview's token (CR-C01): the
// server charges only that figure, once (a retry of the same confirm is never a second
// charge). When the server answers with fresh figures (the price changed, or a decline needs
// a new attempt) the dialog shows them in place and the next confirm uses them.
// 11-28: a preview with `orderNote` (a pages pack before checkout: nothing charged today)
// shows that one line instead of the Today/Then receipt; an empty card line is left out.
import { formatCentsExact } from "@cds/core/pricing";
import { useEffect, useRef, useState } from "react";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { InlineAlert, Skeleton } from "../feedback";
import { useToast } from "../Toast";
import type { ChargePreview, ChargeResult } from "./types";

export const CHARGE_COPY = {
  notNow: "Not now",
  pending: "Charging your card…",
  loadingTitle: "Getting your price…",
  errCard: "Your card was declined. Update it in Settings › Billing.",
  nothingAdded: "Nothing was added.",
  updateCard: "Update card",
} as const;

export interface ChargeConfirmDialogProps {
  open: boolean;
  /** The server's preview of the proration; null while it loads (skeleton). */
  preview: ChargePreview | null;
  /** Called with the shown preview's token. */
  onConfirm: (token: string) => Promise<ChargeResult>;
  onClose: () => void;
  updateCardHref: string;
}

type Failure = {
  reason: "card_declined" | "price_changed" | "error";
  message: string;
};

export function ChargeConfirmDialog({
  open,
  preview: given,
  onConfirm,
  onClose,
  updateCardHref,
}: ChargeConfirmDialogProps) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Fresh figures from a refused confirm replace the loaded preview until the next open.
  const [fresh, setFresh] = useState<ChargePreview | null>(null);
  const preview = fresh ?? given;
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const alertBoxRef = useRef<HTMLDivElement | null>(null);

  // A fresh open starts clean.
  useEffect(() => {
    if (!open) {
      setPending(false);
      setFailure(null);
      setFresh(null);
    }
  }, [open]);

  // Primary autofocus for adds (P5 rule), once the figures are in.
  useEffect(() => {
    if (open && preview && !failure) primaryRef.current?.focus();
  }, [open, preview, failure]);

  // A failure moves focus to the alert so it is read out.
  useEffect(() => {
    if (!failure) return;
    const alert =
      alertBoxRef.current?.querySelector<HTMLElement>('[role="alert"]');
    if (alert) {
      alert.tabIndex = -1;
      alert.focus();
    }
  }, [failure]);

  const close = () => {
    if (pending) return; // not dismissible while charging
    onClose();
  };

  const confirm = async () => {
    if (pending || !preview) return;
    setPending(true);
    setFailure(null);
    let result: ChargeResult;
    try {
      result = await onConfirm(preview.token);
    } catch {
      result = {
        ok: false,
        reason: "error",
        message:
          "We couldn't charge your card just now. Try again in a minute.",
      };
    }
    setPending(false);
    if (result.ok) {
      onClose();
      toast.show({ message: result.toast });
      return;
    }
    if (result.preview) setFresh(result.preview);
    setFailure({ reason: result.reason, message: result.message });
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={preview?.title ?? CHARGE_COPY.loadingTitle}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={pending}>
            {CHARGE_COPY.notNow}
          </Button>
          <Button
            ref={primaryRef}
            variant="primary"
            data-charge-primary=""
            disabled={!preview}
            loading={pending}
            loadingLabel={CHARGE_COPY.pending}
            onClick={() => void confirm()}
          >
            {preview?.confirmLabel ?? "Add and pay"}
          </Button>
        </>
      }
    >
      {preview ? (
        <div className="flex flex-col gap-4">
          <p className="max-w-[68ch]">{preview.what}</p>
          {preview.orderNote ? (
            <p
              data-charge-order-note=""
              className="rounded border border-hub-border p-4 tabular-nums"
            >
              {preview.orderNote}
            </p>
          ) : (
            <dl className="flex flex-col gap-3 rounded border border-hub-border p-4 tabular-nums">
              <div className="flex flex-col gap-1">
                <dt className="sr-only">Due today</dt>
                <dd className="font-semibold">
                  Today · {formatCentsExact(preview.todayCents)}
                </dd>
                <dd className="text-sm text-hub-ink-muted">
                  {preview.todayLabel}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="sr-only">After today</dt>
                <dd>Then · {preview.thenText}</dd>
              </div>
            </dl>
          )}
          {preview.cardLine ? (
            <p className="text-sm text-hub-ink-muted">{preview.cardLine}</p>
          ) : null}
        </div>
      ) : (
        <div data-charge-skeleton="" className="flex flex-col gap-3">
          <Skeleton rows={3} rowHeight={24} />
        </div>
      )}
      {failure ? (
        <div ref={alertBoxRef} className="mt-4">
          <InlineAlert
            tone="error"
            action={
              failure.reason === "card_declined" ? (
                <a
                  href={updateCardHref}
                  className="inline-flex min-h-11 items-center font-semibold text-hub-ink underline"
                >
                  {CHARGE_COPY.updateCard}
                </a>
              ) : null
            }
          >
            {failure.reason === "card_declined" ? (
              <>
                <p>{CHARGE_COPY.errCard}</p>
                <p>{CHARGE_COPY.nothingAdded}</p>
              </>
            ) : (
              <p>{failure.message}</p>
            )}
          </InlineAlert>
        </div>
      ) : null}
    </Dialog>
  );
}
