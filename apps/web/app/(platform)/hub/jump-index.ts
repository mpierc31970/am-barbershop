// Jump-to index (11-14; DASH-28, D285, D311; 11-UI-SPEC "Jump to"; CONTEXT "Jump to"). Built
// on the server, per person, from the already grant-filtered sidebar (composeHubNav) and its
// section tabs (composeSectionTabs over HUB_SECTIONS), plus the help articles the caller
// passes (11-46: the layout passes the grant-filtered help index). Nothing here widens access:
// a screen or tab the person cannot see is not in the nav, so it is not in the index
// (T-11-14-01). Screens come first, in sidebar order (each item, then its tabs), then pinned
// rows, then help articles. A section's Jump-only actions (12-19: CDS Support › Get help ->
// /hub/support/tickets/new, support:write only) follow its tabs. 12-33: the P12 help articles
// (CDS Support tabs, notices, paid services, What support includes) arrive through the same
// help list. De-duplicated by href and capped at JUMP_INDEX_MAX entries. The
// entry shape matches `JumpEntry` in `@cds/ui/hub/shell` (11-15). No record search. Pure.
import { isHubHref } from "@cds/core/today";
import type { HubNav } from "./nav";
import type { SectionTab } from "./sections";

/** 11-46: 250 (was 150) so every help article an Owner may read fits after the screens. */
export const JUMP_INDEX_MAX = 250;

export type JumpEntry = {
  group: "Screens" | "Help articles";
  label: string;
  href: string;
  /** Extra words that match but are not shown. */
  keywords: string;
  /** The Label line under the title ("Website › Pages", "Help"). */
  path?: string;
};

export type JumpHelpEntry = { id: string; title: string; href: string };

export function buildJumpIndex(input: {
  nav: HubNav;
  /** Tabs per sidebar href (composeSectionTabs). */
  sections: Readonly<Record<string, readonly SectionTab[]>>;
  help: readonly JumpHelpEntry[];
}): JumpEntry[] {
  const out: JumpEntry[] = [];
  const seen = new Set<string>();
  const add = (e: JumpEntry) => {
    if (out.length >= JUMP_INDEX_MAX) return;
    if (!isHubHref(e.href) || seen.has(e.href)) return;
    seen.add(e.href);
    out.push(e);
  };
  for (const item of [...input.nav.items, ...input.nav.pinned]) {
    add({
      group: "Screens",
      label: item.label,
      href: item.href,
      keywords: "",
      path: item.label,
    });
    for (const tab of input.sections[item.href] ?? []) {
      add({
        group: "Screens",
        label: tab.label,
        href: tab.href,
        keywords: tab.keywords
          ? `${item.label} ${tab.id} ${tab.keywords}`
          : `${item.label} ${tab.id}`,
        path: `${item.label} › ${tab.label}`,
      });
    }
  }
  for (const h of input.help) {
    add({
      group: "Help articles",
      label: h.title,
      href: h.href,
      keywords: h.id,
      path: "Help",
    });
  }
  return out;
}
