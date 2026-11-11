"use client";
// FormEnhancer: the public form island (CONT-25, D231; 07-UI-SPEC "Public form"; 07-19
// choices 1, 4, 5).
//
// SSR'd by FormItem, so the markup works without JS (a plain POST + 303). Once it runs it sets
// form.noValidate and takes over: the same validateSubmission rules as the server, the focused
// error summary linked to each field, a fetch with Accept: application/json, "Sending…", then
// the focused success panel or a same-host navigation. Copy only from @cds/core/forms. Never
// imports the rich-text sanitizer (edge-boundary test).
//
// Forms Pro (10-40; BILL-14, D233, D234; 10-UI-SPEC "Forms Pro > Public form"), only when the
// view's form carries `pro` (Builder Pro active). The first render matches the server (every
// step and field shows); after mount the island:
//   1. Re-evaluates the owner's rules with core `visibleFieldIds` on every change: hidden
//      fields get `hidden` + `disabled`, so their answers are never sent (choice 1).
//   2. Shows one step at a time: Next checks only the current step's visible fields, focus
//      moves to the step title on Next / Back, the progress text is announced politely (choice 2).
//   3. Offers "Save and finish later" when the form allows it: an email, then a POST with
//      `_intent=save`; a resume link's token is removed from the address bar (choice 3).
//   4. Checks a picked file's type and size before sending and sends multipart only when a file
//      is attached; the server stays the authority (choice 4).
import { isEmail } from "@cds/core/email";
import {
  EMAIL_ANSWER_COPY,
  FILE_UPLOAD_COPY,
  FORM_ERROR_COPY,
  FORM_PRO_COPY,
  FORM_RATE_COPY,
  FORM_UPLOAD_MAX_FILE_BYTES,
  FORM_UPLOAD_TYPES,
  FormErrors,
  formErrorsSummary,
  formSteps,
  payloadFromEntries,
  validateSubmission,
  visibleFieldIds,
  type FormField,
  type PublicForm,
} from "@cds/core/forms";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { siteButtonClasses } from "../SiteButton";
import { FORM_SUBMITTED_EVENT } from "./Beacon";
import {
  FORM_CONTROL_CLASS,
  FORM_LINK_BUTTON_CLASS,
  proStepsOf,
  type ChosenFile,
} from "../items/FormMarkup";
import { FormShell, type FormUiState } from "../items/FormShell";
import { fieldFocusId, type FormView } from "../items/form-view";

export interface FormEnhancerProps {
  view: FormView;
  itemId: string;
  startedAt: number;
  /** Server-computed from the no-JS status, so SSR and the first client render match. */
  initial: FormUiState;
}

/** Only "/"-relative, non-protocol-relative paths may be navigated to. */
export function isSamePath(href: unknown): href is string {
  return (
    typeof href === "string" &&
    href.startsWith("/") &&
    !href.startsWith("//") &&
    !href.startsWith("/\\") &&
    !/[\r\n]/.test(href)
  );
}

function stringEntries(form: HTMLFormElement): [string, string][] {
  const out: [string, string][] = [];
  new FormData(form).forEach((v, k) => {
    if (typeof v === "string") out.push([k, v]);
  });
  return out;
}

function errorsOf(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof v !== "object" || v === null || Array.isArray(v)) return out;
  for (const k of Object.keys(v)) {
    const m = (v as Record<string, unknown>)[k];
    if (typeof m === "string") out[k] = m;
  }
  return out;
}

const UPLOAD_EXTS: ReadonlySet<string> = new Set(
  FORM_UPLOAD_TYPES.flatMap((t) => t.exts as readonly string[]),
);

/** The client-side file message for one pick, or null (choice 4; advisory only). */
export function fileProblem(file: {
  name: string;
  size: number;
}): string | null {
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  if (!UPLOAD_EXTS.has(ext)) return FILE_UPLOAD_COPY.type;
  if (file.size > FORM_UPLOAD_MAX_FILE_BYTES) return FILE_UPLOAD_COPY.size;
  return null;
}

