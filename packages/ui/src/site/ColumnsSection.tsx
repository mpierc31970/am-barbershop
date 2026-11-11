// The columns block: the one container type (CONT-03, CONT-07, D31; invariant 6).
//
// Ported from donor src/components/sections/ColumnsSection.tsx. The grid, padding and
// band all stay with RowRenderer; this component only decides what goes in each cell.
// Columns come from resolveColumns on read (padded to the layout's count, surplus folded
// into the last column), never from a stored count. Additions for the heading rule
// (D-UI-11): when this block owns the page h1, its first non-blank heading item renders
// as <h1>; when it is the first block, its first image loads eagerly.
import {
  resolveColumns,
  type ColumnItem,
  type ColumnsContent,
} from "@cds/core/content";
import { ColumnItemRenderer, columnImageSizes } from "./ColumnItemRenderer";
import { RowRenderer } from "./RowRenderer";
import type { SectionComponentProps } from "./types";

type HeadingItem = Extract<ColumnItem, { kind: "heading" }>;

const isHeading = (item: ColumnItem): item is HeadingItem =>
  item?.kind === "heading" &&
  typeof item.text === "string" &&
  item.text.trim() !== "";

export function ColumnsSection({
  content,
  layout,
  background,
  isH1Owner,
  isFirst,
  now,
  openablePopups,
  coreData,
}: SectionComponentProps<ColumnsContent>) {
  const columns = resolveColumns(content, layout);
  const all = columns.flatMap((c) => c.items);
  const h1Id = isH1Owner ? all.find(isHeading)?.id : undefined;
  const eagerId = isFirst
    ? // A library image has `asset` and url "" (WR-D05); it is the usual LCP image.
      all.find((i) => i?.kind === "image" && Boolean(i.url || i.asset))?.id
    : undefined;

  return (
    <RowRenderer layout={layout} background={background}>
      {columns.map((column, ci) => {
        // No section-level heading exists for a blank image alt to fall back to; the
        // column's own first heading item is the closest equivalent.
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
                  h1Id !== undefined && item?.id === h1Id ? 1 : undefined
                }
                eagerImage={eagerId !== undefined && item?.id === eagerId}
                fallbackAlt={headingItem?.text.trim()}
                now={now}
                openablePopups={openablePopups}
                media={coreData?.media}
                forms={coreData?.forms}
                imageSizes={columnImageSizes(layout, ci)}
              />
            ))}
          </div>
        );
      })}
    </RowRenderer>
  );
}
