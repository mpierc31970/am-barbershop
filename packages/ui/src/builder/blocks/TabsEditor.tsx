"use client";
// TabsEditor (07-20; CONT-27; 07-UI-SPEC row "Tabs" line 359; replaces the 07-06 stub
// body, name and BUILDER_BLOCKS_A entry kept).
//
// Heading · Tabs: the shared PanelListEditor (drag / Move up / Move down, Delete tab with
// an 8 s Undo, each panel edited in ColumnsEditor) with a Tab label field on every row
// (max 30, counter). Label edits go through the panel list so the Save-block handle's
// latest() sees them. 2-6 tabs: Delete is disabled at 2 (helper says why), Add at 6.
// Background stays in SectionForm. Limits come from TABS_LIMITS; the 07-06 validator is
// the authority. Hub tokens and hub primitives only.
import { useId } from "react";
import {
  TABS_LIMITS,
  defaultTabsContent,
  type TabsPanel,
} from "@cds/core/content";
import { TextField } from "../../hub/fields";
import { PanelListEditor } from "./PanelListEditor";
import type { CoreBlockEditorProps } from "./types";

const OVER_COPY = "Tabs hold up to 6 tabs.";
const MIN_COPY = "Tabs need at least 2 tabs.";

const labelOf = (t: TabsPanel, i: number) =>
  typeof t.label === "string" && t.label.trim() !== ""
    ? t.label.trim()
    : `Tab ${i + 1}`;

export function TabsEditor({
  content,
  onChange,
  errors,
  popups,
  timeZone,
  onDirtyChange,
  handleRef,
}: CoreBlockEditorProps) {
  const uid = useId();
  const heading = typeof content.heading === "string" ? content.heading : "";
  const tabs: TabsPanel[] = Array.isArray(content.tabs)
    ? (content.tabs as TabsPanel[])
    : defaultTabsContent().tabs;

  const setTabs = (next: TabsPanel[]) => onChange("tabs", next);

  return (
    <div className="flex flex-col gap-6 font-hub">
      <TextField
        id={`${uid}-heading`}
        label="Heading"
        value={heading}
        error={errors.heading}
        onChange={(e) => onChange("heading", e.currentTarget.value)}
      />
      <section aria-labelledby={`${uid}-tabs`} className="flex flex-col gap-2">
        <h3 id={`${uid}-tabs`} className="text-sm font-semibold text-hub-ink">
          Tabs
        </h3>
        {errors.tabs ? (
          <p className="text-sm text-hub-danger">{errors.tabs}</p>
        ) : null}
        <PanelListEditor<TabsPanel>
          panels={tabs}
          noun="tab"
          max={TABS_LIMITS.maxTabs}
          min={TABS_LIMITS.minTabs}
          overCopy={OVER_COPY}
          minCopy={MIN_COPY}
          rowTitle={labelOf}
          nameOf={labelOf}
          // Label edits go through the panel list, so latest() always sees them.
          renderRowExtra={(tab, _i, update) => (
            <TextField
              id={`${uid}-label-${tab.id}`}
              label="Tab label"
              maxLength={TABS_LIMITS.labelMax}
              counter={{
                value: (tab.label ?? "").length,
                max: TABS_LIMITS.labelMax,
              }}
              value={tab.label ?? ""}
              onChange={(e) => update({ label: e.currentTarget.value })}
            />
          )}
          onPanelsChange={setTabs}
          newPanel={(index) => ({
            ...defaultTabsContent().tabs[0],
            label: `Tab ${index + 1}`,
          })}
          popups={popups}
          timeZone={timeZone}
          onDirtyChange={onDirtyChange}
          handleRef={handleRef}
        />
      </section>
    </div>
  );
}
