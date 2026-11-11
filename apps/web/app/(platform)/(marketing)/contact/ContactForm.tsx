"use client";
// /contact form island (15-19; HUB-07, HUB-03; A3-Q2, D-UI-P15-19; UI-SPEC "Contact", a11y
// contract). Mk form primitives only (mk-* styling, MK_COPY strings). Fields in UI-SPEC order:
// Name, Email, Business (optional), What's this about? (native radios in a fieldset), Phone,
// Message (counter, polite from 90%), Turnstile directly above Send message.
// - Phone: the server markup always shows it with the no-JS label "Phone (only if you'd like a
//   call)"; once hydrated the island shows it (label "Phone") only while `call` is chosen.
// - A failed submit focuses the error summary (field errors) or the request error; success
//   replaces the form and focuses its heading.
// - Values are controlled, so a failed submit keeps every word. The form's action is the
//   useActionState dispatch (a progressive POST form before hydration, never a GET, WR-D01);
//   hydrated, onSubmit builds the FormData from the controlled values plus the Turnstile token.
// - Turnstile is reused from /start (the one allowed /start/_components import).
import { contactSentLine, MK_COPY } from "@cds/core/marketing";
import {
  MkButton,
  MkErrorSummary,
  MkFormStatus,
  MkRadioGroup,
  MkTextArea,
  MkTextField,
} from "@cds/ui/marketing";
import Link from "next/link";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { submitContactAction } from "../../../actions/contact";
import {
  BUSINESS_MAX,
  CONTACT_FIELD_IDS,
  CONTACT_FIELDS,
  EMAIL_MAX,
  EMPTY_CONTACT_VALUES,
  INITIAL_CONTACT_STATE,
  MESSAGE_MAX,
  NAME_MAX,
  PHONE_MAX,
  type ContactState,
  type ContactValues,
} from "../../../../lib/contact-form";
import { Turnstile } from "../../start/_components/Turnstile";

const H2 =
  "m-0 font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance] outline-none";
const BODY = "m-0 text-[18px] leading-[1.55] [text-wrap:pretty]";

const noopSubscribe = () => () => {};
/** false in the server markup and during hydration, true once the island runs. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function hasFailed(s: ContactState): boolean {
  return (
    s.status === "idle" &&
    (s.error !== null || Object.keys(s.fieldErrors).length > 0)
  );
}

export function ContactForm({
  initialTopic = "",
  initialAbout = "",
  initialMessage = "",
}: {
  /** The allow-listed `?topic=`, or "". */
  initialTopic?: string;
  /** The allow-listed `?about=` key, or "". */
  initialAbout?: string;
  /** "I'd like to know more about <name>." when `about` is set, else "". */
  initialMessage?: string;
}) {
  const C = MK_COPY.CONTACT;
  const [state, dispatch, pending] = useActionState(
    submitContactAction,
    INITIAL_CONTACT_STATE,
  );
  const [values, setValues] = useState<ContactValues>(() =>
    // A no-JS round trip renders the returned state: start from the values it kept.
    state.status === "idle" && hasFailed(state)
      ? state.values
      : {
          ...EMPTY_CONTACT_VALUES,
          topic: initialTopic,
          about: initialAbout,
          message: initialMessage,
        },
  );
  const [token, setToken] = useState("");
  const hydrated = useHydrated();
  const summaryRef = useRef<HTMLDivElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const sentRef = useRef<HTMLHeadingElement>(null);

  const fieldErrors = state.status === "idle" ? state.fieldErrors : {};
  const formError = state.status === "idle" ? state.error : null;
  const errorList = CONTACT_FIELDS.filter((f) => fieldErrors[f]).map((f) => ({
    id: CONTACT_FIELD_IDS[f],
    message: fieldErrors[f]!,
  }));
  const isCall = values.topic === "call";
  const showPhone = !hydrated || isCall;

  // A fresh state arrives on every submit: move focus so a screen reader hears the outcome.
  useEffect(() => {
    if (state.status === "sent") sentRef.current?.focus();
    else if (Object.keys(state.fieldErrors).length > 0)
      summaryRef.current?.focus();
    else if (state.error) alertRef.current?.focus();
  }, [state]);

  const set = (key: keyof ContactValues, v: string) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  if (state.status === "sent") {
    return (
      <div
        role="status"
        className="flex flex-col gap-4 border-t-4 border-mk-leaf bg-mk-leaf-tint p-6 text-mk-ink"
      >
        <h2 ref={sentRef} tabIndex={-1} className={H2}>
          {C.SENT_H2}
        </h2>
        <p className={BODY}>{contactSentLine(state.email, state.isCall)}</p>
        <p className={BODY}>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center font-bold text-mk-ink underline decoration-1 underline-offset-[0.2em] hover:decoration-2"
          >
            {C.BACK_HOME}
          </Link>
        </p>
      </div>
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("name", values.name);
    fd.set("email", values.email);
    fd.set("business", values.business);
    fd.set("topic", values.topic);
    if (isCall) fd.set("phone", values.phone);
    fd.set("about", values.about);
    fd.set("message", values.message);
    fd.set("cf-turnstile-response", token);
    startTransition(() => dispatch(fd));
  }

  return (
    <form
      action={dispatch}
      onSubmit={onSubmit}
      noValidate
      aria-busy={pending || undefined}
      className="flex flex-col gap-8"
    >
      <MkErrorSummary
        ref={summaryRef}
        title={C.ERROR_SUMMARY}
        errors={errorList}
      />

      <MkTextField
        id={CONTACT_FIELD_IDS.name}
        name="name"
        label={C.NAME}
        value={values.name}
        onChange={(e) => set("name", e.target.value)}
        error={fieldErrors.name}
        autoComplete="name"
        maxLength={NAME_MAX}
        required
      />
      <MkTextField
        id={CONTACT_FIELD_IDS.email}
        name="email"
        type="email"
        inputMode="email"
        label={C.EMAIL_LABEL}
        value={values.email}
        onChange={(e) => set("email", e.target.value)}
        error={fieldErrors.email}
        autoComplete="email"
        spellCheck={false}
        maxLength={EMAIL_MAX}
        required
      />
      <MkTextField
        id={CONTACT_FIELD_IDS.business}
        name="business"
        label={C.BUSINESS}
        value={values.business}
        onChange={(e) => set("business", e.target.value)}
        error={fieldErrors.business}
        autoComplete="organization"
        maxLength={BUSINESS_MAX}
      />
      <MkRadioGroup
        id={CONTACT_FIELD_IDS.topic}
        name="topic"
        legend={C.TOPIC}
        options={C.TOPICS}
        value={values.topic}
        onValueChange={(v) => set("topic", v)}
        error={fieldErrors.topic}
        required
      />
      {showPhone ? (
        <MkTextField
          id={CONTACT_FIELD_IDS.phone}
          name="phone"
          type="tel"
          inputMode="tel"
          label={hydrated ? C.PHONE : C.PHONE_NOSCRIPT}
          value={values.phone}
          onChange={(e) => set("phone", e.target.value)}
          error={fieldErrors.phone}
          autoComplete="tel"
          maxLength={PHONE_MAX}
        />
      ) : null}
      <input type="hidden" name="about" value={values.about} />
      <MkTextArea
        id={CONTACT_FIELD_IDS.message}
        name="message"
        label={C.MESSAGE}
        value={values.message}
        onChange={(e) => set("message", e.target.value)}
        error={fieldErrors.message}
        counter={{ value: values.message.length, max: MESSAGE_MAX }}
        rows={6}
        required
      />

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
          {pending ? C.SENDING : C.SEND}
        </MkButton>
      </div>
    </form>
  );
}
