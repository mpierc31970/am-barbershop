"use client";
// Live form preview (07-18 choice 2; CONT-25, D-UI-P7-32; 07-UI-SPEC "Form editor"). The
// muted "Preview: sending is off" label sits above an inert [data-site] wrapper in the org's
// theme, which renders the same FormMarkup the public site uses, with the submit disabled.
// It re-renders on every draft change. Relative imports only, so the hub bundle never pulls
// the site barrel or the rich-text cleaner. T-07-18-05/09: React text only, and the inert
// wrapper means nothing in the preview can submit or take focus.
//
// Forms Pro (10-39; BILL-14, D233, D-UI-P10-31): while Builder Pro is active the preview
// applies the same core `visibleFieldIds` / `formSteps` helpers the site and server use. A
// "Try an answer" panel (outside the inert wrapper) feeds answers for the fields rules look
// at, and Previous / Next step buttons walk the steps. Preview answers are never stored.
import {
  formSteps,
  visibleFieldIds,
  type FormField,
  type PublicForm,
} from "@cds/core/forms";
import { useId, useState } from "react";
import { SiteThemeScope } from "../../site/SiteThemeScope";
import { FormMarkup } from "../../site/items/FormMarkup";
import { publicFormOf } from "../../site/items/public-form";
import { Button } from "../Button";
import { Select, TextField } from "../fields";
import {
  PREVIEW_OFF,
  answerChoices,
  fieldTitle,
  type FormDraft,
} from "./form-logic";

export const TRY_AN_ANSWER = "Try an answer";
export const PREVIEW_NEXT = "Next";

export interface FormPreviewProps {
  id: string;
  draft: FormDraft;
  theme: { hash: string; css: string };
  /** Builder Pro is active: apply rules and steps (paused or never bought: free form). */
  proActive?: boolean;
}

/** "Step 2 of 3" */
export function stepLabel(n: number, total: number): string {
  return `Step ${n} of ${total}`;
}

export function FormPreview({
  id,
  draft,
  theme,
  proActive = false,
}: FormPreviewProps) {
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [stepAt, setStepAt] = useState(0);
  const pro = proActive ? draft.pro : undefined;
  const base = publicFormOf(draft, id);

  const sourceIds = new Set((pro?.rules ?? []).map((r) => r.when.field));
  const sources = draft.fields.filter((f) => sourceIds.has(f.id));

  const opts = { proActive: Boolean(pro) };
  const visible = visibleFieldIds(draft, answers, opts);
  const steps = formSteps(draft, opts);
  const multi = steps.length > 1;
  const current = Math.min(stepAt, steps.length - 1);
  const step = steps[current];
  const inStep = new Set(
    multi && step ? step.fields : draft.fields.map((f) => f.id),
  );
  const last = current === steps.length - 1;
  const form: PublicForm = {
    ...base,
    fields: base.fields.filter((f) => visible.has(f.id) && inStep.has(f.id)),
    newsletter_checkbox: base.newsletter_checkbox && (!multi || last),
    after_submit: {
      ...base.after_submit,
      button_text:
        multi && !last ? PREVIEW_NEXT : base.after_submit.button_text,
    },
  };

  return (
    <div className="flex flex-col gap-2">
      {sources.length > 0 ? (
        <section
          aria-labelledby={`${uid}-try`}
          className="flex flex-col gap-3 rounded border border-hub-border bg-hub-surface-2 p-4"
          data-preview-try=""
        >
          <h3 id={`${uid}-try`} className="text-sm font-semibold text-hub-ink">
            {TRY_AN_ANSWER}
          </h3>
          {sources.map((f) => (
            <TryControl
              key={f.id}
              field={f}
              id={`${uid}-try-${f.id}`}
              value={answers[f.id] ?? ""}
              onChange={(v) => setAnswers((a) => ({ ...a, [f.id]: v }))}
            />
          ))}
        </section>
      ) : null}
      <p className="text-sm text-hub-ink-muted">{PREVIEW_OFF}</p>
      <div className="rounded outline outline-1 outline-hub-border-strong">
        <SiteThemeScope
          theme={theme}
          inert
          className="rounded bg-site-surface p-6 font-site-body text-site-text"
        >
          {multi && step ? (
            <div className="mb-6 flex flex-col gap-2" data-preview-step="">
              <p className="text-sm text-site-text-muted">
                {stepLabel(current + 1, steps.length)}
              </p>
              <p className="font-semibold">{step.title}</p>
              <div className="h-1 w-full rounded bg-site-border">
                <div
                  className="h-1 rounded bg-site-primary"
                  style={{
                    width: `${Math.round(((current + 1) / steps.length) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
          <FormMarkup form={form} idPrefix={`preview-${id}`} preview />
        </SiteThemeScope>
      </div>
      {multi ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={current === 0}
            onClick={() => setStepAt(Math.max(0, current - 1))}
          >
            Previous step
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={last}
            onClick={() => setStepAt(Math.min(steps.length - 1, current + 1))}
          >
            Next step
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function TryControl({
  field,
  id,
  value,
  onChange,
}: {
  field: FormField;
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const label = fieldTitle(field);
  const choices = answerChoices(field);
  if (choices) {
    return (
      <Select
        id={id}
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={[
          { value: "", label: "No answer" },
          ...choices.map((c) => ({ value: c, label: c })),
        ]}
      />
    );
  }
  return (
    <TextField
      id={id}
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
