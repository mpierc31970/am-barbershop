"use server";
// Settings › Billing Server Actions (10-29; BILL-13, BILL-19, BILL-03; CONTEXT A4; D225, D285,
// D299, D-UI-P10-14; T-10-29-01, T-10-29-02, T-10-29-04).
//
// Every saved-card charge is confirm-first: the panel loads the server's preview of the
// proration (carePlanPreviewAction / packPreviewAction), the owner confirms, then
// setCarePlanAction / buyPackAction / removePackAction run the one item change under the org's
// billing lock (@cds/db charges.ts). Owner only and never impersonating: refused here before any
// @cds/db call, and again at the chokepoint (`purchases:run`, `billing:write`). Arguments are
// untrusted and shape-checked first. A confirm carries the preview's token (CR-C01, WR-D03):
// the chokepoint charges only that figure, once. A price change or a decline answers with a
// fresh preview, so the dialog shows it and the next confirm uses a new token.
// After an applied change the `org:<id>:addons` tag is invalidated (the charges call the Next
// invalidator) and the hub layout revalidates so tab counts and meters follow.
// 11-28 (DASH-08, D185): the pack actions also take "pages-5" (5 more pages, $10/mo). The
// input is narrowed to the three kinds ("5gb" | "25gb" | "pages-5") before any db call. A pages
// pack passes the add-on registry (before checkout it joins the order, 11-27) and the
// invalidator, and revalidates the Pages tab too. Before checkout the preview is not a charge:
// the dialog shows "It joins your order: $10/mo from checkout." instead of a receipt.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { Forbidden, ImpersonationDenied } from "@cds/core";
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import { formatCentsExact, formatMonthly } from "@cds/core/pricing";
import {
  billingPortalLink,
  buyPack,
  CHARGE_PRICE_CHANGED_COPY,
  formatGb,
  mediaAllowance,
  pageAllowanceFor,
  previewCarePlan,
  previewPack,
  removePack,
  setCarePlan,
  type ChargePreviewData,
  type ChargeResult as DbChargeResult,
  type OrgContext,
} from "@cds/db";
import type { ChargePreview, ChargeResult } from "@cds/ui/hub/billing";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";
import { nextInvalidator } from "../../lib/invalidator";
import {
  ALREADY_ADDED,
  BAD_CARE,
  BAD_PACK,
  ERR_PORTAL,
  IMPERSONATING_BILLING,
  NOT_OWNER_BILLING,
  PREVIEW_FAILED,
} from "../(platform)/hub/settings/billing-copy";

const COPY = {
  forbidden: NOT_OWNER_BILLING,
  impersonation: IMPERSONATING_BILLING,
};

type PackSize = "5gb" | "25gb";
/** The three pack kinds a browser may ask for (T-11-28-02). */
type PackInput = PackSize | "pages-5";
const PAGES = "pages-5";

export type PreviewResult =
  { ok: true; preview: ChargePreview } | { ok: false; message: string };

const PACK_GB: Record<PackSize, string> = { "5gb": "5 GB", "25gb": "25 GB" };

const MONTH = new Intl.DateTimeFormat("en-US", {
  month: "long",
  timeZone: BUSINESS_TIME_ZONE,
});

function isPackSize(v: unknown): v is PackSize {
  return v === "5gb" || v === "25gb";
}

function isPackInput(v: unknown): v is PackInput {
  return isPackSize(v) || v === PAGES;
}

/** Same-shape check of a confirm token before any @cds/db call (the chokepoint verifies it). */
function tokenOf(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= 1024 ? v : null;
}

/** Owner, signed in as themselves (checked before any @cds/db call). */
function assertOwner(ctx: OrgContext): void {
  if (ctx.impersonator) throw new ImpersonationDenied();
  if (ctx.role !== "owner") throw new Forbidden();
}

