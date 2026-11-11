// Our team block (owner 08-04; TMPL-01, TMPL-02).
//
// P8 (08-04): data-bound core block, CONTEXT A3-Q3, D253; content holds display options
// only; items come live from coreData; registered with its renderer and editor in 08-05.
// Team members, roles, bios and photos are read live from the org's team list
// (coreData.team, 08-08), so refsOf is empty: photos resolve through the loader (D253).
// Deny by default: only the three option keys survive.
// Pure and Edge-safe: no Node built-ins, no html cleaner, no next/* imports.
import { FULL_WIDTH_ONLY } from "../layouts";
import type { SectionTypeDefinition } from "../registry";
import { asRecord, isRecord, own, text } from "../validate-helpers";

export type TeamBlockContent = {
  heading: string;
  show_roles: boolean;
  show_bios: boolean;
};

export const TEAM_HEADING_MAX = 120;

export function defaultTeamBlock(): TeamBlockContent {
  return { heading: "Our team", show_roles: true, show_bios: true };
}

function flag(raw: Record<string, unknown>, key: string): boolean {
  const v = own(raw, key);
  return typeof v === "boolean" ? v : true;
}

export function validateTeamBlock(value: unknown): TeamBlockContent {
  const raw = asRecord(value);
  return {
    heading:
      typeof own(raw, "heading") === "string"
        ? text(raw, "heading", TEAM_HEADING_MAX)
        : defaultTeamBlock().heading,
    show_roles: flag(raw, "show_roles"),
    show_bios: flag(raw, "show_bios"),
  };
}

export const teamSection: SectionTypeDefinition = {
  type: "team",
  label: "Our team",
  description: "The people customers will meet, from your team list",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => defaultTeamBlock(),
  validate: (raw) => validateTeamBlock(raw),
  mapRichText: (content) => (isRecord(content) ? { ...content } : content),
  textsOf: (content) =>
    isRecord(content) &&
    typeof content.heading === "string" &&
    content.heading !== ""
      ? [content.heading]
      : [],
  urlsOf: () => [],
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: () => ({ popups: [], forms: [], media: [] }),
};
