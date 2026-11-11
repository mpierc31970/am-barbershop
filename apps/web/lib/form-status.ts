// The no-JS form status URL contract (CONT-25, D231; 07-19 choices 1-4; RESEARCH line 931,
// open redirect). The one place the return URL of POST /api/forms/<id> is built and the one
// place a tenant page parses it back:
//   <path>?form=<formId>&item=<itemId>&sent=1#form-<itemId>
//   <path>?form=<formId>&item=<itemId>&err=fields|rate|error[&f=<fieldId>.<r|i|l>,…]#form-<itemId>
// Only ids and one-letter codes travel; never an answer. Paths come from this org's manifest
// by page id (pagePathFor), never from the request, and always pass safeSamePath.
// Pure: no next/*, never throws.
import type { SiteManifest } from "@cds/core/content";
import type { FieldErrorCode, FormStatusView } from "@cds/ui/site";

export const FORM_ID_RE = /^[a-z0-9]{1,32}$/i;
export const ITEM_ID_RE = /^[a-z0-9-]{1,40}$/;
const FIELD_ID_RE = /^[a-z0-9_-]{1,40}$/i;
const MAX_FIELD_CODES = 40;

export type FormOutcome =
  | { kind: "sent" }
  // 10-40: a no-JS "Save and finish later" (…&saved=1).
  | { kind: "saved" }
  | { kind: "rate" | "error" }
  | { kind: "fields"; fields: Readonly<Record<string, FieldErrorCode>> };

type Params = Readonly<Record<string, string | string[] | undefined>>;

function first(v: unknown): string | null {
  if (Array.isArray(v)) v = v[0];
  return typeof v === "string" ? v : null;
}

function isCode(v: string): v is FieldErrorCode {
  return v === "r" || v === "i" || v === "l";
}

/** Parse up to 40 `<fieldId>.<r|i|l>` pairs; junk dropped. */
export function parseFieldCodes(
  raw: string | null,
): Record<string, FieldErrorCode> {
  const out: Record<string, FieldErrorCode> = {};
  if (!raw || raw.length > 4000) return out;
  let n = 0;
  for (const pair of raw.split(",")) {
    if (n >= MAX_FIELD_CODES) break;
    const dot = pair.lastIndexOf(".");
    if (dot <= 0) continue;
    const id = pair.slice(0, dot);
    const code = pair.slice(dot + 1);
    if (!FIELD_ID_RE.test(id) || !isCode(code)) continue;
    if (Object.prototype.hasOwnProperty.call(out, id)) continue;
    out[id] = code;
    n += 1;
  }
  return out;
}

