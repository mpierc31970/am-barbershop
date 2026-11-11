"use client";
// PolicyCard (09-UI-SPEC "PolicyCard"; CONTEXT A2-Q1, A6-Q2; D216, D287, D-UI-P9-2, -6).
// Controlled and data-free: the signing form in apps/web (09-17) owns the ticks. Title,
// meta, exactly the summary bullets, an inline native <details> full text (works without
// JS), and one accept checkbox that is never pre-ticked and never ticked by opening the
// text. A ticked card does not change colour (D-UI-P9-6). No accept-all anywhere.
import { ChevronDown, ExternalLink } from "lucide-react";
import { useId, useRef, type ReactNode, type Ref } from "react";
import { buttonClasses } from "../Button";
import { LegalProse } from "./LegalProse";
import { SIGNING_COPY } from "./signing-state";

export interface PolicyCardProps {
  policyKey: string;
  title: string;
  /** "Version 1 · Effective 1 Oct 2026" (re-accept adds "· You signed version 1 on …"). */
  metaLine: string;
  /** Exactly the summary bullets to show (3 by CONTEXT). */
  summary: readonly string[];
  /** Pre-rendered, sanitised HTML (see LegalProse). */
  bodyHtml: string;
  /** `/legal/<key>/v<N>`. */
  fullTextHref: string;
  /** Re-accept only: the version's `changes` sentence(s). */
  whatChanged?: string;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Admin or staff impersonating (D287): disabled and unticked. */
  readOnly: boolean;
  /** Signing pending (09-UI-SPEC: every input disabled); keeps the tick, unlike readOnly. */
  disabled?: boolean;
  checkboxRef?: Ref<HTMLInputElement>;
}

export const CARD =
  "rounded-lg border border-hub-border bg-hub-surface p-6 font-hub";

/** The whole-row label with a native 20px checkbox (min 44px row). Internal. */
export function AcceptRow({
  id,
  label,
  checked,
  onCheckedChange,
  readOnly,
  disabled,
  checkboxRef,
  name,
}: {
  id: string;
  label: ReactNode;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  readOnly: boolean;
  disabled?: boolean;
  checkboxRef?: Ref<HTMLInputElement>;
  name?: string;
}) {
  const off = readOnly || Boolean(disabled);
  return (
    <label
      htmlFor={id}
      className={
        "flex min-h-11 items-center gap-2 text-base text-hub-ink " +
        (off ? "cursor-not-allowed text-hub-ink-muted" : "cursor-pointer")
      }
    >
      <input
        ref={checkboxRef}
        id={id}
        name={name}
        type="checkbox"
        className="h-5 w-5 shrink-0 accent-hub-accent"
        checked={!readOnly && checked}
        disabled={off}
        onChange={(e) => onCheckedChange?.(e.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

/** Inline full-text disclosure (D-UI-P9-2). Internal. */
export function FullTextDisclosure({
  bodyHtml,
  title,
  fullTextHref,
}: {
  bodyHtml: string;
  title?: string;
  fullTextHref?: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  return (
    <details ref={detailsRef} className="group">
      <summary
        ref={summaryRef}
        className={
          "inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-base " +
          "text-hub-accent underline-offset-2 hover:text-hub-accent-hover hover:underline " +
          "[&::-webkit-details-marker]:hidden"
        }
      >
        <span className="group-open:hidden">{SIGNING_COPY.readFullText}</span>
        <span className="hidden group-open:inline">
          {SIGNING_COPY.hideFullText}
        </span>
        <ChevronDown
          aria-hidden
          size={16}
          strokeWidth={2}
          className="transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="mt-4 flex flex-col gap-4 border-t border-hub-border pt-4">
        <LegalProse html={bodyHtml} />
        <div className="flex flex-wrap items-center gap-4">
          {fullTextHref && title ? (
            <a
              href={fullTextHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={SIGNING_COPY.openInNewTabLabel(title)}
              className="inline-flex min-h-11 items-center gap-2 text-base text-hub-accent underline underline-offset-2 hover:text-hub-accent-hover"
            >
              <ExternalLink aria-hidden size={16} strokeWidth={2} />
              {SIGNING_COPY.openInNewTab}
            </a>
          ) : null}
          <button
            type="button"
            className={`${buttonClasses("ghost", "md")} min-h-11 text-hub-accent`}
            onClick={() => {
              if (detailsRef.current) detailsRef.current.open = false;
              summaryRef.current?.focus();
            }}
          >
            {SIGNING_COPY.hideFullText}
          </button>
        </div>
      </div>
    </details>
  );
}

export function PolicyCard({
  policyKey,
  title,
  metaLine,
  summary,
  bodyHtml,
  fullTextHref,
  whatChanged,
  checked,
  onCheckedChange,
  readOnly,
  disabled,
  checkboxRef,
}: PolicyCardProps) {
  const uid = useId();
  const boxId = `policy-${policyKey}-${uid}`;
  return (
    <li className={`${CARD} flex flex-col gap-4`} data-policy={policyKey}>
      <div className="flex flex-col gap-2">
        <h2 className="text-xl leading-tight font-semibold text-hub-ink">
          {title}
        </h2>
        <p className="text-sm text-hub-ink-muted tabular-nums">{metaLine}</p>
      </div>
      {whatChanged ? (
        <p className="text-base text-hub-ink">
          <span className="font-semibold">{SIGNING_COPY.whatChangedLead}</span>{" "}
          {whatChanged}
        </p>
      ) : null}
      <ul className="flex list-disc flex-col gap-2 pl-6 text-base text-hub-ink marker:text-hub-ink-muted">
        {summary.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <FullTextDisclosure
        bodyHtml={bodyHtml}
        title={title}
        fullTextHref={fullTextHref}
      />
      <div className="border-t border-hub-border pt-4">
        <AcceptRow
          id={boxId}
          name={`accept-${policyKey}`}
          label={SIGNING_COPY.policyCheckbox(title)}
          checked={checked}
          onCheckedChange={onCheckedChange}
          readOnly={readOnly}
          disabled={disabled}
          checkboxRef={checkboxRef}
        />
      </div>
    </li>
  );
}
