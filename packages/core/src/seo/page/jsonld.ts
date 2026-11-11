// JSON-LD for one tenant page: one @graph, one escaped script (07-30 choice 3; CONT-13,
// CONT-17, D188, D253; Pitfall 15; T-07-30-01, T-07-30-10).
//
// Built at request time from live data passed in by the route (business profile, published
// services and team, the published page's sections, resolved media): never baked into the
// published JSON (D253). The graph holds the LocalBusiness node (schema.org subtype from the
// business type, @id <origin>/#business, on every page), WebPage + BreadcrumbList, FAQPage
// when the page has answered FAQ items, one VideoObject per titled video item that has a
// thumbnail (Google requires one), and active add-ons' nodes after sanitizeAddonNodes.
// Missing data omits its key; never an empty string or a null.
//
// serializeJsonLd escapes < > & U+2028 U+2029 after JSON.stringify, so a tenant string such
// as "</script>" can never close the script (Pitfall 15).
// Pure, Edge-safe (07-02 header rule): no node:, no html cleaner, no next/* imports.
import { faqEntries, type FaqBlockContent } from "../../content/blocks/faq";
import { mediaLinkFrom } from "../../content/media-link";
import { htmlToPlainText } from "../../content/plain-text";
import type { PublishedSection } from "../../content/types";
import { DAYS, type Day } from "../../intake/stages";
import { schemaTypeFor } from "./business-schema";
import { absoluteUrl } from "./meta";
import { sectionItems, visibleSections } from "./content-walk";

export type JsonLdHours = Partial<
  Record<Day, { open?: unknown; ranges?: unknown }>
> | null;

export type JsonLdBusiness = {
  name: string;
  businessType: string;
  phone?: string;
  email?: string;
  address?: { street?: string; city?: string; state?: string; zip?: string };
  timeZone?: string;
  hours?: JsonLdHours;
  socials: readonly { url: string }[];
  logoUrl?: string;
};

export type JsonLdMedia = Readonly<
  Record<
    string,
    { src: string; poster?: string; width?: number; height?: number }
  >
>;

export type JsonLdInput = {
  /** https://<primary host>, no trailing slash. */
  origin: string;
  /** The canonical URL of this page. */
  pageUrl: string;
  page: { title: string; slug: string; isHome: boolean; publishedAt: string };
  business: JsonLdBusiness | null;
  services: readonly {
    name: string;
    description?: string;
    priceCents?: number | null;
    priceDisplay?: string;
  }[];
  team: readonly { name: string; role?: string }[];
  sections: readonly PublishedSection[] | readonly unknown[];
  media: JsonLdMedia;
  addonNodes: readonly unknown[];
};

export type JsonLdGraph = {
  "@context": "https://schema.org";
  "@graph": Record<string, unknown>[];
};

const DAY_NAMES: Readonly<Record<Day, string>> = Object.freeze({
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
});

const HHMM = /^([01]\d|2[0-4]):[0-5]\d$/;
const MAX_STRING = 5000;
const MAX_ADDON_NODES = 20;
const MAX_DEPTH = 6;

function s(v: unknown, max = 1000): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Sets key only when the value is a non-empty string / array / object. */
function put(out: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value === "string" && value === "") return;
  if (Array.isArray(value) && value.length === 0) return;
  out[key] = value;
}

function openingHours(
  hours: JsonLdHours | undefined,
): Record<string, unknown>[] {
  if (!hours || typeof hours !== "object") return [];
  const out: Record<string, unknown>[] = [];
  for (const day of DAYS) {
    const d = Object.hasOwn(hours, day) ? hours[day] : undefined;
    if (!d || d.open !== true || !Array.isArray(d.ranges)) continue;
    for (const r of d.ranges as unknown[]) {
      if (typeof r !== "object" || r === null) continue;
      const opens = s((r as { start?: unknown }).start);
      const closes = s((r as { end?: unknown }).end);
      if (!HHMM.test(opens) || !HHMM.test(closes)) continue;
      out.push({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: `https://schema.org/${DAY_NAMES[day]}`,
        opens,
        closes,
      });
    }
  }
  return out;
}

