// Server Action wrapper (CONTEXT A2-Q2, RESEARCH Pattern 6; T-03-42, T-03-46).
// Every hub action runs through runAction: it re-derives the session from the cookie (no
// action takes a tenant id from the browser), runs the @cds/db call, and turns failures
// into UI-SPEC copy. CdsError codes map to fixed messages; anything else becomes the
// generic ERR-SAVE copy, so raw database error text never reaches the browser.
// Server-only: reads the session cookie.
import { CdsError } from "@cds/core";
import { AGREEMENT_GATE_COPY } from "./agreement-gate";
import { agreementBlocks, getHubSession, type HubSession } from "./session";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; field?: string };

export const SESSION_EXPIRED_COPY =
  "You've been signed out. Sign in again to keep editing; your unsaved changes on this screen are kept until you leave it.";
export const SAVE_FAILED_COPY =
  "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.";
const FORBIDDEN_COPY =
  "Your role on this site can't make this change. Ask the site owner.";
const NOT_FOUND_COPY =
  "This was removed or moved. Reload the page to see the latest.";
const RATE_LIMITED_COPY =
  "Too many changes at once. Wait a minute, then try again.";

// Public /start quote actions (06-UI-SPEC ERR-QUOTE, RATE-QUOTE). They are anonymous, so
// they do not go through runAction; the copy lives here with the rest of the action copy
// ("use server" files may export only async functions).
export const QUOTE_FAILED_COPY =
  "We couldn't save your latest choice. Check your connection; we'll try again with your next change.";
export const QUOTE_RATE_LIMITED_COPY =
  "You're going a little fast. Wait a minute, then try again.";
export const QUOTE_BAD_INPUT_COPY =
  "That quote doesn't look right. Refresh the page and try again.";

// Submit and the /sign-in code path (06-17; 06-UI-SPEC "Submit", Copywriting ERR-SEND-CODE).
// ERR-CODE, ERR-CODE-EXPIRED, ERR-CREATE and ERR-CODE-RATE are the chokepoint's own copy
// (@cds/db ERR_CODE, ERR_CODE_EXPIRED, ERR_CREATE, SUBMIT_RATE_COPY).
export const SEND_CODE_FAILED_COPY =
  "We couldn't send your code. Try again in a minute.";
export const SUBMIT_NAME_COPY =
  "Enter your business name, up to 120 characters.";
/** CR-D01: the stored quote holds an add-on that is now coming soon or hidden. */
export const SUBMIT_ADDON_CHANGED_COPY =
  "An add-on in your quote isn't available any more. Change your quote, then submit.";
export const SUBMIT_DESCRIPTION_COPY =
  "Tell us what your business does in one sentence, up to 200 characters.";

/** Codes whose CdsError message is already UI-SPEC copy, and the field it belongs to. */
const COPY_CODES: Record<string, string | undefined> = {
  slug_taken: "slug",
  slug_reserved: "slug",
  invalid_input: undefined,
  // Add-on refusals (05-11, ADDON-07): the chokepoint's message names the add-ons.
  addon_missing_requirement: undefined,
  addon_conflict: undefined,
  addon_required_by: undefined,
  addon_wrong_path: undefined,
  addon_not_active: undefined,
  // Emailed-code refusals (06-08, 06-17): ERR-CODE, ERR-CODE-EXPIRED, ERR-CREATE.
  submit_code_invalid: undefined,
  submit_code_expired: undefined,
  submit_failed: undefined,
  // Setup (06-18): Send to CDS refused while a must-have is missing; the action swaps in
  // the "Send to CDS unlocks…" hint. Intake field refusals are invalid_input (above), whose
  // message is the field's UI copy (phone, time zone, hours, GA4, web address …).
  intake_incomplete: undefined,
  // Agreements (09-10, 09-17): ERR-STALE, ERR-ALREADY and ERR-GATE are the chokepoint's copy.
  agreement_stale: undefined,
  agreement_already: undefined,
  agreement_required: undefined,
  // Site policy pages (09-16, 09-23): MISSING-LEGAL-INPUTS is the chokepoint's copy.
  site_policy_inputs_missing: undefined,
  // 11-28: PageLimitReached's message is PAGES-FULL (the number tracks the allowance).
  page_limit: undefined,
  // P12 (12-01): TargetLocked's message is LOCKED-BODY (a CDS service window is active).
  target_locked: undefined,
};

/**
 * Feature-specific copy for refusals whose generic message would mislead. The add-on
 * actions pass one (05-UI-SPEC "Not owner", "Staff impersonating"); global copy is unchanged.
 */
export type CopyOverride = { forbidden?: string; impersonation?: string };

/** Next signals redirect / notFound by throwing; those must pass through untouched. */
function isNextControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

export function toActionError(
  err: unknown,
  copy: CopyOverride = {},
): Extract<ActionResult<never>, { ok: false }> {
  if (err instanceof CdsError) {
    const code = err.code;
    if (Object.hasOwn(COPY_CODES, code)) {
      const field = COPY_CODES[code];
      return {
        ok: false,
        code,
        message: err.message,
        ...(field ? { field } : {}),
      };
    }
    if (code === "impersonation_denied" && copy.impersonation) {
      return { ok: false, code, message: copy.impersonation };
    }
    if (code === "forbidden" || code === "impersonation_denied") {
      return {
        ok: false,
        code: "forbidden",
        message: copy.forbidden ?? FORBIDDEN_COPY,
      };
    }
    if (code === "not_found") {
      return { ok: false, code, message: NOT_FOUND_COPY };
    }
    if (code === "rate_limited") {
      return { ok: false, code, message: RATE_LIMITED_COPY };
    }
  }
  console.error("[hub action] failed", err);
  return { ok: false, code: "save_failed", message: SAVE_FAILED_COPY };
}

export async function runAction<T>(
  fn: (session: HubSession) => Promise<T>,
  copy: CopyOverride = {},
): Promise<ActionResult<T>> {
  try {
    // Inside the try: an outage while resolving the session is a failed result, never a
    // rejected action (WR-B02). Only a refused token is signed_out (WR-B01).
    const session = await getHubSession();
    if (!session) {
      return { ok: false, code: "signed_out", message: SESSION_EXPIRED_COPY };
    }
    // Re-acceptance gate (AGR-07, 09-15): an outdated Owner's hub action is refused with a
    // typed result, never a redirect, so the editor keeps its unsaved work and shows the
    // alert (review WR-C02). Page loads still redirect (requireHubSession).
    if (await agreementBlocks(session)) {
      return {
        ok: false,
        code: "agreement_required",
        message: AGREEMENT_GATE_COPY,
      };
    }
    return { ok: true, data: await fn(session) };
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    return toActionError(err, copy);
  }
}
