// GET /api/health — liveness for the CDS monitor app (MONITOR-APP-BRIEF row 1, D175).
// Returns only status + version (T-01-07). Excluded from host routing in middleware.
//
// It also checks the config the middleware needs (WR-01, review iteration 2): if
// PLATFORM_HOSTS would make every routed page fail, health returns 503 "misconfigured",
// so the Docker HEALTHCHECK, Coolify and the monitor app all see the bad deploy. The
// reason is never included in the response.
import { parsePlatformHosts } from "@cds/core";

export const dynamic = "force-dynamic";

function configOk(): boolean {
  try {
    parsePlatformHosts(process.env.PLATFORM_HOSTS);
    return true;
  } catch {
    return false;
  }
}

export function GET() {
  const ok = configOk();
  return Response.json(
    {
      status: ok ? "ok" : "misconfigured",
      // Coolify sets SOURCE_COMMIT to the deployed commit; APP_VERSION is the manual fallback.
      version:
        process.env.SOURCE_COMMIT?.trim() ||
        process.env.APP_VERSION?.trim() ||
        "dev",
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