/** searchParams -> { formId, status } for the tenant page, or null. Never throws. */
export function parseFormStatus(
  params: Params | null | undefined,
): { formId: string; status: FormStatusView } | null {
  try {
    if (!params || typeof params !== "object") return null;
    const get = (k: string) =>
      Object.prototype.hasOwnProperty.call(params, k) ? first(params[k]) : null;
    const formId = get("form");
    const itemId = get("item");
    if (!formId || !FORM_ID_RE.test(formId)) return null;
    if (!itemId || !ITEM_ID_RE.test(itemId)) return null;
    if (get("sent") === "1")
      return { formId, status: { itemId, kind: "sent" } };
    if (get("saved") === "1")
      return { formId, status: { itemId, kind: "saved" } };
    const err = get("err");
    if (err === "rate" || err === "error")
      return { formId, status: { itemId, kind: err } };
    if (err === "fields") {
      return {
        formId,
        status: { itemId, kind: "fields", fields: parseFieldCodes(get("f")) },
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** A resume token: base64url of 32 bytes (10-37 choice 1). */
export const RESUME_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * 10-40: `?resume=<token>` from a "Finish your form" email -> the token, or null. Only the
 * shape is checked here; the forms loader looks it up scoped to this org and form.
 */
export function parseFormResume(
  params: Params | null | undefined,
): string | null {
  try {
    if (!params || typeof params !== "object") return null;
    if (!Object.prototype.hasOwnProperty.call(params, "resume")) return null;
    const v = first(params.resume);
    return v && RESUME_TOKEN_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** The path only when it is a same-host absolute path; else "/". */
export function safeSamePath(path: unknown): string {
  if (typeof path !== "string") return "/";
  if (path.length === 0 || path.length > 512) return "/";
  if (!path.startsWith("/")) return "/";
  if (path.startsWith("//") || path.startsWith("/\\")) return "/";
  if (/[\r\n\t\0]/.test(path) || /\\/.test(path)) return "/";
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(path)) return "/";
  return path;
}

/** The 303 Location for a no-JS send. */
export function formReturnHref(
  path: string,
  formId: string,
  itemId: string | null,
  outcome: FormOutcome,
): string {
  const base = safeSamePath(path);
  const q = new URLSearchParams();
  q.set("form", FORM_ID_RE.test(formId) ? formId : "");
  const item = itemId && ITEM_ID_RE.test(itemId) ? itemId : null;
  if (item) q.set("item", item);
  if (outcome.kind === "sent") q.set("sent", "1");
  else if (outcome.kind === "saved") q.set("saved", "1");
  else q.set("err", outcome.kind);
  let query = q.toString();
  if (outcome.kind === "fields") {
    const pairs = Object.keys(outcome.fields)
      .filter((id) => FIELD_ID_RE.test(id))
      .slice(0, MAX_FIELD_CODES)
      .map((id) => `${encodeURIComponent(id)}.${outcome.fields[id]}`);
    if (pairs.length > 0) query += `&f=${pairs.join(",")}`;
  }
  const hash = item ? `#form-${item}` : "";
  return safeSamePath(`${base}?${query}${hash}`);
}

/**
 * WR-C02: the middleware copies a tenant request's query string into this header, so the
 * tenant 404 page (which gets no searchParams) can show a no-JS form status. Any client-sent
 * copy is stripped first.
 */
export const FORM_QUERY_HEADER = "x-cds-form-query";
/** The longest query string the middleware forwards in FORM_QUERY_HEADER. */
export const MAX_FORM_QUERY = 4600;

/** The 404 page's manifest slug (NOT_FOUND_SLUG in @cds/db; this module stays pure). */
const NOT_FOUND_PAGE_SLUG = "system-404";

/** FORM_QUERY_HEADER's value -> the searchParams record parseFormStatus takes. */
export function formQueryParams(
  raw: string | null | undefined,
): Record<string, string> | null {
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    raw.length > MAX_FORM_QUERY
  )
    return null;
  try {
    const out: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(raw)) {
      if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

export type PagePathOpts = {
  /** Forms only: a protected page re-gates anyone without the cookie, so nothing leaks. */
  allowProtected?: boolean;
  /** Pages of disabled add-ons (getAddonSiteState().hiddenPageIds): never a target. */
  hiddenPageIds?: readonly string[];
};

/**
 * This org's public path for a page id (own-property scan), or null. The 404 page and a
 * disabled add-on's page are never a target; protected pages only with allowProtected.
 */
export function pagePathFor(
  manifest: SiteManifest | null | undefined,
  pageId: unknown,
  opts: PagePathOpts = {},
): string | null {
  if (!manifest || typeof pageId !== "string" || !FORM_ID_RE.test(pageId))
    return null;
  const pages = manifest.pages;
  if (typeof pages !== "object" || pages === null) return null;
  for (const slug of Object.keys(pages)) {
    const entry = pages[slug];
    if (!entry || entry.id !== pageId) continue;
    if (slug === NOT_FOUND_PAGE_SLUG) return null;
    if (entry.protected && !opts.allowProtected) return null;
    if (opts.hiddenPageIds?.includes(pageId)) return null;
    return slug === "home" ? "/" : `/${encodeURIComponent(slug)}`;
  }
  return null;
}

/**
 * WR-C02: where a no-JS send returns to. A form on the 404 page returns to /system-404, which
 * always renders the tenant 404 page (it reads the status from FORM_QUERY_HEADER); any other
 * page to its own path (protected included); unknown -> "/".
 */
export function formReturnPathFor(
  manifest: SiteManifest | null | undefined,
  pageId: string,
  hiddenPageIds: readonly string[] = [],
): string {
  const pages = manifest?.pages;
  if (
    pages &&
    typeof pages === "object" &&
    Object.prototype.hasOwnProperty.call(pages, NOT_FOUND_PAGE_SLUG) &&
    pages[NOT_FOUND_PAGE_SLUG]?.id === pageId
  ) {
    return `/${NOT_FOUND_PAGE_SLUG}`;
  }
  return (
    pagePathFor(manifest, pageId, { allowProtected: true, hiddenPageIds }) ??
    "/"
  );
}
