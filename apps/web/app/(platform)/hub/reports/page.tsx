// Reports (11-33; DASH-10, DASH-11, DASH-15, DASH-25, DASH-32; D59, D188, D189, D196, D199,
// D312; 11-UI-SPEC "Reports" lines 741-802; T-11-33-01, T-11-33-02). /hub/reports with two
// `?tab=` links from HUB_SECTIONS: Site Report (default) and Social; `?period=7|30|90`
// (default 30). Every member who reads content (Viewers too) opens it; everyone else gets a
// 404 before anything renders. The org comes only from the session.
// Before launch the traffic sections are one NotLiveYet note (REPORTS-PRELAUNCH) while SEO
// health and the Google status still show (D-UI-P11-15). Each section fails on its own.
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { can } from "@cds/core";
import { NotLiveYet, ScreenHeader } from "@cds/ui/hub/shell";
import { TabLinks } from "@cds/ui/hub";
import {
  Ga4Panel,
  MetricTable,
  PeriodControl,
  REPORTS_COPY,
  REPORT_SECTION_TITLES as T,
  ReportFigures,
  ReportSection,
  SearchQueriesPanel,
  SeoHealthPanel,
  SocialReport,
  SpeedPanel,
  VisitorsChart,
  formatCount,
  formatDayLong,
  formatShare,
  resolveReportPeriod,
  sourceLabel,
  type ReportPeriod,
} from "@cds/ui/hub/reports";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireHubSession } from "../../../../lib/session";
import { GuardedLink } from "../GuardedLink";
import { HUB_SECTIONS } from "../sections";
import {
  loadSiteReport,
  loadSocialReport,
  type SiteReportData,
  type SocialReportData,
} from "./report-data";
import { resolveReportsTab, type ReportsTabId } from "./tabs";

export const metadata: Metadata = { title: "Reports" };

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const BIO_LINKS_HREF = "/hub/marketing?tab=social";

function reportHref(tab: ReportsTabId, period: ReportPeriod): string {
  return `/hub/reports?tab=${tab}&period=${period}`;
}

const HOME_SLUG = "home";

function pathTitle(path: string, data: SiteReportData): string | null {
  const slug = path === "/" ? HOME_SLUG : path.replace(/^\//, "");
  return data.pages.find((p) => p.slug === slug)?.title ?? null;
}

function checkedAtLabel(iso: string, timeZone: string): string | undefined {
  const t = Date.parse(iso.replace(" ", "T"));
  if (!Number.isFinite(t)) return undefined;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(t));
}

