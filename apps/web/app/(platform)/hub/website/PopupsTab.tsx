// Website › Pop-ups tab (CONT-12, D118, D124, D119; 03-UI-SPEC "Pop-ups tab"; T-03-58).
// Server-loads the site's pop-ups and pages for the signed-in member. Two panes like the
// builder: the list (360px) and the editor for ?popup=<id> (or ?popup=new). The org comes
// only from the session cookie; an unknown pop-up id just shows the list.
//
// Preview: every saved pop-up is server-rendered here as its real public <dialog> markup
// inside SiteThemeScope (display: contents, so it adds no box) carrying the org's real
// theme (THEME-02; 04-UI-SPEC "Theme in the hub"), with one
// PopupController forced into click mode. Any hub button carrying
// data-cds-popup-open="<id>" (the editor's Preview pop-up, the row's overflow item) opens
// it; automatic triggers never fire in the hub.
import type { PopupRecord } from "@cds/core/content";
import { popupSummary } from "@cds/core/content";
import { resolveTheme } from "@cds/core/theme";
import {
  listForms,
  listPages,
  listPopups,
  readOrganizationDesign,
  type PageSummary,
} from "@cds/db";
import { EmptyState, InlineAlert, buttonClasses } from "@cds/ui/hub";
import {
  PopupDialog,
  SiteThemeScope,
  popupControllerConfig,
} from "@cds/ui/site";
import { PopupController } from "@cds/ui/site/client";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { GuardedLink } from "../GuardedLink";
import { requireHubSession } from "../../../../lib/session";
import { themeOrNeutral } from "../../../../lib/theme-read";
import { PopupEditor } from "./PopupEditor";
import { PopupList, type PopupRow } from "./PopupList";
import { popupsHref } from "./popup-logic";

type SearchParams = Record<string, string | string[] | undefined>;

const PREVIEW_PAGE_ID = "hub-preview";

function one(v: string | string[] | undefined): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function previewConfig(p: PopupRecord) {
  return {
    ...popupControllerConfig(p),
    enabled: true,
    trigger: "click" as const,
    show_on: "button-only" as const,
    page_ids: [],
  };
}

/** The site's forms for the Form item picker; a failure never breaks the tab (07-18). */
async function formOptions(
  ctx: Parameters<typeof listForms>[0],
): Promise<{ id: string; name: string; deleted: boolean }[]> {
  try {
    const rows = await listForms(ctx, { includeDeleted: true });
    return rows.map((f) => ({ id: f.id, name: f.name, deleted: f.deleted }));
  } catch (err) {
    console.error("[hub] pop-up forms load failed", err);
    return [];
  }
}

/** UI-SPEC: the 07-18 forms wording for a selection that no longer exists. */
const POPUP_GONE_COPY =
  "This was removed or moved. Reload the page to see the latest.";

export async function PopupsTab(searchParams: SearchParams) {
  const { ctx } = await requireHubSession();
  let popups: PopupRecord[];
  let pages: PageSummary[];
  let design: unknown;
  let forms: { id: string; name: string; deleted: boolean }[];
  try {
    [popups, pages, design, forms] = await Promise.all([
      listPopups(ctx),
      listPages(ctx),
      themeOrNeutral(readOrganizationDesign(ctx), "hub"),
      formOptions(ctx),
    ]);
  } catch (err) {
    console.error("[hub] pop-ups load failed", err);
    return (
      <InlineAlert
        tone="error"
        action={
          <Link
            href={popupsHref()}
            className={buttonClasses("secondary", "sm")}
          >
            Try again
          </Link>
        }
      >
        We couldn&apos;t load this. Check your connection and try again.
      </InlineAlert>
    );
  }

  const raw = one(searchParams.popup);
  const creating = raw === "new";
  const selected = creating ? null : (popups.find((p) => p.id === raw) ?? null);
  const editorOpen = creating || selected !== null;
  // A deleted (or foreign, or mistyped) ?popup= id shows the list with a note (07-28).
  const gone = !creating && typeof raw === "string" && raw !== "" && !selected;

  if (popups.length === 0 && !creating) {
    return (
      <EmptyState
        heading="No pop-ups yet"
        body="A pop-up can show an offer, a sign-up or a notice. Create one, then choose when it appears or point a button at it."
        action={
          <Link href={popupsHref("new")} className={buttonClasses("primary")}>
            Create pop-up
          </Link>
        }
      />
    );
  }

  const rows: PopupRow[] = popups.map((p) => ({
    id: p.id,
    name: p.name,
    summary: popupSummary(p),
    enabled: p.enabled,
  }));
  const now = new Date();
  const theme = resolveTheme(design);

  return (
    <div className="grid gap-8 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
      <div className={editorOpen ? "hidden lg:block" : "flex flex-col gap-4"}>
        {gone ? <InlineAlert tone="info">{POPUP_GONE_COPY}</InlineAlert> : null}
        <PopupList
          popups={rows}
          selectedId={creating ? "new" : (selected?.id ?? null)}
        />
      </div>
      <div className={editorOpen ? undefined : "hidden lg:block"}>
        {editorOpen ? (
          <div className="flex flex-col gap-4">
            <GuardedLink
              href={popupsHref()}
              className="inline-flex w-fit items-center gap-1 rounded text-sm font-semibold text-hub-ink-muted hover:text-hub-ink lg:hidden"
            >
              <ChevronLeft aria-hidden size={16} strokeWidth={2} />
              Pop-ups
            </GuardedLink>
            <PopupEditor
              key={selected?.id ?? "new"}
              popup={selected}
              pages={pages.map((p) => ({ id: p.id, title: p.title }))}
              forms={forms}
            />
          </div>
        ) : (
          <p className="rounded border border-dashed border-hub-border px-6 py-12 text-base text-hub-ink-muted">
            Choose a pop-up to edit it, or create a new one.
          </p>
        )}
      </div>
      <SiteThemeScope theme={theme} className="contents">
        {popups.map((p) => (
          <PopupDialog key={p.id} popup={p} now={now} />
        ))}
        <PopupController
          config={popups.map(previewConfig)}
          pageId={PREVIEW_PAGE_ID}
        />
      </SiteThemeScope>
    </div>
  );
}
