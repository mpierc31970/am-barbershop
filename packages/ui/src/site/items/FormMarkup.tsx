// FormMarkup: the themed fields, newsletter checkbox and submit button of a public form
// (07-18 choice 2; CONT-25, D231, D271; 07-UI-SPEC "Public form", D-UI-P7-15/16).
//
// Owned by 07-18 and shared: the hub preview renders <FormMarkup preview /> inside an inert
// [data-site] wrapper, and 07-19's FormItem wraps it with the <form method="post">, the
// honeypot, the start time, the error summary, the success panel and FormEnhancer. 07-19 may
// add props (keep `preview`). There is no <form> element here.
//
// Hook-free and synchronous: server- and client-safe, no next/*, no sanitizer, no database
// client. Every owner string renders as React text. Payload names follow the 07-15 contract:
// `<id>`, `<id>.line1` ... for address parts, repeated `<id>` for checkboxes, and
// FORM_NEWSLETTER_NAME for the newsletter tick. Ids are `${idPrefix}-<fieldId>`, so two forms
// on one page never collide.
//
// Forms Pro (10-40; BILL-14, D233, D234; 10-UI-SPEC "Forms Pro > Public form"). Only when
// `form.pro` is set (Builder Pro active), so a free form renders exactly the P7 markup:
//   - Steps: one <fieldset> per step with the title as an <h3> in its legend. Without JS (and
//     on the server render) every step shows, one long form. With `enhanced` only the current
//     step shows, under a <nav aria-label="Form progress"> (caption, title, 4px bar, a visually
//     hidden <ol> with aria-current="step"), a polite live region, and Back / Next.
//   - Rules: `enhanced.hidden` fields are `hidden` (out of layout and tab order) and their
//     controls `disabled`, so their answers are not sent.
//   - File upload: a native <input type="file" accept=…> with the type and size helper; the
//     island shows the chosen file with Remove. Never required (10-38).
import {
  FILE_UPLOAD_COPY,
  FORM_NEWSLETTER_NAME,
  FORM_PRO_COPY,
  FORM_UPLOAD_ACCEPT,
  formSteps,
  formatFileSize,
  visibleFieldIds,
  type FormField,
  type ProStep,
  type PublicForm,
} from "@cds/core/forms";
import { CircleAlert } from "lucide-react";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { siteButtonClasses } from "../SiteButton";

/** A file the visitor picked (island state; shown under the control with Remove). */
export type ChosenFile = { name: string; size: number };

/** 10-40: the island's Forms Pro state. Absent = server render / no JS: everything shows. */
export interface FormMarkupEnhanced {
  /** Id of the step shown (multi-step forms). */
  stepId?: string | null;
  /** Step ids with something visible, in order ("Step n of total"). */
  liveSteps?: readonly string[];
  /** Field ids hidden by the owner's rules right now. */
  hidden?: ReadonlySet<string>;
  onBack?: () => void;
  /** The step title the island focuses on Next / Back. */
  stepTitleRef?: Ref<HTMLHeadingElement>;
  /** Field id -> the file picked in that file field. */
  files?: Readonly<Record<string, ChosenFile>>;
  onRemoveFile?: (fieldId: string) => void;
  /** Rendered under the buttons (Save and finish later). */
  extra?: ReactNode;
}

export interface FormMarkupProps {
  form: PublicForm;
  /** Hub preview: the submit is type="button" and disabled. */
  preview?: boolean;
  idPrefix?: string;
  /** Field id -> message (07-19's no-JS re-render and the enhancer). */
  errors?: Readonly<Record<string, string>>;
  /** Field id -> the visitor's previous answer (no-JS re-render). */
  values?: Readonly<Record<string, unknown>>;
  /** 07-19: the island is sending; the submit reads "Sending…" and is aria-busy. */
  sending?: boolean;
  /** 10-40: Forms Pro island state (FormEnhancer only). */
  enhanced?: FormMarkupEnhanced;
}

