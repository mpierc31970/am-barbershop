"use server";
// Submit with an emailed code (ONB-08, ONB-12; D213, D215, D286; 06-UI-SPEC "Submit";
// D-UI-P6-9; T-06-82..T-06-86). Public actions on /start/submit.
//
//   startSubmitAction    Step A: name, sentence, email -> startSubmit (06-08) sends a code;
//                        the otpId + address go into the short-lived cds_submit cookie.
//   completeSubmitAction Step B: the code -> completeSubmit. Created (clear or held) and
//                        existing owner mint a fresh session (setSessionCookie) and clear the
//                        submit and quote cookies before the redirect; blocked stays here
//                        with the category and never gets a session.
//   resendSubmitCodeAction  a fresh code for the pending address (the pending user exists
//                        after Step A, so the member code request serves; it never creates
//                        a user).
//
// Rules: form fields are allow-listed (businessName, description, email, code, and the
// Turnstile token `cf-turnstile-response`, A-WR-02: Step A creates a user and sends a code,
// so the chokepoint verifies a person asked and refuses suppressed addresses); the quote
// comes from the httpOnly quote cookie and the org is created server-side, so no action
// takes an org or quote id from the browser. Nothing is charged and no terms are accepted
// here (D-UI-P6-9). The Step B copy never depends on what Step A found (T-06-82). Codes,
// tokens and addresses are never logged.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { InvalidInput, RateLimited } from "@cds/core";
import { ERR_EMAIL } from "@cds/core/email";
import {
  completeSubmit,
  ERR_CODE,
  ERR_CODE_EXPIRED,
  ERR_CREATE,
  ERR_HUMAN,
  readQuoteByToken,
  requestMemberCode,
  startSubmit,
  SUBMIT_RATE_COPY,
  SUBMIT_SUPPRESSED_COPY,
  SubmitCodeExpired,
  SubmitCodeInvalid,
  type SubmitOutcome,
} from "@cds/db";
import { redirect } from "next/navigation";
import {
  SEND_CODE_FAILED_COPY,
  SUBMIT_ADDON_CHANGED_COPY,
  SUBMIT_DESCRIPTION_COPY,
  SUBMIT_NAME_COPY,
} from "../../lib/action";
import {
  CATALOG_UNAVAILABLE_COPY,
  checkAddonsPickable,
} from "../../lib/catalog-view";
import { clearQuoteCookie, readQuoteCookie } from "../../lib/quote-cookie";
import {
  clientIp,
  setAuthMethodCookie,
  setSessionCookie,
} from "../../lib/session";
import {
  clearSubmitCookie,
  readSubmitCookie,
  setSubmitCookie,
} from "../../lib/submit-cookie";

export type SubmitField = "businessName" | "description" | "email";

export type SubmitState = {
  step: "details" | "code" | "blocked";
  email: string;
  category?: string;
  error: string | null;
  /** The Step A field the error belongs to, if any. */
  field?: SubmitField;
};

const NAME_MAX = 120;
const DESCRIPTION_MAX = 200;
const EMAIL_MAX = 254;
/** Turnstile tokens are at most 2048 characters. */
const HUMAN_TOKEN_MAX = 2048;
const CODE_RE = /^[0-9]{6}$/;

function field(formData: FormData, name: string, max: number): string {
  const v = formData.get(name);
  return typeof v === "string" ? v.trim().slice(0, max + 1) : "";
}

function logKind(where: string, err: unknown): void {
  console.error(
    `[submit] ${where} failed:`,
    err instanceof Error ? err.name : typeof err,
  );
}

/**
 * CR-D01 (T-13-32-01): the server gate for the stored quote's add-ons. Null when every one is
 * pickable now; otherwise the refusal copy. A quote saved before staff set an add-on to
 * coming soon or hidden is refused, and so is any add-on while the listing can't be read.
 * A quote read failure refuses with `readFailed` (fail closed).
 */
async function quoteAddonsRefusal(
  quoteToken: string,
  readFailed: string,
): Promise<string | null> {
  let addons: unknown;
  try {
    addons = (await readQuoteByToken(quoteToken))?.selections.addons;
  } catch (err) {
    logKind("quote read", err);
    return readFailed;
  }
  const res = await checkAddonsPickable(addons);
  if (res === "ok") return null;
  return res === "unavailable"
    ? CATALOG_UNAVAILABLE_COPY
    : SUBMIT_ADDON_CHANGED_COPY;
}

/** The quote cookie, or a redirect to /start: there is nothing to submit without it. */
async function requireQuoteToken(): Promise<string> {
  const token = await readQuoteCookie();
  if (!token) redirect("/start");
  return token;
}

