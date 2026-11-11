"use client";
// Shared purchase plumbing for CarePlanPanel and MediaPacksPanel (10-13). Not in the
// barrel: the panels are the public surface.
// - useChargeFlow: open ChargeConfirmDialog at once with a skeleton, then fill it with
//   the server's preview; a failed preview closes it and reports in place.
// - RemoveConfirmDialog: the danger confirm from 10-UI-SPEC "Destructive actions": the
//   keep button has autofocus (P5 rule), pending is not dismissible, success toasts.
import { useEffect, useRef, useState } from "react";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { InlineAlert } from "../feedback";
import { useToast } from "../Toast";
import type { ChargePreview, ChargeResult } from "./types";

export const PREVIEW_FAILED =
  "We couldn't get the price just now. Try again in a minute.";
const REMOVE_FAILED =
  "We couldn't make that change just now. Try again in a minute.";

export interface ChargeFlow<K> {
  open: boolean;
  preview: ChargePreview | null;
  target: K | null;
  error: string | null;
  start: (target: K) => void;
  close: () => void;
}

export function useChargeFlow<K>(
  load: (target: K) => Promise<ChargePreview>,
): ChargeFlow<K> {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ChargePreview | null>(null);
  const [target, setTarget] = useState<K | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const start = (next: K) => {
    const id = ++seq.current;
    setTarget(next);
    setPreview(null);
    setError(null);
    setOpen(true);
    load(next).then(
      (p) => {
        if (seq.current === id) setPreview(p);
      },
      () => {
        if (seq.current !== id) return;
        setOpen(false);
        setError(PREVIEW_FAILED);
      },
    );
  };

  const close = () => {
    seq.current += 1;
    setOpen(false);
  };

  return { open, preview, target, error, start, close };
}

export interface RemoveConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  removeLabel: string;
  keepLabel: string;
  onRemove: () => Promise<ChargeResult>;
  onClose: () => void;
}

export function RemoveConfirmDialog({
  open,
  title,
  body,
  removeLabel,
  keepLabel,
  onRemove,
  onClose,
}: RemoveConfirmDialogProps) {
  const toast = useToast();
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

  const remove = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    let result: ChargeResult;
    try {
      result = await onRemove();
    } catch {
      result = { ok: false, reason: "error", message: REMOVE_FAILED };
    }
    setPending(false);
    if (result.ok) {
      onClose();
      toast.show({ message: result.toast });
    } else {
      setError(result.message || REMOVE_FAILED);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      footer={
        <>
          <Button
            variant="destructive"
            loading={pending}
            loadingLabel="Removing…"
            onClick={() => void remove()}
          >
            {removeLabel}
          </Button>
          <Button
            ref={keepRef}
            variant="secondary"
            disabled={pending}
            onClick={close}
          >
            {keepLabel}
          </Button>
        </>
      }
    >
      <p className="max-w-[68ch]">{body}</p>
      {error ? (
        <div className="mt-4">
          <InlineAlert tone="error">{error}</InlineAlert>
        </div>
      ) : null}
    </Dialog>
  );
}
