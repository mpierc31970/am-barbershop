// P10 test-pay pages (10-23; CONTEXT A1, UI-SPEC "Test pages", D-UI-P10-8, Pitfall 4).
// What the stand-in payment pages and their Server Actions share: the production guard, the
// strict id patterns, the org-scoped loader for a fake checkout session or invoice, and the
// redirect sanitiser. Server-only (reads the fake store through @cds/db).
//
// Choices (10-23, recorded in SUMMARY): 1. every page and action needs a hub session and the
// object's org_ref must equal ctx.orgId; 2. an expired, settled, unknown or other-org id
// renders TEST_PAY_EXPIRED with Back to CDS only; 3. the production guard is double (layout
// notFound() here, and every fake helper throws PaymentsUnavailable).
import { platformUrl, readFakeObject, type OrgContext } from "@cds/db";

export const TEST_PAY_EXPIRED =
  "This test session has expired. Go back and start again.";
export const TEST_PAY_FAILED = "That didn't go through. Try again.";
export const TEST_PAY_TAX = "Tax calculated at payment: $0.00 in test mode.";
export const TEST_PAY_WORDMARK = "Test payments";
export const TEST_PAY_HOME = "/hub";
export const CARD_UPDATED_PATH = "/hub/settings?tab=billing&card=updated";
export const CONNECT_DONE_PATH = "/hub/settings?tab=payments&connect=return";
const BILLING_TAB = "/hub/settings?tab=billing";

// Fake ids are `<prefix>_fake_<15 chars>` (10-45): PB alphabet or sha256 hex, both [a-z0-9].
export const SESSION_ID_RE = /^cs_fake_[a-z0-9]{15}$/;
export const INVOICE_ID_RE = /^in_fake_[a-z0-9]{15}$/;
export const PORTAL_ID_RE = /^bps_fake_[a-z0-9]{15}$/;
export const ACCOUNT_ID_RE = /^acct_fake_[a-z0-9]{15}$/;

/** Pitfall 4: the stand-in pages and actions do not exist in production. */
export function testPayDisabled(): boolean {
  return process.env.CDS_ENV === "production";
}

/**
 * Internal path for a redirect (T-10-23-03). A root-relative path passes; an absolute URL on
 * the platform origin is reduced to its path; anything else becomes `fallback`. A tenant-side
 * checkout (the tenant's own account, D296) may return to the tenant's site: its URL was
 * written server-side by the gateway call, so `allowExternal` keeps http(s) URLs as stored.
 */
export function safeRedirect(
  url: string,
  fallback: string,
  allowExternal = false,
): string {
  if (url.startsWith("/") && !url.startsWith("//") && !/[\s\\]/.test(url)) {
    return url;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fallback;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return fallback;
  }
  let platformOrigin: string | null = null;
  try {
    platformOrigin = new URL(platformUrl("/")).origin;
  } catch {
    platformOrigin = null;
  }
  if (parsed.origin === platformOrigin) {
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }
  return allowExternal ? parsed.toString() : fallback;
}

export type TestPayLine = { label: string; amountCents: number };

export type TestPayView = {
  kind: "session" | "invoice";
  id: string;
  lines: TestPayLine[];
  /** Integer cents, exactly as stored. */
  totalCents: number;
  /** Back to CDS: the session's cancel URL, or Settings › Billing for an invoice. */
  backHref: string;
  /** A tenant-side checkout on the tenant's own Stripe account (D296). */
  tenantSide: boolean;
};

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function int(v: unknown): number {
  return typeof v === "number" && Number.isSafeInteger(v) ? v : 0;
}

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * The open checkout session or open invoice `id` of the caller's org, as the page shows it;
 * null for a malformed, unknown, settled or other-org id (choice 2). Never throws for those.
 */
export async function loadTestPayment(
  ctx: OrgContext,
  id: string,
): Promise<TestPayView | null> {
  const isSession = SESSION_ID_RE.test(id);
  if (!isSession && !INVOICE_ID_RE.test(id)) return null;
  const obj = await readFakeObject(id);
  if (!obj || obj.orgRef === null || obj.orgRef !== ctx.orgId) return null;
  const data = rec(obj.data);

  if (isSession) {
    if (obj.kind !== "session" || data.status !== "open") return null;
    const tenantSide = text(data.account) !== "";
    const lines = (Array.isArray(data.lines) ? data.lines : []).map((raw) => {
      const l = rec(raw);
      const qty = Math.max(1, int(l.quantity));
      return {
        label: qty > 1 ? `${text(l.label)} × ${qty}` : text(l.label),
        amountCents: int(l.unitCents) * qty,
      };
    });
    return {
      kind: "session",
      id,
      lines,
      totalCents: lines.reduce((sum, l) => sum + l.amountCents, 0),
      backHref: safeRedirect(text(data.cancelUrl), TEST_PAY_HOME, tenantSide),
      tenantSide,
    };
  }

  if (obj.kind !== "invoice" || data.status !== "open") return null;
  const lines = (Array.isArray(data.lines) ? data.lines : []).map((raw) => {
    const l = rec(raw);
    return { label: text(l.description), amountCents: int(l.amountCents) };
  });
  return {
    kind: "invoice",
    id,
    lines,
    totalCents: int(data.totalCents),
    backHref: BILLING_TAB,
    tenantSide: false,
  };
}

/**
 * The portal page's customer, when the `session` query names a portal link of the caller's
 * org for the org's own customer (`orgCustomerId`, from billing_accounts).
 */
export async function portalMatches(
  ctx: OrgContext,
  portalId: string,
  orgCustomerId: string | null,
): Promise<boolean> {
  if (!PORTAL_ID_RE.test(portalId) || orgCustomerId === null) return false;
  const portal = await readFakeObject(portalId);
  if (!portal || portal.kind !== "portal" || portal.orgRef !== ctx.orgId) {
    return false;
  }
  return text(rec(portal.data).customerId) === orgCustomerId;
}
