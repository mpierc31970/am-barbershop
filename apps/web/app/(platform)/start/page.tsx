// /start on the platform host: the public configurator (ONB-06, ONB-08, ONB-11, ONB-12;
// UI-SPEC "Configurator"; D79, D104). Anonymous: no session. The server reads the quote
// cookie (the token stays on the server), the cached price catalog and the public add-on
// list, and hands the client plain data only: the quote view (no token), catalog rows and
// PickableAddon[] (no functions cross the RSC boundary). A submitted or blocked quote reads
// as a fresh start. A catalog failure shows no price lines rather than wrong ones.
// 13-32 (STAFF-07): the add-on list is the merged catalog view (console listing copy and
// order; coming-soon rows shown disabled; hidden and private absent). Selected slugs the
// view no longer offers are dropped from the initial choices, so the next save never sends
// a slug the quote action refuses.
//
// 15-21 (HUB-02, P15-P25): hub CTAs link to /start?path=… and /start?addon=…. The query is
// validated by startPreselect against PATHS and the fail-closed pickable slug set (a degraded
// listing read ignores the add-on), and is used only when the stored quote has no path, so a
// crafted link never overwrites a returning visitor's quote.
//
// JS off (06-15, D-UI-P6-36): a <noscript> block hides the client app and shows the
// server-rendered NoScriptQuoteForm (real inputs, "Update my quote", server receipt).
import { EXTRAS, PATHS } from "@cds/core/onboarding";
import type { CatalogRow } from "@cds/core/pricing";
import { readQuoteByToken, type QuoteView } from "@cds/db";
import type { Metadata } from "next";
import { getCatalog } from "../../../lib/catalog";
import {
  getCatalogView,
  getPickableSlugs,
  startAddons,
} from "../../../lib/catalog-view";
import { readQuoteCookie } from "../../../lib/quote-cookie";
import { Configurator } from "./_components/Configurator";
import { NoScriptQuoteForm } from "./_components/NoScriptQuoteForm";
import { startPreselect, type StartPreselect } from "./_components/start-logic";

const APP_ID = "start-app";

export const metadata: Metadata = {
  title: "Build your website",
  description:
    "Pick your path and the add-ons you want. Your price updates as you go, and you'll see the full cost before you commit.",
};

export const dynamic = "force-dynamic";

function logKind(where: string, err: unknown): void {
  console.error(
    `[start] ${where} failed:`,
    err instanceof Error ? err.name : typeof err,
  );
}

async function initialQuote(): Promise<QuoteView | null> {
  const token = await readQuoteCookie();
  if (!token) return null;
  try {
    const q = await readQuoteByToken(token);
    return q && (q.status === "draft" || q.status === "saved") ? q : null;
  } catch (err) {
    logKind("quote read", err);
    return null;
  }
}

async function catalogOrNull(): Promise<CatalogRow[] | null> {
  try {
    return await getCatalog();
  } catch (err) {
    logKind("catalog read", err);
    return null;
  }
}

/** The stored quote with only the add-ons that can still be picked (13-32 choice 3). */
function withPickableOnly(
  q: QuoteView | null,
  comingSoon: readonly string[],
  addons: readonly { slug: string }[],
): QuoteView | null {
  if (!q) return q;
  const ok = new Set(addons.map((a) => a.slug));
  for (const slug of comingSoon) ok.delete(slug);
  const kept = q.selections.addons.filter((slug) => ok.has(slug));
  if (kept.length === q.selections.addons.length) return q;
  // Stored totals priced the dropped add-on: the receipt reprices from the catalog.
  return { ...q, selections: { ...q.selections, addons: kept }, totals: null };
}

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [stored, catalog, params, view] = await Promise.all([
    initialQuote(),
    catalogOrNull(),
    searchParams,
    getCatalogView(),
  ]);
  const { addons, comingSoon } = startAddons(view);
  const quote = withPickableOnly(stored, comingSoon, addons);
  let preselect: StartPreselect | null = null;
  if (
    !stored?.path &&
    (params.path !== undefined || params.addon !== undefined)
  ) {
    const pickable =
      params.addon !== undefined ? await getPickableSlugs() : null;
    preselect = startPreselect(
      { path: params.path, addon: params.addon },
      view,
      pickable,
    );
  }
  return (
    <>
      <noscript>
        <style>{`#${APP_ID}{display:none}`}</style>
        <NoScriptQuoteForm
          quote={quote}
          catalog={catalog}
          addons={addons}
          comingSoon={comingSoon}
          paths={PATHS}
          extras={EXTRAS}
          failed={params.e === "quote"}
          preselect={preselect}
        />
      </noscript>
      <div id={APP_ID}>
        <Configurator
          initialQuote={quote}
          catalog={catalog}
          addons={addons}
          comingSoon={comingSoon}
          paths={PATHS}
          extras={EXTRAS}
          preselect={preselect}
        />
      </div>
    </>
  );
}
