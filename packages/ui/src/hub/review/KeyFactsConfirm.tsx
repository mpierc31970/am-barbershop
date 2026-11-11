"use client";
// KeyFactsConfirm (14-34 choice 2; DOM-10, D172, D173; 14-UI-SPEC "Launch review" § ?step=facts).
// Back link "Review your site", heading "Check your key details", a read-only <dl> of the five
// facts (business name, phone, email with its confirmation badge, address, compact hours), each
// with an Edit link to its existing screen (`?next=/hub/review?step=facts` is built by the app).
// Footer primary Confirm these details (pending Confirming…). An unconfirmed email blocks it:
// InlineAlert info FACTS-EMAIL with Resend confirmation. Read mode (Admin, staff viewing): the
// facts only, no Edit, no Confirm. A refused confirm shows its message in an alert that takes
// focus; success calls `onConfirmed` (the app navigates back and toasts).
import { P14_COPY } from "@cds/core/dns";
import { ArrowLeft } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { HubLinkComponent } from "../AddonCard";
import { rethrowControlFlow } from "../action-errors";
import type { HubActionResult } from "../addon-types";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { InlineAlert } from "../feedback";
import { REVIEW_UI_COPY } from "./copy";

export type KeyFactKey = "name" | "phone" | "email" | "address" | "hours";

export interface KeyFactsView {
  name: string;
  phone: string;
  email: string;
  /** Null when there is no email address on file. */
  emailConfirmed: boolean | null;
  address: string;
  /** Compact hours ("Mon–Fri 9–5, Sat 10–2"); "" when none. */
  hours: string;
}

export interface KeyFactsConfirmProps {
  facts: KeyFactsView;
  editHrefs: Readonly<Record<KeyFactKey, string>>;
  /** The unconfirmed address for FACTS-EMAIL; "" when every address is confirmed. */
  unconfirmedEmail: string;
  backHref: string;
  readOnly?: boolean;
  onConfirm(): Promise<HubActionResult<unknown>>;
  onResend?(): Promise<HubActionResult<unknown>>;
  onConfirmed?(): void;
  LinkComponent?: HubLinkComponent;
}

const ORDER: readonly KeyFactKey[] = [
  "name",
  "phone",
  "email",
  "address",
  "hours",
];

const LINK =
  "rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

function valueOf(facts: KeyFactsView, key: KeyFactKey): string {
  return facts[key] || "";
}

export function KeyFactsConfirm({
  facts,
  editHrefs,
  unconfirmedEmail,
  backHref,
  readOnly = false,
  onConfirm,
  onResend,
  onConfirmed,
  LinkComponent,
}: KeyFactsConfirmProps) {
  const Link = LinkComponent ?? "a";
  const headingId = useId();
  const alertId = useId();
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const blocked = unconfirmedEmail !== "";

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function confirm() {
    if (pending || blocked) return;
    setPending(true);
    try {
      const res = await onConfirm();
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setError(null);
      onConfirmed?.();
    } catch (err) {
      rethrowControlFlow(err);
      setError(P14_COPY.ERR_GENERIC);
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    if (!onResend || resending) return;
    setResending(true);
    try {
      const res = await onResend();
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setError(null);
      setNotice(REVIEW_UI_COPY.resent);
    } catch (err) {
      rethrowControlFlow(err);
      setError(P14_COPY.ERR_GENERIC);
    } finally {
      setResending(false);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-6 font-hub text-hub-ink"
      data-key-facts=""
    >
      <Link
        href={backHref}
        className={`${LINK} inline-flex w-fit items-center gap-1 text-sm pointer-coarse:py-3`}
      >
        <ArrowLeft aria-hidden size={16} strokeWidth={2} />
        {REVIEW_UI_COPY.backToReview}
      </Link>
      <h2 id={headingId} className="text-xl leading-tight font-semibold">
        {REVIEW_UI_COPY.factsHeading}
      </h2>
      <dl className="flex flex-col divide-y divide-hub-border border-y border-hub-border">
        {ORDER.map((key) => {
          const label = REVIEW_UI_COPY.factLabels[key];
          const value = valueOf(facts, key);
          return (
            <div
              key={key}
              data-fact={key}
              className="flex flex-col gap-1 py-4 sm:flex-row sm:items-start sm:gap-4"
            >
              <dt className="w-40 shrink-0 text-sm text-hub-ink-muted">
                {label}
              </dt>
              <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-base">
                <span className="break-words">
                  {value || (
                    <span className="text-hub-ink-muted">
                      {REVIEW_UI_COPY.notSet}
                    </span>
                  )}
                </span>
                {key === "email" && facts.emailConfirmed !== null ? (
                  <Badge tone={facts.emailConfirmed ? "confirmed" : "waiting"}>
                    {facts.emailConfirmed
                      ? REVIEW_UI_COPY.emailConfirmed
                      : REVIEW_UI_COPY.emailNotConfirmed}
                  </Badge>
                ) : null}
              </dd>
              {readOnly ? null : (
                <dd className="shrink-0">
                  <Link
                    href={editHrefs[key]}
                    className={`${LINK} text-sm pointer-coarse:py-3`}
                    aria-label={REVIEW_UI_COPY.editAria(label)}
                  >
                    {REVIEW_UI_COPY.edit}
                  </Link>
                </dd>
              )}
            </div>
          );
        })}
      </dl>
      {blocked && !readOnly ? (
        <div id={alertId} data-facts-email="">
          <InlineAlert
            tone="info"
            action={
              onResend ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={resending}
                  onClick={() => void resend()}
                >
                  {REVIEW_UI_COPY.resendConfirmation}
                </Button>
              ) : undefined
            }
          >
            {P14_COPY.FACTS_EMAIL({ email: unconfirmedEmail })}
          </InlineAlert>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-hub-ink-muted">
          {notice}
        </p>
      ) : null}
      {error ? (
        <div ref={errorRef} tabIndex={-1} className="outline-none">
          <InlineAlert tone="error">{error}</InlineAlert>
        </div>
      ) : null}
      {readOnly ? (
        <p className="text-sm text-hub-ink-muted" data-owner-only="">
          {REVIEW_UI_COPY.ownerOnly}
        </p>
      ) : (
        <div>
          <Button
            variant="primary"
            loading={pending}
            loadingLabel={REVIEW_UI_COPY.confirming}
            aria-disabled={blocked || undefined}
            aria-describedby={blocked ? alertId : undefined}
            onClick={() => void confirm()}
            data-confirm-facts=""
          >
            {REVIEW_UI_COPY.confirm}
          </Button>
        </div>
      )}
    </section>
  );
}
