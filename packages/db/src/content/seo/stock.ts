// Unsplash and Pexels behind the StockPhotoSource port (07-30 choice 9; CONT-28, D-UI-P7-11;
// T-07-30-06, T-07-30-07, T-07-30-08).
//
// Keys are read only here and never logged, returned or sent to the client. Fixed API hosts;
// results are kept only when their image host is allowlisted (hot-linked per the Unsplash
// guideline); `registerUse` takes only an id matching STOCK_ID_RE (never a URL). Every call
// has an 8 s timeout; a non-2xx, a timeout or a bad body is an empty page plus one `[stock]`
// log line. Without keys there is no source and the picker's Free photos tab is absent.
import { SlidingWindowLimiter } from "../../rate-limit";
import type { StockPhoto, StockPhotoPage, StockPhotoSource } from "../p7-ports";

export const STOCK_IMAGE_HOSTS: readonly string[] = Object.freeze([
  "images.unsplash.com",
  "images.pexels.com",
]);
export const STOCK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const STOCK_PER_PAGE = 24;
export const STOCK_QUERY_MAX = 100;
export const STOCK_PAGE_MAX = 50;
const UTM = "utm_source=cds_platform&utm_medium=referral";

type FetchFn = typeof fetch;

const EMPTY: StockPhotoPage = Object.freeze({ photos: [], hasMore: false });

function str(v: unknown, max = 500): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0
    ? Math.round(v)
    : 0;
}

function obj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** An https URL on an allowlisted image host, or null. */
function imageUrl(v: unknown): string | null {
  try {
    const u = new URL(str(v, 2048));
    return u.protocol === "https:" && STOCK_IMAGE_HOSTS.includes(u.hostname)
      ? u.href
      : null;
  } catch {
    return null;
  }
}

/** An https link on the source's own site with the referral params, or null. */
function creditLink(v: unknown, hosts: readonly string[]): string | null {
  try {
    const u = new URL(str(v, 2048));
    if (u.protocol !== "https:" || !hosts.includes(u.hostname)) return null;
    u.search = UTM;
    return u.href;
  } catch {
    return null;
  }
}

function cleanQuery(query: string): string {
  return str(query, STOCK_QUERY_MAX);
}

function cleanPage(page: number): number {
  return Number.isInteger(page) && page >= 1 && page <= STOCK_PAGE_MAX
    ? page
    : 1;
}

