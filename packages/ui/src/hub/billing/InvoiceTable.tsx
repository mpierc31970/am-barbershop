"use client";
// InvoiceTable (10-10; 10-UI-SPEC "Settings › Billing" section 7, a11y, responsive;
// BILL-08, D82, D-UI-P10-22): invoices from mirrored rows, newest first as given. From
// 768px a real table element; below 768px each invoice is a card (<li>). 12 rows, then a
// Show more button reveals the next page. Every link names its invoice and date, and
// says it opens Stripe when it leaves the platform host; external links carry
// rel="noopener noreferrer" (T-10-10-02). Empty: EmptyState with Receipt.
import { formatCentsExact } from "@cds/core/pricing";
import { ExternalLink, Receipt } from "lucide-react";
import { useState } from "react";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { EmptyState } from "../feedback";
import type { InvoiceRow, InvoiceStatus } from "./types";

export const INVOICE_COPY = {
  heading: "Invoices",
  date: "Date",
  invoice: "Invoice",
  whatFor: "What for",
  amount: "Amount",
  status: "Status",
  view: "View invoice",
  showMore: "Show more",
  emptyHeading: "No invoices yet",
  emptyBody:
    "Your invoices show here after your first payment. Each one has a PDF to download for your records.",
  tax: (amount: string) => `incl. ${amount} tax`,
} as const;

/** Badge word per status; the word is always present (tone never alone). */
export const INVOICE_STATUS_WORD: Record<InvoiceStatus, string> = {
  paid: "Paid",
  due: "Due",
  unpaid: "Unpaid",
  refunded: "Refunded",
  void: "Cancelled",
};

function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function linkLabel(row: InvoiceRow, external: boolean): string {
  return `View invoice ${row.number} from ${row.date}${external ? " (opens Stripe)" : ""}`;
}

const LINK =
  "inline-flex items-center gap-1 rounded text-hub-accent underline underline-offset-2 " +
  "pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-hub-accent";

function InvoiceLink({ row }: { row: InvoiceRow }) {
  if (!row.href) return null;
  const external = isExternal(row.href);
  return (
    <a
      href={row.href}
      aria-label={linkLabel(row, external)}
      className={LINK}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {INVOICE_COPY.view}
      {external ? <ExternalLink aria-hidden size={16} strokeWidth={2} /> : null}
    </a>
  );
}

function Amount({ row }: { row: InvoiceRow }) {
  return (
    <span className="flex flex-col items-end gap-1 tabular-nums">
      <span className="text-base text-hub-ink">
        {formatCentsExact(row.amountCents)}
      </span>
      <span className="text-sm text-hub-ink-muted">
        {INVOICE_COPY.tax(formatCentsExact(row.taxCents))}
      </span>
    </span>
  );
}

export interface InvoiceTableProps {
  rows: readonly InvoiceRow[];
  pageSize?: number;
}

const TH = "py-4 pr-4 text-left text-sm font-semibold text-hub-ink-muted";
const TD = "py-4 pr-4 align-top";

export function InvoiceTable({ rows, pageSize = 12 }: InvoiceTableProps) {
  const [shown, setShown] = useState(pageSize);
  if (rows.length === 0) {
    return (
      <div className="max-w-[880px]">
        <EmptyState
          icon={Receipt}
          heading={INVOICE_COPY.emptyHeading}
          body={INVOICE_COPY.emptyBody}
        />
      </div>
    );
  }
  const visible = rows.slice(0, shown);
  return (
    <div
      className="flex max-w-[880px] flex-col gap-4 font-hub"
      data-invoice-table=""
    >
      <table className="hidden w-full border-collapse md:table">
        <thead className="border-b border-hub-border">
          <tr>
            <th scope="col" className={TH}>
              {INVOICE_COPY.date}
            </th>
            <th scope="col" className={TH}>
              {INVOICE_COPY.invoice}
            </th>
            <th scope="col" className={TH}>
              {INVOICE_COPY.whatFor}
            </th>
            <th scope="col" className={`${TH} text-right`}>
              {INVOICE_COPY.amount}
            </th>
            <th scope="col" className={TH}>
              {INVOICE_COPY.status}
            </th>
            <th scope="col" className={TH}>
              <span className="sr-only">{INVOICE_COPY.invoice}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hub-border">
          {visible.map((row) => (
            <tr key={row.id} data-invoice-row={row.id}>
              <td className={`${TD} text-base text-hub-ink tabular-nums`}>
                {row.date}
              </td>
              <td className={`${TD} text-sm text-hub-ink-muted tabular-nums`}>
                {row.number}
              </td>
              <td className={`${TD} text-base text-hub-ink`}>{row.whatFor}</td>
              <td className={`${TD} text-right`}>
                <Amount row={row} />
              </td>
              <td className={TD}>
                <Badge tone={row.status}>
                  {INVOICE_STATUS_WORD[row.status]}
                </Badge>
              </td>
              <td className={`${TD} pr-0`}>
                <InvoiceLink row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="flex flex-col divide-y divide-hub-border border-y border-hub-border md:hidden">
        {visible.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 py-4">
            <span className="flex items-center justify-between gap-4">
              <span className="text-base text-hub-ink tabular-nums">
                {row.date}
              </span>
              <Badge tone={row.status}>{INVOICE_STATUS_WORD[row.status]}</Badge>
            </span>
            <span className="text-base text-hub-ink">{row.whatFor}</span>
            <span className="flex items-start justify-between gap-4">
              <span className="text-sm text-hub-ink-muted tabular-nums">
                {row.number}
              </span>
              <Amount row={row} />
            </span>
            <InvoiceLink row={row} />
          </li>
        ))}
      </ul>
      {shown < rows.length ? (
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => setShown((n) => n + pageSize)}
        >
          {INVOICE_COPY.showMore}
        </Button>
      ) : null}
    </div>
  );
}
