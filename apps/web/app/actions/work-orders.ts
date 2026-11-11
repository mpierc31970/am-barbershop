"use server";
// Quote page Server Actions (10-30; BILL-20; CONTEXT A4; D297, D299; T-10-30-01..03).
//
// acceptQuoteAction / declineQuoteAction run the owner's answer to a CDS quote through the
// work-order chokepoint (@cds/db acceptWorkOrder / declineWorkOrder, `purchases:run`, audited
// there). Owner only and never impersonating: refused here before any @cds/db call, and again
// at the chokepoint. The id is untrusted and shape-checked with a strict regex first (a
// malformed id never reaches the database). Accept returns the hosted invoice URL (or the
// test page); the client navigates there in the same tab (10-30 choice 2). When the invoice
// was created but the answer did not reach the browser, a retry finds the quote already
// accepted and re-opens its stored invoice instead of failing.
import { Forbidden, ImpersonationDenied } from "@cds/core";
import {
  acceptWorkOrder,
  declineWorkOrder,
  readWorkOrder,
  type OrgContext,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { runAction } from "../../lib/action";
import { IMPERSONATING_PAY } from "../../lib/checkout-order";

const QUOTE_ID = /^[a-z0-9]{15}$/;

const NOT_OWNER_QUOTE = "Only the site owner can accept or decline quotes.";
/** UI-SPEC ERR-QUOTE-PAY (same text as QUOTE_COPY.errPay in @cds/ui). */
const ERR_QUOTE_PAY =
  "We couldn't open your invoice. Your acceptance is saved; try again in a minute.";
const BAD_QUOTE =
  "That quote doesn't look right. Refresh the page and try again.";

const COPY = { forbidden: NOT_OWNER_QUOTE, impersonation: IMPERSONATING_PAY };

export type AcceptQuoteResult =
  { ok: true; url: string } | { ok: false; message: string };

function isQuoteId(v: unknown): v is string {
  return typeof v === "string" && QUOTE_ID.test(v);
}

/** Owner, signed in as themselves (checked before any @cds/db call). */
function assertOwner(ctx: OrgContext): void {
  if (ctx.impersonator) throw new ImpersonationDenied();
  if (ctx.role !== "owner") throw new Forbidden();
}

/** Only an absolute http(s) URL or a same-origin path is followed. */
function safeUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function refreshHub(): void {
  try {
    revalidatePath("/hub", "layout");
  } catch (err) {
    console.error(
      "[hub] quote: revalidate failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
}

/** The stored invoice of an already accepted quote, or null. */
async function storedInvoice(ctx: OrgContext, id: string) {
  try {
    const view = await readWorkOrder(ctx, id);
    return view.status === "accepted" ? safeUrl(view.payHref) : null;
  } catch {
    return null;
  }
}

/** Accept and pay: one invoice for the full price or the 50% deposit (D299). */
export async function acceptQuoteAction(
  id: unknown,
): Promise<AcceptQuoteResult> {
  if (!isQuoteId(id)) return { ok: false, message: BAD_QUOTE };
  const res = await runAction(async (s) => {
    assertOwner(s.ctx);
    try {
      const { payUrl } = await acceptWorkOrder(s.ctx, id);
      return { url: safeUrl(payUrl), retried: false };
    } catch (err) {
      // A retry after a lost answer: the acceptance is saved, so re-open its invoice.
      const url = await storedInvoice(s.ctx, id);
      if (url) return { url, retried: true };
      throw err;
    }
  }, COPY);
  refreshHub();
  if (!res.ok) {
    return {
      ok: false,
      message: res.code === "save_failed" ? ERR_QUOTE_PAY : res.message,
    };
  }
  if (!res.data.url) return { ok: false, message: ERR_QUOTE_PAY };
  return { ok: true, url: res.data.url };
}

/** Decline this quote: CDS is told, no work starts, nothing is invoiced. */
export async function declineQuoteAction(
  id: unknown,
): Promise<{ ok: boolean }> {
  if (!isQuoteId(id)) return { ok: false };
  const res = await runAction(async (s) => {
    assertOwner(s.ctx);
    await declineWorkOrder(s.ctx, id);
    return true;
  }, COPY);
  if (res.ok) refreshHub();
  return { ok: res.ok };
}
