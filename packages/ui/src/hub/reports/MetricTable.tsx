"use client";
// MetricTable (11-33; 11-UI-SPEC "Reports" sections 3, 4, 8, 9 and the Social tab). A plain
// table: first column is the row header, numeric columns right-aligned and tabular. Shows
// `limit` rows (default 10) with a ghost "Show all {n}" that expands in place. Server-rendered
// first (the extra rows simply stay hidden without JavaScript).
import { useState, type ReactNode } from "react";
import { buttonClasses } from "../Button";
import { REPORTS_COPY } from "./copy";

export interface MetricColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

export interface MetricRow {
  key: string;
  cells: Readonly<Record<string, ReactNode>>;
}

export interface MetricTableProps {
  caption: string;
  columns: readonly MetricColumn[];
  rows: readonly MetricRow[];
  limit?: number;
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
}

export function MetricTable({
  caption,
  columns,
  rows,
  limit = 10,
  empty,
}: MetricTableProps) {
  const [all, setAll] = useState(false);
  if (rows.length === 0) {
    return (
      <p className="font-hub text-base text-hub-ink-muted">
        {empty ?? REPORTS_COPY.noRows}
      </p>
    );
  }
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <div className="flex flex-col gap-2 font-hub text-hub-ink">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-hub-border text-hub-ink-muted">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={
                    "py-2 font-semibold " +
                    (c.numeric ? "pl-4 text-right" : "pr-4 text-left")
                  }
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className="border-b border-hub-border">
                {columns.map((c, i) =>
                  i === 0 ? (
                    <th
                      key={c.key}
                      scope="row"
                      className="py-2 pr-4 text-left font-normal"
                    >
                      {r.cells[c.key]}
                    </th>
                  ) : (
                    <td
                      key={c.key}
                      className={
                        "py-2 " +
                        (c.numeric ? "pl-4 text-right tabular-nums" : "pr-4")
                      }
                    >
                      {r.cells[c.key]}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!all && rows.length > limit ? (
        <div>
          <button
            type="button"
            className={buttonClasses("ghost", "sm")}
            aria-expanded={false}
            onClick={() => setAll(true)}
          >
            {REPORTS_COPY.showAll(rows.length)}
          </button>
        </div>
      ) : null}
    </div>
  );
}