function SiteReport({
  data,
  canEdit,
}: {
  data: SiteReportData;
  canEdit: boolean;
}) {
  const { period } = data;
  const retry = reportHref("site", period);
  const label = REPORTS_COPY.periodName(period);
  const cur = data.current.ok ? data.current.data : null;
  const prev = data.previous.ok ? data.previous.data : null;
  const failed = !data.current.ok;
  const pageNames = Object.fromEntries(data.pages.map((p) => [p.id, p.title]));

  const seo = (
    <ReportSection
      title={T.seo}
      failed={!data.seo.ok}
      retryHref={retry}
      LinkComponent={GuardedLink}
    >
      {data.seo.ok ? (
        <SeoHealthPanel
          score={data.seo.data.score}
          fixes={data.seo.data.fixes}
          checkedAt={checkedAtLabel(data.seo.data.checkedAt, data.timeZone)}
          pageNames={pageNames}
          fixHref={(id) =>
            canEdit
              ? `/hub/website/pages/${encodeURIComponent(id)}?seo=1`
              : null
          }
          LinkComponent={GuardedLink}
        />
      ) : null}
    </ReportSection>
  );

  const ga4 = (
    <ReportSection
      title={T.ga4}
      label={label}
      failed={!data.ga4.ok}
      retryHref={retry}
      LinkComponent={GuardedLink}
    >
      {data.ga4.ok ? <Ga4Panel summary={data.ga4.data} /> : null}
    </ReportSection>
  );

  if (!data.live) {
    return (
      <div className="flex flex-col gap-8">
        <NotLiveYet what={REPORTS_COPY.prelaunch} />
        {seo}
        <ReportSection title={T.speed}>
          <p className="font-hub text-base text-hub-ink-muted">
            {REPORTS_COPY.speedPrelaunch}
          </p>
        </ReportSection>
        {ga4}
      </div>
    );
  }

  const messages = cur?.formSubmissions ?? 0;
  return (
    <div className="flex flex-col gap-8">
      <ReportSection
        title={T.summary}
        label={label}
        failed={failed}
        retryHref={retry}
        LinkComponent={GuardedLink}
      >
        {cur ? (
          <ReportFigures
            period={period}
            sentence={
              <>
                In the last {period} days,{" "}
                <strong className="font-semibold">
                  {formatCount(cur.views)}{" "}
                  {cur.views === 1 ? "person" : "people"}
                </strong>{" "}
                visited your site and{" "}
                <strong className="font-semibold">
                  {formatCount(messages)}
                </strong>{" "}
                sent you a message.
              </>
            }
            figures={[
              { label: "Visitors", now: cur.views, prev: prev?.views },
              {
                label: "Messages",
                now: messages,
                prev: prev?.formSubmissions,
              },
            ]}
          />
        ) : null}
      </ReportSection>

      <ReportSection
        title={T.visitors}
        label={label}
        failed={failed}
        retryHref={retry}
        LinkComponent={GuardedLink}
      >
        {cur ? <VisitorsChart days={cur.byDay} /> : null}
      </ReportSection>

      <ReportSection
        title={T.topPages}
        label={label}
        failed={failed}
        retryHref={retry}
        LinkComponent={GuardedLink}
      >
        {cur ? (
          <MetricTable
            caption="Top pages"
            columns={[
              { key: "page", label: "Page" },
              { key: "visitors", label: "Visitors", numeric: true },
              { key: "share", label: "Share", numeric: true },
            ]}
            rows={cur.topPages.map((p) => {
              const title = pathTitle(p.path, data);
              return {
                key: p.path,
                cells: {
                  page: (
                    <span className="flex flex-col">
                      <span>{title ?? p.path}</span>
                      {title ? (
                        <span className="text-sm text-hub-ink-muted">
                          {p.path}
                        </span>
                      ) : null}
                    </span>
                  ),
                  visitors: formatCount(p.views),
                  share: formatShare(p.views, cur.views),
                },
              };
            })}
          />
        ) : null}
      </ReportSection>

      <ReportSection
        title={T.sources}
        label={label}
        failed={failed}
        retryHref={retry}
        LinkComponent={GuardedLink}
      >
        {cur ? (
          <div className="flex flex-col gap-2">
            <MetricTable
              caption="Where visitors come from"
              columns={[
                { key: "source", label: "Source" },
                { key: "visitors", label: "Visitors", numeric: true },
                { key: "messages", label: "Messages", numeric: true },
              ]}
              rows={cur.sources.map((s) => ({
                key: s.source,
                cells: {
                  source: sourceLabel(s.source),
                  visitors: formatCount(s.views),
                  messages: formatCount(s.conversions),
                },
              }))}
            />
            <p className="font-hub text-sm text-hub-ink-muted">
              {REPORTS_COPY.sourcesHelp}
            </p>
          </div>
        ) : null}
      </ReportSection>

      {seo}

      <ReportSection
        title={T.speed}
        label={label}
        failed={failed}
        retryHref={retry}
        LinkComponent={GuardedLink}
      >
        {cur ? (
          <SpeedPanel
            phone={cur.vitalsByDevice.m}
            computer={cur.vitalsByDevice.c}
            visits={cur.views}
          />
        ) : null}
      </ReportSection>

      <ReportSection
        title={T.forms}
        label={label}
        failed={failed}
        retryHref={retry}
        LinkComponent={GuardedLink}
      >
        {cur ? (
          <div className="flex flex-col gap-2 font-hub text-hub-ink">
            <ReportFigures
              period={period}
              figures={[
                {
                  label: "Messages",
                  now: messages,
                  prev: prev?.formSubmissions,
                },
              ]}
            />
            <p>
              <GuardedLink
                href="/hub/inbox"
                className="text-hub-accent underline underline-offset-2 hover:text-hub-accent-hover"
              >
                {REPORTS_COPY.openInbox}
              </GuardedLink>
            </p>
          </div>
        ) : null}
      </ReportSection>

      <ReportSection
        title={T.notFound}
        label={label}
        failed={failed}
        retryHref={retry}
        LinkComponent={GuardedLink}
      >
        {cur ? (
          <div className="flex flex-col gap-2">
            <MetricTable
              caption="Pages not found"
              columns={[
                { key: "address", label: "Address" },
                { key: "times", label: "Times", numeric: true },
                { key: "last", label: "Last seen", numeric: true },
              ]}
              rows={cur.notFound.map((n) => ({
                key: n.path,
                cells: {
                  address: <span className="text-sm">{n.path}</span>,
                  times: formatCount(n.hits),
                  last: formatDayLong(n.lastSeen),
                },
              }))}
              empty={REPORTS_COPY.notFoundNone}
            />
            {cur.notFound.length > 0 ? (
              <p className="font-hub text-sm text-hub-ink-muted">
                {REPORTS_COPY.notFoundHelp}
              </p>
            ) : null}
          </div>
        ) : null}
      </ReportSection>

      <ReportSection
        title={T.searches}
        label={label}
        failed={!data.searches.ok}
        retryHref={retry}
        LinkComponent={GuardedLink}
      >
        {data.searches.ok ? (
          <SearchQueriesPanel queries={data.searches.data} />
        ) : null}
      </ReportSection>

      {ga4}
    </div>
  );
}

