// Website › Media URL params (07-17 choice 5; CONT-21, D-UI-P7-4; 07-UI-SPEC "Media";
// T-07-17-03). Pure: no next imports, safe on server and client.
// `/hub/website?tab=media&type=&q=&asset=&view=`: filter and search live in the URL so Back
// and refresh keep them; `asset` opens the drawer; `view=describe` shows the describe list.
// A hand-edited URL never breaks the page: unknown values are dropped, never thrown. Hrefs are
// built from this closed key set on the fixed /hub/website path only.

const ID = /^[a-z0-9]{1,32}$/i;
const Q_MAX = 100;

export const MEDIA_FILTERS = ["all", "images", "videos", "audio"] as const;
export type MediaFilterParam = (typeof MEDIA_FILTERS)[number];

export type MediaParams = {
  type: MediaFilterParam;
  q: string;
  asset?: string;
  view?: "describe";
};

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" ? x : undefined;
}

export function parseMediaParams(sp: RawParams): MediaParams {
  const rawType = first(sp.type);
  const type = (MEDIA_FILTERS as readonly string[]).includes(rawType ?? "")
    ? (rawType as MediaFilterParam)
    : "all";
  const q = (first(sp.q) ?? "").trim().slice(0, Q_MAX).trim();
  const out: MediaParams = { type, q };
  const asset = first(sp.asset);
  if (asset && ID.test(asset)) out.asset = asset;
  if (first(sp.view) === "describe") out.view = "describe";
  return out;
}

export type MediaPatch = {
  type?: MediaFilterParam | null;
  q?: string | null;
  asset?: string | null;
  view?: "describe" | null;
};

/** `/hub/website?tab=media&…` from the closed key set; empty values are dropped. */
export function mediaHref(params: MediaParams, patch: MediaPatch = {}): string {
  const next: Record<string, string | undefined> = {
    type: params.type,
    q: params.q,
    asset: params.asset,
    view: params.view,
  };
  for (const k of ["type", "q", "asset", "view"] as const) {
    if (!Object.hasOwn(patch, k)) continue;
    const v = patch[k];
    next[k] = v === null || v === undefined || v === "" ? undefined : v;
  }
  const qs = new URLSearchParams();
  qs.set("tab", "media");
  if (next.type && next.type !== "all") {
    if ((MEDIA_FILTERS as readonly string[]).includes(next.type)) {
      qs.set("type", next.type);
    }
  }
  if (next.q) qs.set("q", next.q.slice(0, Q_MAX));
  if (next.asset && ID.test(next.asset)) qs.set("asset", next.asset);
  if (next.view === "describe") qs.set("view", "describe");
  return `/hub/website?${qs.toString()}`;
}

/** True when a filter or a search is set (the filtered empty state, Clear filters). */
export function mediaFiltered(p: MediaParams): boolean {
  return p.type !== "all" || p.q !== "";
}