/** The picked file of every enabled file field. */
function pickedFiles(form: HTMLFormElement): Map<string, File> {
  const out = new Map<string, File>();
  for (const el of Array.from(
    form.querySelectorAll<HTMLInputElement>('input[type="file"]'),
  )) {
    const f = el.files?.[0];
    if (!el.disabled && f && el.name) out.set(el.name, f);
  }
  return out;
}

/** Validation input for the whole Pro form: the rules matter, nothing else of `pro`. */
function proSource(form: PublicForm) {
  return {
    fields: form.fields,
    pro: form.pro
      ? {
          rules: form.pro.rules,
          steps: form.pro.steps,
          auto_reply: { enabled: false, subject: "", body: "" },
          routing: [],
          save_resume: form.pro.save_resume,
        }
      : undefined,
  };
}

function check(
  validate: () => void,
  files: Map<string, File>,
  fileIds: ReadonlySet<string>,
): Record<string, string> | "error" | null {
  const errors: Record<string, string> = {};
  try {
    validate();
  } catch (err) {
    if (!(err instanceof FormErrors)) return "error";
    Object.assign(errors, err.errors);
  }
  for (const [id, f] of files) {
    if (!fileIds.has(id)) continue;
    const problem = fileProblem(f);
    if (problem) errors[id] ??= problem;
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

export function FormEnhancer({
  view,
  itemId,
  startedAt,
  initial,
}: FormEnhancerProps) {
  const [state, setState] = useState<FormUiState>(initial);
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const stepTitleRef = useRef<HTMLHeadingElement>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const focusNext = useRef<"summary" | "success" | null>(
    initial.kind === "idle"
      ? null
      : initial.kind === "sent"
        ? "success"
        : "summary",
  );
  const focusStep = useRef(false);
  // WR-C08: the control an error-summary link asked for, focused once its step shows.
  const focusField = useRef<string | null>(null);
  const uid = useId();

  const pro = view.preview ? null : (view.form.pro ?? null);
  const steps = pro ? proStepsOf(view.form) : null;
  const [mounted, setMounted] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [liveSteps, setLiveSteps] = useState<readonly string[] | null>(null);
  const [stepId, setStepId] = useState<string | null>(steps?.[0]?.id ?? null);
  const [files, setFiles] = useState<Record<string, ChosenFile>>({});
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveEmail, setSaveEmail] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (formRef.current) formRef.current.noValidate = true;
  });

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    (target === "summary" ? summaryRef : successRef).current?.focus();
  }, [state]);

  useEffect(() => {
    if (!focusStep.current) return;
    focusStep.current = false;
    stepTitleRef.current?.focus();
  }, [stepId]);

  useEffect(() => {
    const id = focusField.current;
    if (!id) return;
    focusField.current = null;
    const el = document.getElementById(id);
    el?.focus();
    el?.scrollIntoView?.({ block: "center" });
  }, [stepId]);

  /**
   * WR-C08: an error-summary link to a field on another (hidden) step moves to that step
   * first, then focuses the field. Links on the shown step keep the browser's own jump.
   */
  function onSummaryLink(fieldId: string, e: MouseEvent<HTMLAnchorElement>) {
    if (!steps || !mounted) return;
    const at = stepOfField(fieldId);
    const field = view.form.fields.find((f) => f.id === fieldId);
    if (!at || !field || at === stepId) return;
    e.preventDefault();
    focusField.current = fieldFocusId(itemId, field);
    setStepId(at);
  }

  /** Rules and live steps from the current answers (choice 1). */
  function recompute(): { visible: Set<string>; live: string[] } | null {
    const form = formRef.current;
    if (!pro || !form) return null;
    // Disabled (hidden) fields are not in FormData; the core walk ignores a hidden field's
    // answer anyway, so one pass gives the same answer as the server.
    const answers = payloadFromEntries(stringEntries(form));
    const visible = visibleFieldIds(view.form, answers, { proActive: true });
    const live = steps
      ? formSteps(view.form, { proActive: true, answers })
          .map((s) => s.id)
          .filter((id) => steps.some((s) => s.id === id))
      : [];
    setHidden(
      new Set(
        view.form.fields.filter((f) => !visible.has(f.id)).map((f) => f.id),
      ),
    );
    setLiveSteps(live);
    return { visible, live };
  }

  function stepOfField(fieldId: string): string | null {
    return steps?.find((s) => s.fields.includes(fieldId))?.id ?? null;
  }

  // After hydration: apply rules, steps, the no-JS error step and drop a resume token.
  useEffect(() => {
    setMounted(true);
    if (!pro) return;
    recompute();
    if (initial.kind === "summary" && initial.fieldErrors && steps) {
      const first = view.form.fields.find(
        (f) =>
          initial.fieldErrors &&
          Object.prototype.hasOwnProperty.call(initial.fieldErrors, f.id),
      );
      const at = first ? stepOfField(first.id) : null;
      if (at) setStepId(at);
    }
    if (view.resume) {
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.has("resume")) {
          url.searchParams.delete("resume");
          window.history.replaceState(
            window.history.state,
            "",
            `${url.pathname}${url.search}${url.hash}`,
          );
        }
      } catch {
        // An odd location never blocks the form.
      }
    }
    // Mount only: the view is fixed for the island's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function show(next: FormUiState) {
    focusNext.current =
      next.kind === "sent"
        ? "success"
        : next.kind === "summary"
          ? "summary"
          : null;
    setState(next);
  }

  function showErrors(errors: Record<string, string>) {
    if (steps) {
      const first = view.form.fields.find((f) =>
        Object.prototype.hasOwnProperty.call(errors, f.id),
      );
      const at = first ? stepOfField(first.id) : null;
      if (at) setStepId(at);
    }
    show({
      kind: "summary",
      summary: formErrorsSummary(Object.keys(errors).length),
      fieldErrors: errors,
    });
  }

  function onChange(e: FormEvent<HTMLFormElement>) {
    const el = e.target as HTMLInputElement;
    if (el && el.type === "file" && el.name) {
      const f = el.files?.[0];
      const id = el.name;
      setFiles((cur) => {
        const next = { ...cur };
        if (f) next[id] = { name: f.name, size: f.size };
        else delete next[id];
        return next;
      });
      const problem = f ? fileProblem(f) : null;
      if (problem) {
        // Shown at once under the field (no focus move); the send stays blocked.
        const prev = state.kind === "summary" ? state.fieldErrors : undefined;
        const fieldErrors = { ...prev, [id]: problem };
        setState({
          kind: "summary",
          summary: formErrorsSummary(Object.keys(fieldErrors).length),
          fieldErrors,
        });
      }
    }
    recompute();
  }

  function removeFile(fieldId: string) {
    const form = formRef.current;
    const named = form?.elements.namedItem(fieldId);
    const input =
      named instanceof HTMLInputElement && named.type === "file" ? named : null;
    if (input) {
      input.value = "";
      input.focus();
    }
    setFiles((cur) => {
      const next = { ...cur };
      delete next[fieldId];
      return next;
    });
    if (state.kind === "summary" && state.fieldErrors?.[fieldId]) {
      const rest = { ...state.fieldErrors };
      delete rest[fieldId];
      const n = Object.keys(rest).length;
      setState(
        n > 0
          ? {
              kind: "summary",
              summary: formErrorsSummary(n),
              fieldErrors: rest,
            }
          : { kind: "idle" },
      );
    }
  }

  function moveTo(id: string) {
    focusStep.current = true;
    setStepId(id);
  }

  function onBack() {
    const live = liveSteps ?? steps?.map((s) => s.id) ?? [];
    const at = stepId ? live.indexOf(stepId) : -1;
    if (at > 0) {
      if (state.kind === "summary") setState({ kind: "idle" });
      moveTo(live[at - 1]!);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (view.preview) {
      e.preventDefault();
      return;
    }
    const form = e.currentTarget;
    e.preventDefault();
    if (busy.current) return;
    const entries = stringEntries(form);
    const payload = payloadFromEntries(entries);
    const picked = pickedFiles(form);

    if (pro && steps && mounted) {
      const computed = recompute();
      const live = computed?.live ?? steps.map((s) => s.id);
      const current =
        stepId && live.includes(stepId) ? stepId : (live[0] ?? null);
      const at = current ? live.indexOf(current) : -1;
      if (current && at < live.length - 1) {
        // Next: only this step's visible fields (choice 2).
        const visible = computed?.visible;
        const step = steps.find((s) => s.id === current);
        const ids = new Set(
          (step?.fields ?? []).filter((id) => !visible || visible.has(id)),
        );
        const fields: FormField[] = view.form.fields.filter((f) =>
          ids.has(f.id),
        );
        const errors = check(
          () => validateSubmission(fields, payload),
          picked,
          ids,
        );
        if (errors === "error") {
          show({ kind: "summary", summary: FORM_ERROR_COPY });
          return;
        }
        if (errors) {
          showErrors(errors);
          return;
        }
        if (state.kind === "summary") setState({ kind: "idle" });
        moveTo(live[at + 1]!);
        return;
      }
    }

    const allIds = new Set(view.form.fields.map((f) => f.id));
    const errors = check(
      () =>
        pro
          ? validateSubmission(proSource(view.form), payload, {
              proActive: true,
            })
          : validateSubmission(view.form.fields, payload),
      picked,
      allIds,
    );
    if (errors === "error") {
      show({ kind: "summary", summary: FORM_ERROR_COPY });
      return;
    }
    if (errors) {
      showErrors(errors);
      return;
    }
    busy.current = true;
    setState({ kind: "sending" });
    try {
      const res = await fetch(form.action, {
        method: "POST",
        // Multipart only when a file rides along (10-38 body cap); else URL-encoded as in P7.
        body:
          picked.size > 0 ? new FormData(form) : new URLSearchParams(entries),
        headers: { Accept: "application/json" },
      });
      let body: Record<string, unknown> = {};
      try {
        const j: unknown = await res.json();
        if (typeof j === "object" && j !== null)
          body = j as Record<string, unknown>;
      } catch {
        body = {};
      }
      if (res.status === 200 && body.ok === true) {
        // 11-31 choice 3: the beacon island counts a conversion (no payload).
        window.dispatchEvent(new CustomEvent(FORM_SUBMITTED_EVENT));
        const after = body.afterSubmit as Record<string, unknown> | undefined;
        if (after && after.kind === "page" && isSamePath(after.href)) {
          window.location.assign(after.href);
          return;
        }
        const message =
          after && typeof after.message === "string" && after.message !== ""
            ? after.message
            : view.form.after_submit.message;
        show({ kind: "sent", message });
        return;
      }
      if (res.status === 422) {
        const fieldErrors = errorsOf(body.errors);
        const n = Object.keys(fieldErrors).length;
        if (n > 0) showErrors(fieldErrors);
        else show({ kind: "summary", summary: FORM_ERROR_COPY });
        return;
      }
      if (res.status === 429) {
        show({ kind: "summary", summary: FORM_RATE_COPY });
        return;
      }
      show({ kind: "summary", summary: FORM_ERROR_COPY });
    } catch {
      show({ kind: "summary", summary: FORM_ERROR_COPY });
    } finally {
      busy.current = false;
    }
  }

  /** Save and finish later (choice 3): never sends files; the server re-checks everything. */
  async function onSave() {
    const form = formRef.current;
    if (!form || busy.current) return;
    const email = saveEmail.trim();
    if (!isEmail(email)) {
      setSaveError(EMAIL_ANSWER_COPY);
      saveInputRef.current?.focus();
      return;
    }
    setSaveError(null);
    busy.current = true;
    setSaving(true);
    try {
      const entries = stringEntries(form);
      entries.push(["_intent", "save"], ["_email", email]);
      const res = await fetch(form.action, {
        method: "POST",
        body: new URLSearchParams(entries),
        headers: { Accept: "application/json" },
      });
      let body: Record<string, unknown> = {};
      try {
        const j: unknown = await res.json();
        if (typeof j === "object" && j !== null)
          body = j as Record<string, unknown>;
      } catch {
        body = {};
      }
      if (res.status === 200 && body.ok === true) {
        show({ kind: "sent", message: FORM_PRO_COPY.saved });
        return;
      }
      const emailError = errorsOf(body.errors)._email;
      if (res.status === 422 && emailError) {
        setSaveError(emailError);
        saveInputRef.current?.focus();
        return;
      }
      show({
        kind: "summary",
        summary: res.status === 429 ? FORM_RATE_COPY : FORM_ERROR_COPY,
      });
    } catch {
      show({ kind: "summary", summary: FORM_ERROR_COPY });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  function onSaveKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void onSave();
  }

  const saveId = `${uid}-save-email`;
  const saveErrId = `${uid}-save-error`;
  const extra =
    mounted && pro?.save_resume ? (
      <div className="flex flex-col gap-3" data-form-save="">
        {saveOpen ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={saveId} className="font-semibold text-site-text">
              {FORM_PRO_COPY.saveEmail}
            </label>
            <input
              ref={saveInputRef}
              id={saveId}
              type="email"
              autoComplete="email"
              inputMode="email"
              value={saveEmail}
              onChange={(e) => setSaveEmail(e.target.value)}
              onKeyDown={onSaveKey}
              aria-invalid={saveError ? true : undefined}
              aria-describedby={saveError ? saveErrId : undefined}
              className={`${FORM_CONTROL_CLASS} ${saveError ? "border-site-text" : ""}`}
            />
            {saveError ? (
              <p id={saveErrId} className="font-semibold text-site-text">
                {saveError}
              </p>
            ) : null}
            <div className="flex flex-col gap-3 @min-[560px]:flex-row @min-[560px]:items-center">
              <button
                type="button"
                onClick={() => void onSave()}
                aria-busy={saving || undefined}
                className={`${siteButtonClasses("secondary")} w-full @min-[560px]:w-auto`}
              >
                {saving ? "Sending…" : FORM_PRO_COPY.saveSend}
              </button>
              <button
                type="button"
                className={FORM_LINK_BUTTON_CLASS}
                onClick={() => {
                  setSaveOpen(false);
                  setSaveError(null);
                }}
              >
                {FORM_PRO_COPY.saveCancel}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button
              type="button"
              className={FORM_LINK_BUTTON_CLASS}
              onClick={() => {
                setSaveOpen(true);
                requestAnimationFrame(() => saveInputRef.current?.focus());
              }}
            >
              {FORM_PRO_COPY.saveLater}
            </button>
          </div>
        )}
      </div>
    ) : null;

  return (
    <FormShell
      view={view}
      itemId={itemId}
      startedAt={startedAt}
      state={state}
      formRef={formRef}
      summaryRef={summaryRef}
      successRef={successRef}
      onSubmit={onSubmit}
      onChange={pro ? onChange : undefined}
      onSummaryLink={steps ? onSummaryLink : undefined}
      enhanced={
        pro && mounted
          ? {
              stepId,
              liveSteps: liveSteps ?? undefined,
              hidden,
              onBack,
              stepTitleRef,
              files,
              onRemoveFile: removeFile,
              extra,
            }
          : undefined
      }
    />
  );
}
