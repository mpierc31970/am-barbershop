// FormShell: the public form around 07-18's FormMarkup (CONT-25, D231; 07-UI-SPEC "Public
// form" and the forms a11y line; 07-19 choices 1, 2, 5).
//
// <form method="post" action="/api/forms/<formId>"> (no `novalidate`: without JS the browser
// enforces required/type natively; FormEnhancer sets noValidate once it runs; CR-C02: a Pro
// form is `novalidate` from the start, because before the island mounts its later steps and
// rule-hidden fields are display:none and a hidden required control would block the send with
// no visible message; the server is the authority and answers with field errors), the hidden
// `_started` / `_page` / `_item` inputs, the honeypot in an aria-hidden visually hidden wrapper
// (never display:none), the error summary and the success panel. Hook-free and synchronous:
// rendered by FormEnhancer on the server (SSR) and the client, so both HTML are identical.
// No next/*, no sanitizer; every owner string renders as React text.
import {
  FORM_ERROR_COPY,
  FORM_HONEYPOT_NAME,
  FORM_PRO_COPY,
  FORM_RATE_COPY,
  FORM_STARTED_NAME,
  formErrorsSummary,
} from "@cds/core/forms";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ChangeEvent, FormEvent, MouseEvent, Ref } from "react";
import { PREMOUNT_FALLBACK_SCRIPT } from "../premount";
import { FormMarkup, type FormMarkupEnhanced } from "./FormMarkup";
import {
  FORM_ITEM_ANCHOR,
  fieldErrorCopy,
  fieldFocusId,
  fieldIdPrefix,
  type FormView,
} from "./form-view";

export type FormUiState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; message: string }
  | {
      kind: "summary";
      summary: string;
      /** Field id -> message shown under the field and linked from the summary. */
      fieldErrors?: Readonly<Record<string, string>>;
    };

export const PREVIEW_LABEL = "Preview: sending is off";

// CR-C02: the inline fallback after a pre-mount Pro form (shared with the Pro table).
export { PREMOUNT_FALLBACK_MS, PREMOUNT_FALLBACK_SCRIPT } from "../premount";

/** The first state of one item: the no-JS status when it is for this item, else idle. */
export function initialFormState(view: FormView, itemId: string): FormUiState {
  const s = view.status;
  if (!s || s.itemId !== itemId || view.preview) return { kind: "idle" };
  if (s.kind === "sent")
    return { kind: "sent", message: view.form.after_submit.message };
  // 10-40: a no-JS "Save and finish later" landed.
  if (s.kind === "saved") return { kind: "sent", message: FORM_PRO_COPY.saved };
  if (s.kind === "rate") return { kind: "summary", summary: FORM_RATE_COPY };
  if (s.kind !== "fields") return { kind: "summary", summary: FORM_ERROR_COPY };
  const codes = s.fields;
  const fieldErrors: Record<string, string> = {};
  for (const f of view.form.fields) {
    if (!Object.prototype.hasOwnProperty.call(codes, f.id)) continue;
    const code = codes[f.id];
    if (code) fieldErrors[f.id] = fieldErrorCopy(f, code);
  }
  const n = Object.keys(fieldErrors).length;
  if (n === 0) return { kind: "summary", summary: FORM_ERROR_COPY };
  return { kind: "summary", summary: formErrorsSummary(n), fieldErrors };
}

/** 10-40: the hidden input that carries a resume token back (draft deleted after a send). */
export const FORM_RESUME_NAME = "_resume";

const HIDDEN_WRAP =
  "absolute h-px w-px overflow-hidden whitespace-nowrap [clip:rect(0,0,0,0)] -m-px p-0 border-0";

export interface FormShellProps {
  view: FormView;
  itemId: string;
  startedAt: number;
  state: FormUiState;
  formRef?: Ref<HTMLFormElement>;
  summaryRef?: Ref<HTMLDivElement>;
  successRef?: Ref<HTMLDivElement>;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  /** 10-40: answers changed (the island re-applies show / hide rules). */
  onChange?: (e: ChangeEvent<HTMLFormElement>) => void;
  /** 10-40: Forms Pro island state, passed to FormMarkup. */
  enhanced?: FormMarkupEnhanced;
  /**
   * WR-C08: a click on an error-summary link (the island moves to that field's step when it
   * sits on a hidden one, then focuses it).
   */
  onSummaryLink?: (fieldId: string, e: MouseEvent<HTMLAnchorElement>) => void;
}

