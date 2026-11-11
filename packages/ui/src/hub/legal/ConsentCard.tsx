"use client";
// ConsentCard (09-UI-SPEC "SignaturePanel"; CONTEXT A2-Q1; D80). Same card as a policy
// card: ink-muted meta line, optional consent full text, and the CONSENT-TEXT checkbox,
// ticked again on every signing, never pre-ticked. Controlled and data-free.
import { useId, type Ref } from "react";
import { AcceptRow, CARD, FullTextDisclosure } from "./PolicyCard";
import { SIGNING_COPY } from "./signing-state";

export interface ConsentCardProps {
  /** "Electronic signature consent · Version 1". */
  metaLine: string;
  /** Pre-rendered, sanitised HTML of the consent text version (optional). */
  consentHtml?: string;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  readOnly: boolean;
  checkboxRef?: Ref<HTMLInputElement>;
  /** Pending submit: input disabled without changing its value. */
  disabled?: boolean;
}

export function ConsentCard({
  metaLine,
  consentHtml,
  checked,
  onCheckedChange,
  readOnly,
  checkboxRef,
  disabled,
}: ConsentCardProps) {
  const uid = useId();
  return (
    <div className={`${CARD} flex flex-col gap-4`}>
      <p className="text-sm text-hub-ink-muted tabular-nums">{metaLine}</p>
      {consentHtml ? <FullTextDisclosure bodyHtml={consentHtml} /> : null}
      <AcceptRow
        id={`consent-${uid}`}
        name="accept-consent"
        label={SIGNING_COPY.consentText}
        checked={checked}
        onCheckedChange={onCheckedChange}
        readOnly={readOnly}
        disabled={disabled}
        checkboxRef={checkboxRef}
      />
    </div>
  );
}
