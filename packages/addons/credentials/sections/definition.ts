// The Credentials block (ADDON-02, ADDON-08; D36, D253; invariants 5 and 6). Pure. The block
// holds settings only; the credentials themselves are live data resolved at render
// (server.ts blockData). Full width only: layout belongs to the container.
import { InvalidInput } from "@cds/core";
import {
  FULL_WIDTH_ONLY,
  emptyRefs,
  type SectionTypeDefinition,
} from "@cds/core/content";

export type CredentialsBlockContent = {
  heading: string;
  group_by_category: boolean;
};

declare module "@cds/core/content" {
  interface SectionTypeMap {
    credentials: CredentialsBlockContent;
  }
}

export const HEADING_MAX = 120;
export const DEFAULT_HEADING = "Credentials";

export function defaultCredentialsContent(): CredentialsBlockContent {
  return { heading: DEFAULT_HEADING, group_by_category: true };
}

const own = (o: object, k: string): unknown =>
  Object.prototype.hasOwnProperty.call(o, k)
    ? (o as Record<string, unknown>)[k]
    : undefined;

/**
 * Heading: a string is trimmed and capped (the owner may clear it); anything else falls back
 * to "Credentials". Group by category: a boolean, else on.
 */
export function validateCredentialsContent(
  raw: unknown,
): CredentialsBlockContent {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidInput("malformed credentials block");
  }
  const heading = own(raw, "heading");
  const group = own(raw, "group_by_category");
  return {
    heading:
      typeof heading === "string"
        ? heading.trim().slice(0, HEADING_MAX)
        : DEFAULT_HEADING,
    group_by_category: typeof group === "boolean" ? group : true,
  };
}

export const credentialsSection: SectionTypeDefinition = {
  type: "credentials",
  label: "Credentials",
  description: "Your licenses and memberships, grouped",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => defaultCredentialsContent(),
  validate: (raw) => validateCredentialsContent(raw),
  mapRichText: (content) => ({ ...(content as CredentialsBlockContent) }),
  textsOf: (content) =>
    [(content as CredentialsBlockContent).heading].filter(
      (t) => typeof t === "string" && t !== "",
    ),
  urlsOf: () => [],
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: () => emptyRefs(),
};
