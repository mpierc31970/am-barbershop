// Help article (11-46; DASH-17, D110; 11-UI-SPEC "Help article" lines 603-610). Opened from
// the Help center, Jump to, and every screen's "?" (ScreenHeader links /hub/help/<helpId>;
// lib/help-index.ts resolves `<section>.<tab>` ids). An unknown id, an article the person's
// role may not read, or an add-on article whose add-on is off or not granted is a 404
// (T-11-46-01). Steps come from the baked how-to (no docs/ at runtime) and render as text
// (T-11-46-02). "Go to {screen}" appears only when the how-to's route is a screen in this
// person's own Jump-to index (the grant-filtered nav and tabs), so it never points at a
// screen they cannot open.
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { helpArticle } from "@cds/addon-registry/help";
import { activeAddons, getOrgStage } from "@cds/db";
import {
  HelpArticle,
  TOUR_FOR_HELP_ENTRY,
  TOUR_SCREEN_HREF,
} from "@cds/ui/hub/help";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  buildHelpIndex,
  findHelpEntry,
  helpLinkFor,
  helpRouteHref,
} from "../../../../../lib/help-index";
import { requireHubSession } from "../../../../../lib/session";
import { GuardedLink } from "../../GuardedLink";
import { buildJumpIndex } from "../../jump-index";
import { composeHubNav } from "../../nav";
import { composeSectionTabs } from "../../sections";

export const metadata: Metadata = { title: "Help" };

export const dynamic = "force-dynamic";

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requireHubSession();
  let active: string[] = [];
  try {
    active = await activeAddons(ctx);
  } catch (err) {
    console.error(
      "[hub] help add-ons failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
  let rawId = id;
  try {
    rawId = decodeURIComponent(id);
  } catch {
    notFound();
  }
  const entry = findHelpEntry(ctx, active, rawId);
  const article = entry ? helpArticle(entry.howTo) : null;
  if (!entry || !article) notFound();

  let goTo: { label: string; href: string } | null = null;
  const target = helpRouteHref(article.route);
  if (target) {
    let stage = "";
    try {
      stage = (await getOrgStage(ctx)).stage;
    } catch {
      // The button is a convenience; without the stage the setup item is just not matched.
    }
    const input = {
      role: ctx.role,
      grants: ctx.grants,
      active,
      registry: ADDON_REGISTRY,
    };
    const nav = composeHubNav({ ...input, stage });
    const screens = buildJumpIndex({
      nav,
      sections: composeSectionTabs({ ...input, nav: nav.items }),
      help: [],
    });
    const hit = screens.find((s) => s.href === target);
    if (hit) goTo = { label: hit.path ?? hit.label, href: hit.href };
  }

  // 11-48 (DASH-17): "Show the tour" beside Go to, for a screen with a first-use tour the
  // person can open (never for impersonating staff, who don't get tours).
  const tour = Object.prototype.hasOwnProperty.call(
    TOUR_FOR_HELP_ENTRY,
    entry.id,
  )
    ? TOUR_FOR_HELP_ENTRY[entry.id]
    : undefined;
  const tourHref =
    goTo && tour && !ctx.impersonator ? TOUR_SCREEN_HREF[tour] : null;

  return (
    <HelpArticle
      title={entry.title}
      activate={article.activate}
      use={article.use}
      goTo={goTo}
      tourHref={tourHref}
      linkFor={helpLinkFor(buildHelpIndex(ctx, active))}
      LinkComponent={GuardedLink}
    />
  );
}
