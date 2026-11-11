// The declined notice (10-32; 10-UI-SPEC "Declined notice"; BILL-09, D214, D-UI-P10-19).
// When staff decline a paid site, every /hub/* request from any member renders this inside
// the focused frame (header with Sign out only; no sidebar). One centred 720px column: the
// H1, DECLINED-BODY with the reason sentence, the refund and deletion lines, DECLINED-KEEP,
// then secondary actions only (nothing to do here, so no primary) and no red. Lines come from
// readDeclinedNotice, which already scopes the agreement link (Owner/Admin) and the invoices
// (Owner) by role (T-10-32-01). "View invoices" opens a plain read-only list on this page.
import { buttonClasses } from "@cds/ui/hub";
import { InvoiceTable } from "@cds/ui/hub/billing";
import type { DeclinedNotice as DeclinedNoticeData } from "@cds/db";
import { invoiceRows } from "../../../lib/billing-view";

export const DECLINED_COPY = {
  title: "We've refunded your order",
  body: (amount: string, reason: string) =>
    `Support can't build this site, so we've refunded everything you paid, ${amount}, to your card. It can take 5 to 10 business days to show.${reason ? ` ${reason}` : ""}`,
  refunded: "Refunded",
  deleted: "Account and site details deleted on",
  keep: (date: string) =>
    `Your preview site is offline. Your account and site details are deleted on ${date}. Your signed agreement and receipts are kept for our records, and you can download them until then.`,
  download: "Download your signed agreement",
  invoices: "View invoices",
  support: "Contact Support",
} as const;

const TERM = "text-sm font-semibold text-hub-ink-muted";
const DESC = "text-base text-hub-ink tabular-nums";

export function DeclinedNotice({
  notice,
  supportHref,
}: {
  notice: DeclinedNoticeData;
  supportHref: string;
}) {
  const rows = invoiceRows(notice.invoices);
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 font-hub sm:pt-4">
      <h1 className="text-[1.75rem] leading-tight font-semibold text-balance text-hub-ink">
        {DECLINED_COPY.title}
      </h1>
      <p className="max-w-[60ch] text-base text-hub-ink">
        {DECLINED_COPY.body(notice.refundedAmount, notice.reasonSentence)}
      </p>
      <dl className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <dt className={TERM}>{DECLINED_COPY.refunded}</dt>
          <dd className={DESC}>{notice.refundedLabel}</dd>
        </div>
        {notice.deleteOnLabel ? (
          <div className="flex flex-col gap-1">
            <dt className={TERM}>{DECLINED_COPY.deleted}</dt>
            <dd className={DESC}>{notice.deleteOnLabel}</dd>
          </div>
        ) : null}
      </dl>
      <p className="max-w-[60ch] text-sm text-hub-ink-muted">
        {DECLINED_COPY.keep(notice.deleteOnLabel || "the deletion date")}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {notice.agreementHref ? (
          <a
            href={notice.agreementHref}
            className={`${buttonClasses("secondary", "sm")} pointer-coarse:min-h-11`}
          >
            {DECLINED_COPY.download}
          </a>
        ) : null}
        <a
          href={supportHref}
          className="text-base font-semibold text-hub-accent underline underline-offset-4 hover:no-underline"
        >
          {DECLINED_COPY.support}
        </a>
      </div>
      {rows.length > 0 ? (
        <details className="group flex flex-col gap-4">
          <summary
            className={`${buttonClasses("secondary", "sm")} w-fit cursor-pointer list-none pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden`}
          >
            {DECLINED_COPY.invoices}
          </summary>
          <div className="mt-4">
            <InvoiceTable rows={rows} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
