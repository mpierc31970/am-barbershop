// Ticket form rules (D94): which types a role may file, and the target picker. Targets are
// validated against server-built options, never trusted from the client (T-12-03-02).
import { InvalidInput } from "../errors";
import { SUPPORT_COPY } from "./copy";
import type { OrgRole } from "../roles";
import type { SitePart, TargetRef, TicketType } from "./types";

export const SITE_PARTS: readonly { key: SitePart; label: string }[] = [
  { key: "header", label: "Header" },
  { key: "footer", label: "Footer" },
  { key: "menus", label: "Menus" },
];

export const WHOLE_SITE: TargetRef = {
  kind: "site",
  id: "site",
  label: "Whole site",
};

/**
 * Owner/Admin: every type incl. billing. Editor: no billing. Viewer, and grants-only roles
 * (staff, renter; P12-P11): none.
 */
export function ticketTypesFor(role: OrgRole | null | undefined): TicketType[] {
  switch (role) {
    case "owner":
    case "admin":
      return ["problem", "change", "question", "billing", "suggestion"];
    case "editor":
      return ["problem", "change", "question", "suggestion"];
    default:
      return [];
  }
}

export type TargetGroup = {
  label: "Your site" | "Pages" | "Add-ons" | "Site parts";
  options: TargetRef[];
};

/** The picker's optgroups. Pass the org's live pages and active add-ons only. */
export function buildTargetOptions(input: {
  pages: readonly { id: string; title: string }[];
  addons: readonly { slug: string; name: string }[];
}): TargetGroup[] {
  const groups: TargetGroup[] = [{ label: "Your site", options: [WHOLE_SITE] }];
  if (input.pages.length > 0) {
    groups.push({
      label: "Pages",
      options: input.pages.map((p) => ({
        kind: "page",
        id: p.id,
        label: p.title,
      })),
    });
  }
  if (input.addons.length > 0) {
    groups.push({
      label: "Add-ons",
      options: input.addons.map((a) => ({
        kind: "addon",
        id: a.slug,
        label: a.name,
      })),
    });
  }
  groups.push({
    label: "Site parts",
    options: SITE_PARTS.map((p) => ({
      kind: "part",
      id: p.key,
      label: p.label,
    })),
  });
  return groups;
}

/**
 * Accepts `{kind,id}` or a `kind:id` string; returns the server's own option (its label, never
 * the client's). Missing input means Whole site.
 */
export function validateTarget(
  raw: unknown,
  options: readonly TargetGroup[],
): TargetRef {
  if (raw === undefined || raw === null || raw === "") return WHOLE_SITE;
  let kind: unknown;
  let id: unknown;
  if (typeof raw === "string") {
    const i = raw.indexOf(":");
    if (i < 0) throw new InvalidInput(SUPPORT_COPY.TARGET_UNKNOWN);
    kind = raw.slice(0, i);
    id = raw.slice(i + 1);
  } else if (typeof raw === "object") {
    kind = (raw as { kind?: unknown }).kind;
    id = (raw as { id?: unknown }).id;
  }
  if (typeof kind !== "string" || typeof id !== "string") {
    throw new InvalidInput(SUPPORT_COPY.TARGET_UNKNOWN);
  }
  for (const g of options) {
    for (const o of g.options) {
      if (o.kind === kind && o.id === id) return { ...o };
    }
  }
  throw new InvalidInput(SUPPORT_COPY.TARGET_UNKNOWN);
}
