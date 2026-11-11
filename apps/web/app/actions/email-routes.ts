"use server";
// "Where should your email go?" actions (06-22; 06-UI-SPEC "Email routing"; ONB-09, ONB-10,
// D173, D-UI-P6-24; T-06-102, T-06-104). Public POST endpoints: every argument is untrusted.
// The tenant and role come only from the session cookie via runAction; purposes are
// allow-listed here and the chokepoint checks format, duplicates, the 5-address cap, the
// suppression list and the business write permission (an Editor gets the Forbidden copy).
// Adding or changing an address sends its confirm email through the one send pipeline with
// the default transport (the logging stand-in until P12). Saves refresh the /hub layout, so
// the setup needed-count and the Settings › Email bouncing count follow. Every confirm email
// (add, change, restore, resend) counts against the chokepoint's per-org and per-address
// limits (A-WR-01 / B-WR-03); a refusal shows CONFIRM_RATE_COPY.
import { ERR_EMAIL } from "@cds/core/email";
import {
  CONFIRM_RATE_COPY,
  ROUTE_COPY,
  addEmailRoute,
  changeDefaultRoute,
  removeEmailRoute,
  resendRouteConfirmation,
  setNewsletterSender,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";
import { emailRouteView, type EmailRouteView } from "../../lib/intake";

const OVERRIDES = ["inquiries", "newsletter", "billing", "account"] as const;
type OverridePurpose = (typeof OVERRIDES)[number];

const ID_RE = /^[a-z0-9]{15}$/;
/** RFC 5321 path limit; anything longer is refused before the chokepoint. */
const ADDRESS_MAX = 254;
const NAME_MAX = 200;

function bad(message: string): Extract<ActionResult<never>, { ok: false }> {
  return { ok: false, code: "invalid_input", message };
}

function purposeOf(raw: unknown): OverridePurpose | null {
  return (OVERRIDES as readonly unknown[]).includes(raw)
    ? (raw as OverridePurpose)
    : null;
}

function addressOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v === "" || v.length > ADDRESS_MAX ? null : v;
}

function idOf(raw: unknown): string | null {
  return typeof raw === "string" && ID_RE.test(raw) ? raw : null;
}

function refreshHub(): void {
  try {
    revalidatePath("/hub", "layout");
  } catch (err) {
    console.error("[email-routes] revalidate failed", err);
  }
}

async function after<T>(
  res: Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const out = await res;
  if (out.ok) refreshHub();
  if (!out.ok && out.code === "rate_limited") {
    return { ...out, message: CONFIRM_RATE_COPY };
  }
  return out;
}

/** Add an override address (inquiries up to 5; the others replace) and send its confirmation. */
export async function addEmailRouteAction(
  purpose: unknown,
  address: unknown,
  /** An inquiry row this address replaces, swapped in one batch (C-WR-04). */
  replaces?: unknown,
): Promise<ActionResult<EmailRouteView>> {
  const p = purposeOf(purpose);
  if (!p) return bad(ROUTE_COPY.purpose);
  const a = addressOf(address);
  if (!a) return bad(ERR_EMAIL);
  let r: string | undefined;
  if (replaces !== undefined) {
    const id = idOf(replaces);
    if (!id || p !== "inquiries") return bad(ROUTE_COPY.purpose);
    r = id;
  }
  return after(
    runAction(async (s) =>
      emailRouteView(
        await addEmailRoute(s.ctx, {
          purpose: p,
          address: a,
          ...(r ? { replaces: r } : {}),
        }),
      ),
    ),
  );
}

/** Start changing the default address; the current one works until the new one is confirmed. */
export async function changeDefaultRouteAction(
  address: unknown,
): Promise<ActionResult<EmailRouteView>> {
  const a = addressOf(address);
  if (!a) return bad(ERR_EMAIL);
  return after(
    runAction(async (s) => emailRouteView(await changeDefaultRoute(s.ctx, a))),
  );
}

/** A fresh confirmation (60 s cooldown at the chokepoint). */
export async function resendRouteConfirmationAction(
  id: unknown,
): Promise<ActionResult<null>> {
  const rid = idOf(id);
  if (!rid) return bad(ROUTE_COPY.purpose);
  // Two limits answer rate_limited: the 60 s cooldown and the confirm-email cap.
  let capped = false;
  const res = await runAction(async (s) => {
    try {
      await resendRouteConfirmation(s.ctx, rid);
    } catch (err) {
      capped =
        err instanceof Error &&
        (err as { code?: unknown }).code === "rate_limited" &&
        err.message === CONFIRM_RATE_COPY;
      throw err;
    }
    return null;
  });
  if (!res.ok && res.code === "rate_limited") {
    return {
      ...res,
      message: capped ? CONFIRM_RATE_COPY : ROUTE_COPY.cooldown,
    };
  }
  return res;
}

/** Remove an override address or cancel a pending default change (the default can't go). */
export async function removeEmailRouteAction(
  id: unknown,
): Promise<ActionResult<null>> {
  const rid = idOf(id);
  if (!rid) return bad(ROUTE_COPY.purpose);
  return after(
    runAction(async (s) => {
      await removeEmailRoute(s.ctx, rid);
      return null;
    }),
  );
}

/**
 * Undo a removal: the address goes back on its list. It is added again, so it gets a fresh
 * confirmation (a restore never skips confirming, T-06-102).
 */
export async function restoreEmailRouteAction(
  snapshot: unknown,
): Promise<ActionResult<EmailRouteView>> {
  const o =
    typeof snapshot === "object" && snapshot !== null
      ? (snapshot as Record<string, unknown>)
      : {};
  return addEmailRouteAction(o.purpose, o.address);
}

/** The newsletter's sender name (empty = the business name); autosaved. */
export async function setNewsletterSenderAction(
  name: unknown,
): Promise<ActionResult<null>> {
  if (typeof name !== "string" || name.length > NAME_MAX) {
    return bad(ROUTE_COPY.senderLong);
  }
  return after(
    runAction(async (s) => {
      await setNewsletterSender(s.ctx, name);
      return null;
    }),
  );
}
