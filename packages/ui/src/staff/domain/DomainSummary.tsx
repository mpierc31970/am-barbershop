// DomainSummary (14-38 choice 2; DOM-08; 14-UI-SPEC "Staff › Site › Domain" DomainSummary).
// The 320px rail as a description list: Domain · Registrar + expiry · DNSSEC ("On at parent" in
// danger) · CDS zone (copy id + status) · Assigned nameservers (mono) · Delegation seen ·
// Primary host · Last health check; then the HostsTable. Below 1280px the panel puts the rail
// first: it is a <details> "Domain details", open by default, whose summary hides at xl so
// the rail reads as a plain aside there. Server-safe apart from the CopyIdButton island; every
// value is a React text node (DNS values come from outside, T-14-38-01).
import type { ReactNode } from "react";
import { Badge } from "../../hub/Badge";
import { CopyIdButton } from "../sites/CopyIdButton";
import {
  STAFF_DOMAIN_COPY,
  formatDomainDate,
  formatDomainWhen,
  type StaffDomainHostData,
  type StaffDomainSummaryData,
} from "./copy";
import { HostsTable } from "./HostsTable";

const C = STAFF_DOMAIN_COPY.summary;

export interface DomainSummaryProps {
  summary: StaffDomainSummaryData;
  hosts?: readonly StaffDomainHostData[];
  timeZone?: string;
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-hub-border py-2">
      <dt className="text-sm text-hub-ink-muted">{term}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-hub-ink">
        {children}
      </dd>
    </div>
  );
}

/** "Today 06:00 · HTTPS ok · cert running low · email records unchanged". */
export function healthLine(
  health: StaffDomainSummaryData["lastHealth"],
  timeZone?: string,
): string {
  if (!health.at) return C.noCheck;
  const inc = new Set(health.incidents);
  const parts = [formatDomainWhen(health.at, timeZone)];
  parts.push(inc.has("https_failing") ? C.httpsFailing : C.httpsOk);
  if (inc.has("cert_low")) parts.push(C.certLow);
  parts.push(inc.has("email_drift") ? C.emailDrift : C.emailUnchanged);
  if (inc.has("delegation_lost")) parts.push(C.delegationLost);
  if (inc.has("expiry_7d") || inc.has("expiry_30d")) parts.push(C.expiring);
  return parts.filter(Boolean).join(" · ");
}

export function DomainSummary({
  summary,
  hosts,
  timeZone,
}: DomainSummaryProps) {
  const registrar = summary.registrar ?? C.unknownRegistrar;
  const expiry = summary.expiresAt
    ? C.expires(formatDomainDate(summary.expiresAt, timeZone))
    : null;
  const dnssec = summary.dnssec ?? "unknown";
  return (
    <details
      open
      data-domain-summary=""
      className="group rounded border border-hub-border bg-hub-surface p-4 font-hub xl:border-0 xl:p-0"
    >
      <summary className="cursor-pointer text-base font-semibold text-hub-ink pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent xl:hidden">
        {C.label}
      </summary>
      <div className="flex flex-col gap-6 pt-2 xl:pt-0">
        <dl aria-label={C.label}>
          <Row term={C.domain}>
            <span className="font-mono break-all">
              {summary.domain ?? C.none}
            </span>
          </Row>
          <Row term={C.registrar}>
            <span>{expiry ? `${registrar} · ${expiry}` : registrar}</span>
          </Row>
          <Row term={C.dnssec}>
            <span
              data-dnssec={dnssec}
              className={
                dnssec === "on" ? "font-semibold text-hub-danger" : undefined
              }
            >
              {C.dnssecWords[dnssec]}
            </span>
          </Row>
          <Row term={C.zone}>
            {summary.zone ? (
              <>
                {summary.zone.id ? (
                  <>
                    <span className="font-mono">{summary.zone.id}</span>
                    <CopyIdButton value={summary.zone.id} />
                  </>
                ) : null}
                <Badge
                  tone={
                    summary.zone.status === "active"
                      ? "m-done"
                      : summary.zone.status === "pending"
                        ? "m-waiting"
                        : "m-skipped"
                  }
                >
                  {summary.zone.status}
                </Badge>
              </>
            ) : (
              <span>{C.none}</span>
            )}
          </Row>
          <Row term={C.nameservers}>
            {summary.nameservers.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {summary.nameservers.map((ns) => (
                  <li key={ns} className="font-mono break-all">
                    {ns}
                  </li>
                ))}
              </ul>
            ) : (
              <span>{C.none}</span>
            )}
          </Row>
          <Row term={C.delegation}>
            <span className="tabular-nums">
              {summary.delegatedAt
                ? formatDomainWhen(summary.delegatedAt, timeZone)
                : C.notSeen}
            </span>
          </Row>
          <Row term={C.primary}>
            <span className="font-mono break-all">
              {summary.primaryHost ?? C.none}
            </span>
          </Row>
          <Row term={C.health}>
            <span>{healthLine(summary.lastHealth, timeZone)}</span>
          </Row>
        </dl>
        {hosts ? <HostsTable hosts={hosts} /> : null}
      </div>
    </details>
  );
}
