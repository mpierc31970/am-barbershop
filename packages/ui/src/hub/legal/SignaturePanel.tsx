"use client";
// SignaturePanel (09-UI-SPEC "SignaturePanel"; CONTEXT A2-Q1, A6-Q2; D80, D287,
// D-UI-P9-5, D-UI-P9-7). The "Sign your agreement" section: ConsentCard, the typed full
// legal name (never pre-filled), the live signing statement, an error region, and the
// one primary button. Incomplete = aria-disabled (still focusable) + a polite reason
// line; activating it moves focus to the first missing item and does nothing else.
// Pending = "Signing…", every input disabled, no double submit. Read-only (Admin, staff
// impersonating) = every input disabled and unticked/empty, no button.
// Controlled and data-free: the signing form in apps/web (09-17) owns state and calls
// the Server Action.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "../Button";
import { TextField } from "../fields";
import { InlineAlert } from "../feedback";
import { ConsentCard, type ConsentCardProps } from "./ConsentCard";
import {
  SIGNING_COPY,
  signingReason,
  signingStatement,
  typedNameValid,
} from "./signing-state";

export interface SignaturePanelProps {
  consent: ConsentCardProps;
  /** The typed name, raw (the server normalises again). Empty on first render. */
  name: string;
  onNameChange?: (value: string) => void;
  /** Org legal name, else business name. */
  onBehalfOf: string;
  /** "8 Oct 2026" in the org's timezone. */
  dateLabel: string;
  /** Unticked policy boxes + the consent box. */
  missingBoxes: number;
  pending: boolean;
  readOnly: boolean;
  /** ERR-SIGN / ERR-STALE / ERR-ALREADY content; focused when it appears. */
  error?: ReactNode;
  onSign: () => void;
  /** Focus the first unticked checkbox. Called only when a box is missing; when only
   *  the name is missing the panel focuses its own name field. */
  focusFirstMissing: () => void;
}

const DISABLED_LOOK =
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-50 " +
  "aria-disabled:hover:bg-hub-accent aria-disabled:active:bg-hub-accent";

export function SignaturePanel({
  consent,
  name,
  onNameChange,
  onBehalfOf,
  dateLabel,
  missingBoxes,
  pending,
  readOnly,
  error,
  onSign,
  focusFirstMissing,
}: SignaturePanelProps) {
  const uid = useId();
  const headingId = `sign-heading-${uid}`;
  const nameId = `signer-name-${uid}`;
  const reasonId = `sign-reason-${uid}`;
  const errorRef = useRef<HTMLDivElement>(null);
  const [nameTried, setNameTried] = useState(false);

  const shownName = readOnly ? "" : name;
  const nameOk = typedNameValid(shownName);
  const reason = signingReason(missingBoxes, nameOk);
  const incomplete = reason !== null;

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function activate() {
    if (pending || readOnly) return;
    if (!incomplete) {
      onSign();
      return;
    }
    if (!nameOk) setNameTried(true);
    if (missingBoxes > 0) focusFirstMissing();
    else document.getElementById(nameId)?.focus();
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col font-hub">
      <h2
        id={headingId}
        className="mb-4 text-xl leading-tight font-semibold text-hub-ink"
      >
        {SIGNING_COPY.signHeading}
      </h2>
      <ConsentCard
        {...consent}
        readOnly={readOnly || consent.readOnly}
        disabled={pending || consent.disabled}
      />
      <div className="mt-6">
        <TextField
          id={nameId}
          name="signer_name"
          type="text"
          label={SIGNING_COPY.nameLabel}
          helper={SIGNING_COPY.nameHelper}
          error={
            nameTried && !nameOk && !readOnly
              ? SIGNING_COPY.nameError
              : undefined
          }
          value={shownName}
          onChange={(e) => onNameChange?.(e.currentTarget.value)}
          disabled={readOnly || pending}
          autoComplete="name"
          autoCapitalize="words"
          spellCheck={false}
        />
      </div>
      <p className="mt-4 text-sm text-hub-ink-muted tabular-nums">
        {signingStatement({ name: shownName, onBehalfOf, dateLabel })}
      </p>
      {error ? (
        <div ref={errorRef} tabIndex={-1} className="mt-6 outline-none">
          <InlineAlert tone="error">{error}</InlineAlert>
        </div>
      ) : null}
      {readOnly ? null : (
        <div className="mt-6 flex flex-col gap-2">
          <Button
            variant="primary"
            type="button"
            className={`w-full sm:w-auto sm:self-start ${DISABLED_LOOK}`}
            loading={pending}
            loadingLabel={SIGNING_COPY.signing}
            aria-disabled={incomplete && !pending ? true : undefined}
            aria-describedby={incomplete ? reasonId : undefined}
            onClick={activate}
          >
            {SIGNING_COPY.sign}
          </Button>
          <p
            id={reasonId}
            aria-live="polite"
            className="text-sm text-hub-ink-muted"
          >
            {reason ?? ""}
          </p>
        </div>
      )}
    </section>
  );
}
