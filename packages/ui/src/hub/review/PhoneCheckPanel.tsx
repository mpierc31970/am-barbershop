"use client";
// PhoneCheckPanel (14-34 choice 2; DOM-10, D172; 14-UI-SPEC "Launch review" § ?step=phone,
// D-UI-P14-13; a11y "QR code: role=img + aria-label; the link equivalent is always visible").
// Heading QrCode 20 "Check on your phone", the body, the QR (160px; 200px at >= 1024px) and
// under it "Or open this link on your phone:" + the link (font-mono, selectable) + ghost sm
// Copy link, the 60-minute Label and secondary "I checked it on my phone". Below 640px the QR
// is hidden and the panel reads "You're on your phone already." + Open my site in review mode.
//
// The QR markup is produced on the server by `qrSvg(url, { px, label })` (@cds/core/qr, 14-07):
// numbers and an escaped label only, never the URL text, no script, no href (T-14-34-02). This
// component only inserts that trusted string. Read mode: no QR, no link, no button (the review
// link is minted only for the owner, T-14-34-01).
import { P14_COPY } from "@cds/core/dns";
import { ArrowLeft, ExternalLink, QrCode } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { HubLinkComponent } from "../AddonCard";
import { rethrowControlFlow } from "../action-errors";
import type { HubActionResult } from "../addon-types";
import { Button, buttonClasses } from "../Button";
import { InlineAlert } from "../feedback";
import { CopyLinkButton } from "../social/SocialAccountsList";
import { REVIEW_UI_COPY } from "./copy";

export interface PhoneCheckPanelProps {
  /** Server-rendered QR SVG at 160px (`qrSvg(url, { px: 160, label })`); null without a link. */
  svg: string | null;
  /** The same QR at 200px for >= 1024px; falls back to `svg`. */
  svgLarge?: string | null;
  /** The phone review link the QR encodes; null when no link could be minted. */
  shortLink: string | null;
  /** The phone check is already done (the button still re-ticks it). */
  done?: boolean;
  readOnly?: boolean;
  backHref: string;
  onChecked(): Promise<HubActionResult<unknown>>;
  /** After a successful tick (the app navigates back and toasts). */
  onDone?(): void;
  LinkComponent?: HubLinkComponent;
}

const LINK =
  "rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

export function PhoneCheckPanel({
  svg,
  svgLarge,
  shortLink,
  done = false,
  readOnly = false,
  backHref,
  onChecked,
  onDone,
  LinkComponent,
}: PhoneCheckPanelProps) {
  const Link = LinkComponent ?? "a";
  const headingId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function checked() {
    if (pending) return;
    setPending(true);
    try {
      const res = await onChecked();
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setError(null);
      onDone?.();
    } catch (err) {
      rethrowControlFlow(err);
      setError(P14_COPY.ERR_GENERIC);
    } finally {
      setPending(false);
    }
  }

  const large = svgLarge ?? svg;
  const checkedButton = (
    <Button
      variant="secondary"
      loading={pending}
      onClick={() => void checked()}
      className="w-full justify-center sm:w-auto pointer-coarse:h-11"
      data-phone-checked=""
    >
      {P14_COPY.BTN_CHECKED_ON_PHONE_ITEM}
    </Button>
  );

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-6 font-hub text-hub-ink"
      data-phone-check=""
      data-done={done ? "" : undefined}
    >
      <Link
        href={backHref}
        className={`${LINK} inline-flex w-fit items-center gap-1 text-sm pointer-coarse:py-3`}
      >
        <ArrowLeft aria-hidden size={16} strokeWidth={2} />
        {REVIEW_UI_COPY.backToReview}
      </Link>
      <h2
        id={headingId}
        className="flex items-center gap-2 text-xl leading-tight font-semibold"
      >
        <QrCode aria-hidden size={20} strokeWidth={2} />
        {REVIEW_UI_COPY.phoneHeading}
      </h2>
      {readOnly ? (
        <p className="text-sm text-hub-ink-muted" data-owner-only="">
          {REVIEW_UI_COPY.ownerOnly}
        </p>
      ) : !shortLink || !svg ? (
        <InlineAlert tone="info">{REVIEW_UI_COPY.noLink}</InlineAlert>
      ) : (
        <>
          {/* >= 640px: the QR, the link and the desktop tick. */}
          <div className="hidden flex-col gap-4 sm:flex" data-phone-desktop="">
            <p className="max-w-[68ch] text-base">
              {REVIEW_UI_COPY.phoneBodyBefore}
              <strong className="font-semibold">
                {P14_COPY.BTN_CHECKED_ON_PHONE}
              </strong>
              {REVIEW_UI_COPY.phoneBodyAfter}
            </p>
            <div
              className="w-fit rounded border border-hub-border bg-hub-surface p-2 lg:hidden"
              data-qr="160"
              // Trusted server SVG: qrSvg emits numbers + an escaped label only (14-07).
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <div
              className="hidden w-fit rounded border border-hub-border bg-hub-surface p-2 lg:block"
              data-qr="200"
              dangerouslySetInnerHTML={{ __html: large ?? svg }}
            />
            <div className="flex flex-col gap-2">
              <p className="text-sm">{REVIEW_UI_COPY.orOpen}</p>
              <div className="flex flex-wrap items-start gap-2">
                <code
                  className="min-w-0 flex-1 rounded bg-hub-surface-2 px-2 py-1 font-mono text-sm break-all select-all"
                  data-review-link=""
                >
                  {shortLink}
                </code>
                <CopyLinkButton
                  name="review"
                  link={shortLink}
                  label={P14_COPY.BTN_COPY_LINK}
                  accessibleName={REVIEW_UI_COPY.copyLinkAria}
                  copiedMessage={REVIEW_UI_COPY.linkCopied}
                  variant="ghost"
                  onCopied={setAnnounce}
                />
              </div>
              <p className="text-sm text-hub-ink-muted">
                {REVIEW_UI_COPY.linkLife}
              </p>
            </div>
            <div>{checkedButton}</div>
          </div>
          {/* < 640px: already on a phone, no QR. */}
          <div className="flex flex-col gap-4 sm:hidden" data-phone-mobile="">
            <p className="text-base">{REVIEW_UI_COPY.onPhone}</p>
            <a
              href={shortLink}
              target="_blank"
              rel="noopener noreferrer"
              className={`${buttonClasses("secondary")} w-full justify-center pointer-coarse:h-11`}
            >
              <ExternalLink aria-hidden size={16} strokeWidth={2} />
              <span>{P14_COPY.BTN_OPEN_REVIEW_MODE}</span>
              <span className="sr-only"> {REVIEW_UI_COPY.newTab}</span>
            </a>
            <p className="text-sm text-hub-ink-muted">
              {REVIEW_UI_COPY.linkLife}
            </p>
            {checkedButton}
          </div>
        </>
      )}
      {error ? (
        <div ref={errorRef} tabIndex={-1} className="outline-none">
          <InlineAlert tone="error">{error}</InlineAlert>
        </div>
      ) : null}
      <p aria-live="polite" className="sr-only" data-phone-live="">
        {announce}
      </p>
    </section>
  );
}
