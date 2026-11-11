// Marketing › Contacts URL params (07-16; CONTACTS-01/02, D-UI-P7-21; 07-UI-SPEC "Contacts";
// T-07-16-03, T-07-16-10). Pure: no next imports, safe on server and client.
// Filters live in the URL (`?tab=contacts&q=&source=&tag=&newsletter=&list=&sort=&page=&contact=`)
// so Back and refresh keep them. A hand-edited URL never breaks the page: listContacts throws
// InvalidInput on unknown filter values, so unknown values are dropped here, never thrown.
// Hrefs are built from this closed key set on the fixed /hub/marketing path only.

const ID = /^[a-z0-9]{1,32}$/i;
const Q_MAX = 100;
const TAG_MAX = 40;
const PAGE_MAX = 10_000;

export const CONTACTS_PER_PAGE = 50;

const SOURCES = new Set([
  "form",
  "booking",
  "subscribe",
  "registration",
  "purchase",
  "import",
  "manual",
]);

export type ContactsConsentFilter =
  "subscribed" | "unconfirmed" | "unsubscribed" | "none";

const CONSENTS = new Set<string>([
  "subscribed",
  "unconfirmed",
  "unsubscribed",
  "none",
]);

export type ContactsParams = {
  q?: string;
  source?: string;
  tag?: string;
  /** URL key `newsletter`; the chokepoint's `consent` option. */
  consent?: ContactsConsentFilter;
  sort?: "last_seen" | "name";
  page?: number;
  /** A contact id, or "new" for the Add contact drawer. */
  contact?: string;
  list?: string;
};

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" ? x : undefined;
}

export function parseContactsParams(sp: RawParams): ContactsParams {
  const out: ContactsParams = {};
  const q = first(sp.q)?.trim().slice(0, Q_MAX).trim();
  if (q) out.q = q;
  const source = first(sp.source);
  if (source && SOURCES.has(source)) out.source = source;
  const tag = first(sp.tag)?.trim();
  if (tag && tag.length <= TAG_MAX) out.tag = tag;
  const consent = first(sp.newsletter);
  if (consent && CONSENTS.has(consent)) {
    out.consent = consent as ContactsConsentFilter;
  }
  const sort = first(sp.sort);
  if (sort === "name" || sort === "last_seen") out.sort = sort;
  const page = first(sp.page);
  if (page && /^\d{1,6}$/.test(page)) {
    const n = Number(page);
    if (n >= 1 && n <= PAGE_MAX) out.page = n;
  }
  const contact = first(sp.contact);
  if (contact && (contact === "new" || ID.test(contact))) out.contact = contact;
  const list = first(sp.list);
  if (list && ID.test(list)) out.list = list;
  return out;
}

/** Keys whose change starts the list over at page 1. */
const FILTER_KEYS = ["q", "source", "tag", "consent", "list", "sort"] as const;

export type ContactsPatch = {
  [K in keyof ContactsParams]?: ContactsParams[K] | null;
};

/** True when any search or filter is set (Clear filters, the filtered empty state). */
export function hasFilters(p: ContactsParams): boolean {
  return Boolean(p.q || p.source || p.tag || p.consent || p.list);
}

/** `/hub/marketing?tab=contacts&…` from the closed key set; empty values are dropped. */
export function contactsHref(
  params: ContactsParams,
  patch: ContactsPatch = {},
): string {
  const next: ContactsParams = { ...pickKnown(params) };
  let filterChanged = false;
  for (const [k, v] of Object.entries(patch) as [
    keyof ContactsParams,
    unknown,
  ][]) {
    if (!KNOWN.has(k)) continue;
    if ((FILTER_KEYS as readonly string[]).includes(k) && next[k] !== v) {
      filterChanged = true;
    }
    if (v === null || v === undefined || v === "") {
      delete next[k];
    } else {
      (next as Record<string, unknown>)[k] = v;
    }
  }
  if (filterChanged && !Object.hasOwn(patch, "page")) delete next.page;

  const qs = new URLSearchParams();
  qs.set("tab", "contacts");
  if (next.q) qs.set("q", next.q);
  if (next.source) qs.set("source", next.source);
  if (next.tag) qs.set("tag", next.tag);
  if (next.consent) qs.set("newsletter", next.consent);
  if (next.list) qs.set("list", next.list);
  if (next.sort && next.sort !== "last_seen") qs.set("sort", next.sort);
  if (typeof next.page === "number" && next.page > 1) {
    qs.set("page", String(next.page));
  }
  if (next.contact) qs.set("contact", next.contact);
  return `/hub/marketing?${qs.toString()}`;
}

const KNOWN = new Set<string>([
  "q",
  "source",
  "tag",
  "consent",
  "sort",
  "page",
  "contact",
  "list",
]);

function pickKnown(p: ContactsParams): ContactsParams {
  const out: Record<string, unknown> = {};
  for (const k of KNOWN) {
    const v = (p as Record<string, unknown>)[k];
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out as ContactsParams;
}
