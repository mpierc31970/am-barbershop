// Settings › Domain › DNS records (14-32 choice 2; DOM-03; 14-UI-SPEC "DNS records"; D119,
// D-UI-P14-19, D-UI-P14-20). `/hub/settings?tab=domain&view=records`, rendered by DomainPanel
// only once a CDS zone exists (ownerDnsRecords non-null). Server component: back link Domain,
// the h2 DNS records with its explainer, RECORDS-INTRO, then the RecordsManager island
// (toolbar, grouped list in manage mode, dialogs). An Admin (or anyone without `domain:write`,
// or while the feature is closed) gets the same list read-only with DOMAIN-ADMIN-READ and no
// actions; the server refuses writes regardless (T-14-32-01).
import { P14_COPY } from "@cds/core/dns";
import type { OwnerDnsRecordsView } from "@cds/db";
import { ArrowLeft, Globe } from "lucide-react";
import Link from "next/link";
import { RecordsManager } from "./DnsRecordsControls";
import { RECORDS_VIEW_COPY as C, recordGroups } from "./records-view";

export const DOMAIN_HREF = "/hub/settings?tab=domain";
export const RECORDS_HREF = "/hub/settings?tab=domain&view=records";
export const EMAIL_SETUP_HREF = "/hub/settings?tab=domain&view=email";

const BACK =
  "inline-flex min-h-11 items-center gap-1 self-start rounded text-sm text-hub-ink-muted " +
  "hover:text-hub-ink";

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={BACK}>
      <ArrowLeft aria-hidden size={16} strokeWidth={2} />
      {label}
    </Link>
  );
}

export function DnsRecordsView({
  records,
  adminRead,
}: {
  records: OwnerDnsRecordsView;
  /** The caller can read but not change the domain (Admin): DOMAIN-ADMIN-READ. */
  adminRead: boolean;
}) {
  const canEdit = records.canEdit && !adminRead;
  return (
    <section
      aria-labelledby="dns-records-h"
      data-dns-records={canEdit ? "manage" : "read"}
      className="flex flex-col gap-6 font-hub text-hub-ink"
    >
      <BackLink href={DOMAIN_HREF} label={C.backToDomain} />
      <div className="flex flex-col gap-1">
        <h2
          id="dns-records-h"
          className="flex items-center gap-2 text-xl leading-tight font-semibold"
        >
          <Globe aria-hidden size={20} strokeWidth={2} />
          {C.heading}
        </h2>
        <p className="max-w-[68ch] text-sm text-hub-ink-muted">{C.explainer}</p>
      </div>
      <p className="max-w-[68ch] text-sm text-hub-ink-muted">
        {P14_COPY.RECORDS_INTRO}
      </p>
      {adminRead ? (
        <p data-admin-read="" className="text-sm text-hub-ink-muted">
          {P14_COPY.DOM_ADMIN_READ}
        </p>
      ) : null}
      <RecordsManager
        domain={records.domain}
        groups={recordGroups(records, { canEdit })}
        canEdit={canEdit}
        emailHref={EMAIL_SETUP_HREF}
      />
    </section>
  );
}
