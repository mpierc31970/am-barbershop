// /_site/review/note?page=<id> on a preview host (14-35 choice 3; DOM-10, D172; 14-UI-SPEC
// "Review mode" Needs a change): the owner says what should change on one page. Platform
// chrome, not the site's: the tenant layout renders nothing around this path (no theme, header
// or footer), so this page draws the ink review strip and a hub-surface 560px column in the hub
// system stack. The form is no-JS: POST /_site/review/send (Origin + `cds_rv` checks there),
// which files a P12 change ticket on `page:<id>` and returns to the page with "Sent. CDS will
// make the change and tell you.". `e=short` shows NOTE-SHORT (the short text comes back in
// `n`), `e=send` ERR-SEND. Without a valid owner review cookie: a plain "link ended" note with
// the way back to the hub. Never indexed.
import { P14_COPY } from "@cds/core/dns";
import { buttonClasses, TextArea } from "@cds/ui/hub";
import {
  platformUrl,
  reviewContextForToken,
  reviewPages,
  type ReviewPage,
} from "@cds/db";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import {
  REVIEW_COOKIE,
  REVIEW_NOTE_COPY,
  REVIEW_PAGE_ID_RE,
  REVIEW_SEND_PATH,
  safeReviewPath,
} from "../../../../../../lib/review-mode";
import { siteForRequest } from "../../../../../../lib/tenant";
import { PreviewStrip } from "../../../_chrome/PreviewStrip";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ host: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function one(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

function hubReviewHref(): string {
  try {
    return platformUrl("/hub/review");
  } catch {
    return "/";
  }
}

const SKIP =
  "sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded focus:bg-hub-surface focus:px-4 focus:py-3 focus:font-hub focus:font-semibold focus:text-hub-ink focus:shadow-lg";

export default async function ReviewNotePage({ params, searchParams }: Props) {
  const { host } = await params;
  const site = await siteForRequest(host);
  if (site.hostKind !== "preview") notFound();
  const q = await searchParams;
  const pageId = one(q.page);
  if (!REVIEW_PAGE_ID_RE.test(pageId)) notFound();
  const backHref = hubReviewHref();

  const token = (await cookies()).get(REVIEW_COOKIE)?.value;
  // WR-D02: a failed read (PocketBase blip, membership re-check throwing) shows the
  // "link ended" page with the way back, never a raw 500 (the layout cannot catch here).
  let pages: ReviewPage[] | null = null;
  try {
    const ctx = token ? await reviewContextForToken(token) : null;
    pages = ctx && ctx.orgId === site.orgId ? await reviewPages(ctx) : null;
  } catch (err) {
    console.error(
      "[site] review note failed",
      err instanceof Error ? err.name : typeof err,
    );
    pages = null;
  }
  const index = pages ? pages.findIndex((p) => p.id === pageId) : -1;
  const page = pages && index >= 0 ? pages[index]! : null;

  const strip = (
    <PreviewStrip
      variant="review"
      review={{
        page:
          page && pages
            ? { index: index + 1, total: pages.length, title: page.title }
            : null,
        status: null,
        backHref,
        phoneCheckPageId: null,
      }}
    />
  );

  if (!pages) {
    return (
      <div className="min-h-screen bg-hub-surface font-hub text-hub-ink">
        <a href="#content" className={SKIP}>
          Skip to content
        </a>
        {strip}
        <main
          id="content"
          className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-12"
        >
          <h1 className="text-2xl leading-tight font-semibold">
            This review link has ended
          </h1>
          <p className="text-base text-hub-ink-muted">
            Open your review again from your dashboard.
          </p>
          <p>
            <a href={backHref} className={buttonClasses("secondary")}>
              {P14_COPY.BTN_BACK_TO_REVIEW}
            </a>
          </p>
        </main>
      </div>
    );
  }
  if (!page) notFound();

  const err = one(q.e);
  const error =
    err === "short"
      ? REVIEW_NOTE_COPY.short
      : err === "send"
        ? REVIEW_NOTE_COPY.error
        : undefined;
  const typed = err === "short" ? one(q.n).slice(0, 2000) : "";
  const pagePath = safeReviewPath(page.path) ?? "/";

  return (
    <div className="min-h-screen bg-hub-surface font-hub text-hub-ink">
      <a href="#content" className={SKIP}>
        Skip to content
      </a>
      {strip}
      <main
        id="content"
        className="mx-auto flex w-full max-w-[560px] flex-col gap-6 px-4 py-8 sm:py-12"
      >
        <h1 className="text-2xl leading-tight font-semibold">
          {REVIEW_NOTE_COPY.heading(page.title)}
        </h1>
        <form
          method="post"
          action={REVIEW_SEND_PATH}
          className="flex flex-col gap-6"
        >
          <input type="hidden" name="page" value={page.id} />
          <TextArea
            id="review-note"
            name="note"
            label={REVIEW_NOTE_COPY.label}
            helper={REVIEW_NOTE_COPY.helper}
            error={error}
            rows={6}
            minLength={10}
            maxLength={2000}
            required
            defaultValue={typed}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={buttonClasses("primary")}>
              {REVIEW_NOTE_COPY.send}
            </button>
            <a href={pagePath} className={buttonClasses("ghost")}>
              {REVIEW_NOTE_COPY.back}
            </a>
          </div>
        </form>
      </main>
    </div>
  );
}
