// /hub/api/help/<id>: one how-to for the hub's help drawer (11-47; DASH-17, D110,
// D-UI-P11-16; T-11-47-01, T-11-47-02). Session-checked GET; the person and org come from the
// session only. The id (a training id or a screen's `<section>.<tab>` help id) is resolved
// against the closed help map (`findHelpEntry`: HELP_ALIASES, add-on tabs, the person's own
// grant- and audience-filtered Help index), so the drawer can never show an article the Help
// center would 404 (a Viewer asking for `download-data`, an off add-on, an unknown id).
//   200 { id, title, href, steps: [{ screen, action, expected }], tour }   (plain text steps;
//       tour = the first-use tour on that screen, or null; 11-48)
//       askCds = the drawer may offer "Still stuck? Ask CDS" (12-20: support:write and not
//       impersonating; Viewers and staff viewing as the tenant get false)
//   401 signed out · 404 unknown or not permitted. Every response is `private, no-store`.
import { helpArticle } from "@cds/addon-registry/help";
import { can } from "@cds/core";
import { activeAddons } from "@cds/db";
import { TOUR_FOR_HELP_ENTRY } from "@cds/ui/hub/help";
import { findHelpEntry } from "../../../../../../lib/help-index";
import { getHubSession } from "../../../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SAFE_HEADERS, "Content-Type": "application/json" },
  });
}

/** Markdown inline marks to plain text: the drawer renders steps as text. */
function plainStep(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|`/g, "")
    .trim();
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Review 11 IN-E03: a session-read outage is a 503 with the safe headers, not Next's 500.
  let session: Awaited<ReturnType<typeof getHubSession>>;
  try {
    session = await getHubSession();
  } catch (err) {
    console.error(
      "[hub] help api session read failed",
      err instanceof Error ? err.name : typeof err,
    );
    return json(503, { error: "unavailable" });
  }
  if (!session) return json(401, { error: "signed_out" });
  const { ctx } = session;

  let rawId: string;
  try {
    rawId = decodeURIComponent((await params).id);
  } catch {
    return json(404, { error: "not_found" });
  }

  let active: string[] = [];
  try {
    active = await activeAddons(ctx);
  } catch (err) {
    // Without the add-on list only core articles resolve (an add-on id is a 404).
    console.error(
      "[hub] help api add-ons failed",
      err instanceof Error ? err.name : typeof err,
    );
  }

  const entry = findHelpEntry(ctx, active, rawId);
  const article = entry ? helpArticle(entry.howTo) : null;
  if (!entry || !article) return json(404, { error: "not_found" });

  return json(200, {
    id: entry.id,
    title: entry.title,
    href: entry.href,
    steps: article.use.map((s) => ({
      screen: plainStep(s.screen),
      action: plainStep(s.action),
      expected: plainStep(s.expected),
    })),
    tour: Object.prototype.hasOwnProperty.call(TOUR_FOR_HELP_ENTRY, entry.id)
      ? TOUR_FOR_HELP_ENTRY[entry.id]
      : null,
    askCds: !ctx.impersonator && can(ctx, "support", "write"),
  });
}
