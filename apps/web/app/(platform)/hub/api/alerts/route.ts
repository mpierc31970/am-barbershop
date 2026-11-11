// /hub/api/alerts: the signed-in person's bell (11-21; DASH-34, DASH-37; 11-UI-SPEC "Bell";
// D-UI-P11-12; T-11-21-01, T-11-21-02). Session-checked GET (the agreement download route's
// pattern): the person and org come from the session cookie only; listBell / bellCounts bind
// every read to (org, actor), so a colleague's or another site's alerts are never returned.
//   GET ?view=count  -> { count, urgent }                     (the 60s / navigation refresh)
//   GET [?more=1]    -> { rows, count, urgent, timeZone, hasMore }   (the drawer; 30 or 100 rows)
// Signed out: 401 with the empty bell (no redirect: it is a fetch). Impersonating staff get
// the empty bell (no staff bell, UI-SPEC). Every response is `private, no-store`.
import { DEFAULT_TIME_ZONE } from "@cds/core/today";
import {
  bellCounts,
  listBell,
  statsTimeZone,
  type NeedsYouResult,
} from "@cds/db";
import { bellKeysFrom } from "../../../../../lib/bell";
import { getNeedsYou } from "../../../../../lib/needs-you";
import { getHubSession } from "../../../../../lib/session";
import { ALL_NEEDS_YOU_FAILED } from "../../nav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

const PAGE = 30;
const MORE = 100;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SAFE_HEADERS, "Content-Type": "application/json" },
  });
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const countOnly = params.get("view") === "count";
  const empty = countOnly
    ? { count: 0, urgent: 0 }
    : {
        rows: [],
        count: 0,
        urgent: 0,
        timeZone: DEFAULT_TIME_ZONE,
        hasMore: false,
      };

  // Review 11 IN-E03: a session-read outage is a 503 with the safe headers, not Next's 500.
  let session: Awaited<ReturnType<typeof getHubSession>>;
  try {
    session = await getHubSession();
  } catch (err) {
    console.error(`[alerts] session read failed ${errName(err)}`);
    return json(503, empty);
  }
  if (!session) return json(401, empty);
  const { ctx } = session;
  if (ctx.impersonator) return json(200, empty);

  let needsYou: NeedsYouResult;
  try {
    needsYou = await getNeedsYou();
  } catch (err) {
    // Unknown items are never "done": every Needs-you alert stays as it is.
    console.error(`[alerts] needs-you failed ${errName(err)}`);
    needsYou = { items: [], failed: [...ALL_NEEDS_YOU_FAILED] };
  }
  const keys = bellKeysFrom(needsYou);

  try {
    const counts = await bellCounts(ctx, keys);
    if (countOnly) {
      return json(200, { count: counts.unread, urgent: counts.urgent });
    }
    const limit = params.get("more") === "1" ? MORE : PAGE;
    const [rows, timeZone] = await Promise.all([
      listBell(ctx, { needsYouKeys: keys, limit }),
      statsTimeZone(ctx).catch(() => DEFAULT_TIME_ZONE),
    ]);
    return json(200, {
      rows,
      count: counts.unread,
      urgent: counts.urgent,
      timeZone,
      hasMore: limit === PAGE && rows.length === PAGE,
    });
  } catch (err) {
    console.error(`[alerts] bell read failed ${errName(err)}`);
    return json(500, { error: "load_failed" });
  }
}
