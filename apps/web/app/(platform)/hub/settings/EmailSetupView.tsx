// Settings › Domain › Set up email for my domain (14-32 choice 2; DOM-03, ONB-10; 14-UI-SPEC
// "Email setup"; D119, D173, D-UI-P14-26). `/hub/settings?tab=domain&view=email`, rendered by
// DomainPanel only once a CDS zone exists. Owner only: the 3-step EmailSetupFlow island, with
// the current provider (from the apex MX) marked "Your current email". An Admin sees the
// current provider read-only and DOMAIN-ADMIN-READ, never the flow (the server refuses the
// write anyway, T-14-32-01). Back link DNS records.
import { P14_COPY } from "@cds/core/dns";
import type { OwnerDnsRecordsView } from "@cds/db";
import { EmailSetupIsland } from "./DnsRecordsControls";
import { BackLink, RECORDS_HREF } from "./DnsRecordsView";
import { RECORDS_VIEW_COPY as C, currentEmail } from "./records-view";

export function EmailSetupView({
  records,
  adminRead,
  howToHref = null,
}: {
  records: OwnerDnsRecordsView;
  adminRead: boolean;
  /** "Get a professional email address" how-to, once the help map knows it (14-46). */
  howToHref?: string | null;
}) {
  const current = currentEmail(records);
  const canEdit = records.canEdit && !adminRead;
  return (
    <div
      data-email-setup-view={canEdit ? "owner" : "read"}
      className="flex max-w-[720px] flex-col gap-6 font-hub text-hub-ink"
    >
      <BackLink href={RECORDS_HREF} label={P14_COPY.BTN_DNS_RECORDS} />
      {canEdit ? (
        <EmailSetupIsland
          domain={records.domain}
          currentPreset={current.preset}
          recordsHref={RECORDS_HREF}
          howToHref={howToHref}
        />
      ) : (
        <section
          aria-labelledby="email-setup-read-h"
          className="flex flex-col gap-4"
        >
          <h2
            id="email-setup-read-h"
            className="text-xl leading-tight font-semibold"
          >
            {P14_COPY.BTN_SET_UP_EMAIL}
          </h2>
          <dl className="flex flex-col gap-1 rounded border border-hub-border px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
            <dt className="text-sm font-semibold text-hub-ink-muted sm:w-40 sm:shrink-0">
              {C.currentEmail}
            </dt>
            <dd className="text-base">{current.name ?? C.noEmail}</dd>
          </dl>
          <p data-admin-read="" className="text-sm text-hub-ink-muted">
            {adminRead ? P14_COPY.DOM_ADMIN_READ : C.emailOwnerOnly}
          </p>
        </section>
      )}
    </div>
  );
}