async function getJson(
  fetchFn: FetchFn,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  label: string,
): Promise<unknown | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { headers, signal: ac.signal });
    if (!res.ok) {
      console.error(`[stock] ${label} failed (HTTP ${res.status})`);
      return null;
    }
    return (await res.json()) as unknown;
  } catch {
    console.error(`[stock] ${label} failed (network or timeout)`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function createUnsplashSource(opts: {
  accessKey: string;
  fetch?: FetchFn;
  timeoutMs?: number;
}): StockPhotoSource {
  const fetchFn = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const headers = {
    Authorization: `Client-ID ${opts.accessKey}`,
    "Accept-Version": "v1",
  };
  const hosts = ["unsplash.com"];
  return {
    name: "unsplash",
    async search(query, page) {
      const q = cleanQuery(query);
      if (q === "") return EMPTY;
      const p = cleanPage(page);
      const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&page=${p}&per_page=${STOCK_PER_PAGE}`;
      const body = obj(
        await getJson(fetchFn, url, headers, timeoutMs, "unsplash search"),
      );
      const results = Array.isArray(body.results) ? body.results : [];
      const photos: StockPhoto[] = [];
      for (const raw of results) {
        const r = obj(raw);
        const id = str(r.id, 64);
        const urls = obj(r.urls);
        const user = obj(r.user);
        const full = imageUrl(urls.regular);
        const thumb = imageUrl(urls.small) ?? imageUrl(urls.thumb);
        const creditUrl = creditLink(obj(user.links).html, hosts);
        const creditName = str(user.name, 80);
        if (
          !STOCK_ID_RE.test(id) ||
          !full ||
          !thumb ||
          !creditUrl ||
          !creditName
        )
          continue;
        photos.push({
          id,
          source: "unsplash",
          url: full,
          thumbUrl: thumb,
          width: num(r.width),
          height: num(r.height),
          alt: str(r.alt_description, 300) || str(r.description, 300),
          creditName,
          creditUrl,
        });
      }
      const totalPages = num(body.total_pages);
      return { photos, hasMore: p < Math.min(totalPages, STOCK_PAGE_MAX) };
    },
    async registerUse(photoId) {
      if (typeof photoId !== "string" || !STOCK_ID_RE.test(photoId)) {
        throw new Error("invalid stock photo id");
      }
      await getJson(
        fetchFn,
        `https://api.unsplash.com/photos/${photoId}/download`,
        headers,
        timeoutMs,
        "unsplash download ping",
      );
    },
  };
}

export function createPexelsSource(opts: {
  apiKey: string;
  fetch?: FetchFn;
  timeoutMs?: number;
}): StockPhotoSource {
  const fetchFn = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const headers = { Authorization: opts.apiKey };
  const hosts = ["www.pexels.com", "pexels.com"];
  return {
    name: "pexels",
    async search(query, page) {
      const q = cleanQuery(query);
      if (q === "") return EMPTY;
      const p = cleanPage(page);
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&page=${p}&per_page=${STOCK_PER_PAGE}`;
      const body = obj(
        await getJson(fetchFn, url, headers, timeoutMs, "pexels search"),
      );
      const results = Array.isArray(body.photos) ? body.photos : [];
      const photos: StockPhoto[] = [];
      for (const raw of results) {
        const r = obj(raw);
        const id =
          typeof r.id === "number" && Number.isInteger(r.id)
            ? String(r.id)
            : str(r.id, 64);
        const src = obj(r.src);
        const full = imageUrl(src.large2x) ?? imageUrl(src.large);
        const thumb = imageUrl(src.medium) ?? imageUrl(src.small);
        const creditUrl = creditLink(r.photographer_url, hosts);
        const creditName = str(r.photographer, 80);
        if (
          !STOCK_ID_RE.test(id) ||
          !full ||
          !thumb ||
          !creditUrl ||
          !creditName
        )
          continue;
        photos.push({
          id,
          source: "pexels",
          url: full,
          thumbUrl: thumb,
          width: num(r.width),
          height: num(r.height),
          alt: str(r.alt, 300),
          creditName,
          creditUrl,
        });
      }
      return {
        photos,
        hasMore: typeof body.next_page === "string" && p < STOCK_PAGE_MAX,
      };
    },
  };
}

/**
 * The configured source: CDS_STOCK_PHOTOS = unsplash | pexels | off; unset = Unsplash when
 * UNSPLASH_ACCESS_KEY is set, else Pexels when PEXELS_API_KEY is set, else null (tab absent).
 * An explicit choice without its key is null plus one `[stock] missing key` log.
 */
export function getStockPhotoSource(
  env: Readonly<Record<string, string | undefined>> = process.env,
  opts: { fetch?: FetchFn } = {},
): StockPhotoSource | null {
  const choice = str(env.CDS_STOCK_PHOTOS, 20).toLowerCase();
  const unsplash = str(env.UNSPLASH_ACCESS_KEY, 200);
  const pexels = str(env.PEXELS_API_KEY, 200);
  const make = (name: "unsplash" | "pexels"): StockPhotoSource | null => {
    if (name === "unsplash") {
      return unsplash
        ? createUnsplashSource({ accessKey: unsplash, fetch: opts.fetch })
        : null;
    }
    return pexels
      ? createPexelsSource({ apiKey: pexels, fetch: opts.fetch })
      : null;
  };
  if (choice === "off") return null;
  if (choice === "unsplash" || choice === "pexels") {
    const s = make(choice);
    if (!s) console.error("[stock] missing key");
    return s;
  }
  return make("unsplash") ?? make("pexels");
}

// 60 searches per org per hour (T-07-30-08). In memory, per process: the hub runs one app.
export const STOCK_SEARCHES_PER_HOUR = 60;
export const STOCK_RATE_COPY =
  "That's a lot of searches for one hour. Try again in a little while.";
let stockLimiter = new SlidingWindowLimiter(
  STOCK_SEARCHES_PER_HOUR,
  60 * 60 * 1000,
);

/** Record one stock search for the org; false when it is over the hourly limit. */
export function takeStockSearch(orgId: string): boolean {
  return stockLimiter.hit(`stock:${orgId}`);
}

export function resetStockLimitsForTests(now?: () => number): void {
  stockLimiter = new SlidingWindowLimiter(
    STOCK_SEARCHES_PER_HOUR,
    60 * 60 * 1000,
    now,
  );
}
