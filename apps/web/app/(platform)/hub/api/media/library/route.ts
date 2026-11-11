// /hub/api/media/library: the hub's one client read path for the media library, plus the bulk
// describe write (07-17 choice 1; CONT-14, CONT-19, CONT-21, CONT-35, D280; T-07-17-01..03,
// T-07-17-06). Invariant 1: the org comes from the session only (mediaContext); nothing in
// the request names a tenant, and every value reaching @cds/db is allowlisted and
// shape-checked here, then re-checked by the chokepoint (NotFound for foreign ids).
//   GET  ?filter=&q=&page=&perPage=  -> { page, usage }   (list; video items carry videoState)
//   GET  ?ids=a,b                    -> { items }         (≤ 60; NotFound ids skipped)
//   GET  ?states=a,b                 -> { states }        (≤ 200)
//   POST { describe: [{ id, alt }] } -> { count }         (same origin; ≤ 64 KB; ≤ 200)
// Every response is `Cache-Control: private, no-store`. Never logs names, alts or ids.
import { NotFound } from "@cds/core";
import {
  describeMedia,
  getLibraryItem,
  listLibrary,
  mediaUsage,
  videoStates,
  type LibraryFilter,
  type LibraryItem,
} from "@cds/db";
import {
  mediaContext,
  sameOrigin,
  uploadErrorResponse,
} from "../../../../../../lib/media-route";
import { mediaUsageView } from "../../../../../../lib/media-usage-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" } as const;
const ID = /^[a-z0-9]{1,32}$/i;
const FILTERS = new Set<LibraryFilter>(["all", "images", "videos", "audio"]);
const Q_MAX = 100;
const IDS_MAX = 60;
const STATES_MAX = 200;
const DESCRIBE_MAX = 200;
const BODY_MAX = 64 * 1024;

function reply(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: HEADERS });
}

/** Map a chokepoint error with the shared mapping, then force the private header. */
function failure(err: unknown): Response {
  if (err instanceof NotFound) return reply(404, { error: "not_found" });
  const res = uploadErrorResponse(err);
  const out = new Response(res.body, { status: res.status });
  out.headers.set("Content-Type", "application/json");
  out.headers.set("Cache-Control", HEADERS["Cache-Control"]);
  return out;
}

function intParam(v: string | null, min: number, max: number, dflt: number) {
  if (v === null || !/^\d{1,6}$/.test(v)) return dflt;
  return Math.min(max, Math.max(min, Number(v)));
}

function idList(raw: string, cap: number): string[] {
  const out: string[] = [];
  for (const id of raw.split(",")) {
    if (out.length >= cap) break;
    if (ID.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

export async function GET(req: Request): Promise<Response> {
  const ctx = await mediaContext();
  if (!ctx) return reply(401, { error: "signed_out" });
  if (ctx instanceof Response) return ctx;
  const sp = new URL(req.url).searchParams;

  try {
    if (sp.has("ids")) {
      const ids = idList(sp.get("ids") ?? "", IDS_MAX);
      const items: LibraryItem[] = [];
      for (const id of ids) {
        try {
          items.push(await getLibraryItem(ctx, id));
        } catch (err) {
          if (!(err instanceof NotFound)) throw err;
        }
      }
      return reply(200, { items });
    }

    if (sp.has("states")) {
      const ids = idList(sp.get("states") ?? "", STATES_MAX);
      return reply(200, {
        states: ids.length === 0 ? {} : await videoStates(ctx, ids),
      });
    }

    const rawFilter = sp.get("filter") as LibraryFilter | null;
    const filter: LibraryFilter =
      rawFilter && FILTERS.has(rawFilter) ? rawFilter : "all";
    const q = (sp.get("q") ?? "").trim().slice(0, Q_MAX).trim();
    const page = intParam(sp.get("page"), 1, 100_000, 1);
    const perPage = intParam(sp.get("perPage"), 1, 100, 60);
    const [list, usage] = await Promise.all([
      listLibrary(ctx, { filter, q, page, perPage }),
      mediaUsage(ctx),
    ]);
    const videoIds = list.items
      .filter((i) => i.kind === "video")
      .map((i) => i.id);
    const states = videoIds.length > 0 ? await videoStates(ctx, videoIds) : {};
    return reply(200, {
      page: {
        ...list,
        items: list.items.map((i) =>
          i.kind === "video" && states[i.id]
            ? { ...i, videoState: states[i.id] }
            : i,
        ),
      },
      usage: await mediaUsageView(usage, ctx),
    });
  } catch (err) {
    return failure(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return reply(403, { error: "forbidden" });
  const ctx = await mediaContext();
  if (!ctx) return reply(401, { error: "signed_out" });
  if (ctx instanceof Response) return ctx;

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > BODY_MAX) {
    return reply(413, { error: "too_large" });
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return reply(400, { error: "bad_request" });
  }
  if (text.length > BODY_MAX) return reply(413, { error: "too_large" });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: "bad_request" });
  }
  const list =
    typeof body === "object" && body !== null
      ? (body as { describe?: unknown }).describe
      : undefined;
  if (!Array.isArray(list) || list.length > DESCRIBE_MAX) {
    return reply(400, { error: "bad_request" });
  }
  const entries: { id: string; alt: string }[] = [];
  for (const raw of list as unknown[]) {
    if (typeof raw !== "object" || raw === null) {
      return reply(400, { error: "bad_request" });
    }
    const { id, alt } = raw as { id?: unknown; alt?: unknown };
    if (typeof id !== "string" || !ID.test(id) || typeof alt !== "string") {
      return reply(400, { error: "bad_request" });
    }
    entries.push({ id, alt });
  }
  try {
    const res = await describeMedia(ctx, entries);
    return reply(200, { count: res.updated });
  } catch (err) {
    return failure(err);
  }
}
