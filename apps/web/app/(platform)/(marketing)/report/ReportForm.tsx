"use client";
// /report form island (STAFF-24, D249, P13-P24; restyled in 15-20 for HUB-07, A3-Q3; UI-SPEC
// "Report"). Marketing form primitives only (mk-* styling). The field contract is unchanged from
// P13: ids and names from lib/report-form (shared with the action), REPORT_COPY strings, native
// radios in a fieldset/legend, the copyright block revealed in place with its DRAFT mark (now the
// marigold DRAFT band), Turnstile (test keys until GO-LIVE), "Send report" ("Sending…" while
// pending). After a failed submit the error summary at the top lists each problem as a link to
// its field and takes focus. Success replaces the header and the form with "Report received" and
// the case ref; the "What happens next" aside stays. Values are controlled, so a failed submit
// keeps every word typed.
// Layout: the page's header (H1, intro, abuse@ line) on top, then two columns >= 1024px (form
// 640px left, aside right), stacked below with the aside after the form.
import {
  ChipField,
  MkButton,
  MkCheckbox,
  MkErrorSummary,
  MkFormStatus,
  MkRadioGroup,
  MkTextArea,
  MkTextField,
} from "@cds/ui/marketing";
import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { submitReportAction } from "../../../actions/report";
import {
  EMPTY_REPORT_VALUES,
  INITIAL_REPORT_STATE,
  REPORT_CATEGORIES,
  REPORT_COPY,
  REPORT_DESCRIPTION_MAX,
  REPORT_FIELD_IDS,
  REPORT_FIELDS,
  REPORT_ORIGINAL_MAX,
  type ReportValues,
} from "../../../../lib/report-form";
import { Turnstile } from "../../start/_components/Turnstile";

/** Radio ids are `<group>-<value>`, so the first one stays REPORT_FIELD_IDS.category. */
const CATEGORY_GROUP_ID = "report-category";

const CATEGORY_OPTIONS = REPORT_CATEGORIES.map((value) => {
  const c = REPORT_COPY.CATEGORY[value];
  return {
    value,
    label:
      "description" in c
        ? `${c.title}. ${(c as { description: string }).description}`
        : c.title,
  };
});

const SUMMARY_ID = "report-error-summary";

const H1 =
  "m-0 max-w-[16ch] font-mk-display text-[clamp(48px,6vw+16px,96px)] leading-[0.95] font-bold tracking-[-0.02em] [text-wrap:balance] outline-none";
const BODY = "m-0 text-[18px] leading-[1.55] [text-wrap:pretty]";
const LEGEND = "mb-2 p-0 text-[18px] leading-[1.55] font-bold";

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