function businessNode(input: JsonLdInput, id: string): Record<string, unknown> {
  const b = input.business!;
  const node: Record<string, unknown> = {
    "@type": schemaTypeFor(b.businessType),
    "@id": id,
  };
  put(node, "name", s(b.name));
  node.url = `${input.origin}/`;
  const logo = absoluteUrl(input.origin, b.logoUrl);
  if (logo) {
    node.logo = logo;
    node.image = logo;
  }
  put(node, "telephone", s(b.phone, 40));
  put(node, "email", s(b.email, 200));
  const a = b.address;
  if (a && [a.street, a.city, a.state, a.zip].some((v) => s(v) !== "")) {
    const addr: Record<string, unknown> = { "@type": "PostalAddress" };
    put(addr, "streetAddress", s(a.street));
    put(addr, "addressLocality", s(a.city));
    put(addr, "addressRegion", s(a.state));
    put(addr, "postalCode", s(a.zip, 20));
    addr.addressCountry = "US";
    node.address = addr;
  }
  put(node, "openingHoursSpecification", openingHours(b.hours));
  put(
    node,
    "sameAs",
    (Array.isArray(b.socials) ? b.socials : [])
      // Absolute http(s) profiles only: a relative link is not another profile.
      .map((x) =>
        /^https?:\/\//i.test(s(x?.url))
          ? absoluteUrl(input.origin, x?.url)
          : null,
      )
      .filter((u): u is string => u !== null),
  );
  put(
    node,
    "makesOffer",
    (Array.isArray(input.services) ? input.services : [])
      .filter((x) => s(x?.name) !== "")
      .map((x) => {
        const service: Record<string, unknown> = {
          "@type": "Service",
          name: s(x.name),
        };
        put(service, "description", s(x.description, 500));
        const offer: Record<string, unknown> = {
          "@type": "Offer",
          itemOffered: service,
        };
        if (
          typeof x.priceCents === "number" &&
          Number.isFinite(x.priceCents) &&
          x.priceCents >= 0
        ) {
          offer.priceSpecification = {
            "@type": "PriceSpecification",
            price: (Math.round(x.priceCents) / 100).toFixed(2),
            priceCurrency: "USD",
          };
        }
        return offer;
      }),
  );
  put(
    node,
    "employee",
    (Array.isArray(input.team) ? input.team : [])
      .filter((x) => s(x?.name) !== "")
      .map((x) => {
        const p: Record<string, unknown> = {
          "@type": "Person",
          name: s(x.name),
        };
        put(p, "jobTitle", s(x.role, 200));
        return p;
      }),
  );
  return node;
}

function faqNode(
  input: JsonLdInput,
  sections: ReturnType<typeof visibleSections>,
): Record<string, unknown> | null {
  const questions: Record<string, unknown>[] = [];
  for (const sec of sections) {
    if (sec.section_type !== "faq") continue;
    try {
      for (const e of faqEntries(sec.content as FaqBlockContent)) {
        const answer = htmlToPlainText(e.answer);
        const name = s(e.question, 300);
        if (name === "" || answer === "") continue;
        questions.push({
          "@type": "Question",
          name,
          acceptedAnswer: {
            "@type": "Answer",
            text: answer.slice(0, MAX_STRING),
          },
        });
      }
    } catch {
      // A malformed FAQ block adds nothing.
    }
  }
  if (questions.length === 0) return null;
  return {
    "@type": "FAQPage",
    "@id": `${input.pageUrl}#faq`,
    mainEntity: questions,
  };
}

