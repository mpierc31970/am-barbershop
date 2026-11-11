// AgreementHistoryTable (09-UI-SPEC "Settings › Legal" Section 1; CONTEXT A3-Q3; AGR-06).
// Every signing, newest first (the caller sorts). A real <table> at >= 768px and a card
// list below; both are rendered and toggled with CSS, so the list works without JS.
// Each row has a Download link whose accessible name includes the date. Zero rows render
// nothing: the page shows the EmptyState (EMPTY-AGR-H / EMPTY-AGR-B).
import { Download } from "lucide-react";
import { buttonClasses } from "../Button";
import { SIGNING_COPY } from "./signing-state";

export interface AgreementHistoryRow {
  id: string;
  /** "8 Oct 2026". */
  dateLabel: string;
  /** "2:14 pm". */
  timeLabel: string;
  signerName: string;
  signerEmail: string;
  /** "Service Agreement · version 1", one per policy signed. */
  items: readonly string[];
  /** "First signing" / "Updated terms". */
  typeLabel: string;
  /** `/hub/agreement/download/<id>` (D-UI-P9-11). */
  downloadHref: string;
  /** "Download the agreement signed 8 Oct 2026". */
  downloadAriaLabel: string;
}

export interface AgreementHistoryTableProps {
  rows: readonly AgreementHistoryRow[];
}

function DownloadLink({
  row,
  full,
}: {
  row: AgreementHistoryRow;
  full?: boolean;
}) {
  return (
    <a
      href={row.downloadHref}
      aria-label={row.downloadAriaLabel}
      className={`${buttonClasses("secondary", "sm")} min-h-11 md:min-h-8${full ? " w-full" : ""}`}
    >
      <Download aria-hidden size={16} strokeWidth={2} />
      {SIGNING_COPY.download}
    </a>
  );
}

function ItemList({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm text-hub-ink">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

const TH = "px-4 py-3 text-left text-sm font-semibold text-hub-ink";
const TD = "px-4 py-4 align-top text-base text-hub-ink";

export function AgreementHistoryTable({ rows }: AgreementHistoryTableProps) {
  if (rows.length === 0) return null;
  return (
    <div className="font-hub">
      <table className="hidden w-full border-collapse overflow-hidden rounded-lg border border-hub-border bg-hub-surface md:table">
        <thead className="border-b border-hub-border bg-hub-surface-2">
          <tr>
            <th scope="col" className={TH}>
              Signed
            </th>
            <th scope="col" className={TH}>
              Signed by
            </th>
            <th scope="col" className={TH}>
              What was signed
            </th>
            <th scope="col" className={TH}>
              Type
            </th>
            <th scope="col" className="sr-only">
              {SIGNING_COPY.historyCopyHeader}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-hub-border">
              <td className={TD}>
                <div className="tabular-nums">{row.dateLabel}</div>
                <div className="text-sm text-hub-ink-muted tabular-nums">
                  {row.timeLabel}
                </div>
              </td>
              <td className={TD}>
                <div>{row.signerName}</div>
                <div className="text-sm break-all text-hub-ink-muted">
                  {row.signerEmail}
                </div>
              </td>
              <td className={TD}>
                <ItemList items={row.items} />
              </td>
              <td className={TD}>{row.typeLabel}</td>
              <td className={`${TD} text-right`}>
                <DownloadLink row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul data-layout="cards" className="flex flex-col gap-4 md:hidden">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-col gap-2 rounded-lg border border-hub-border bg-hub-surface p-4"
          >
            <p className="text-base text-hub-ink">
              <span className="font-semibold tabular-nums">
                {row.dateLabel}
              </span>
              <span className="text-hub-ink-muted"> · {row.typeLabel}</span>
            </p>
            <p className="text-sm text-hub-ink-muted">
              <span className="text-hub-ink">{row.signerName}</span> ·{" "}
              <span className="break-all">{row.signerEmail}</span>
            </p>
            <ItemList items={row.items} />
            <div className="mt-2">
              <DownloadLink row={row} full />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
