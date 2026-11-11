"use client";
// ReviewSubmitPanel (14-34 choice 2; DOM-10, D172, D26; 14-UI-SPEC "Launch review" §
// ReviewSubmitPanel). The bottom panel (--hub-surface-2, 24px padding, 8px radius):
//   - Heading SUBMIT-H "Your site goes live at <domain>." (no domain: "Connect your domain to
//     choose where your site goes live." + Connect your domain).
//   - Locked: primary Ready to launch + ArrowRight stays aria-disabled (focusable, inert) with
//     aria-describedby to the reason lines ("Finish 2 more items above.", DOMAIN-NOT-READY with
//     its Settings › Domain link). Unlocked: Ready to launch (pending Sending…), no confirm
//     dialog (not destructive; CDS approves).
//   - Sent: CircleCheck 20 + SUBMITTED-H + SUBMITTED-B replaces the panel. Edited after sending:
//     InlineAlert warning RESUBMIT above the panel, which can be sent again.
// Read mode (Admin, staff viewing): heading and reasons, the owner-only Label, no button.
import { P14_COPY } from "@cds/core/dns";
import { ArrowRight, CircleCheck } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { HubLinkComponent } from "../AddonCard";
import { rethrowControlFlow } from "../action-errors";
import type { HubActionResult } from "../addon-types";
import { Button } from "../Button";
import { InlineAlert } from "../feedback";
import { REVIEW_UI_COPY } from "./copy";

export type ReviewSubmitReason = {
  text: string;
  /** An optional link after the text (DOMAIN-NOT-READY -> Settings › Domain). */
  href?: string;
  linkLabel?: string;
};

export interface ReviewSubmitPanelProps {
  /** Locked even with no reasons listed (e.g. the review isn't open). */
  locked: boolean;
  reasons: readonly ReviewSubmitReason[];
  /** The domain the site goes live at; null when none is connected. */
  domain: string | null;
  /** The review was sent and nothing changed since. */
  sent: boolean;
  /** Page titles published again after sending (RESUBMIT). */
  resubmit?: readonly string[];
  /** Settings › Domain (the no-domain Connect your domain link). */
  domainHref: string;
  readOnly?: boolean;
  onSubmit(): Promise<HubActionResult<unknown>>;
  onSent?(): void;
  LinkComponent?: HubLinkComponent;
}

const LINK =
  "rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

export function ReviewSubmitPanel({
  locked,
  reasons,
  domain,
  sent,
  resubmit = [],
  domainHref,
  readOnly = false,
  onSubmit,
  onSent,
  LinkComponent,
}: ReviewSubmitPanelProps) {
  const Link = LinkComponent ?? "a";
  const headingId = useId();
  const reasonsId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  if (sent && resubmit.length === 0) {
    return (
      <section
        aria-labelledby={headingId}
        className="mt-12 flex flex-col gap-2 font-hub text-hub-ink"
        data-review-sent=""
      >
        <CircleCheck
          aria-hidden
          size={20}
          strokeWidth={2}
          className="text-hub-success"
        />
        <h2 id={headingId} className="text-xl leading-tight font-semibold">
          {P14_COPY.SUBMITTED_H}
        </h2>
        <p className="max-w-[68ch] text-base">{P14_COPY.SUBMITTED_B}</p>
      </section>
    );
  }

  const isLocked = locked || reasons.length > 0 || !domain;

  async function submit() {
    if (pending || isLocked) return;
    setPending(true);
    try {
      const res = await onSubmit();
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setError(null);
      onSent?.();
    } catch (err) {
      rethrowControlFlow(err);
      setError(P14_COPY.ERR_GENERIC);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 font-hub text-hub-ink">
      {resubmit.map((title) => (
        <InlineAlert key={title} tone="warning">
          {P14_COPY.RESUBMIT({ title })}
        </InlineAlert>
      ))}
      <section
        aria-labelledby={headingId}
        className="flex flex-col gap-4 rounded-lg bg-hub-surface-2 p-6"
        data-review-submit=""
        data-locked={isLocked ? "" : undefined}
      >
        <h2 id={headingId} className="text-xl leading-tight font-semibold">
          {domain
            ? P14_COPY.SUBMIT_H({ domain })
            : REVIEW_UI_COPY.noDomainHeading}
        </h2>
        {!domain && !readOnly ? (
          <Link href={domainHref} className={`${LINK} w-fit text-sm`}>
            {REVIEW_UI_COPY.connectDomain}
          </Link>
        ) : null}
        {reasons.length > 0 ? (
          <ul id={reasonsId} className="flex flex-col gap-1" data-reasons="">
            {reasons.map((r) => (
              <li key={r.text} className="text-sm text-hub-ink-muted">
                {r.text}
                {r.href && !readOnly ? (
                  <>
                    {" "}
                    <Link href={r.href} className={LINK}>
                      {r.linkLabel ?? REVIEW_UI_COPY.domainSettings}
                    </Link>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
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
              loadingLabel={REVIEW_UI_COPY.sending}
              aria-disabled={isLocked || undefined}
              aria-describedby={reasons.length > 0 ? reasonsId : undefined}
              onClick={() => void submit()}
              className={isLocked ? "cursor-not-allowed opacity-50" : undefined}
              data-ready-to-launch=""
            >
              {REVIEW_UI_COPY.readyToLaunch}
              {pending ? null : (
                <ArrowRight
                  aria-hidden
                  size={16}
                  strokeWidth={2}
                  className="ml-1 inline-block align-[-3px]"
                />
              )}
            </Button>
          </div>
        )}
        {error ? (
          <div ref={errorRef} tabIndex={-1} className="outline-none">
            <InlineAlert tone="error">{error}</InlineAlert>
          </div>
        ) : null}
      </section>
    </div>
  );
}
