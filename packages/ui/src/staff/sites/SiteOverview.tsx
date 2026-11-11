// SiteOverview (13-33 choice 3; STAFF-02; 13-UI-SPEC site detail "Overview" lines 779-783). Two
// columns from 1024px. Left: a description list (Status, Path, Plan, Care Plan, Billing (read
// only, `unpaid` badge when past due), Domains (preview + live links), Demo flag, Suspension,
// Created, Org id with copy). Right: Members (name + role badge only, never an email,
// T-13-33-02) and Recent activity (last audit lines, link to the Audit tab). Server-safe:
// only CopyIdButton is a client island. Tenant names stay React text.
import type { ReactNode } from "react";
import { Badge } from "../../hub/Badge";
import { CopyIdButton } from "./CopyIdButton";
import {
  SITES_COPY as C,
  formatSiteDate,
  formatSiteDateTime,
  siteBillingLabel,
  siteBillingUnpaid,
  sitePathLabel,
  sitePlanLabel,
  type SiteStateView,
} from "./copy";
import { SiteFlags, SiteStateBadge } from "./badges";

export interface SiteOverviewMember {
  name: string;
  role: string;
}

export interface SiteOverviewActivity {
  id: string;
  when: string;
  actor: string;
  action: string;
}

export interface SiteOverviewSuspension {
  mode: string;
  suspendedAt: string | null;
  fixBy: string | null;
  fixedAt: string | null;
  liftedAt: string | null;
}

export interface SiteOverviewView {
  orgId: string;
  name: string;
  state: SiteStateView;
  path: string;
  plan: string;
  carePlan: boolean;
  liveHost: string | null;
  previewHost: string | null;
  created: string;
  demo: boolean;
  repeatInfringer: boolean;
  billing: { state: string; nextRenewal: string | null };
  suspension: SiteOverviewSuspension | null;
  members: readonly SiteOverviewMember[];
  recent: readonly SiteOverviewActivity[];
}

export interface SiteOverviewProps {
  site: SiteOverviewView;
  /** Audit tab link ("See the full audit log"). */
  auditHref: string;
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
  staff: "Staff",
  renter: "Renter",
};

const LINK =
  "rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1 border-b border-hub-border py-2 max-sm:grid-cols-1">
      <dt className="text-sm text-hub-ink-muted">{term}</dt>
      <dd className="flex flex-wrap items-center gap-2 text-sm text-hub-ink">
        {children}
      </dd>
    </div>
  );
}

function HostLink({ host }: { host: string }) {
  return (
    <a
      href={`https://${host}`}
      target="_blank"
      rel="noopener noreferrer"
      className={LINK}
    >
      {host}
    </a>
  );
}

function suspensionText(s: SiteOverviewSuspension | null): string {
  const S = C.suspension;
  if (!s) return S.none;
  if (s.liftedAt) return S.lifted;
  if (s.suspendedAt) return S.suspended(formatSiteDate(s.suspendedAt));
  if (s.fixedAt) return S.fixed;
  if (s.mode === "notice" && s.fixBy) return S.notice(formatSiteDate(s.fixBy));
  return S.none;
}

export function SiteOverview({ site, auditHref }: SiteOverviewProps) {
  const O = C.overview;
  const billingLabel = siteBillingLabel(site.billing.state);
  return (
    <div className="grid gap-8 font-hub lg:grid-cols-2">
      <section aria-labelledby="site-overview-details">
        <h2
          id="site-overview-details"
          className="mb-2 text-base font-semibold text-hub-ink"
        >
          {O.details}
        </h2>
        <dl>
          <Row term={O.stage}>
            <SiteStateBadge state={site.state} />
            <SiteFlags demo={false} repeatInfringer={site.repeatInfringer} />
          </Row>
          <Row term={O.path}>{sitePathLabel(site.path)}</Row>
          <Row term={O.plan}>{sitePlanLabel(site.plan, false)}</Row>
          <Row term={O.carePlan}>{site.carePlan ? O.yes : O.no}</Row>
          <Row term={O.billing}>
            {siteBillingUnpaid(site.billing.state) ? (
              <Badge tone="unpaid">{billingLabel}</Badge>
            ) : (
              <span>
                {billingLabel}
                {site.billing.nextRenewal && site.billing.state === "active"
                  ? ` · ${C.billing.renews(formatSiteDate(site.billing.nextRenewal))}`
                  : ""}
              </span>
            )}
          </Row>
          <Row term={O.domains}>
            <span className="flex flex-col gap-1">
              <span>
                {O.liveLabel}:{" "}
                {site.liveHost ? (
                  <HostLink host={site.liveHost} />
                ) : (
                  <span className="text-hub-ink-muted">{O.noDomain}</span>
                )}
              </span>
              <span>
                {O.previewLabel}:{" "}
                {site.previewHost ? (
                  <HostLink host={site.previewHost} />
                ) : (
                  <span className="text-hub-ink-muted">{C.none}</span>
                )}
              </span>
            </span>
          </Row>
          <Row term={O.demo}>
            {site.demo ? <Badge tone="demo">{C.demo}</Badge> : O.no}
          </Row>
          <Row term={O.suspension}>{suspensionText(site.suspension)}</Row>
          <Row term={O.created}>{formatSiteDate(site.created)}</Row>
          <Row term={O.orgId}>
            <code className="font-mono text-sm">{site.orgId}</code>
            <CopyIdButton value={site.orgId} />
          </Row>
        </dl>
      </section>
      <div className="flex flex-col gap-8">
        <section aria-labelledby="site-overview-members">
          <h2
            id="site-overview-members"
            className="mb-2 text-base font-semibold text-hub-ink"
          >
            {O.members}
          </h2>
          {site.members.length === 0 ? (
            <p className="text-sm text-hub-ink-muted">{O.noMembers}</p>
          ) : (
            <ul className="flex flex-col">
              {site.members.map((m, i) => (
                <li
                  key={`${m.role}-${m.name}-${i}`}
                  className="flex items-center justify-between gap-2 border-b border-hub-border py-2 text-sm text-hub-ink"
                >
                  <span>{m.name || C.none}</span>
                  <Badge tone="role">{ROLE_LABELS[m.role] ?? m.role}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="site-overview-recent">
          <h2
            id="site-overview-recent"
            className="mb-2 text-base font-semibold text-hub-ink"
          >
            {O.recent}
          </h2>
          {site.recent.length === 0 ? (
            <p className="text-sm text-hub-ink-muted">{O.noRecent}</p>
          ) : (
            <ol className="flex flex-col">
              {site.recent.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-baseline gap-x-2 border-b border-hub-border py-2 text-sm"
                >
                  <span className="text-hub-ink-muted tabular-nums">
                    {formatSiteDateTime(a.when)}
                  </span>
                  <span className="font-semibold text-hub-ink">{a.actor}</span>
                  <span className="text-hub-ink">{a.action}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-2 text-sm">
            <a href={auditHref} className={LINK}>
              {O.allAudit}
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
