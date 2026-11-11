"use client";
// EmailSetupFlow (14-32 choice 1; 14-UI-SPEC "Email setup"; D119, D173, D-UI-P14-26, ONB-10).
// "Set up email for my domain" as three steps in one 720px column, "Step 1 of 3" as text:
//   1. Who provides your email? RadioCardGroup of the six presets plus Another provider (the
//      detected one says "Your current email"). Another provider swaps Next for secondary
//      Ask CDS to set it up (a prefilled change ticket, through `askAction`).
//   2. Paste your values: only that preset's fields (`EMAIL_PRESETS[id].fields`), checked
//      against their pattern here (EMAIL-VALUE-FORMAT) before the server previews them.
//   3. Check and add: RecordGroupList preview (Change: Add / Replace / Update), the SPF merge
//      line, REPLACE-WARN + the required Replace my current email checkbox when another
//      provider's MX exist (Add email records stays disabled, aria-describedby the warning,
//      until ticked), Add email records (pending Adding…). Success: EMAIL-DONE-H / -B with
//      Get a professional email address and Back to DNS records. A write failure shows
//      EMAIL-WRITE-FAILED. The server re-checks everything (replaceConfirmed, T-14-32-01).
import {
  EMAIL_PRESETS,
  EMAIL_PRESET_IDS,
  P14_COPY,
  checkPresetValue,
  type EmailPresetFieldKey,
  type EmailPresetId,
} from "@cds/core/dns";
import { CircleCheck } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { rethrowControlFlow } from "../action-errors";
import type { HubActionResult } from "../addon-types";
import { Button, buttonClasses } from "../Button";
import { InlineAlert } from "../feedback";
import { TextArea, TextField } from "../fields";
import { RadioCardGroup } from "../RadioCardGroup";
import { RecordGroupList, type RecordGroup } from "./RecordGroupList";
import { RECORDS_UI_COPY as C } from "./records-copy";

export type EmailSetupChoice = EmailPresetId | "other";

/** What step 3 shows (built on the server from the 14-28 preview). */
export interface EmailSetupPreviewView {
  groups: RecordGroup[];
  /** The include the one SPF record gains, or null when the SPF is unchanged. */
  spfInclude: string | null;
  /** Another provider's name when its MX are replaced (REPLACE-WARN), else null. */
  replacesProvider: string | null;
}

export interface EmailSetupInput {
  preset: EmailPresetId;
  values: { verification?: string; dkim?: string };
}

export interface EmailSetupFlowProps {
  domain: string;
  /** The preset matching the current email (labelled "Your current email"), if any. */
  currentPreset?: EmailPresetId | null;
  previewAction(
    input: EmailSetupInput,
  ): Promise<HubActionResult<EmailSetupPreviewView>>;
  applyAction(
    input: EmailSetupInput & { replaceConfirmed: boolean },
  ): Promise<HubActionResult<unknown>>;
  askAction(): Promise<HubActionResult<{ number: number }>>;
  /** Back to DNS records. */
  recordsHref: string;
  /** The "Get a professional email address" how-to, once it exists. */
  howToHref?: string | null;
  /** Start on step 1 with this choice (tests, deep links). */
  initialChoice?: EmailSetupChoice | null;
}

const DKIM_PREFIX: Readonly<Record<string, string>> = {
  txt: "v=DKIM1",
  microsoft: "selector1-",
  proton: "protonmail.domainkey.",
};

/** The field's format error (EMAIL-VALUE-FORMAT for verification), or null when it's fine. */
export function presetFieldError(
  id: EmailPresetId,
  key: EmailPresetFieldKey,
  value: string,
): string | null {
  if (value.trim() === "") return P14_COPY.REC_VALUE_EMPTY;
  if (checkPresetValue(id, key, value)) return null;
  const p = EMAIL_PRESETS[id];
  if (key === "verification") {
    return P14_COPY.EMAIL_VALUE_FORMAT({
      service: p.name,
      prefix: p.verificationPrefix ?? "",
    });
  }
  return C.dkimFormat(p.name, DKIM_PREFIX[p.dkim] ?? "v=DKIM1");
}

function StepLabel({ n }: { n: number }) {
  return (
    <p data-step={n} className="text-sm text-hub-ink-muted tabular-nums">
      {C.stepOf(n)}
    </p>
  );
}

