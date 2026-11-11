"use client";
// LeaveStartPanel (14-42 choice 1; LIFE-01, D282, D263, D161, D-UI-P14-21; 14-UI-SPEC
// "/hub/leaving before starting"; T-14-42-02, T-14-42-03). The honest start page: a 720px
// column, H1 Leaving CDS (DoorOpen 20, decorative), 48px above the summary, LEAVE-INTRO and
// the ordered five lines (DNS first, the 30-day date, downloads, the billing facts composed
// from the plan, close and delete), then an optional reason Select and note (1000), the
// emailed-code step-up (the P11 CodeInput) and one danger button. No retention offer, no extra
// "are you sure" step.
//
// The code is requested by the first press of Start the 30-day notice (no email is ever sent
// on a page load: no GET mutations); the field then appears with "To confirm, we emailed a
// code to m•••@gmail.com." and the next press starts the notice. Under impersonation the
// button is aria-disabled with IMPERSONATING-LEAVE (T-14-42-01; @cds/db refuses it too).
import { P14_COPY } from "@cds/core/dns";
import { DoorOpen } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { HubLinkComponent } from "../AddonCard";
import type { HubActionResult } from "../addon-types";
import { Button, buttonClasses } from "../Button";
import { CODE_LENGTH, CodeInput } from "../CodeInput";
import { InlineAlert } from "../feedback";
import { Select, TextArea } from "../fields";
import { LEAVE_REASONS, LEAVING_UI_COPY as C, type LeaveReason } from "./copy";

export interface LeaveStartInput {
  reasonCategory: LeaveReason | "";
  note: string;
  otpId: string;
  code: string;
}

export interface LeaveStartPanelProps {
  /** Long notice-end date ("14 Nov 2026"). */
  endsOn: string;
  /** Short close date ("14 Nov"). */
  endsOnShort: string;
  /** offboardingChecklist billing lines ("Your plan ends on …", annual, launch price). */
  billingLines: readonly string[];
  /** CDS staff viewing as the owner: the button is turned off (IMPERSONATING-LEAVE). */
  impersonating?: boolean;
  /** Keep my site (Settings › Billing). */
  keepHref: string;
  requestCode(): Promise<
    HubActionResult<{ otpId: string; maskedEmail: string }>
  >;
  start(input: LeaveStartInput): Promise<HubActionResult<unknown>>;
  /** After a started notice (the app toasts and refreshes). */
  onStarted?(): void;
  /** Replaces the default H1 (the app passes ScreenHeader with "?" once the how-to exists). */
  header?: ReactNode;
  LinkComponent?: HubLinkComponent;
}

/** Bold every occurrence of `date` inside `text` (text nodes only). */
export function boldDate(text: string, date: string): ReactNode[] {
  if (!date || !text.includes(date)) return [text];
  const out: ReactNode[] = [];
  text.split(date).forEach((piece, i) => {
    if (i > 0) {
      out.push(
        <strong key={`d${i}`} className="font-semibold">
          {date}
        </strong>,
      );
    }
    if (piece) out.push(piece);
  });
  return out;
}

export function LeavingTitle() {
  return (
    <h1 className="flex items-center gap-2 text-[28px] leading-[1.2] font-semibold text-hub-ink">
      <DoorOpen aria-hidden size={20} strokeWidth={2} />
      {C.title}
    </h1>
  );
}

