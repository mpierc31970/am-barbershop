"use server";
// Email-link actions (ONB-08, ONB-09; 06-UI-SPEC "Quote links"; D-UI-P6-15, D138, D173;
// T-06-79). The GET pages only describe; these POST-only actions change state, so a link
// scanner that follows the emailed URL never unsubscribes or confirms anything.
//
//   unsubscribeAction    field t: the signed unsubscribe token -> unsubscribeQuote
//   confirmEmailAction   field t: the email-route confirm token -> confirmEmailRoute
//   openSignedQuoteAction field s: a reminder's signed reopen link -> resolveSignedReopen
//                         (rotates the quote token, sets the cookie, redirects; B-WR-01)
//
// The token is the only authority (no session, no cookie). An unknown, used, tampered or
// expired token reads "expired"; any other failure keeps the form with a generic error.
// Tokens are never logged.
import {
  confirmEmailRoute,
  resolveSignedReopen,
  unsubscribeQuote,
} from "@cds/db";
import { redirect } from "next/navigation";
import { LINK_ACTION_FAILED } from "../(platform)/start/_components/link-copy";
import { setQuoteCookie } from "../../lib/quote-cookie";
import {
  REOPEN_EXPIRED_PATH,
  REOPEN_SUBMITTED_PATH,
  REOPEN_VALID_PATH,
  SIGNED_REOPEN_RE,
} from "../../lib/quote-links";

export type LinkActionState = {
  status: "idle" | "done" | "expired";
  error: string | null;
};

const MAX_TOKEN = 512;

function tokenOf(formData: FormData): string | null {
  const t = formData.get("t");
  return typeof t === "string" && t.length > 0 && t.length <= MAX_TOKEN
    ? t
    : null;
}

async function run(
  formData: FormData,
  label: string,
  perform: (token: string) => Promise<boolean>,
): Promise<LinkActionState> {
  const token = tokenOf(formData);
  if (!token) return { status: "expired", error: null };
  try {
    return (await perform(token))
      ? { status: "done", error: null }
      : { status: "expired", error: null };
  } catch (err) {
    console.error(
      `[quote-links] ${label} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { status: "idle", error: LINK_ACTION_FAILED };
  }
}

export async function unsubscribeAction(
  _prev: LinkActionState,
  formData: FormData,
): Promise<LinkActionState> {
  return run(formData, "unsubscribe", (t) => unsubscribeQuote(t));
}

export async function confirmEmailAction(
  _prev: LinkActionState,
  formData: FormData,
): Promise<LinkActionState> {
  return run(
    formData,
    "email confirm",
    async (t) => (await confirmEmailRoute(t)) !== null,
  );
}

/**
 * The reminder reopen page's button (B-WR-01). Only this POST rotates the quote token, so a
 * link scanner or prefetch that follows the emailed GET changes nothing. Valid: the fresh
 * token goes into the cookie and the visitor lands on /start. Everything else goes to the
 * expired or submitted page. The link is never logged.
 */
export async function openSignedQuoteAction(formData: FormData): Promise<void> {
  const s = formData.get("s");
  let to = REOPEN_EXPIRED_PATH;
  if (typeof s === "string" && SIGNED_REOPEN_RE.test(s)) {
    try {
      const outcome = await resolveSignedReopen(s);
      if (outcome?.state === "valid") {
        await setQuoteCookie(outcome.token);
        to = REOPEN_VALID_PATH;
      } else if (outcome?.state === "submitted") {
        to = REOPEN_SUBMITTED_PATH;
      }
    } catch (err) {
      console.error(
        `[quote-links] signed reopen failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  redirect(to);
}