/** The form's steps when it is a multi-step Pro form (2+ steps), else null. */
export function proStepsOf(form: PublicForm): ProStep[] | null {
  if (!form.pro || form.pro.steps.length < 2) return null;
  const steps = formSteps(form, { proActive: true });
  if (steps.length < 2) return null;
  // A field missing from every step (a stale definition) joins the last step.
  const placed = new Set(steps.flatMap((s) => s.fields));
  const rest = form.fields.filter((f) => !placed.has(f.id)).map((f) => f.id);
  if (rest.length > 0) {
    const last = steps[steps.length - 1]!;
    steps[steps.length - 1] = { ...last, fields: [...last.fields, ...rest] };
  }
  return steps;
}

const CONTROL =
  "w-full min-h-12 rounded-site-button border border-site-text-muted bg-site-surface " +
  "px-4 py-3 text-[length:var(--site-text-body)] text-site-text " +
  "placeholder:text-site-text-muted";
/** The themed text control classes (10-40's save-later email field reuses them). */
export const FORM_CONTROL_CLASS = CONTROL;
const INVALID = "border-site-text";
const LABEL = "font-semibold text-site-text";
const MUTED = "text-site-text-muted";
const CHECK = "mt-0.5 h-6 w-6 shrink-0 accent-[var(--site-primary)]";
const FILE_CONTROL =
  "w-full min-h-12 rounded-site-button border border-site-text-muted bg-site-surface " +
  "p-1 text-[length:var(--site-text-body)] text-site-text " +
  "file:mr-4 file:min-h-10 file:cursor-pointer file:rounded-site-button file:border " +
  "file:border-site-text file:bg-transparent file:px-6 file:font-semibold file:text-site-text";
export const FORM_LINK_BUTTON_CLASS =
  "inline-flex min-h-11 items-center font-semibold text-site-primary underline underline-offset-4 cursor-pointer";

// 10-44 (CLS): before the island mounts, a Pro form is the no-JS long form. Where the browser
// will run scripts, these hints lay it out as the island will (step 1 only, progress shown,
// rule-hidden fields gone, the save link's space kept), so mounting moves nothing. Without
// JS, `scripting: none` leaves the long form exactly as before.
// CR-C02: the hints apply only while the <form> carries `data-premount` (FormShell). The
// island drops it on mount, and an inline fallback drops it after 5 s if the island never
// mounts (chunk error, blocked script), so a dead island leaves the full long form, every
// step reachable. Literal strings: Tailwind only sees whole class names.
const JS_HIDE = "[@media(scripting:enabled)]:group-data-[premount]/form:hidden";
const JS_SR_ONLY =
  "[@media(scripting:enabled)]:group-data-[premount]/form:sr-only";
const JS_FLEX =
  "hidden [@media(scripting:enabled)]:group-data-[premount]/form:flex";
const JS_BLOCK =
  "hidden [@media(scripting:enabled)]:group-data-[premount]/form:block";

type InputMeta = {
  type: string;
  autoComplete?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
};

const INPUTS: Partial<Record<FormField["type"], InputMeta>> = {
  short_text: { type: "text" },
  name: { type: "text", autoComplete: "name" },
  email: { type: "email", autoComplete: "email", inputMode: "email" },
  phone: { type: "tel", autoComplete: "tel", inputMode: "tel" },
  number: { type: "number", inputMode: "decimal" },
  date: { type: "date" },
  time: { type: "time" },
};

const ADDRESS: readonly {
  part: string;
  label: string;
  autoComplete: string;
  optional?: true;
  half?: true;
}[] = [
  { part: "line1", label: "Street address", autoComplete: "address-line1" },
  {
    part: "line2",
    label: "Apartment, suite or unit",
    autoComplete: "address-line2",
    optional: true,
  },
  { part: "city", label: "City", autoComplete: "address-level2" },
  {
    part: "region",
    label: "State",
    autoComplete: "address-level1",
    half: true,
  },
  {
    part: "postal_code",
    label: "ZIP code",
    autoComplete: "postal-code",
    half: true,
  },
];

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function list(v: unknown): string[] {
  if (Array.isArray(v))
    return v.filter((x): x is string => typeof x === "string");
  return typeof v === "string" ? [v] : [];
}