function videoNodes(
  input: JsonLdInput,
  sections: ReturnType<typeof visibleSections>,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const media = input.media ?? {};
  const mediaOf = (id: unknown) =>
    typeof id === "string" && id !== "" && Object.hasOwn(media, id)
      ? media[id]
      : undefined;
  for (const sec of sections) {
    for (const item of sectionItems(sec)) {
      try {
        if (item.kind !== "video") continue;
        const name = s(item.title, 300);
        if (name === "") continue;
        const cover = mediaOf(item.cover);
        let contentUrl: string | null = null;
        let embedUrl: string | null = null;
        let thumb: string | null = absoluteUrl(input.origin, cover?.src);
        if (item.source === "media") {
          const asset = mediaOf(item.asset);
          contentUrl = absoluteUrl(input.origin, asset?.src);
          thumb ??= absoluteUrl(input.origin, asset?.poster);
        } else {
          embedUrl =
            mediaLinkFrom(item.provider, item.provider_id)?.embedUrl ?? null;
        }
        if (!thumb || (!contentUrl && !embedUrl)) continue;
        const node: Record<string, unknown> = {
          "@type": "VideoObject",
          name,
          description: name,
          thumbnailUrl: thumb,
        };
        put(node, "uploadDate", s(input.page.publishedAt, 40));
        put(node, "contentUrl", contentUrl ?? "");
        put(node, "embedUrl", embedUrl ?? "");
        out.push(node);
      } catch {
        // A malformed item adds nothing.
      }
    }
  }
  return out;
}

/** The page's @graph: business, WebPage, breadcrumbs, FAQ, videos, add-on nodes. */
export function buildJsonLd(input: JsonLdInput): JsonLdGraph {
  const graph: Record<string, unknown>[] = [];
  const businessId = `${input.origin}/#business`;
  const hasBusiness = input.business !== null && s(input.business?.name) !== "";
  if (hasBusiness) graph.push(businessNode(input, businessId));

  const sections = visibleSections(input.sections);
  const title = s(input.page.title, 300);
  const webPage: Record<string, unknown> = {
    "@type": "WebPage",
    "@id": `${input.pageUrl}#webpage`,
    url: input.pageUrl,
  };
  put(webPage, "name", title);
  const site: Record<string, unknown> = {
    "@type": "WebSite",
    "@id": `${input.origin}/#website`,
    url: `${input.origin}/`,
  };
  if (hasBusiness) put(site, "name", s(input.business?.name));
  webPage.isPartOf = site;
  if (hasBusiness) webPage.about = { "@id": businessId };
  put(webPage, "dateModified", s(input.page.publishedAt, 40));
  graph.push(webPage);

  if (!input.page.isHome) {
    graph.push({
      "@type": "BreadcrumbList",
      "@id": `${input.pageUrl}#breadcrumb`,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: `${input.origin}/`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: title || input.page.slug,
          item: input.pageUrl,
        },
      ],
    });
  }

  const faq = faqNode(input, sections);
  if (faq) graph.push(faq);
  graph.push(...videoNodes(input, sections));
  graph.push(...sanitizeAddonNodes(input.addonNodes));
  return { "@context": "https://schema.org", "@graph": graph };
}

const LINE_SEP = new RegExp(String.fromCharCode(0x2028), "g");
const PARA_SEP = new RegExp(String.fromCharCode(0x2029), "g");

/** JSON for a <script type="application/ld+json">: < > & U+2028 U+2029 escaped. */
export function serializeJsonLd(graph: unknown): string {
  return JSON.stringify(graph)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LINE_SEP, "\\u2028")
    .replace(PARA_SEP, "\\u2029");
}

class Drop extends Error {}

function copy(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) throw new Drop();
  if (value === null) return null;
  switch (typeof value) {
    case "string":
      return value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "boolean":
      return value;
    case "object":
      break;
    default:
      return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((v) => copy(v, depth + 1))
      .filter((v) => v !== undefined);
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as object).slice(0, 100)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype")
      continue;
    const v = copy((value as Record<string, unknown>)[key], depth + 1);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Add-on nodes made safe: plain objects with a string @type, depth <= 6, <= 20 nodes. */
export function sanitizeAddonNodes(raw: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let list: unknown[];
  try {
    if (!Array.isArray(raw)) return out;
    list = raw.slice(0, 200);
  } catch {
    return out;
  }
  for (const node of list) {
    if (out.length >= MAX_ADDON_NODES) break;
    try {
      if (typeof node !== "object" || node === null || Array.isArray(node))
        continue;
      const clean = copy(node, 1) as Record<string, unknown>;
      const type = clean["@type"];
      if (typeof type !== "string" || type.trim() === "") continue;
      out.push(clean);
    } catch {
      // Hostile node (throwing getter, cycle, too deep): dropped.
    }
  }
  return out;
}
