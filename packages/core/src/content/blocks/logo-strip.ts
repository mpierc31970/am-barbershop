// Logo strip block (owner 07-06; CONT-27; CONTEXT decisions 1, 2 and 5).
//
// Logos are media asset ids (org-scoped on save via refsOf().media and 07-04's
// assertRefsOwned, T-07-06-01), each with a required name (it is the image description,
// like imagePair's alt rule) and an optional link through safeHref (`javascript:` -> "",
// T-07-06-02). Renderer and editor: 07-22.
// Deny by default: fresh objects, own-property reads, trimmed and capped strings.
// Pure and Edge-safe: no node:, no sanitizer, no next/* imports.
import { InvalidInput } from "../../errors";
import { nonEmpty } from "../items/walk";
import { FULL_WIDTH_ONLY } from "../layouts";
import type { SectionTypeDefinition } from "../registry";
import { safeHref } from "../validate";
import { asRecord, isRecord, own, safeId, text } from "../validate-helpers";
import {
  assertUniqueIds,
  assetId,
  bool,
  boundedArray,
  mediaRefs,
} from "./helpers-a";

export type LogoStripLogo = {
  id: string;
  /** Media asset id (org-scoped on save). */
  asset: string;
  /** Read out to people who can't see the logo. Required. */
  name: string;
  /** Optional safe link; "" = not a link. */
  link: string;
};

export type LogoStripContent = {
  heading: string;
  grayscale: boolean;
  logos: LogoStripLogo[];
};

export const LOGO_STRIP_LIMITS = Object.freeze({
  maxLogos: 16,
  nameMax: 120,
} as const);

/** Validator and editor share these (07-22 decision 11). */
export const LOGO_STRIP_MAX_COPY = "A logo strip holds up to 16 logos.";
export const LOGO_STRIP_NAME_COPY =
  "Give each logo a name. It is read out to people who can't see it.";
const ASSET_COPY = "Pick each logo from your media.";

export function defaultLogoStripContent(): LogoStripContent {
  return { heading: "", grayscale: false, logos: [] };
}

/** safeHref, but an unsafe link is blanked rather than refused. */
function softHref(value: unknown): string {
  try {
    return safeHref(value);
  } catch {
    return "";
  }
}

function validateLogo(value: unknown): LogoStripLogo {
  const raw = asRecord(value);
  const name = text(raw, "name", LOGO_STRIP_LIMITS.nameMax);
  if (name === "") throw new InvalidInput(LOGO_STRIP_NAME_COPY);
  return {
    id: safeId(own(raw, "id")),
    asset: assetId(own(raw, "asset"), ASSET_COPY),
    name,
    link: softHref(own(raw, "link")),
  };
}

export function validateLogoStripContent(value: unknown): LogoStripContent {
  const raw = asRecord(value);
  const logos = boundedArray(
    raw,
    "logos",
    LOGO_STRIP_LIMITS.maxLogos,
    LOGO_STRIP_MAX_COPY,
  ).map(validateLogo);
  assertUniqueIds(logos);
  return {
    heading: text(raw, "heading"),
    grayscale: bool(raw, "grayscale", false),
    logos,
  };
}

function logosOf(content: unknown): LogoStripLogo[] {
  return isRecord(content) && Array.isArray(content.logos)
    ? (content.logos.filter(isRecord) as LogoStripLogo[])
    : [];
}

export const logoStripSection: SectionTypeDefinition = {
  type: "logo-strip",
  label: "Logo strip",
  description: "Logos of clients, partners or press",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => defaultLogoStripContent(),
  validate: (raw) => validateLogoStripContent(raw),
  mapRichText: (content) => ({ ...(content as LogoStripContent) }),
  textsOf: (content) =>
    nonEmpty([
      isRecord(content) ? (content.heading as string) : "",
      ...logosOf(content).map((l) => l.name),
    ]),
  urlsOf: (content) => nonEmpty(logosOf(content).map((l) => l.link)),
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: (content) =>
    mediaRefs(nonEmpty(logosOf(content).map((l) => l.asset))),
};
