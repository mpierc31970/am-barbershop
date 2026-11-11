// /start/submit on the platform host (ONB-08, ONB-12; D213, D215, D286; 06-UI-SPEC
// "Submit"; D-UI-P6-9). Anonymous. The server reads the quote cookie (the token stays on the
// server): a visitor with no usable quote (none, expired, submitted, blocked, or no path and
// business type yet) goes back to /start. The form column is 720px beside the read-only
// receipt rail (>= 1024px) with "Change your quote"; below 1024px the receipt sits in a
// collapsed <details> "Your quote: $X at checkout". Both receipts are server-rendered from
// the stored choices and only one is displayed at a width, so one set of ids is exposed.
//
// A pending code (the cds_submit cookie, 10 minutes) opens the page on Step B, so a reload
// or a tab switch to the mail app keeps the visitor's place. Only the address reaches the
// client; the otpId stays in the httpOnly cookie.
// 13-32 (STAFF-07): add-on names come from the merged catalog view, like /start.
// CR-D01 (T-13-32-01): a stored quote holding an add-on that is now coming soon or hidden is
// cleaned (the add-on dropped, totals repriced by the chokepoint) and the visitor goes back
// to /start to see the change. The submit actions refuse it too, so the server is the gate.
import { EXTRAS, PATHS } from "@cds/core/onboarding";
import {
  formatCents,
  priceQuote,
  type CatalogRow,
  type QuoteTotals,
} from "@cds/core/pricing";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { readQuoteByToken, updateQuote, type QuoteView } from "@cds/db";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCatalog } from "../../../../lib/catalog";
import { getCatalogState, pickableSlugs } from "../../../../lib/catalog-view";
import { readQuoteCookie } from "../../../../lib/quote-cookie";
import { clientIp } from "../../../../lib/session";
import { readSubmitCookie } from "../../../../lib/submit-cookie";
import { Receipt } from "../_components/Receipt";
import { StartFrame } from "../_components/StartFrame";
import { SubmitFlow } from "./SubmitFlow";

export const metadata: Metadata = {
  title: "Submit your quote",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Dev default until CDS_SUPPORT_EMAIL is set (GO-LIVE). */
const DEFAULT_SUPPORT_EMAIL = "support@connectionsdesignstudios.com";

function supportEmail(): string {
  return process.env.CDS_SUPPORT_EMAIL?.trim() || DEFAULT_SUPPORT_EMAIL;
}

function logKind(where: string, err: unknown): void {
  console.error(
    `[start/submit] ${where} failed:`,
    err instanceof Error ? err.name : typeof err,
  );
}

function submittable(q: QuoteView | null): q is QuoteView {
  if (!q || (q.status !== "draft" && q.status !== "saved")) return false;
  if (!q.path || !q.businessType) return false;
  return q.businessType !== "other" || q.businessTypeOther.trim() !== "";
}

async function catalogOrNull(): Promise<CatalogRow[] | null> {
  try {
    return await getCatalog();
  } catch (err) {
    logKind("catalog read", err);
    return null;
  }
}

function ChangeQuoteLink() {
  return (
    <Link
      href="/start"
      className="self-start text-sm text-hub-accent underline underline-offset-4"
    >
      Change your quote
    </Link>
  );
}

export default async function SubmitPage() {
  const token = await readQuoteCookie();
  if (!token) redirect("/start");
  let quote: QuoteView | null = null;
  try {
    quote = await readQuoteByToken(token);
  } catch (err) {
    logKind("quote read", err);
  }
  if (!submittable(quote)) redirect("/start");

  const [catalog, pending, { view, degraded }] = await Promise.all([
    catalogOrNull(),
    readSubmitCookie(),
    getCatalogState(),
  ]);
  const path = quote.path;
  if (!path) redirect("/start");
  if (!degraded) {
    const ok = pickableSlugs(view);
    const kept = quote.selections.addons.filter((s) => ok.has(s));
    if (kept.length !== quote.selections.addons.length) {
      try {
        await updateQuote(
          token,
          { selections: { ...quote.selections, addons: kept } },
          await clientIp(),
          { registry: ADDON_REGISTRY },
        );
      } catch (err) {
        // The submit actions still refuse the add-on; /start shows the quote without it.
        logKind("quote clean", err);
      }
      redirect("/start");
    }
  }
  const addonNames = Object.fromEntries(view.map((e) => [e.slug, e.name]));
  const totals: QuoteTotals | null =
    quote.totals ??
    (catalog
      ? priceQuote(catalog, quote.selections, path, quote.selections.cadence)
      : null);
  const summary = totals
    ? `Your quote: ${formatCents(totals.dueAtCheckoutCents)} at checkout`
    : "Your quote";

  const receipt = (idPrefix: string) => (
    <Receipt
      catalog={catalog}
      path={path}
      typeChosen
      selections={quote.selections}
      serverTotals={quote.totals}
      addonNames={addonNames}
      extras={EXTRAS}
      paths={PATHS}
      interactive={false}
      idPrefix={idPrefix}
      actions={<ChangeQuoteLink />}
    />
  );

  return (
    <StartFrame step={4} anchorBase="/start">
      <div className="lg:grid lg:grid-cols-[minmax(0,720px)_360px] lg:items-start lg:gap-12">
        <div className="flex flex-col gap-8">
          <SubmitFlow
            initialEmail={quote.email}
            pendingEmail={pending?.email ?? null}
            supportEmail={supportEmail()}
          />
          <details className="group rounded-lg border border-hub-border lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 text-base font-semibold tabular-nums [&::-webkit-details-marker]:hidden">
              {summary}
            </summary>
            {receipt("receipt-submit-sheet")}
          </details>
        </div>
        <div className="hidden lg:sticky lg:top-8 lg:block">
          {receipt("receipt-submit")}
        </div>
      </div>
    </StartFrame>
  );
}