export async function startSubmitAction(
  _prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const quoteToken = await requireQuoteToken();
  const businessName = field(formData, "businessName", NAME_MAX);
  const description = field(formData, "description", DESCRIPTION_MAX);
  const email = field(formData, "email", EMAIL_MAX);
  const humanToken = field(formData, "cf-turnstile-response", HUMAN_TOKEN_MAX);
  const details = (error: string, f?: SubmitField): SubmitState => ({
    step: "details",
    email,
    error,
    ...(f ? { field: f } : {}),
  });

  if (!businessName || businessName.length > NAME_MAX) {
    return details(SUBMIT_NAME_COPY, "businessName");
  }
  if (!description || description.length > DESCRIPTION_MAX) {
    return details(SUBMIT_DESCRIPTION_COPY, "description");
  }
  const addonRefusal = await quoteAddonsRefusal(
    quoteToken,
    SEND_CODE_FAILED_COPY,
  );
  if (addonRefusal) return details(addonRefusal);

  let sent: { otpId: string; email: string } | null = null;
  try {
    sent = await startSubmit({
      quoteToken,
      businessName,
      description,
      email,
      ip: await clientIp(),
      humanToken,
    });
  } catch (err) {
    if (err instanceof RateLimited) return details(SUBMIT_RATE_COPY);
    if (err instanceof InvalidInput) {
      if (err.message === ERR_EMAIL) {
        return details(ERR_EMAIL, "email");
      }
      if (err.message === SUBMIT_SUPPRESSED_COPY) {
        return details(SUBMIT_SUPPRESSED_COPY, "email");
      }
      if (err.message === ERR_HUMAN) return details(ERR_HUMAN);
      // The chokepoint refuses a quote that is expired, submitted or has no path.
      if (err.message !== ERR_CREATE) {
        return details(SUBMIT_DESCRIPTION_COPY, "description");
      }
    } else {
      logKind("code request", err);
      return details(SEND_CODE_FAILED_COPY);
    }
  }
  // Only an unusable quote leaves `sent` empty: the visitor starts again on /start.
  if (!sent) redirect("/start");

  await setSubmitCookie({ otpId: sent.otpId, email: sent.email });
  // One state whatever Step A found: new and existing addresses read the same (T-06-82).
  return { step: "code", email: sent.email, error: null };
}

export async function completeSubmitAction(
  prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const quoteToken = await requireQuoteToken();
  const pending = await readSubmitCookie();
  const email = pending?.email ?? prev.email;
  const codeError = (error: string): SubmitState => ({
    step: "code",
    email,
    error,
  });

  if (!pending) return codeError(ERR_CODE_EXPIRED);
  const raw = formData.get("code");
  const code = typeof raw === "string" ? raw.replace(/\s/g, "") : "";
  if (!CODE_RE.test(code)) return codeError(ERR_CODE);
  // CR-D01: checked again here, since the listing can change between Step A and Step B.
  const addonRefusal = await quoteAddonsRefusal(quoteToken, ERR_CREATE);
  if (addonRefusal) return codeError(addonRefusal);

  let outcome: SubmitOutcome;
  try {
    outcome = await completeSubmit(
      { quoteToken, otpId: pending.otpId, code, ip: await clientIp() },
      { registry: ADDON_REGISTRY },
    );
  } catch (err) {
    if (err instanceof SubmitCodeInvalid) return codeError(ERR_CODE);
    if (err instanceof SubmitCodeExpired) return codeError(ERR_CODE_EXPIRED);
    if (err instanceof RateLimited) return codeError(SUBMIT_RATE_COPY);
    logKind("account creation", err);
    return codeError(ERR_CREATE);
  }

  await clearSubmitCookie();
  if (outcome.outcome === "blocked") {
    // No org, and the pending account is gone (D215, D-UI-P6-14; B-WR-04).
    return {
      step: "blocked",
      email,
      category: outcome.category,
      error: null,
    };
  }

  // A fresh token from the code exchange; the anonymous cookies go (T-06-84).
  await setSessionCookie(outcome.token);
  // AGR-03 evidence (09-15): the new owner signed in with the emailed code.
  await setAuthMethodCookie("otp", outcome.token);
  await clearQuoteCookie();
  if (outcome.outcome === "existing_owner") {
    redirect("/hub?notice=existing-owner");
  }
  redirect("/hub/setup");
}

export async function resendSubmitCodeAction(): Promise<{
  error: string | null;
}> {
  await requireQuoteToken();
  const pending = await readSubmitCookie();
  if (!pending) return { error: ERR_CODE_EXPIRED };
  try {
    const { otpId } = await requestMemberCode(pending.email, await clientIp());
    await setSubmitCookie({ otpId, email: pending.email });
    return { error: null };
  } catch (err) {
    if (err instanceof RateLimited) return { error: SUBMIT_RATE_COPY };
    logKind("code resend", err);
    return { error: SEND_CODE_FAILED_COPY };
  }
}