function refreshHub(pages = false): void {
  try {
    revalidatePath("/hub", "layout");
    if (pages) revalidatePath("/hub/website");
  } catch (err) {
    console.error(
      "[hub] billing: revalidate failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
}

function cardSentence(line: string | null): string {
  return line ? `Plus sales tax. Charged to ${line}.` : "Plus sales tax.";
}

function previewOf(
  data: ChargePreviewData,
  copy: { title: string; what: string; confirmLabel: string },
  now: Date,
): ChargePreview {
  return {
    title: copy.title,
    what: copy.what,
    todayCents: data.todayCents,
    todayLabel: `For the rest of ${MONTH.format(now)}`,
    thenText: data.periodEndLabel
      ? `${formatMonthly(data.thenCents)} on your monthly bill from ${data.periodEndLabel}`
      : `${formatMonthly(data.thenCents)} on your monthly bill`,
    cardLine: cardSentence(data.cardLine),
    confirmLabel: copy.confirmLabel,
    token: data.token,
  };
}

/**
 * Map the chokepoint's result: a refusal keeps its copy, a decline is ERR-CARD, a moved price
 * is PRICE-CHANGED. Those two carry a fresh preview (a new token) when one can be read.
 */
async function chargeOf(
  res: DbChargeResult,
  toast: string,
  again: () => Promise<ChargePreview>,
): Promise<ChargeResult> {
  if (res.ok) {
    return { ok: true, toast: res.alreadyApplied ? ALREADY_ADDED : toast };
  }
  if (res.reason !== "card_declined" && res.reason !== "price_changed") {
    return { ok: false, reason: "error", message: res.message };
  }
  const fresh = await again().catch(() => null);
  return {
    ok: false,
    reason: res.reason,
    message: res.message,
    ...(fresh ? { preview: fresh } : {}),
  };
}

function failed(res: { message: string }): ChargeResult {
  return { ok: false, reason: "error", message: res.message };
}

/** A charge confirm sent without a token (a stale page): nothing is charged. */
function noToken(): ChargeResult {
  return {
    ok: false,
    reason: "price_changed",
    message: CHARGE_PRICE_CHANGED_COPY,
  };
}

async function preview(
  fn: (ctx: OrgContext) => Promise<ChargePreview>,
): Promise<PreviewResult> {
  const res = await runAction(async (s) => {
    assertOwner(s.ctx);
    return fn(s.ctx);
  }, COPY);
  if (res.ok) return { ok: true, preview: res.data };
  return {
    ok: false,
    message: res.code === "save_failed" ? PREVIEW_FAILED : res.message,
  };
}

async function carePreview(ctx: OrgContext): Promise<ChargePreview> {
  const data = await previewCarePlan(ctx);
  return previewOf(
    data,
    {
      title: "Add the Care Plan?",
      what: "1 hour a month of changes made for you by CDS.",
      confirmLabel: `Add and pay ${formatCentsExact(data.todayCents)}`,
    },
    new Date(),
  );
}

/** The Add the Care Plan confirm's figures (server preview of the proration). */
export async function carePlanPreviewAction(): Promise<PreviewResult> {
  return preview(carePreview);
}

/**
 * Turn the Care Plan on (prorated charge, confirmed with the preview's token) or off (credit
 * for the unused time; no token).
 */
export async function setCarePlanAction(
  on: unknown,
  token?: unknown,
): Promise<ChargeResult> {
  if (typeof on !== "boolean") {
    return { ok: false, reason: "error", message: BAD_CARE };
  }
  const confirmed = tokenOf(token);
  if (on && !confirmed) return noToken();
  const res = await runAction(async (s) => {
    assertOwner(s.ctx);
    const out = await setCarePlan(
      s.ctx,
      on,
      { invalidator: nextInvalidator },
      confirmed ?? undefined,
    );
    return { out, ctx: s.ctx };
  }, COPY);
  if (!res.ok) return failed(res);
  if (res.data.out.ok) refreshHub();
  const { ctx } = res.data;
  return chargeOf(
    res.data.out,
    on ? "Care Plan added. Receipt emailed." : "Care Plan removed.",
    () => carePreview(ctx),
  );
}

/** "Add 5 more pages?": before checkout it joins the order; after, the prorated receipt. */
async function pagesPreview(ctx: OrgContext): Promise<ChargePreview> {
  const [data, allowance] = await Promise.all([
    previewPack(ctx, PAGES, { registry: ADDON_REGISTRY }),
    pageAllowanceFor(ctx),
  ]);
  const base = previewOf(
    data,
    {
      title: "Add 5 more pages?",
      what: `Your site can have ${allowance + 5} pages.`,
      confirmLabel:
        data.beforeCheckout || data.todayCents === 0
          ? "Add 5 pages"
          : `Add and pay ${formatCentsExact(data.todayCents)}`,
    },
    new Date(),
  );
  if (!data.beforeCheckout) return base;
  return {
    ...base,
    cardLine: "",
    orderNote: `It joins your order: ${formatMonthly(data.thenCents)} from checkout.`,
  };
}

async function packPreview(
  ctx: OrgContext,
  size: PackInput,
): Promise<ChargePreview> {
  if (size === PAGES) return pagesPreview(ctx);
  const gb = PACK_GB[size];
  return previewOf(
    await previewPack(ctx, size),
    {
      title: `Add ${gb} of media storage?`,
      what: `${gb} more room for your photos, video and audio.`,
      confirmLabel: `Add ${gb}`,
    },
    new Date(),
  );
}

/**
 * One more pack's confirm figures (media, or 5 more pages). A malformed kind is refused before
 * any db call.
 */
export async function packPreviewAction(size: unknown): Promise<PreviewResult> {
  if (!isPackInput(size)) return { ok: false, message: BAD_PACK };
  return preview((ctx) => packPreview(ctx, size));
}

/** The page allowance after a change, or null when it can't be read. */
async function pagesLabel(ctx: OrgContext): Promise<number | null> {
  try {
    return await pageAllowanceFor(ctx);
  } catch {
    return null;
  }
}

/** "5 GB added. You now have 7 GB." after the allowance is re-read. */
async function allowanceLabel(ctx: OrgContext): Promise<string | null> {
  try {
    return formatGb(await mediaAllowance(ctx));
  } catch {
    return null;
  }
}

/** Buy one more pack on the saved card, confirmed with the preview's token. */
export async function buyPackAction(
  size: unknown,
  token?: unknown,
): Promise<ChargeResult> {
  if (!isPackInput(size))
    return { ok: false, reason: "error", message: BAD_PACK };
  const confirmed = tokenOf(token);
  if (!confirmed) return noToken();
  const pages = size === PAGES;
  const res = await runAction(async (s) => {
    assertOwner(s.ctx);
    const out = await buyPack(
      s.ctx,
      size,
      pages
        ? { invalidator: nextInvalidator, registry: ADDON_REGISTRY }
        : { invalidator: nextInvalidator },
      confirmed,
    );
    let now: string | null = null;
    if (out.ok) {
      const n = pages ? await pagesLabel(s.ctx) : null;
      now = pages
        ? n === null
          ? null
          : String(n)
        : await allowanceLabel(s.ctx);
    }
    return { out, ctx: s.ctx, now };
  }, COPY);
  if (!res.ok) return failed(res);
  if (res.data.out.ok) refreshHub(pages);
  const { ctx } = res.data;
  let toast: string;
  if (size === PAGES) {
    toast = res.data.now
      ? `5 pages added. You can now have ${res.data.now}.`
      : "5 pages added.";
  } else {
    const gb = PACK_GB[size];
    toast = res.data.now
      ? `${gb} added. You now have ${res.data.now}.`
      : `${gb} added. Receipt emailed.`;
  }
  return chargeOf(res.data.out, toast, () => packPreview(ctx, size));
}

/**
 * Remove one pack (credit for the unused time); refused while media would overfill, or (pages)
 * with PAGES-PACK-REFUSED while the counted pages exceed what would be left.
 */
export async function removePackAction(size: unknown): Promise<ChargeResult> {
  if (!isPackInput(size))
    return { ok: false, reason: "error", message: BAD_PACK };
  if (size === PAGES) return removePagesPack();
  const res = await runAction(async (s) => {
    assertOwner(s.ctx);
    const out = await removePack(s.ctx, size, { invalidator: nextInvalidator });
    return { out, now: out.ok ? await allowanceLabel(s.ctx) : null };
  }, COPY);
  if (!res.ok) return failed(res);
  const out = res.data.out;
  if (!out.ok) return { ok: false, reason: "error", message: out.message };
  refreshHub();
  const gb = PACK_GB[size];
  return {
    ok: true,
    toast: res.data.now
      ? `${gb} pack removed. You now have ${res.data.now}.`
      : `${gb} pack removed.`,
  };
}

async function removePagesPack(): Promise<ChargeResult> {
  const res = await runAction(async (s) => {
    assertOwner(s.ctx);
    const out = await removePack(s.ctx, PAGES, {
      invalidator: nextInvalidator,
      registry: ADDON_REGISTRY,
    });
    return { out, now: out.ok ? await pagesLabel(s.ctx) : null };
  }, COPY);
  if (!res.ok) return failed(res);
  const out = res.data.out;
  if (!out.ok) return { ok: false, reason: "error", message: out.message };
  refreshHub(true);
  return {
    ok: true,
    toast:
      res.data.now === null
        ? "5-page pack removed."
        : `5-page pack removed. You can now have ${res.data.now}.`,
  };
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

/**
 * Update card: the provider's hosted card page (or the test portal) for the caller's own
 * customer. The client navigates there in the same tab; it returns to
 * `?tab=billing&card=updated` (10-29 choice 4). Owner only, never impersonating.
 */
export async function updateCardAction(): Promise<
  ActionResult<{ url: string }>
> {
  const res = await runAction(async (s) => {
    assertOwner(s.ctx);
    const { url } = await billingPortalLink(s.ctx);
    const safe = safeUrl(url);
    if (!safe) throw new Error("portal url rejected");
    return { url: safe };
  }, COPY);
  if (!res.ok && res.code === "save_failed") {
    return { ok: false, code: res.code, message: ERR_PORTAL };
  }
  return res;
}
