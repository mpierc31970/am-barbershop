// /hub/api/support: the support thread poll (12-12; COMM-01, COMM-07; 12-UI-SPEC polling,
// every 20 s while a thread is open and visible). Session-checked GET (the alerts route's
// pattern): the person and org come from the session cookie only.
//   GET ?thread=<id>[&since=<iso>] -> { messages: TenantMessage[], now, cursor }
// `messages` are the thread's public messages newer than `since` (oldest first); internal
// notes never appear (listThreadMessages filters visibility = 'public' in the query).
// `cursor` is the newest returned message's time (else `since`, else `now`): the client sends
// it back as `since`, so app and database clocks never need to agree.
// Signed out: 401 json. No support:read: 403. A foreign or missing thread: the same 404
// (T-12-12-02). Malformed since: 400. Every response is `private, no-store`; errors are logged
// by class name only.
import { can, InvalidInput, NotFound } from "@cds/core";
import { listThreadMessages } from "@cds/db";
import { getHubSession } from "../../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

const THREAD_ID = /^[a-z0-9]{15}$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SAFE_HEADERS, "Content-Type": "application/json" },
  });
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

const NOT_FOUND = { error: "not_found" } as const;

export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;

  let session: Awaited<ReturnType<typeof getHubSession>>;
  try {
    session = await getHubSession();
  } catch (err) {
    console.error(`[support-poll] session read failed ${errName(err)}`);
    return json(503, { error: "unavailable" });
  }
  if (!session) return json(401, { error: "signed_out" });
  const { ctx } = session;
  if (!can(ctx, "support", "read")) return json(403, { error: "forbidden" });

  const thread = params.get("thread") ?? "";
  if (!THREAD_ID.test(thread)) return json(404, NOT_FOUND);

  const rawSince = params.get("since");
  let since: Date | undefined;
  if (rawSince !== null && rawSince !== "") {
    const d = new Date(rawSince);
    if (rawSince.length > 40 || Number.isNaN(d.getTime())) {
      return json(400, { error: "bad_since" });
    }
    since = d;
  }

  const now = new Date();
  try {
    const page = await listThreadMessages(ctx, thread, since ? { since } : {});
    const newest = page.messages.at(-1)?.created;
    const cursor = newest
      ? new Date(newest).toISOString()
      : (since ?? now).toISOString();
    return json(200, {
      messages: page.messages,
      now: now.toISOString(),
      cursor,
    });
  } catch (err) {
    if (err instanceof NotFound) return json(404, NOT_FOUND);
    if (err instanceof InvalidInput) return json(400, { error: "bad_request" });
    console.error(`[support-poll] read failed ${errName(err)}`);
    return json(500, { error: "load_failed" });
  }
}
