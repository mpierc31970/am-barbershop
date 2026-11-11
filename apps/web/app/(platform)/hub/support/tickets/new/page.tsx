// Get help (12-20 choices 1, 2; COMM-06, COMM-08, D94, D119, SUPPORT-02; 12-UI-SPEC "Get help
// form" lines 376-417). "← CDS Support", ScreenHeader "Get help" + "?" (help id
// `support.get-help`; the Suggest a feature header `support.ideas`, 12-33), then the form for writers only:
//   - Viewers see VIEWER-READONLY, staff impersonating IMPERSONATING-SUPPORT, grants-only roles
//     (no support:read, P12-P11) the no-access line; none of them gets a form (T-12-20-04; the
//     action refuses them too).
//   - Server-built inputs: the role's ticket types (ticketTypesFor), the target picker groups
//     (ticketTargets: live pages, active add-ons, site parts), and the person's own help list
//     for deflection (buildHelpIndex, the Help center's source).
//   - Query: `?type` (only a type the role may file), `?target` (only one of the server's own
//     options, else Whole site), `?from` (passed on to fileTicket, which keeps it only when it
//     is a same-origin /hub path; Discard goes back there via safeNext), `?ref` (parsed as a
//     ticket number; prefills "Follows up on ticket #1042."). Text reaches the page only
//     through React (T-12-20-03).
// A failed targets / help / stage read still renders the form (Whole site + site parts, no
// deflection).
// Suggest a feature (12-27 choice 1; CUSTOM-01, D297, D-UI-P12-7): for a role that may file
// `suggestion`, the page also loads the visible ideas that are not built (suggested,
// considering, planned) once, so the in-place idea form can offer similar ideas whichever way
// the person arrives. A failed ideas read just leaves the similar panel empty. The client form
// shows H1 "Suggest a feature" while the type is `suggestion` (both headers built here).
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { can } from "@cds/core";
import {
  WHOLE_SITE,
  buildTargetOptions,
  parseTicketNumber,
  ticketTypesFor,
  validateTarget,
  type IdeaCard,
  type TargetGroup,
  type TicketType,
} from "@cds/core/support";
import {
  activeAddons,
  getBusinessProfile,
  getOrgStage,
  listIdeas,
  ticketTargets,
  type OrgContext,
} from "@cds/db";
import { InlineAlert } from "@cds/ui/hub";
import { SUPPORT_UI_COPY, targetValue } from "@cds/ui/hub/support";
import { ScreenHeader } from "@cds/ui/hub/shell";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { safeNext } from "../../../../../../lib/agreement-gate";
import { buildHelpIndex } from "../../../../../../lib/help-index";
import { requireHubSession } from "../../../../../../lib/session";
import { GuardedLink } from "../../../GuardedLink";
import { IDEA_FORM_COPY } from "./IdeaFields";
import { NewTicketForm, type DeflectArticle } from "./NewTicketForm";

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}): Promise<Metadata> {
  const params: SearchParams = (await searchParams) ?? {};
  return {
    title: first(params.type) === "suggestion" ? IDEA_FORM_COPY.h1 : "Get help",
  };
}

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const SUPPORT_HREF = "/hub/support";
const NO_ACCESS_COPY =
  "Your role on this site doesn't include CDS Support. Ask your site owner.";
const BACK_LINK =
  "inline-flex items-center gap-1 self-start rounded text-sm font-semibold text-hub-accent " +
  "underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-hub-accent";

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function first(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && v.length > 0 ? v : null;
}

async function targetsFor(ctx: OrgContext): Promise<TargetGroup[]> {
  try {
    return await ticketTargets(ctx, {
      addonNames: Object.fromEntries(
        ADDON_REGISTRY.list().map((m) => [m.slug, m.name]),
      ),
    });
  } catch (err) {
    console.error(`[hub] support targets failed ${errName(err)}`);
    return buildTargetOptions({ pages: [], addons: [] });
  }
}

