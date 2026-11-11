"use client";
// One email address in "Where should your email go?" (06-22; 06-UI-SPEC "Email routing"
// item 5, Badge table, Copywriting BOUNCE; ONB-09, D173, D-UI-P6-24). Address (Body) + a
// status badge, always a word:
//   - Waiting for confirmation: ghost Resend confirmation. After a send it stays disabled for
//     60 s and reads "Sent. Check that inbox." (T-06-102: no confirm-mail spamming).
//   - Confirmed: no action.
//   - Bouncing: TriangleAlert badge and an error InlineAlert under the row with the BOUNCE
//     copy and Change address.
// The host adds the rest: a Change address button for the default row, a remove IconButton
// for an override row. Nothing here saves; the host's callbacks do.
import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { InlineAlert } from "./feedback";
import { IconButton } from "./IconButton";

export type EmailRouteStatus = "waiting" | "confirmed" | "bouncing";

export const RESEND_CONFIRM_COOLDOWN_MS = 60_000;

export const ROUTE_ROW_COPY = {
  waiting: "Waiting for confirmation",
  confirmed: "Confirmed",
  bouncing: "Bouncing",
  resend: "Resend confirmation",
  resent: "Sent. Check that inbox.",
  change: "Change address",
  remove: (address: string) => `Remove ${address}`,
} as const;

/** BOUNCE (06-UI-SPEC Copywriting). */
export function bounceCopy(address: string): string {
  return `Emails to ${address} are bouncing, so you may be missing messages. Check the address or use another one.`;
}

export interface EmailRouteRowProps {
  address: string;
  status: EmailRouteStatus;
  /** A line under the address, e.g. "New address. Your current one works until this is confirmed." */
  note?: ReactNode;
  readOnly?: boolean;
  /**
   * Send a fresh confirmation. Resolve true when a confirmation went out (or one is still
   * cooling down), which starts the 60 s cooldown; false leaves the button ready.
   */
  onResend?: () => Promise<boolean>;
  /** Change address (the bouncing alert's action; the host may also show its own button). */
  onChange?: () => void;
  /** Remove this address (override rows only; the default row has no remove). */
  onRemove?: () => void;
  /** Extra actions at the row's end (e.g. the default row's Change address). */
  actions?: ReactNode;
}

export function EmailRouteRow({
  address,
  status,
  note,
  readOnly = false,
  onResend,
  onChange,
  onRemove,
  actions,
}: EmailRouteRowProps) {
  const [cooling, setCooling] = useState(false);
  const [sending, setSending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function resend() {
    if (!onResend || cooling || sending) return;
    setSending(true);
    let started = false;
    try {
      started = await onResend();
    } catch {
      started = false;
    }
    setSending(false);
    if (!started) return;
    setCooling(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCooling(false);
      timer.current = null;
    }, RESEND_CONFIRM_COOLDOWN_MS);
  }

  return (
    <div className="flex flex-col gap-2 font-hub" data-route-status={status}>
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="min-w-0 text-base break-all text-hub-ink">
            {address}
          </span>
          <Badge tone={status}>{ROUTE_ROW_COPY[status]}</Badge>
        </div>
        <div className="flex items-center gap-1">
          {status === "waiting" && onResend && !readOnly ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={cooling}
              loading={sending}
              onClick={() => void resend()}
            >
              {cooling ? ROUTE_ROW_COPY.resent : ROUTE_ROW_COPY.resend}
            </Button>
          ) : null}
          {readOnly ? null : actions}
          {onRemove && !readOnly ? (
            <IconButton
              size="sm"
              label={ROUTE_ROW_COPY.remove(address)}
              tooltipAlign="end"
              onClick={onRemove}
              icon={<X aria-hidden size={16} strokeWidth={2} />}
            />
          ) : null}
        </div>
      </div>
      {note ? <p className="text-sm text-hub-ink-muted">{note}</p> : null}
      {status === "bouncing" ? (
        <InlineAlert
          tone="error"
          action={
            onChange && !readOnly ? (
              <Button variant="secondary" size="sm" onClick={onChange}>
                {ROUTE_ROW_COPY.change}
              </Button>
            ) : undefined
          }
        >
          {bounceCopy(address)}
        </InlineAlert>
      ) : null}
    </div>
  );
}
