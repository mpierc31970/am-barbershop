// MediaSource: the one client read path for the media library, plus the describe write
// (07-17 choice 1; CONT-14, CONT-21, CONT-35). @cds/ui cannot import app server actions, and
// the picker opens from the builder, the pop-up editor and (07-30) the SEO drawer, so every
// MediaField / MediaPicker takes an optional `source` (tests inject a fake) and defaults to
// fetchMediaSource over the session-scoped GET/POST /hub/api/media/library route. The tenant
// is never sent: the route takes the org from the session (invariant 1, T-07-17-01).
// Never throws: every failure is a HubActionResult with an owner-facing message.
import type { HubActionResult } from "../addon-types";
import {
  MEDIA_COPY,
  type LibraryFilterView,
  type LibraryItemView,
  type LibraryPageView,
  type UsageView,
  type VideoStateView,
} from "./copy";

export const MEDIA_LIBRARY_URL = "/hub/api/media/library";

export type MediaListOptions = {
  filter: LibraryFilterView;
  q?: string;
  page?: number;
  perPage?: number;
};

export type MediaListResult = { page: LibraryPageView; usage: UsageView };

export interface MediaSource {
  list(opts: MediaListOptions): Promise<HubActionResult<MediaListResult>>;
  items(ids: readonly string[]): Promise<HubActionResult<LibraryItemView[]>>;
  states(
    ids: readonly string[],
  ): Promise<HubActionResult<Record<string, VideoStateView>>>;
  describe(
    entries: readonly { id: string; alt: string }[],
  ): Promise<HubActionResult<{ count: number }>>;
}

const CODE_BY_STATUS: Record<number, string> = {
  400: "invalid_input",
  401: "signed_out",
  403: "forbidden",
  404: "not_found",
  413: "too_large",
};

/** Route errors are either a sentence for the owner or a bare code ("not_found"). */
const isSentence = (s: string) => s.includes(" ");

async function call<T>(
  url: string,
  init: RequestInit,
  pick: (json: Record<string, unknown>) => T,
): Promise<HubActionResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    return { ok: false, code: "network", message: MEDIA_COPY.errLoad };
  }
  let json: Record<string, unknown> = {};
  try {
    const v: unknown = await res.json();
    if (typeof v === "object" && v !== null)
      json = v as Record<string, unknown>;
  } catch {
    json = {};
  }
  if (!res.ok) {
    const error = typeof json.error === "string" ? json.error : "";
    const code = CODE_BY_STATUS[res.status] ?? "failed";
    const message = isSentence(error)
      ? error
      : res.status === 401
        ? MEDIA_COPY.signedOut
        : MEDIA_COPY.errLoad;
    return { ok: false, code, message };
  }
  return { ok: true, data: pick(json) };
}

function qs(pairs: [string, string][]): string {
  return new URLSearchParams(pairs).toString();
}

export const fetchMediaSource: MediaSource = {
  list(opts) {
    const pairs: [string, string][] = [["filter", opts.filter]];
    if (opts.q) pairs.push(["q", opts.q]);
    if (opts.page) pairs.push(["page", String(opts.page)]);
    if (opts.perPage) pairs.push(["perPage", String(opts.perPage)]);
    return call(
      `${MEDIA_LIBRARY_URL}?${qs(pairs)}`,
      { method: "GET" },
      (j) => ({
        page: j.page as LibraryPageView,
        usage: j.usage as UsageView,
      }),
    );
  },
  items(ids) {
    return call(
      `${MEDIA_LIBRARY_URL}?${qs([["ids", ids.join(",")]])}`,
      { method: "GET" },
      (j) => (Array.isArray(j.items) ? (j.items as LibraryItemView[]) : []),
    );
  },
  states(ids) {
    return call(
      `${MEDIA_LIBRARY_URL}?${qs([["states", ids.join(",")]])}`,
      { method: "GET" },
      (j) =>
        typeof j.states === "object" && j.states !== null
          ? (j.states as Record<string, VideoStateView>)
          : {},
    );
  },
  describe(entries) {
    return call(
      MEDIA_LIBRARY_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          describe: entries.map((e) => ({ id: e.id, alt: e.alt })),
        }),
      },
      (j) => ({ count: typeof j.count === "number" ? j.count : 0 }),
    );
  },
};
