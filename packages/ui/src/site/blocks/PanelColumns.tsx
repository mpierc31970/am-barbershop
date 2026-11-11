// One slide or tab panel = one columns row (07-20; CONT-23, CONT-27, D229; layout belongs
// to the container, invariant 6).
//
// The grid comes from RowRenderer's own table (rowGridClass), so a slide's split is the
// same CONT-03 contract as a Columns block; the item loop copies ColumnsSection's rules
// (first image eager only in the first panel of the first block, blank alt falls back to
// the column's first heading). Heading demotion (CONTEXT decision 2, 07-20 decision 8):
// under a non-blank block heading every heading item renders <h3>; otherwise items keep
// their stored H2/H3. Never <h1>. Items receive the page's media, forms, request time and
// openable pop-ups. Server component.
import {
  resolveColumns,
  type ColumnItem,
  type SliderSlide,
} from "@cds/core/content";
import { ColumnItemRenderer } from "../ColumnItemRenderer";
import { rowGridClass } from "../RowRenderer";
import type { CoreBoundData } from "../types";

/** A slide or tab panel (core PanelRow; SliderSlide is its public alias). */
export type PanelRowShape = SliderSlide;

export interface PanelColumnsProps {
  panel: PanelRowShape;
  /** The block has a visible heading: every heading item renders <h3>. */
  demote: boolean;
  isFirstPanel: boolean;
  /** The block is the first on the page. */
  isFirstBlock: boolean;
  now: Date;
  openablePopups?: ReadonlySet<string>;
  coreData?: CoreBoundData;
}

type HeadingItem = Extract<ColumnItem, { kind: "heading" }>;

const isHeading = (item: ColumnItem): item is HeadingItem =>
  item?.kind === "heading" &&
  typeof item.text === "string" &&
  item.text.trim() !== "";

const isImage = (item: ColumnItem): boolean =>
  item?.kind === "image" && Boolean(item.url || item.asset);

export function PanelColumns({
  panel,
  demote,
  isFirstPanel,
  isFirstBlock,
  now,
  openablePopups,
  coreData,
}: PanelColumnsProps) {
  const columns = resolveColumns(panel, panel.row_layout);
  const eagerId =
    isFirstBlock && isFirstPanel
      ? columns.flatMap((c) => c.items).find(isImage)?.id
      : undefined;
  const grid = rowGridClass(panel.row_layout);

  return (
    <div data-panel-row="" className={grid || undefined}>
      {columns.map((column) => {
        const headingItem = column.items.find(isHeading);
        return (
          <div
            key={column.id}
            data-column=""
            className="flex min-w-0 flex-col gap-4"
          >
            {column.items.map((item, i) => (
              <ColumnItemRenderer
                key={item?.id ?? i}
                item={item}
                headingLevelOverride={
                  demote && item?.kind === "heading" ? 3 : undefined
                }
                eagerImage={eagerId !== undefined && item?.id === eagerId}
                fallbackAlt={headingItem?.text.trim()}
                now={now}
                openablePopups={openablePopups}
                media={coreData?.media}
                forms={coreData?.forms}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