function ticked(v: unknown): boolean {
  return v === true || (typeof v === "string" && v !== "" && v !== "no");
}

function partOf(v: unknown, part: string): string {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "";
  return Object.prototype.hasOwnProperty.call(v, part)
    ? text((v as Record<string, unknown>)[part])
    : "";
}

function Optional() {
  return <span className={`font-normal ${MUTED}`}> (optional)</span>;
}

function ErrorLine({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} className="flex items-start gap-2 font-semibold text-site-text">
      <CircleAlert aria-hidden size={20} strokeWidth={2} className="shrink-0" />
      <span>{message}</span>
    </p>
  );
}

function describedBy(...ids: (string | null)[]): string | undefined {
  const s = ids.filter(Boolean).join(" ");
  return s === "" ? undefined : s;
}

function FieldBody({
  field: f,
  fid,
  error,
  value,
  disabled = false,
  file,
  onRemoveFile,
}: {
  field: FormField;
  fid: string;
  error: string | undefined;
  value: unknown;
  /** 10-40: hidden by a rule; the controls are disabled so nothing is sent. */
  disabled?: boolean;
  file?: ChosenFile;
  onRemoveFile?: (fieldId: string) => void;
}): ReactNode {
  const helpId = f.help ? `${fid}-help` : null;
  const errId = error ? `${fid}-error` : null;
  const aria = {
    "aria-describedby": describedBy(helpId, errId),
    "aria-invalid": error ? (true as const) : undefined,
  };
  const dis = disabled ? { disabled: true } : {};
  const req = f.required
    ? { required: true, "aria-required": true as const }
    : {};
  const labelText = (
    <>
      {f.label}
      {f.required ? null : <Optional />}
    </>
  );
  const help = f.help ? (
    <p id={helpId!} className={MUTED}>
      {f.help}
    </p>
  ) : null;
  const err = error ? <ErrorLine id={errId!} message={error} /> : null;
  const control = `${CONTROL} ${error ? INVALID : ""}`;

  if (f.type === "heading") {
    return (
      <h3 className="text-[length:var(--site-text-h3,1.25rem)] font-semibold text-site-text">
        {f.content}
      </h3>
    );
  }
  if (f.type === "paragraph") {
    return <p className="text-site-text">{f.content}</p>;
  }

  if (f.type === "agreement") {
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={fid} className="flex items-start gap-3 text-site-text">
          <input
            id={fid}
            type="checkbox"
            name={f.id}
            value="yes"
            defaultChecked={ticked(value)}
            className={CHECK}
            {...req}
            {...aria}
            {...dis}
          />
          <span>
            {f.content || f.label}
            {f.required ? null : <Optional />}
          </span>
        </label>
        {help}
        {err}
      </div>
    );
  }

  if (
    f.type === "radio" ||
    f.type === "checkboxes" ||
    f.type === "yes_no" ||
    f.type === "address"
  ) {
    const groupAria = {
      "aria-describedby": describedBy(helpId, errId),
      "aria-invalid": error ? (true as const) : undefined,
      "aria-required": f.required ? (true as const) : undefined,
    };
    let body: ReactNode;
    if (f.type === "address") {
      body = (
        <div className="grid gap-4 @min-[560px]:grid-cols-2">
          {ADDRESS.map((p) => {
            const pid = `${fid}-${p.part}`;
            const required = f.required && !p.optional;
            return (
              <div
                key={p.part}
                className={`flex flex-col gap-2 ${p.half ? "" : "@min-[560px]:col-span-2"}`}
              >
                <label htmlFor={pid} className="text-site-text">
                  {p.label}
                  {required ? null : <Optional />}
                </label>
                <input
                  id={pid}
                  type="text"
                  name={`${f.id}.${p.part}`}
                  autoComplete={p.autoComplete}
                  defaultValue={partOf(value, p.part)}
                  className={control}
                  required={required || undefined}
                  aria-required={required || undefined}
                  aria-invalid={error ? true : undefined}
                  {...dis}
                />
              </div>
            );
          })}
        </div>
      );
    } else {
      const options =
        f.type === "yes_no"
          ? [
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]
          : f.options.map((o) => ({ value: o, label: o }));
      const picked = f.type === "checkboxes" ? list(value) : [text(value)];
      body = (
        <div className="flex flex-col gap-3">
          {options.map((o, i) => {
            const oid = `${fid}-${i}`;
            return (
              <label
                key={oid}
                htmlFor={oid}
                className="flex items-start gap-3 text-site-text"
              >
                <input
                  id={oid}
                  type={f.type === "checkboxes" ? "checkbox" : "radio"}
                  name={f.id}
                  value={o.value}
                  defaultChecked={picked.includes(o.value)}
                  required={
                    f.required && f.type !== "checkboxes" ? true : undefined
                  }
                  className={CHECK}
                  {...dis}
                />
                <span>{o.label}</span>
              </label>
            );
          })}
        </div>
      );
    }
    return (
      <fieldset className="flex min-w-0 flex-col gap-2" {...groupAria}>
        <legend className={`${LABEL} mb-2`}>{labelText}</legend>
        {help}
        {body}
        {err}
      </fieldset>
    );
  }

  if (f.type === "file") {
    // 10-38/10-40: never required; the server re-checks type, size and the scan.
    const typesId = `${fid}-types`;
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={fid} className={LABEL}>
          {f.label}
          <Optional />
        </label>
        {help}
        <p id={typesId} className={MUTED}>
          {FILE_UPLOAD_COPY.helper}
        </p>
        <input
          id={fid}
          name={f.id}
          type="file"
          accept={FORM_UPLOAD_ACCEPT}
          className={`${FILE_CONTROL} ${error ? INVALID : ""}`}
          aria-describedby={describedBy(helpId, typesId, errId)}
          aria-invalid={error ? true : undefined}
          {...dis}
        />
        {file ? (
          <div
            className="flex flex-wrap items-center gap-x-4 text-site-text"
            data-file-chosen=""
          >
            <span className="min-w-0 break-words">
              {file.name} ({formatFileSize(file.size)})
            </span>
            {onRemoveFile ? (
              <button
                type="button"
                className={FORM_LINK_BUTTON_CLASS}
                aria-label={`${FILE_UPLOAD_COPY.remove} ${file.name}`}
                onClick={() => onRemoveFile(f.id)}
              >
                {FILE_UPLOAD_COPY.remove}
              </button>
            ) : null}
          </div>
        ) : null}
        {err}
      </div>
    );
  }

  let input: ReactNode;
  if (f.type === "long_text") {
    input = (
      <textarea
        id={fid}
        name={f.id}
        placeholder={f.placeholder || undefined}
        defaultValue={text(value)}
        className={`${control} min-h-36`}
        {...req}
        {...aria}
        {...dis}
      />
    );
  } else if (f.type === "dropdown") {
    input = (
      <select
        id={fid}
        name={f.id}
        defaultValue={text(value)}
        className={control}
        {...req}
        {...aria}
        {...dis}
      >
        <option value="">Choose one</option>
        {f.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else {
    const meta = INPUTS[f.type] ?? { type: "text" };
    input = (
      <input
        id={fid}
        name={f.id}
        type={meta.type}
        autoComplete={meta.autoComplete}
        inputMode={meta.inputMode}
        placeholder={f.placeholder || undefined}
        defaultValue={text(value)}
        className={control}
        {...req}
        {...aria}
        {...dis}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fid} className={LABEL}>
        {labelText}
      </label>
      {help}
      {input}
      {err}
    </div>
  );
}

export function FormMarkup({
  form,
  preview = false,
  idPrefix,
  errors,
  values,
  sending = false,
  enhanced,
}: FormMarkupProps) {
  const prefix = idPrefix ?? `form-${form.id}`;
  const two = form.layout === "2";
  const own = (
    rec: Readonly<Record<string, unknown>> | undefined,
    k: string,
  ) =>
    rec && Object.prototype.hasOwnProperty.call(rec, k) ? rec[k] : undefined;
  const nlId = `${prefix}-newsletter`;
  const byId = new Map(form.fields.map((f) => [f.id, f]));
  const steps = preview ? null : proStepsOf(form);
  const stepped = Boolean(steps && enhanced);
  const live = steps
    ? (enhanced?.liveSteps ?? steps.map((s) => s.id)).filter((id) =>
        steps.some((s) => s.id === id),
      )
    : [];
  const currentId =
    steps && enhanced
      ? live.includes(enhanced.stepId ?? "")
        ? enhanced.stepId!
        : (live[0] ?? steps[0]!.id)
      : null;
  const at = currentId ? live.indexOf(currentId) : -1;
  const lastStep = !stepped || at === live.length - 1;
  const currentStep = steps?.find((s) => s.id === currentId) ?? null;
  // Pre-mount hints (server render and first client render of a public Pro form).
  const premount = !preview && !enhanced && Boolean(form.pro);
  const hintSteps = premount && steps ? steps : null;
  let hintHidden: ReadonlySet<string> = new Set();
  if (premount && values === undefined) {
    const shown = visibleFieldIds(form, {}, { proActive: true });
    hintHidden = new Set(
      form.fields.filter((f) => !shown.has(f.id)).map((f) => f.id),
    );
  }

  const grid = (fields: readonly FormField[]) => (
    <div className={`grid gap-6 ${two ? "@min-[560px]:grid-cols-2" : ""}`}>
      {fields.map((f) => {
        const span =
          two &&
          (f.full_width ||
            f.type === "heading" ||
            f.type === "paragraph" ||
            f.type === "address" ||
            f.type === "file");
        const off = enhanced?.hidden?.has(f.id) === true;
        return (
          <div
            key={f.id}
            data-field={f.id}
            hidden={off || undefined}
            className={`min-w-0 ${span ? "@min-[560px]:col-span-2" : ""}${hintHidden.has(f.id) ? ` ${JS_HIDE}` : ""}`}
          >
            <FieldBody
              field={f}
              fid={`${prefix}-${f.id}`}
              error={text(own(errors, f.id)) || undefined}
              value={own(values, f.id)}
              disabled={off}
              file={enhanced?.files?.[f.id]}
              onRemoveFile={enhanced?.onRemoveFile}
            />
          </div>
        );
      })}
    </div>
  );

  const submitLabel = sending
    ? "Sending…"
    : lastStep
      ? form.after_submit.button_text
      : FORM_PRO_COPY.next;
  const submitButton = (
    <button
      type={preview ? "button" : "submit"}
      disabled={preview || undefined}
      aria-busy={sending || undefined}
      className={`${siteButtonClasses("primary")} w-full @min-[560px]:w-auto disabled:cursor-not-allowed`}
    >
      {submitLabel}
    </button>
  );

  return (
    <div className="@container flex flex-col gap-6" data-cds-form-fields="">
      {stepped && currentStep ? (
        <>
          <nav
            aria-label={FORM_PRO_COPY.progress}
            className="flex flex-col gap-2"
            data-form-progress=""
          >
            <p className="text-sm text-site-text-muted">
              {FORM_PRO_COPY.stepOf(at + 1, live.length)}
            </p>
            <h3
              ref={enhanced?.stepTitleRef}
              tabIndex={-1}
              className="font-semibold text-site-text"
            >
              {currentStep.title}
            </h3>
            <div className="h-1 w-full rounded-full bg-site-border">
              <div
                className="h-1 rounded-full bg-site-primary"
                style={{
                  width: `${Math.round(((at + 1) / Math.max(live.length, 1)) * 100)}%`,
                }}
              />
            </div>
            <ol className="sr-only">
              {live.map((id) => (
                <li
                  key={id}
                  aria-current={id === currentId ? "step" : undefined}
                >
                  {steps!.find((s) => s.id === id)?.title ?? ""}
                </li>
              ))}
            </ol>
          </nav>
          <p className="sr-only" role="status" aria-live="polite">
            {FORM_PRO_COPY.announce(at + 1, live.length, currentStep.title)}
          </p>
        </>
      ) : hintSteps ? (
        // Pre-mount stand-in for the progress block above (same layout; never read: the
        // island renders the real one on mount, so it is aria-hidden).
        <div aria-hidden="true" className={`${JS_FLEX} flex-col gap-2`}>
          <p className="text-sm text-site-text-muted">
            {FORM_PRO_COPY.stepOf(1, hintSteps.length)}
          </p>
          <p className="font-semibold text-site-text">{hintSteps[0]!.title}</p>
          <div className="h-1 w-full rounded-full bg-site-border">
            <div
              className="h-1 rounded-full bg-site-primary"
              style={{
                width: `${Math.round((1 / hintSteps.length) * 100)}%`,
              }}
            />
          </div>
        </div>
      ) : null}
      {steps
        ? steps.map((s, i) => (
            <fieldset
              key={s.id}
              data-step={s.id}
              hidden={(stepped && s.id !== currentId) || undefined}
              className={`flex min-w-0 flex-col gap-6${hintSteps && i > 0 ? ` ${JS_HIDE}` : ""}`}
            >
              <legend
                className={
                  stepped
                    ? "sr-only"
                    : hintSteps
                      ? `mb-6 ${JS_SR_ONLY}`
                      : "mb-6"
                }
              >
                {stepped ? (
                  s.title
                ) : (
                  <h3 className="text-[length:var(--site-text-h3,1.25rem)] font-semibold text-site-text">
                    {s.title}
                  </h3>
                )}
              </legend>
              {grid(
                s.fields
                  .map((id) => byId.get(id))
                  .filter((f): f is FormField => f !== undefined),
              )}
            </fieldset>
          ))
        : grid(form.fields)}
      {form.newsletter_checkbox ? (
        <label
          htmlFor={nlId}
          hidden={!lastStep || undefined}
          className={`flex items-start gap-3 text-site-text${hintSteps ? ` ${JS_HIDE}` : ""}`}
        >
          <input
            id={nlId}
            type="checkbox"
            name={FORM_NEWSLETTER_NAME}
            value="yes"
            defaultChecked={ticked(own(values, FORM_NEWSLETTER_NAME))}
            className={CHECK}
          />
          <span>{form.newsletter_wording}</span>
        </label>
      ) : null}
      {stepped ? (
        <div className="flex flex-col-reverse gap-3 @min-[560px]:flex-row @min-[560px]:items-center">
          {at > 0 ? (
            <button
              type="button"
              onClick={enhanced?.onBack}
              className={`${siteButtonClasses("secondary")} w-full @min-[560px]:w-auto`}
            >
              {FORM_PRO_COPY.back}
            </button>
          ) : null}
          {submitButton}
        </div>
      ) : hintSteps ? (
        // CR-C02: before the island mounts, the visible button is a stand-in Next that posts
        // nothing (a pre-hydration click can never send step 1 alone). The real submit is
        // there for no JS, and comes back if the island never mounts.
        <div>
          <div className={JS_HIDE}>{submitButton}</div>
          <div className={JS_BLOCK}>
            <button
              type="button"
              className={`${siteButtonClasses("primary")} w-full @min-[560px]:w-auto`}
            >
              {FORM_PRO_COPY.next}
            </button>
          </div>
        </div>
      ) : (
        <div>{submitButton}</div>
      )}
      {enhanced?.extra ??
        (premount && form.pro?.save_resume ? (
          // Keeps the space of the island's "Save and finish later" link (JS only).
          <div aria-hidden="true" className={`${JS_FLEX} flex-col gap-3`}>
            <div>
              <span className={`${FORM_LINK_BUTTON_CLASS} invisible`}>
                {FORM_PRO_COPY.saveLater}
              </span>
            </div>
          </div>
        ) : null)}
    </div>
  );
}
