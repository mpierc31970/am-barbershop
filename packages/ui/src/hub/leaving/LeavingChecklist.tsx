"use client";
// LeavingChecklist (14-42 choice 3; LIFE-01, D282, D284, D263, D161, D-UI-P14-23; 14-UI-SPEC
// "/hub/leaving checklist"). H1 Leaving CDS + "Notice ends 14 Nov 2026 · 23 days left", then
// an <ol> of six panel rows (StageStatusIcon + Body 600 title + Label sub-line):
//   1 Move your DNS (the `dns` slot: one HandbackFlow per domain; HANDBACK-NA when there was
//     nothing to hand back) · 2 Download your data · 3 Add-ons · 4 Connected services ·
//   5 Billing (read-only) · 6 Your site closes.
// Every step after DNS is LOCKED until DNS is done or not applicable: Lock 16 + "Opens once
// your DNS has moved back." and its content aria-disabled, with no action (D282, enforced in
// @cds/db too). Footer: Stay with CDS → Dialog (safe autofocus on Stay with CDS, STAY-B, plus
// the "no longer points to CDS" line once the DNS moved back) · Keep leaving.
// Admins (and staff viewing) get the same list read-only: no buttons.
import { P14_COPY } from "@cds/core/dns";
import { Lock } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import type { HubActionResult } from "../addon-types";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { InlineAlert } from "../feedback";
import { StageStatusIcon } from "../StageRail";
import { LeavingTitle } from "./LeaveStartPanel";
import { LEAVING_UI_COPY as C } from "./copy";

export type LeavingStepKey =
  "dns_handback" | "download" | "addons" | "services" | "billing" | "close";
export type LeavingStepStatus = "open" | "done" | "not_applicable" | "locked";

export type LeavingServiceLine = { key: string; label: string; state: string };
export type LeavingAddonLine = {
  key: string;
  addon: string;
  label: string;
  line: string;
};

/** Steps the owner ticks by hand (the rest are driven by the flow or the job). */
export type LeavingTickStep = "addons" | "services" | "billing";

export interface LeavingChecklistProps {
  /** Long notice-end date ("14 Nov 2026"). */
  endsOn: string;
  daysLeft: number;
  steps: readonly { key: LeavingStepKey; status: LeavingStepStatus }[];
  /** Step 1 body: the HandbackFlow(s). Ignored when DNS is not applicable. */
  dns?: ReactNode;
  /** "Available until 14 Nov 2026." */
  downloadLine: string;
  addons: { items: readonly LeavingAddonLine[]; line: string | null };
  services: readonly LeavingServiceLine[];
  billingLines: readonly string[];
  /** "14 Nov 2026. Deleted 30 days later, on 14 Dec 2026." */
  closeLine: string;
  readOnly?: boolean;
  /** The DNS already moved back (the Stay dialog adds `stayHandedBackLine`). */
  dnsHandedBack?: boolean;
  stayHandedBackLine?: string;
  onDownloadData?(): Promise<HubActionResult<unknown>>;
  onStepDone?(step: LeavingTickStep): Promise<HubActionResult<unknown>>;
  onStay?(): Promise<HubActionResult<unknown>>;
  /** After a step action succeeded (the app refreshes); `message` for a toast. */
  onChanged?(message?: string): void;
  /** After Stay with CDS succeeded (the app toasts and leaves the page). */
  onStayed?(): void;
  /** Replaces the default H1 (ScreenHeader with "?" once the how-to exists). */
  header?: ReactNode;
}

export const LEAVING_STEP_TITLES: Readonly<Record<LeavingStepKey, string>> =
  Object.freeze({
    dns_handback: "Move your DNS",
    download: "Download your data",
    addons: "Add-ons",
    services: "Connected services",
    billing: "Billing",
    close: "Your site closes",
  });

function iconStatus(s: LeavingStepStatus) {
  if (s === "done" || s === "not_applicable") return "done" as const;
  return "not_started" as const;
}

const TICKABLE: ReadonlySet<LeavingStepKey> = new Set([
  "addons",
  "services",
  "billing",
]);

