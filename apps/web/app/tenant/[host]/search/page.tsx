// /search on tenant hosts (07-31 choice 11; CONT-28, CONT-37; D277, D119; 07-UI-SPEC lines
// 535-542, 569, 642-643). Server-rendered under the site chrome (the tenant layout), works
// without JS: a GET form, numbered page links.
//
// Reads only index.json (getSiteIndex) and never filters pages itself: excluded pages are
// never written to the index. The query is normalized (<= 100 chars, <= 8 terms) and echoed
// as React text only (T-07-31-03). States: empty query -> helper text; no results ->
// SEARCH-NONE + Popular pages (top-level menu links); a failed index read -> the UI-SPEC error
// copy, never a 500; nothing published yet -> zero results. noindex, follow on every host.
// A static route: it wins over the [[...path]] catch-all ("search" is a reserved slug).
import { normalizeQuery, searchSiteIndex } from "@cds/core/seo";
import type { SiteContext, SiteIndex } from "@cds/db";
import {
  PageTitleHeader,
  PopularPages,
  SEARCH_COPY,
  SearchResults,
  SiteSearchForm,
} from "@cds/ui/site";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  getLiveSite,
  getManifest,
  getSiteIndex,
} from "../../../../lib/site-cache";
import { popularPages } from "../../../../lib/site-chrome";
import { siteForRequest } from "../../../../lib/tenant";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ host: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export function generateMetadata(): Metadata {
  return {
    title: SEARCH_COPY.title,
    robots: { index: false, follow: true },
  };
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function pageParam(v: string | string[] | undefined): number {
  const n = Number.parseInt(first(v) ?? "", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 1;
}

async function popular(site: SiteContext) {
  try {
    const [live, manifest] = await Promise.all([
      getLiveSite(site),
      getManifest(site).catch(() => null),
    ]);
    return await popularPages(site, { live, manifest });
  } catch {
    return [];
  }
}

const MUTED =
  "text-[length:var(--site-text-body)] leading-[1.6] text-site-text-muted";

export default async function SearchPage({ params, searchParams }: Props) {
  const { host } = await params;
  const site = await siteForRequest(host);
  // The one await of searchParams.
  const sp = searchParams ? await searchParams : null;
  const q = normalizeQuery(first(sp?.q));
  const page = pageParam(sp?.page);

  let body: ReactNode;
  if (q === "") {
    body = <p className={MUTED}>{SEARCH_COPY.empty}</p>;
  } else {
    let index: SiteIndex | null = null;
    let failed = false;
    try {
      index = await getSiteIndex(site);
    } catch {
      failed = true;
    }
    if (failed) {
      body = (
        <p role="alert" className={MUTED}>
          {SEARCH_COPY.error}
        </p>
      );
    } else {
      const out = searchSiteIndex(index, q, { page });
      if (out.empty || out.total === 0) {
        const links = await popular(site);
        body = (
          <div className="flex flex-col gap-4">
            <p role="status" aria-live="polite" className={MUTED}>
              {SEARCH_COPY.none(q)}
            </p>
            <PopularPages links={links} />
          </div>
        );
      } else {
        body = (
          <SearchResults
            query={out.query}
            total={out.total}
            results={out.results}
            hostLabel={site.primaryHost ?? site.host}
            page={out.page}
            pages={out.pages}
          />
        );
      }
    }
  }

  return (
    <main
      id="content"
      tabIndex={-1}
      className="outline-none"
      data-search-page=""
    >
      <PageTitleHeader title={SEARCH_COPY.title} />
      <div className="mx-auto max-w-[1120px] px-6 pb-16 md:px-8">
        <div className="flex max-w-[720px] flex-col gap-8">
          <SiteSearchForm defaultValue={q} autoFocus={q === ""} />
          {body}
        </div>
      </div>
    </main>
  );
}
