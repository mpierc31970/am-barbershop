// Map block (owner 07-07; CONT-24, D230, CONTEXT decision 4; T-07-07-01).
//
// The owner types an address or pastes a Google Maps link. We store only the extracted
// place query, never a URL or iframe html (D281): the embed URL is built at render time
// by 07-24's MapEmbed port from this query. "" means "use the business address", filled
// at render from coreData.business (07-24). Renderer and editor: 07-24.
// Link parsing is strict: http(s) only, no userinfo, an anchored google host, a /maps
// path (unless the host is maps.google.*), short goo.gl links refused (we cannot follow
// redirects safely from a validator).
// Deny by default: fresh objects, own-property reads, trimmed and capped strings.
// Pure and Edge-safe: no Node built-ins, no html cleaner, no next/* imports.
import { InvalidInput } from "../../errors";
import { nonEmpty } from "../items/walk";
import { FULL_WIDTH_ONLY } from "../layouts";
import type { SectionTypeDefinition } from "../registry";
import { asRecord, capped, isRecord, own, text } from "../validate-helpers";

/** Same shape as @cds/db p7-ports MapQuery (core never imports db). */
export type MapQuery = { query: string };

export type MapBlockContent = {
  heading: string;
  /** A parsed place query; "" = use the business address. */
  location: string;
  show_directions: boolean;
};

export const MAP_HEADING_MAX = 120;
export const MAP_LOCATION_MAX = 300;
/** A pasted link may be long (place URLs carry data= blobs); the stored query is capped at 300. */
const MAP_LINK_INPUT_MAX = 2048;
export const MAP_LINK_COPY = "Paste an address or a Google Maps link.";
export const MAP_SHORT_LINK_COPY =
  "Short map links can't be read here. Type the address instead.";

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const GOOGLE_HOST = /^(?:www\.|maps\.)?google\.(?:[a-z]{2,3})(?:\.[a-z]{2})?$/;
const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);
const COORDS = /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/;

function clean(value: string): string {
  return capped(
    value
      .replace(/\s+/g, " ")
      .replace(CONTROL, "")
      .replace(/ {2,}/g, " ")
      .trim(),
    MAP_LOCATION_MAX,
  );
}

function decodeSegment(segment: string): string {
  const plus = segment.replace(/\+/g, " ");
  try {
    return decodeURIComponent(plus);
  } catch {
    return plus;
  }
}

function queryFromUrl(url: URL): string {
  for (const key of ["q", "query", "destination"]) {
    const v = url.searchParams.get(key);
    if (v !== null && v.trim() !== "") return v;
  }
  const place = /^\/maps\/(?:place|search)\/([^/]+)/.exec(url.pathname);
  if (place?.[1]) {
    const decoded = decodeSegment(place[1]);
    if (decoded.trim() !== "") return decoded;
  }
  const at = COORDS.exec(url.pathname);
  if (at) {
    const lat = Number(at[1]);
    const lng = Number(at[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return `${at[1]},${at[2]}`;
    }
  }
  return "";
}

/**
 * A plain address or a Google Maps link -> { query }. Blank or non-string -> null.
 * A link that is not a readable Google Maps link throws InvalidInput.
 */
export function parseMapLink(input: unknown): MapQuery | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!SCHEME.test(trimmed)) {
    const query = clean(trimmed);
    return query === "" ? null : { query };
  }
  capped(trimmed, MAP_LINK_INPUT_MAX);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InvalidInput(MAP_LINK_COPY);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InvalidInput(MAP_LINK_COPY);
  }
  if (url.username !== "" || url.password !== "") {
    throw new InvalidInput(MAP_LINK_COPY);
  }
  const host = url.hostname.toLowerCase();
  if (SHORT_HOSTS.has(host)) throw new InvalidInput(MAP_SHORT_LINK_COPY);
  if (!GOOGLE_HOST.test(host)) throw new InvalidInput(MAP_LINK_COPY);
  if (!host.startsWith("maps.") && !/^\/maps(?:\/|$)/.test(url.pathname)) {
    throw new InvalidInput(MAP_LINK_COPY);
  }
  const query = clean(queryFromUrl(url));
  if (query === "") throw new InvalidInput(MAP_LINK_COPY);
  return { query };
}

export function defaultMapBlock(): MapBlockContent {
  return { heading: "Find us", location: "", show_directions: true };
}

export function validateMapBlock(value: unknown): MapBlockContent {
  const raw = asRecord(value);
  const sd = own(raw, "show_directions");
  return {
    heading: text(raw, "heading", MAP_HEADING_MAX),
    location: parseMapLink(own(raw, "location"))?.query ?? "",
    show_directions: typeof sd === "boolean" ? sd : true,
  };
}

function str(content: unknown, key: string): string {
  if (!isRecord(content)) return "";
  const v = own(content, key);
  return typeof v === "string" ? v : "";
}

export const mapSection: SectionTypeDefinition = {
  type: "map",
  label: "Map",
  description: "Where to find you, with directions",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => defaultMapBlock(),
  validate: (raw) => validateMapBlock(raw),
  mapRichText: (content) => (isRecord(content) ? { ...content } : content),
  textsOf: (content) =>
    nonEmpty([str(content, "heading"), str(content, "location")]),
  urlsOf: () => [],
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: () => ({ popups: [], forms: [], media: [] }),
};

// 07-24 (choice 4): the address query and the directions link live here, so the renderer
// and the db MapEmbed port share one builder (the frame URL lives only in mapFrameUrl).

/** A business address object -> "12 Main St, Austin, TX 78701"; "" when unusable. */
export function mapAddressQuery(address: unknown): string {
  if (!isRecord(address)) return "";
  const part = (k: string): string => {
    const v = own(address, k);
    return typeof v === "string" ? v.replace(CONTROL, "").trim() : "";
  };
  const street = part("street");
  const city = part("city");
  const stateZip = [part("state"), part("zip")]
    .filter((s) => s !== "")
    .join(" ");
  return [street, city, stateZip]
    .filter((s) => s !== "")
    .join(", ")
    .slice(0, MAP_LOCATION_MAX);
}

/** Google Maps directions to a place (no key, no script); "" for a blank query. */
export function mapDirectionsUrl(query: string): string {
  if (typeof query !== "string") return "";
  const q = query.replace(CONTROL, "").trim().slice(0, MAP_LOCATION_MAX);
  if (q === "") return "";
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}