export function FormShell({
  view,
  itemId,
  startedAt,
  state,
  formRef,
  summaryRef,
  successRef,
  onSubmit,
  onChange,
  enhanced,
  onSummaryLink,
}: FormShellProps) {
  const { form, preview, pageId, resume } = view;
  const anchor = FORM_ITEM_ANCHOR(itemId);
  // CR-C02: a public Pro form before its island mounts (FormMarkup's pre-mount hints).
  const premount = !preview && Boolean(form.pro) && !enhanced;

  if (state.kind === "sent") {
    return (
      <div id={anchor} className="@container w-full">
        <div
          ref={successRef}
          role="status"
          tabIndex={-1}
          data-cds-form-success=""
          className="flex items-start gap-3 rounded-site-button border border-site-text-muted bg-site-surface p-6 text-site-text"
        >
          <CircleCheck
            aria-hidden
            size={24}
            strokeWidth={2}
            className="shrink-0"
          />
          <p className="whitespace-pre-line">{state.message}</p>
        </div>
      </div>
    );
  }

  const fieldErrors = state.kind === "summary" ? state.fieldErrors : undefined;
  const linked = fieldErrors
    ? form.fields.filter((f) =>
        Object.prototype.hasOwnProperty.call(fieldErrors, f.id),
      )
    : [];

  return (
    <div id={anchor} className="@container w-full">
      <form
        ref={formRef}
        method="post"
        action={preview ? undefined : `/api/forms/${form.id}`}
        onSubmit={onSubmit}
        onChange={onChange}
        encType={
          !preview && form.fields.some((f) => f.type === "file")
            ? "multipart/form-data"
            : undefined
        }
        noValidate={(!preview && Boolean(form.pro)) || undefined}
        className="group/form relative flex flex-col gap-6"
        data-cds-form={form.id}
        data-premount={premount ? "" : undefined}
      >
        {resume && !preview ? (
          <div
            role="status"
            data-cds-form-resume={resume.kind}
            className="flex items-start gap-3 rounded-site-button border border-site-text-muted bg-site-surface-raised p-4 text-site-text"
          >
            <Info aria-hidden size={24} strokeWidth={2} className="shrink-0" />
            <p>
              {resume.kind === "resumed"
                ? FORM_PRO_COPY.resumed
                : FORM_PRO_COPY.expired}
            </p>
          </div>
        ) : null}
        {state.kind === "summary" ? (
          <div
            ref={summaryRef}
            role="alert"
            tabIndex={-1}
            data-cds-form-summary=""
            className="flex items-start gap-3 rounded-site-button border-2 border-site-text bg-site-surface p-4 text-site-text"
          >
            <CircleAlert
              aria-hidden
              size={24}
              strokeWidth={2}
              className="shrink-0"
            />
            <div className="flex flex-col gap-2">
              <p className="font-semibold">{state.summary}</p>
              {linked.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {linked.map((f) => (
                    <li key={f.id}>
                      <a
                        href={`#${fieldFocusId(itemId, f)}`}
                        className="underline underline-offset-2"
                        onClick={
                          onSummaryLink
                            ? (e) => onSummaryLink(f.id, e)
                            : undefined
                        }
                      >
                        {f.label || f.id}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
        <input
          type="hidden"
          name={FORM_STARTED_NAME}
          value={String(startedAt)}
        />
        {pageId ? <input type="hidden" name="_page" value={pageId} /> : null}
        <input type="hidden" name="_item" value={itemId} />
        {resume?.kind === "resumed" && !preview ? (
          <input type="hidden" name={FORM_RESUME_NAME} value={resume.token} />
        ) : null}
        <div aria-hidden="true" className={HIDDEN_WRAP}>
          <label htmlFor={`${anchor}-website`}>Leave this empty</label>
          <input
            id={`${anchor}-website`}
            type="text"
            name={FORM_HONEYPOT_NAME}
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </div>
        <FormMarkup
          form={form}
          preview={preview}
          idPrefix={fieldIdPrefix(itemId)}
          errors={fieldErrors}
          values={view.values}
          sending={state.kind === "sending"}
          enhanced={enhanced}
        />
        {preview ? (
          <p className="text-site-text-muted">{PREVIEW_LABEL}</p>
        ) : null}
      </form>
      {premount ? (
        <script
          dangerouslySetInnerHTML={{ __html: PREMOUNT_FALLBACK_SCRIPT }}
        />
      ) : null}
    </div>
  );
}