function SocialTab({ data }: { data: SocialReportData }) {
  if (!data.live) {
    return <NotLiveYet what={REPORTS_COPY.socialPrelaunch} />;
  }
  return (
    <ReportSection
      title={T.social}
      label={REPORTS_COPY.periodName(data.period)}
      failed={!data.social.ok}
      retryHref={reportHref("social", data.period)}
      LinkComponent={GuardedLink}
    >
      {data.social.ok ? (
        <SocialReport
          rows={data.social.data}
          period={data.period}
          addLinksHref={BIO_LINKS_HREF}
          LinkComponent={GuardedLink}
        />
      ) : null}
    </ReportSection>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireHubSession();
  if (!can(ctx, "content", "read")) notFound();
  const sp = await searchParams;
  const tab = resolveReportsTab(sp.tab);
  const period = resolveReportPeriod(sp.period);

  // Reports tabs carry no add-on tabs or counts, so no active-add-on read is needed.
  const tabs = HUB_SECTIONS.reports.tabs({
    role: ctx.role,
    grants: ctx.grants,
    active: [],
    registry: ADDON_REGISTRY,
  });

  const panel =
    tab === "social" ? (
      <SocialTab data={await loadSocialReport(ctx, period)} />
    ) : (
      <SiteReport
        data={await loadSiteReport(ctx, period)}
        canEdit={can(ctx, "content", "write")}
      />
    );

  return (
    <div className="flex max-w-[880px] flex-col gap-6">
      <ScreenHeader
        title="Reports"
        helpId={`reports.${tab}`}
        helpName={tabs.find((t) => t.id === tab)?.label}
        LinkComponent={GuardedLink}
      />
      <TabLinks
        label="Reports sections"
        activeId={tab}
        tabs={tabs.map((t) => ({
          id: t.id,
          label: t.label,
          href: `?tab=${encodeURIComponent(t.id)}&period=${period}`,
        }))}
        LinkComponent={GuardedLink}
      />
      <PeriodControl
        value={period}
        hrefFor={(p) => reportHref(tab, p)}
        LinkComponent={GuardedLink}
      />
      <div key={`${tab}-${period}`}>{panel}</div>
    </div>
  );
}