export function LeavingChecklist({
  endsOn,
  daysLeft,
  steps,
  dns,
  downloadLine,
  addons,
  services,
  billingLines,
  closeLine,
  readOnly = false,
  dnsHandedBack = false,
  stayHandedBackLine,
  onDownloadData,
  onStepDone,
  onStay,
  onChanged,
  onStayed,
  header,
}: LeavingChecklistProps) {
  const id = useId();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stayOpen, setStayOpen] = useState(false);
  const [stayError, setStayError] = useState<string | null>(null);

  const statusOf = (k: LeavingStepKey): LeavingStepStatus =>
    steps.find((s) => s.key === k)?.status ?? "open";
  const dnsStatus = statusOf("dns_handback");
  const dnsSettled = dnsStatus === "done" || dnsStatus === "not_applicable";

  async function act(
    key: string,
    fn: () => Promise<HubActionResult<unknown>>,
    message?: string,
  ): Promise<void> {
    if (pending) return;
    setPending(key);
    setError(null);
    try {
      const res = await fn().catch(() => null);
      if (!res) setError(C.tryAgain);
      else if (!res.ok) setError(res.message);
      else onChanged?.(message);
    } finally {
      setPending(null);
    }
  }

  async function stay(): Promise<void> {
    if (!onStay || pending) return;
    setPending("stay");
    setStayError(null);
    try {
      const res = await onStay().catch(() => null);
      if (!res) setStayError(C.tryAgain);
      else if (!res.ok) setStayError(res.message);
      else {
        setStayOpen(false);
        onStayed?.();
      }
    } finally {
      setPending(null);
    }
  }

  function body(k: LeavingStepKey): ReactNode {
    switch (k) {
      case "dns_handback":
        return dnsStatus === "not_applicable" ? (
          <p className="text-sm text-hub-ink-muted">{P14_COPY.HANDBACK_NA}</p>
        ) : (
          (dns ?? null)
        );
      case "download":
        return (
          <div className="flex flex-col gap-2">
            {!readOnly && onDownloadData && statusOf(k) !== "locked" ? (
              <div>
                <Button
                  size="sm"
                  loading={pending === "download"}
                  onClick={() =>
                    void act("download", onDownloadData, C.downloadStarted)
                  }
                >
                  {P14_COPY.BTN_DOWNLOAD_DATA}
                </Button>
              </div>
            ) : null}
            <p className="text-sm text-hub-ink-muted">{downloadLine}</p>
          </div>
        );
      case "addons":
        return addons.items.length === 0 ? (
          <p className="text-sm text-hub-ink-muted">
            {addons.line ?? P14_COPY.ADDONS_NA}
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {addons.items.map((a) => (
              <li key={`${a.addon}:${a.key}`}>
                <span className="font-semibold">
                  {a.addon} · {a.label}
                </span>
                <span className="text-hub-ink-muted"> · {a.line}</span>
              </li>
            ))}
          </ul>
        );
      case "services":
        return (
          <ul className="flex flex-col gap-1 text-sm" data-leaving-services="">
            {services.map((s) => (
              <li key={s.key} data-service={s.key}>
                {s.label}
                <span className="text-hub-ink-muted"> · {s.state}</span>
              </li>
            ))}
          </ul>
        );
      case "billing":
        return (
          <p className="text-sm text-hub-ink-muted">{billingLines.join(" ")}</p>
        );
      case "close":
        return <p className="text-sm text-hub-ink-muted">{closeLine}</p>;
    }
  }

  const order: LeavingStepKey[] = [
    "dns_handback",
    "download",
    "addons",
    "services",
    "billing",
    "close",
  ];

  return (
    <div
      data-leaving-checklist=""
      className="mx-auto flex w-full max-w-[720px] flex-col gap-8 font-hub text-hub-ink"
    >
      <div className="flex flex-col gap-2">
        {header ?? <LeavingTitle />}
        <p className="text-sm text-hub-ink-muted">
          {C.noticeLine(endsOn, daysLeft)}
        </p>
        {readOnly ? (
          <p className="text-sm text-hub-ink-muted">{C.readOnly}</p>
        ) : null}
      </div>

      <ol className="flex flex-col gap-4">
        {order.map((k) => {
          const raw = statusOf(k);
          const locked =
            k !== "dns_handback" && (raw === "locked" || !dnsSettled);
          const status: LeavingStepStatus = locked ? "locked" : raw;
          const headingId = `${id}-${k}`;
          return (
            <li
              key={k}
              data-step={k}
              data-step-status={status}
              aria-labelledby={headingId}
              className="flex flex-col gap-4 rounded-lg border border-hub-border bg-hub-surface p-6"
            >
              <div className="flex items-start gap-3">
                <span className="mt-1">
                  <StageStatusIcon status={iconStatus(status)} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <h2 id={headingId} className="text-base font-semibold">
                    {LEAVING_STEP_TITLES[k]}
                  </h2>
                  {locked ? (
                    <p
                      className="flex items-center gap-2 text-sm text-hub-ink-muted"
                      data-locked=""
                    >
                      <Lock aria-hidden size={16} strokeWidth={2} />
                      {P14_COPY.LOCKED}
                    </p>
                  ) : null}
                </div>
                {!locked &&
                !readOnly &&
                onStepDone &&
                TICKABLE.has(k) &&
                status === "open" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={C.markDoneName(LEAVING_STEP_TITLES[k])}
                    loading={pending === k}
                    onClick={() =>
                      void act(k, () => onStepDone(k as LeavingTickStep))
                    }
                  >
                    {C.markDone}
                  </Button>
                ) : null}
              </div>
              {locked ? (
                <div aria-disabled="true" className="opacity-60">
                  {k === "download" ? (
                    <p className="text-sm text-hub-ink-muted">{downloadLine}</p>
                  ) : (
                    body(k)
                  )}
                </div>
              ) : (
                body(k)
              )}
            </li>
          );
        })}
      </ol>

      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}

      {!readOnly && onStay ? (
        <div>
          <Button onClick={() => setStayOpen(true)}>{P14_COPY.BTN_STAY}</Button>
        </div>
      ) : null}

      {stayOpen ? (
        <Dialog
          open
          onClose={() => setStayOpen(false)}
          title={P14_COPY.STAY_H}
          footer={
            <>
              <Button onClick={() => setStayOpen(false)}>
                {P14_COPY.BTN_KEEP_LEAVING}
              </Button>
              <Button
                variant="primary"
                autoFocus
                loading={pending === "stay"}
                onClick={() => void stay()}
              >
                {P14_COPY.BTN_STAY}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <p>{P14_COPY.STAY_B}</p>
            {dnsHandedBack && stayHandedBackLine ? (
              <p>{stayHandedBackLine}</p>
            ) : null}
            {stayError ? (
              <InlineAlert tone="error">{stayError}</InlineAlert>
            ) : null}
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
