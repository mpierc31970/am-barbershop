// /hub/manifest.webmanifest: the installable hub's per-org web app manifest (11-22; DASH-34,
// D63; 11-UI-SPEC "Push"; T-11-22-05). The org comes from the session cookie only; signed out
// (or a staff token) → 404, so no org name leaks. `private, no-store`: a shared cache never
// serves one org's name to another. The layout links it with crossorigin="use-credentials"
// (a manifest is fetched without cookies otherwise).
import { readOwnSiteIcons } from "@cds/db";
import { buildHubManifest } from "../../../../lib/hub-pwa";
import { getHubSession } from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

export async function GET(): Promise<Response> {
  const session = await getHubSession().catch(() => null);
  if (!session) {
    return new Response("Not found", { status: 404, headers: HEADERS });
  }
  let iconVersion: string | null = null;
  try {
    iconVersion = (await readOwnSiteIcons(session.ctx))?.v ?? null;
  } catch {
    // The monogram stands in; a storage blip never breaks the manifest.
    iconVersion = null;
  }
  const manifest = buildHubManifest({ name: session.org.name, iconVersion });
  return new Response(JSON.stringify(manifest), {
    status: 200,
    headers: { ...HEADERS, "Content-Type": "application/manifest+json" },
  });
}