/** Headings take focus when the step changes, so screen readers hear the new step. */
function StepHeading({
  id,
  children,
  focusOnMount = false,
}: {
  id: string;
  children: string;
  /** WR-E08: the done view is a new tree; its heading takes focus on its first render. */
  focusOnMount?: boolean;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (!focusOnMount) return;
    }
    ref.current?.focus();
  }, [children, focusOnMount]);
  return (
    <h2
      id={id}
      ref={ref}
      tabIndex={-1}
      className="text-xl leading-tight font-semibold outline-none"
    >
      {children}
    </h2>
  );
}

export function EmailSetupFlow({
  domain,
  currentPreset = null,
  previewAction,
  applyAction,
  askAction,
  recordsHref,
  howToHref = null,
  initialChoice = null,
}: EmailSetupFlowProps) {
  const id = useId();
  const [step, setStep] = useState<1 | 2 | 3 | "done">(1);
  const [choice, setChoice] = useState<EmailSetupChoice | null>(initialChoice);
  const [values, setValues] = useState<Record<EmailPresetFieldKey, string>>({
    verification: "",
    dkim: "",
  });
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<EmailPresetFieldKey, string>>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<EmailSetupPreviewView | null>(null);
  const [replace, setReplace] = useState(false);
  const [pending, setPending] = useState(false);
  const [asked, setAsked] = useState<number | null>(null);

  const preset = choice && choice !== "other" ? EMAIL_PRESETS[choice] : null;
  const headingId = `${id}-h`;
  const warnId = `${id}-warn`;

  function input(): EmailSetupInput | null {
    if (!choice || choice === "other" || !preset) return null;
    const out: EmailSetupInput["values"] = {};
    for (const f of preset.fields) out[f.key] = values[f.key].trim();
    return { preset: choice, values: out };
  }

  async function ask() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await askAction();
      if (res.ok) setAsked(res.data.number);
      else setError(res.message);
    } catch (err) {
      rethrowControlFlow(err);
      setError(P14_COPY.ERR_GENERIC);
    } finally {
      setPending(false);
    }
  }

  function next1() {
    if (!choice) {
      setError(C.pickProvider);
      return;
    }
    setError(null);
    setStep(2);
  }

  async function next2() {
    if (pending || !preset || !choice || choice === "other") return;
    const errs: Partial<Record<EmailPresetFieldKey, string>> = {};
    for (const f of preset.fields) {
      const e = presetFieldError(choice, f.key, values[f.key]);
      if (e) errs[f.key] = e;
    }
    setFieldErrors(errs);
    setError(null);
    if (Object.keys(errs).length > 0) return;
    const body = input();
    if (!body) return;
    setPending(true);
    try {
      const res = await previewAction(body);
      if (res.ok) {
        setPreview(res.data);
        setReplace(false);
        setStep(3);
      } else if (res.field === "verification" || res.field === "dkim") {
        setFieldErrors({ [res.field]: res.message });
      } else {
        setError(res.message);
      }
    } catch (err) {
      rethrowControlFlow(err);
      setError(P14_COPY.ERR_GENERIC);
    } finally {
      setPending(false);
    }
  }

  async function apply() {
    const body = input();
    if (pending || !body || !preview) return;
    if (preview.replacesProvider && !replace) return;
    setPending(true);
    setError(null);
    try {
      const res = await applyAction({ ...body, replaceConfirmed: replace });
      if (res.ok) setStep("done");
      else setError(res.message);
    } catch (err) {
      rethrowControlFlow(err);
      setError(P14_COPY.ERR_GENERIC);
    } finally {
      setPending(false);
    }
  }

  const backLink = (
    <a href={recordsHref} className={buttonClasses("ghost", "md")}>
      {P14_COPY.BTN_BACK}
    </a>
  );

  if (step === "done" && preset) {
    return (
      <section
        aria-labelledby={headingId}
        data-email-setup="done"
        className="flex max-w-[720px] flex-col gap-4 font-hub text-hub-ink"
      >
        <CircleCheck
          aria-hidden
          size={20}
          strokeWidth={2}
          className="text-hub-success"
        />
        <StepHeading id={headingId} focusOnMount>
          {P14_COPY.EMAIL_DONE_H({ provider: preset.name })}
        </StepHeading>
        <p className="text-base">
          {P14_COPY.EMAIL_DONE_B({ console: preset.console })}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {howToHref ? (
            <a
              href={howToHref}
              className="rounded text-hub-accent underline underline-offset-2"
            >
              {C.getEmail}
            </a>
          ) : null}
          <a href={recordsHref} className={buttonClasses("secondary", "md")}>
            {P14_COPY.BTN_BACK_TO_RECORDS}
          </a>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-email-setup={step}
      className="flex max-w-[720px] flex-col gap-6 font-hub text-hub-ink"
    >
      <div className="flex flex-col gap-1">
        <StepLabel n={step === "done" ? 3 : step} />
        <StepHeading id={headingId}>
          {step === 1
            ? C.step1H
            : step === 2
              ? C.step2H(preset?.name ?? "")
              : C.step3H}
        </StepHeading>
      </div>

      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}

      {step === 1 ? (
        <>
          <RadioCardGroup<EmailSetupChoice>
            name={`${id}-provider`}
            legend={C.step1H}
            hideLegend
            value={choice}
            onChange={(v) => {
              // WR-E07: another provider's values and errors never carry over.
              if (v !== choice) {
                setValues({ verification: "", dkim: "" });
                setFieldErrors({});
                setPreview(null);
              }
              setChoice(v);
              setError(null);
              setAsked(null);
            }}
            options={[
              ...EMAIL_PRESET_IDS.map((p) => ({
                value: p as EmailSetupChoice,
                title: EMAIL_PRESETS[p].name,
                ...(p === currentPreset ? { description: C.currentEmail } : {}),
              })),
              { value: "other" as const, title: C.otherProvider },
            ]}
          />
          {choice === "other" ? (
            asked !== null ? (
              <InlineAlert tone="success">{C.asked(asked)}</InlineAlert>
            ) : (
              <p className="text-base">{C.otherBody}</p>
            )
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-end">
            {choice === "other" ? (
              asked === null ? (
                <Button
                  type="button"
                  variant="secondary"
                  loading={pending}
                  loadingLabel={C.sendingAsk}
                  onClick={() => void ask()}
                >
                  {P14_COPY.BTN_ASK_CDS_SET_UP}
                </Button>
              ) : null
            ) : (
              <Button type="button" variant="primary" onClick={next1}>
                {P14_COPY.BTN_NEXT}
              </Button>
            )}
            {backLink}
          </div>
        </>
      ) : null}

      {step === 2 && preset && choice && choice !== "other" ? (
        <>
          {preset.fields.length === 0 ? (
            <p className="text-base">{C.noValues}</p>
          ) : (
            preset.fields.map((f) => {
              const props = {
                id: `${id}-${f.key}`,
                name: f.key,
                label: f.label,
                helper: f.help,
                error: fieldErrors[f.key],
                value: values[f.key],
                autoComplete: "off",
                spellCheck: false,
                className: "font-mono",
              };
              return f.key === "dkim" ? (
                <TextArea
                  key={f.key}
                  {...props}
                  rows={3}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    setValues((s) => ({ ...s, dkim: v }));
                  }}
                />
              ) : (
                <TextField
                  key={f.key}
                  {...props}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    setValues((s) => ({ ...s, verification: v }));
                  }}
                />
              );
            })
          )}
          <p className="text-sm text-hub-ink-muted">{C.notYet}</p>
          <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-end">
            <Button
              type="button"
              variant="primary"
              loading={pending}
              loadingLabel={C.loadingPreview}
              onClick={() => void next2()}
            >
              {P14_COPY.BTN_NEXT}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setError(null);
                setStep(1);
              }}
            >
              {P14_COPY.BTN_BACK}
            </Button>
          </div>
        </>
      ) : null}

      {step === 3 && preview && preset ? (
        <>
          <RecordGroupList
            mode="preview"
            groups={preview.groups}
            domain={domain}
          />
          {preview.spfInclude ? (
            <p data-spf-line="" className="text-base">
              {C.spfLine(preview.spfInclude)}
            </p>
          ) : null}
          {preview.replacesProvider ? (
            <div className="flex flex-col gap-3">
              <div id={warnId}>
                <InlineAlert tone="warning">
                  {P14_COPY.REPLACE_WARN({
                    current: preview.replacesProvider,
                    next: preset.name,
                  })}
                </InlineAlert>
              </div>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base">
                <input
                  type="checkbox"
                  name="replace"
                  required
                  checked={replace}
                  onChange={(e) => setReplace(e.currentTarget.checked)}
                  aria-describedby={warnId}
                  className="h-5 w-5 shrink-0 accent-hub-accent"
                />
                <span>{P14_COPY.BTN_REPLACE_EMAIL}</span>
              </label>
            </div>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-end">
            <Button
              type="button"
              variant="primary"
              data-apply=""
              loading={pending}
              loadingLabel={C.adding}
              disabled={Boolean(preview.replacesProvider) && !replace}
              aria-describedby={
                preview.replacesProvider && !replace ? warnId : undefined
              }
              onClick={() => void apply()}
            >
              {P14_COPY.BTN_ADD_EMAIL_RECORDS}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setError(null);
                setStep(2);
              }}
            >
              {P14_COPY.BTN_BACK}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