export function LeaveStartPanel({
  endsOn,
  endsOnShort,
  billingLines,
  impersonating = false,
  keepHref,
  requestCode,
  start,
  onStarted,
  header,
  LinkComponent,
}: LeaveStartPanelProps) {
  const id = useId();
  const [reason, setReason] = useState<LeaveReason | "">("");
  const [note, setNote] = useState("");
  const [otp, setOtp] = useState<{ otpId: string; masked: string } | null>(
    null,
  );
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState(0);
  const errorRef = useRef<HTMLDivElement>(null);
  const codeWrap = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const focusedOtp = useRef<string | null>(null);

  const showError = (message: string) => {
    setError(message);
    setErrorKey((k) => k + 1);
  };

  // WR-E03: focus moves run after React commits, so the error box and the code field exist
  // (a microtask after an await runs before the render). The code field takes focus once per
  // new code, when it is no longer disabled by the pending request.
  useEffect(() => {
    if (errorKey > 0) errorRef.current?.focus();
  }, [errorKey]);
  useEffect(() => {
    if (!otp || pending || focusedOtp.current === otp.otpId) return;
    focusedOtp.current = otp.otpId;
    codeWrap.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [otp, pending]);

  async function sendCode(): Promise<void> {
    const res = await requestCode().catch(() => null);
    if (!res) {
      showError(C.tryAgain);
      return;
    }
    if (!res.ok) {
      showError(res.message);
      return;
    }
    setOtp({ otpId: res.data.otpId, masked: res.data.maskedEmail });
    setCode("");
  }

  /** WR-E04: Send a new code shares the submit guard, so a double press mints one code. */
  async function resend(): Promise<void> {
    if (impersonating || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await sendCode();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function onSubmit(e?: FormEvent<HTMLFormElement>): Promise<void> {
    e?.preventDefault();
    if (impersonating || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      if (!otp) {
        await sendCode();
        return;
      }
      if (code.length !== CODE_LENGTH) {
        showError(C.codeMissing);
        return;
      }
      const res = await start({
        reasonCategory: reason,
        note: note.trim().slice(0, C.noteMax),
        otpId: otp.otpId,
        code,
      }).catch(() => null);
      if (!res) {
        showError(C.tryAgain);
        return;
      }
      if (!res.ok) {
        showError(res.message);
        return;
      }
      onStarted?.();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const Link = LinkComponent;
  const keepClass = buttonClasses("secondary", "md");
  const lines: ReactNode[] = [
    C.lineDns,
    boldDate(C.lineStaysUp(endsOn), endsOn),
    C.lineDownload,
    billingLines.map((l, i) => (
      <span key={i}>
        {i > 0 ? " " : null}
        {boldDate(l, endsOn)}
      </span>
    )),
    C.lineCloses(endsOnShort),
  ];

  return (
    <div
      data-leave-start=""
      className="mx-auto flex w-full max-w-[720px] flex-col font-hub text-hub-ink"
    >
      {header ?? <LeavingTitle />}
      <form
        onSubmit={(e) => void onSubmit(e)}
        noValidate
        className="mt-12 flex flex-col gap-8"
      >
        <div className="flex flex-col gap-4">
          <p className="text-base">{P14_COPY.LEAVE_INTRO}</p>
          <ol
            data-leave-lines=""
            className="flex list-decimal flex-col gap-2 pl-6 text-base"
          >
            {lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
        </div>

        <div className="flex flex-col gap-4">
          <Select
            id={`${id}-reason`}
            label={C.reasonLabel}
            options={[{ value: "", label: C.reasonNone }, ...LEAVE_REASONS]}
            value={reason}
            disabled={impersonating}
            onChange={(e) =>
              setReason(e.currentTarget.value as LeaveReason | "")
            }
          />
          <TextArea
            id={`${id}-note`}
            label={C.noteLabel}
            maxLength={C.noteMax}
            counter={{ value: note.length, max: C.noteMax }}
            value={note}
            disabled={impersonating}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
        </div>

        <section
          aria-labelledby={`${id}-code-h`}
          className="flex flex-col gap-4"
        >
          <h2
            id={`${id}-code-h`}
            className="text-xl leading-tight font-semibold"
          >
            {C.codeHeading}
          </h2>
          <p className="text-base" aria-live="polite">
            {otp ? C.codeSent(otp.masked) : C.codeIntro}
          </p>
          {otp ? (
            <div ref={codeWrap} className="flex max-w-xs flex-col gap-2">
              <CodeInput
                id={`${id}-code`}
                name="code"
                value={code}
                onChange={setCode}
                disabled={pending}
                errorId={error ? `${id}-error` : undefined}
              />
              <button
                type="button"
                className="inline-flex min-h-11 w-fit items-center rounded px-1 text-sm text-hub-ink-muted underline-offset-4 hover:text-hub-ink hover:underline"
                disabled={pending}
                onClick={() => void resend()}
              >
                {C.resendCode}
              </button>
            </div>
          ) : null}
        </section>

        {error ? (
          <div
            id={`${id}-error`}
            ref={errorRef}
            tabIndex={-1}
            data-error-key={errorKey}
          >
            <InlineAlert tone="error">{error}</InlineAlert>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            {impersonating ? (
              <button
                type="button"
                aria-disabled="true"
                aria-describedby={`${id}-imp`}
                className={`${buttonClasses("destructive", "md")} cursor-not-allowed opacity-50`}
              >
                {P14_COPY.BTN_START_NOTICE}
              </button>
            ) : (
              <Button
                type="submit"
                variant="destructive"
                loading={pending}
                loadingLabel={otp ? C.starting : C.sendingCode}
              >
                {P14_COPY.BTN_START_NOTICE}
              </Button>
            )}
            {Link ? (
              <Link href={keepHref} className={keepClass}>
                {P14_COPY.BTN_KEEP_MY_SITE}
              </Link>
            ) : (
              <a href={keepHref} className={keepClass}>
                {P14_COPY.BTN_KEEP_MY_SITE}
              </a>
            )}
          </div>
          {impersonating ? (
            <p id={`${id}-imp`} className="text-sm text-hub-ink-muted">
              {P14_COPY.IMPERSONATING_LEAVE}
            </p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
