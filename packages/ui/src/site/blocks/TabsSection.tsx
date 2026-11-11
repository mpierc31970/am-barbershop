// TabsSection: the published tabs block (07-20; CONT-27; 07-UI-SPEC row "Tabs" line
// 359; replaces the 07-06 stub body, name and SITE_BLOCKS_A entry kept).
//
// Tabs with empty panels are dropped; none left renders nothing; one left renders its
// panel without a tablist. Two or more go to the TabsController island as server-rendered
// nodes (07-20 decision 1). Panel headings demote to <h3> under a block heading
// (decision 8); the no-JS label headings are <h3> under it, else <h2>. No-JS view
// (decision 2): one constant <noscript><style> hides the tablist and shows every panel
// under its label. The CSS is a constant: no owner input reaches it. Server component.
import { tabsVisiblePanels, type TabsContent } from "@cds/core/content";
import { RowRenderer } from "../RowRenderer";
import { TabsController } from "../client/TabsController";
import { HEADING_CLASSES, type SectionComponentProps } from "../types";
import { PanelColumns } from "./PanelColumns";

/** No-JS fallback: no tablist; every panel shows in order under its label heading. */
export const TABS_NOSCRIPT_CSS =
  "[data-cds-tabs] [role=tablist]{display:none}" +
  "[data-cds-tabs] [role=tabpanel]{display:block}" +
  "[data-cds-tabs] [data-tab-label]{display:block}";

export function TabsSection({
  content,
  background,
  isFirst,
  now,
  openablePopups,
  coreData,
}: SectionComponentProps<TabsContent>) {
  const tabs = tabsVisiblePanels(content);
  if (tabs.length === 0) return null;

  const heading =
    typeof content?.heading === "string" ? content.heading.trim() : "";
  const headingId = heading ? `cds-tabs-${tabs[0].id}` : undefined;
  const demote = heading !== "";

  const panelNode = (panel: (typeof tabs)[number], i: number) => (
    <PanelColumns
      panel={panel}
      demote={demote}
      isFirstPanel={i === 0}
      isFirstBlock={isFirst}
      now={now}
      openablePopups={openablePopups}
      coreData={coreData}
    />
  );

  return (
    <RowRenderer layout="full" background={background}>
      {heading ? (
        <h2 id={headingId} className={`${HEADING_CLASSES[2]} mb-8`}>
          {heading}
        </h2>
      ) : null}
      {tabs.length === 1 ? (
        panelNode(tabs[0], 0)
      ) : (
        <>
          <TabsController
            tabs={tabs.map((tab, i) => ({
              id: tab.id,
              label: tab.label,
              node: panelNode(tab, i),
            }))}
            labelledBy={headingId}
            labelLevel={heading ? 3 : 2}
          />
          <noscript>
            <style>{TABS_NOSCRIPT_CSS}</style>
          </noscript>
        </>
      )}
    </RowRenderer>
  );
}