async function articlesFor(ctx: OrgContext): Promise<DeflectArticle[]> {
  let active: string[] = [];
  try {
    active = await activeAddons(ctx);
  } catch (err) {
    console.error(`[hub] support help add-ons failed ${errName(err)}`);
  }
  let live = false;
  try {
    live = (await getOrgStage(ctx)).stage === "live";
  } catch (err) {
    console.error(`[hub] support help stage failed ${errName(err)}`);
  }
  try {
    return buildHelpIndex(ctx, active, { includeSetup: !live }).map((e) => ({
      id: e.id,
      title: e.title,
      summary: e.summary,
      href: e.href,
    }));
  } catch (err) {
    console.error(`[hub] support help list failed ${errName(err)}`);
    return [];
  }
}

/** Statuses offered for similar-idea matching: listed, still open to votes (not built). */
const SIMILAR_STATUSES = ["suggested", "considering", "planned"] as const;

async function similarIdeasFor(
  ctx: OrgContext,
  types: readonly TicketType[],
): Promise<IdeaCard[]> {
  if (!types.includes("suggestion")) return [];
  try {
    const lists = await Promise.all(
      SIMILAR_STATUSES.map((status) => listIdeas(ctx, { status })),
    );
    return lists.flat();
  } catch (err) {
    console.error(`[hub] support similar ideas failed ${errName(err)}`);
    return [];
  }
}

async function timeZoneOf(ctx: OrgContext): Promise<string> {
  try {
    return (await getBusinessProfile(ctx)).time_zone || "UTC";
  } catch {
    return "UTC";
  }
}

function refNumber(raw: string | null): number | null {
  if (!raw) return null;
  try {
    return parseTicketNumber(raw);
  } catch {
    return null;
  }
}

export default async function NewTicketPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { ctx } = await requireHubSession();
  const params: SearchParams = (await searchParams) ?? {};

  const headerFor = (title: string, helpId: string) => (
    <>
      <GuardedLink href={SUPPORT_HREF} className={BACK_LINK}>
        <ArrowLeft aria-hidden size={16} strokeWidth={2} />
        CDS Support
      </GuardedLink>
      <ScreenHeader title={title} helpId={helpId} LinkComponent={GuardedLink} />
    </>
  );
  const header = headerFor("Get help", "support.get-help");

  let refusal: string | null = null;
  if (!can(ctx, "support", "read")) refusal = NO_ACCESS_COPY;
  else if (ctx.impersonator) refusal = SUPPORT_UI_COPY.IMPERSONATING_SUPPORT;
  else if (!can(ctx, "support", "write")) {
    refusal = SUPPORT_UI_COPY.VIEWER_READONLY;
  }
  const types: TicketType[] = refusal ? [] : ticketTypesFor(ctx.role);
  if (refusal || types.length === 0) {
    return (
      <div
        className="flex w-full max-w-[720px] flex-col gap-6 font-hub text-hub-ink"
        data-get-help=""
      >
        {header}
        <InlineAlert tone="info">{refusal ?? NO_ACCESS_COPY}</InlineAlert>
      </div>
    );
  }

  const [targets, articles, timeZone, ideas] = await Promise.all([
    targetsFor(ctx),
    articlesFor(ctx),
    timeZoneOf(ctx),
    similarIdeasFor(ctx, types),
  ]);

  const rawType = first(params.type);
  const initialType =
    rawType && (types as string[]).includes(rawType)
      ? (rawType as TicketType)
      : null;
  let initialTarget = targetValue(WHOLE_SITE);
  try {
    initialTarget = targetValue(validateTarget(first(params.target), targets));
  } catch {
    // An unknown or foreign target is ignored: Whole site (T-12-20-03).
  }
  const from = first(params.from);
  const ref = refNumber(first(params.ref));

  return (
    <div
      className="flex w-full max-w-[720px] flex-col gap-6 font-hub text-hub-ink"
      data-get-help=""
    >
      <NewTicketForm
        header={header}
        ideaHeader={headerFor(IDEA_FORM_COPY.h1, "support.ideas")}
        ideas={ideas}
        types={types}
        targets={targets}
        articles={articles}
        initialType={initialType}
        initialTarget={initialTarget}
        refNumber={ref}
        fromUrl={from && from.length <= 2048 ? from : null}
        backHref={safeNext(from, SUPPORT_HREF)}
        timeZone={timeZone}
      />
    </div>
  );
}
