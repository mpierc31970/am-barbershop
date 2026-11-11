// Tabs block (owner 07-06; CONT-27; CONTEXT decisions 1, 2 and 5).
//
// Each tab is a labelled columns row validated by validatePanels with pop-up buttons
// allowed. Up to 6 tabs; the 2-tab minimum is an editor/renderer rule (UI-SPEC: "fewer
// than 2 left -> the one panel renders without a tablist"), so drafts stay saveable.
// A blank label becomes "Tab N". Renderer and TabsEditor: 07-20.
// Deny by default: fresh objects, own-property reads, trimmed and capped strings.
// Pure and Edge-safe: no node:, no sanitizer, no next/* imports.
import { nonEmpty } from "../items/walk";
import { FULL_WIDTH_ONLY } from "../layouts";
import type { SectionTypeDefinition } from "../registry";
import { asRecord, isRecord, own, text } from "../validate-helpers";
import {
  clonePanelFreshIds,
  mapPanelsRichText,
  newPanel,
  panelsRefs,
  panelsTexts,
  panelsUrls,
  validatePanels,
  type PanelRow,
} from "./helpers-a";

export type TabsPanel = PanelRow & { label: string };

export type TabsContent = {
  heading: string;
  tabs: TabsPanel[];
};

/** minTabs is an editor/renderer rule, not enforced by the validator. */
export const TABS_LIMITS = Object.freeze({
  minTabs: 2,
  maxTabs: 6,
  startTabs: 2,
  labelMax: 30,
} as const);

const OVER_COPY = "Tabs hold up to 6 tabs.";

export function defaultTabsContent(): TabsContent {
  return {
    heading: "",
    tabs: [
      { ...newPanel(), label: "First tab" },
      { ...newPanel(), label: "Second tab" },
    ],
  };
}

export function validateTabsContent(value: unknown): TabsContent {
  const raw = asRecord(value);
  const panels = validatePanels(raw, "tabs", TABS_LIMITS.maxTabs, OVER_COPY);
  const rawTabs = own(raw, "tabs") as unknown[];
  const tabs = panels.map((panel, i) => {
    const label = text(asRecord(rawTabs[i]), "label", TABS_LIMITS.labelMax);
    return { ...panel, label: label === "" ? `Tab ${i + 1}` : label };
  });
  return { heading: text(raw, "heading"), tabs };
}

// ---- Render and editor helpers (07-20) ----

function hasItems(panel: unknown): boolean {
  if (!isRecord(panel) || !Array.isArray(panel.columns)) return false;
  return panel.columns.some(
    (col: unknown) =>
      isRecord(col) && Array.isArray(col.items) && col.items.length > 0,
  );
}

/** The tabs a visitor sees: tabs with empty panels dropped; defensive on any input. */
export function tabsVisiblePanels(content: unknown): TabsPanel[] {
  const tabs = isRecord(content) ? content.tabs : undefined;
  return Array.isArray(tabs) ? (tabs.filter(hasItems) as TabsPanel[]) : [];
}

/** Duplicate a tab (label kept): a fresh-id copy after the source; unchanged at 6. */
export function duplicateTabsPanel(
  content: TabsContent,
  tabId: string,
): TabsContent {
  const tabs = Array.isArray(content.tabs) ? content.tabs : [];
  const at = tabs.findIndex((t) => t.id === tabId);
  if (at < 0 || tabs.length >= TABS_LIMITS.maxTabs) return content;
  const next = [...tabs];
  next.splice(at + 1, 0, clonePanelFreshIds(tabs[at]));
  return { ...content, tabs: next };
}

function tabsOf(content: unknown): unknown {
  return isRecord(content) ? content.tabs : [];
}

export const tabsSection: SectionTypeDefinition = {
  type: "tabs",
  label: "Tabs",
  description: "Content split under a few tabs",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => defaultTabsContent(),
  validate: (raw) => validateTabsContent(raw),
  mapRichText: (content, fn) => {
    const c = content as TabsContent;
    return { ...c, tabs: mapPanelsRichText<TabsPanel>(c?.tabs, fn) };
  },
  textsOf: (content) => {
    const tabs = tabsOf(content);
    const labels = Array.isArray(tabs)
      ? tabs.filter(isRecord).map((t) => t.label as string)
      : [];
    return nonEmpty([
      isRecord(content) ? (content.heading as string) : "",
      ...labels,
      ...panelsTexts(tabs),
    ]);
  },
  urlsOf: (content) => panelsUrls(tabsOf(content)),
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: (content) => panelsRefs(tabsOf(content)),
};