export function ReportForm({
  initialSite = "",
  initialUrl = "",
  header = null,
  aside = null,
}: {
  /** The validated `?site=` host, or "". */
  initialSite?: string;
  /** `https://<host>/` from `?site=`, or "". */
  initialUrl?: string;
  /** H1 + intro + abuse@ line (server-rendered by the page); hidden once sent. */
  header?: ReactNode;
  /** ReportAside (server-rendered by the page); shown in every state. */
  aside?: ReactNode;
}) {
  const [state, dispatch, pending] = useActionState(
    submitReportAction,
    INITIAL_REPORT_STATE,
  );
  const [values, setValues] = useState<ReportValues>({
    ...EMPTY_REPORT_VALUES,
    site: initialSite,
    url: initialUrl,
  });
  const [token, setToken] = useState("");
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const sentRef = useRef<HTMLHeadingElement>(null);

  // MkErrorSummary takes no id prop: name the element the form focuses so the P13 contract
  // (#report-error-summary) holds.
  const setSummary = useCallback((el: HTMLDivElement | null) => {
    summaryRef.current = el;
    if (el) el.id = SUMMARY_ID;
  }, []);

  const fieldErrors = state.status === "idle" ? state.fieldErrors : {};
  const formError = state.status === "idle" ? state.error : null;
  const copyright = values.category === "copyright";
  const errorList = REPORT_FIELDS.filter((f) => fieldErrors[f]).map((f) => ({
    id: REPORT_FIELD_IDS[f],
    message: fieldErrors[f]!,
  }));

  // A fresh state arrives on every submit: focus the summary (or the alert, or the
  // success heading) so a screen reader hears the outcome.
  useEffect(() => {
    if (state.status === "sent") sentRef.current?.focus();
    else if (Object.keys(state.fieldErrors).length > 0)
      summaryRef.current?.focus();
    else if (state.error) alertRef.current?.focus();
  }, [state]);

  const set = <K extends keyof ReportValues>(key: K, v: ReportValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  // A summary link moves focus to its field (not only the scroll position).
  function focusFromSummary(e: MouseEvent<HTMLDivElement>) {
    const link = (e.target as Element).closest?.('a[href^="#"]');
    if (!link) return;
    const el = document.getElementById(
      (link.getAttribute("href") ?? "").slice(1),
    );
    if (el) {
      e.preventDefault();
      el.focus();
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("category", values.category);
    fd.set("site", values.site);
    fd.set("url", values.url);
    fd.set("description", values.description);
    fd.set("name", values.name);
    fd.set("email", values.email);
    if (copyright) {
      fd.set("originalWork", values.originalWork);
      if (values.goodFaith) fd.set("goodFaith", "on");
      if (values.accuracy) fd.set("accuracy", "on");
      fd.set("signature", values.signature);
    }
    fd.set("cf-turnstile-response", token);
    startTransition(() => dispatch(fd));
  }

  const sent = state.status === "sent";

  return (
    <div className="flex flex-col gap-12">
      {sent ? null : header}

      <div className="flex flex-col gap-12 lg:flex-row lg:items-start lg:gap-16">
        <div className="w-full lg:max-w-[640px] lg:flex-[0_1_640px]">
          {sent ? (
            <div
              role="status"
              className="flex flex-col gap-4 border-t-4 border-mk-leaf bg-mk-leaf-tint p-6 text-mk-ink"
            >
              <h1 ref={sentRef} tabIndex={-1} className={H1}>
                {REPORT_COPY.SENT_H}
              </h1>
              <p className={BODY}>
                {withRef(
                  state.email
                    ? fill(REPORT_COPY.SENT_BODY, { email: state.email })
                    : REPORT_COPY.SENT_BODY_NO_EMAIL,
                  state.ref,
                )}
              </p>
              <p className={BODY}>
                <a
                  href="/report"
                  className="inline-flex min-h-11 items-center font-bold text-mk-ink underline decoration-1 underline-offset-[0.2em] hover:decoration-2"
                >
                  {REPORT_COPY.AGAIN}
                </a>
              </p>
            </div>
          ) : (
            // WR-D01: the useActionState dispatch as the form action renders a progressive
            // POST form (React sets method and encoding for a function action), so a submit
            // before hydration or with JS off never puts the description, name, email or DMCA
            // lines in a GET URL. Hydrated, onSubmit prevents the default and builds the
            // FormData from the controlled values; React then skips this action.
            <form
              action={dispatch}
              onSubmit={onSubmit}
              noValidate
              aria-busy={pending || undefined}
              className="flex flex-col gap-8"
            >
              <div onClick={focusFromSummary} className="contents">
                <MkErrorSummary
                  ref={setSummary}
                  title={REPORT_COPY.ERROR_SUMMARY}
                  errors={errorList}
                />
              </div>

              <MkRadioGroup
                id={CATEGORY_GROUP_ID}
                name="category"
                legend={REPORT_COPY.CATEGORY_LEGEND}
                options={CATEGORY_OPTIONS}
                value={values.category}
                onValueChange={(v) => set("category", v)}
                error={fieldErrors.category}
                required
              />

              <MkTextField
                id={REPORT_FIELD_IDS.site}
                name="site"
                label={REPORT_COPY.SITE}
                value={values.site}
                onChange={(e) => set("site", e.target.value)}
                error={fieldErrors.site}
                autoComplete="off"
                spellCheck={false}
                disabled={pending}
              />
              <MkTextField
                id={REPORT_FIELD_IDS.url}
                name="url"
                type="url"
                inputMode="url"
                label={REPORT_COPY.URL}
                value={values.url}
                onChange={(e) => set("url", e.target.value)}
                error={fieldErrors.url}
                autoComplete="off"
                spellCheck={false}
                required
                disabled={pending}
              />

              <MkTextArea
                id={REPORT_FIELD_IDS.description}
                name="description"
                label={REPORT_COPY.DESCRIPTION}
                value={values.description}
                onChange={(e) => set("description", e.target.value)}
                error={fieldErrors.description}
                counter={{
                  value: values.description.length,
                  max: REPORT_DESCRIPTION_MAX,
                }}
                rows={6}
                required
                disabled={pending}
              />

              <fieldset className="m-0 flex min-w-0 flex-col gap-8 border-0 p-0">
                <legend className={LEGEND}>{REPORT_COPY.CONTACT_LEGEND}</legend>
                <MkTextField
                  id={REPORT_FIELD_IDS.name}
                  name="name"
                  label={REPORT_COPY.NAME}
                  value={values.name}
                  onChange={(e) => set("name", e.target.value)}
                  error={fieldErrors.name}
                  autoComplete="name"
                  required={copyright}
                  disabled={pending}
                />
                <MkTextField
                  id={REPORT_FIELD_IDS.email}
                  name="email"
                  type="email"
                  inputMode="email"
                  label={REPORT_COPY.EMAIL}
                  value={values.email}
                  onChange={(e) => set("email", e.target.value)}
                  error={fieldErrors.email}
                  autoComplete="email"
                  spellCheck={false}
                  required
                  disabled={pending}
                />
              </fieldset>

              {copyright ? (
                <fieldset
                  data-testid="report-dmca"
                  className="m-0 flex min-w-0 flex-col gap-6 border border-mk-rule-strong p-4 sm:p-6"
                >
                  <legend className={`${LEGEND} px-1`}>
                    {REPORT_COPY.DMCA_LEGEND}
                  </legend>
                  <ChipField
                    field="marigold"
                    as="div"
                    className="border border-mk-ink px-4 py-3 text-[16px] leading-[1.4] font-bold"
                  >
                    {REPORT_COPY.DRAFT_MARK}
                  </ChipField>
                  <MkTextArea
                    id={REPORT_FIELD_IDS.originalWork}
                    name="originalWork"
                    label={REPORT_COPY.ORIGINAL}
                    help={REPORT_COPY.ORIGINAL_HELPER}
                    value={values.originalWork}
                    onChange={(e) => set("originalWork", e.target.value)}
                    error={fieldErrors.originalWork}
                    counter={{
                      value: values.originalWork.length,
                      max: REPORT_ORIGINAL_MAX,
                    }}
                    rows={3}
                    disabled={pending}
                  />
                  <MkCheckbox
                    id={REPORT_FIELD_IDS.goodFaith}
                    name="goodFaith"
                    label={REPORT_COPY.DMCA_GOODFAITH}
                    checked={values.goodFaith}
                    onChange={(e) => set("goodFaith", e.target.checked)}
                    error={fieldErrors.goodFaith}
                    required
                    disabled={pending}
                  />
                  <MkCheckbox
                    id={REPORT_FIELD_IDS.accuracy}
                    name="accuracy"
                    label={REPORT_COPY.DMCA_ACCURATE}
                    checked={values.accuracy}
                    onChange={(e) => set("accuracy", e.target.checked)}
                    error={fieldErrors.accuracy}
                    required
                    disabled={pending}
                  />
                  <MkTextField
                    id={REPORT_FIELD_IDS.signature}
                    name="signature"
                    label={REPORT_COPY.SIGNATURE}
                    help={REPORT_COPY.SIGNATURE_HELPER}
                    value={values.signature}
                    onChange={(e) => set("signature", e.target.value)}
                    error={fieldErrors.signature}
                    autoComplete="name"
                    required
                    disabled={pending}
                  />
                </fieldset>
              ) : null}

              <div className="flex flex-col items-start gap-4">
                {formError ? (
                  <MkFormStatus ref={alertRef} tone="error" className="w-full">
                    {formError}
                  </MkFormStatus>
                ) : null}
                <Turnstile onToken={setToken} resetKey={state} />
                <MkButton
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={pending}
                  aria-disabled={pending || undefined}
                >
                  {pending ? REPORT_COPY.SENDING : REPORT_COPY.SEND}
                </MkButton>
              </div>
            </form>
          )}
        </div>

        {aside}
      </div>
    </div>
  );
}

/** The template with {ref} drawn in bold (UI-SPEC: "Your report number is **R-32**"). */
function withRef(template: string, ref: string) {
  const [before, after = ""] = template.split("{ref}");
  return (
    <>
      {before}
      <strong>{ref}</strong>
      {after}
    </>
  );
}
