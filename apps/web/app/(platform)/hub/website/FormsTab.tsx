// Website › Forms (CONT-25, D231, D270, D311; 07-UI-SPEC "Forms"). 07-18 replaces the 07-03
// shell. Server panel: reads the site's live forms and, per form, where it is placed
// (choice 6: one formUsedOn per form, each in its own try/catch so a failure drops only that
// row's usage). With &form=new it shows the template chooser (writers only); with
// &form=<id> it reads the form, the pages, the email routes (Forbidden -> labels only,
// choice 7) and the org's theme for the live preview. A form that is gone or deleted shows
// the GONE notice over the list. The org comes only from the session; the `form` param is
// "new" or an id matching /^[a-z0-9]{1,32}$/i, anything else is ignored (T-07-18-04).
// 10-38 (D234, choice 4): members who can delete messages (content write) see a warning
// InlineAlert at 80 % of the 1 GB of form uploads and another at 100 % (upload fields hidden),
// only when a live form has a File upload field. A failed usage read shows nothing.
import { CdsError, can } from "@cds/core";
import { FORM_UPLOAD_USAGE_COPY, formatFileSize } from "@cds/core/forms";
import { resolveTheme } from "@cds/core/theme";
import {
  formUploadUsage,
  formUsedOn,
  getForm,
  listEmailRoutes,
  listForms,
  listPages,
  readOrganizationDesign,
  type FormListRow,
  type FormRecord,
  type OrgContext,
} from "@cds/db";
import { InlineAlert, Skeleton, buttonClasses } from "@cds/ui/hub";
import type { EmailRouteView, FormRowView } from "@cds/ui/hub";
import Link from "next/link";
import { Suspense, type JSX } from "react";
import { contentDeps } from "../../../../lib/content";
import { getEntitlements } from "../../../../lib/entitlements";
import { requireHubSession } from "../../../../lib/session";
import { themeOrNeutral } from "../../../../lib/theme-read";
import { FormsPanel, type FormsPanelEditor } from "./FormsPanel";

export type SearchParams = Record<string, string | string[] | undefined>;

const ID = /^[a-z0-9]{1,32}$/i;
const LIST_HREF = "/hub/website?tab=forms";

function one(v: string | string[] | undefined): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function formParam(sp: SearchParams): "new" | string | null {
  const raw = one(sp.form);
  if (raw === "new") return "new";
  return raw !== null && ID.test(raw) ? raw : null;
}

async function withUsage(
  ctx: OrgContext,
  rows: readonly FormListRow[],
): Promise<FormRowView[]> {
  const sections = contentDeps().sections;
  return Promise.all(
    rows.map(async (r) => {
      let usage: FormRowView["usage"] = null;
      try {
        usage = await formUsedOn(ctx, sections, r.id);
      } catch (err) {
        console.error("[hub] form usage read failed", err);
      }
      return {
        id: r.id,
        name: r.name,
        template: r.template,
        fieldCount: r.fieldCount,
        unread: r.unread,
        inReview: r.inReview,
        deleted: r.deleted,
        usage,
      };
    }),
  );
}

async function routesOf(ctx: OrgContext): Promise<EmailRouteView[] | null> {
  try {
    const routes = await listEmailRoutes(ctx);
    return routes.map((r) => ({
      purpose: r.purpose,
      address: r.address,
      status: r.status,
    }));
  } catch {
    return null;
  }
}

async function editorFor(
  ctx: OrgContext,
  id: string,
): Promise<FormsPanelEditor | null> {
  let form: FormRecord;
  try {
    form = await getForm(ctx, id);
  } catch (err) {
    if (
      err instanceof CdsError &&
      (err.code === "not_found" || err.code === "invalid_input")
    ) {
      return null;
    }
    throw err;
  }
  if (form.deleted) return null;
  const [pages, routes, design, ent] = await Promise.all([
    listPages(ctx),
    routesOf(ctx),
    themeOrNeutral(readOrganizationDesign(ctx), "hub"),
    entitlementKeys(ctx),
  ]);
  return {
    form: {
      id: form.id,
      name: form.name,
      layout: form.layout,
      fields: form.fields,
      after_submit: form.after_submit,
      notify_route: form.notify_route,
      newsletter_checkbox: form.newsletter_checkbox,
      newsletter_wording: form.newsletter_wording,
      template: form.template,
      inReview: form.inReview,
      deleted: form.deleted,
      // Forms Pro settings (10-39): the editor shows them live, or read-only while paused.
      ...(form.pro ? { pro: form.pro } : {}),
    },
    pages: pages.map((p) => ({ id: p.id, title: p.title })),
    routes,
    theme: resolveTheme(design),
    entitlements: ent,
    canBuy: can(ctx, "purchases", "run"),
  };
}

/** The org's entitlement keys (cached server read, 10-17). A failure locks Pro, never breaks the editor. */
async function entitlementKeys(ctx: OrgContext): Promise<string[]> {
  try {
    return (await getEntitlements(ctx)).keys;
  } catch (err) {
    console.error("[hub] entitlements read failed", err);
    return [];
  }
}

/** The 80 % / 100 % form-upload alert, or null (10-38 choice 4). */
async function uploadAlert(
  ctx: OrgContext,
  canWrite: boolean,
): Promise<JSX.Element | null> {
  if (!canWrite) return null;
  try {
    const usage = await formUploadUsage(ctx);
    if (!usage.hasFileFields || usage.level === "ok") return null;
    return (
      <div data-upload-usage={usage.level} className="mb-4">
        <InlineAlert tone="warning">
          {usage.level === "full"
            ? FORM_UPLOAD_USAGE_COPY.full
            : FORM_UPLOAD_USAGE_COPY.warn(formatFileSize(usage.usedBytes))}
        </InlineAlert>
      </div>
    );
  } catch (err) {
    console.error("[hub] form upload usage read failed", err);
    return null;
  }
}

/** The panel itself (exported for tests); FormsTab streams it behind the skeleton rows. */
export async function FormsTabBody({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<JSX.Element> {
  const { ctx } = await requireHubSession();
  const canWrite = can(ctx, "content", "write");
  const param = formParam(searchParams);

  let rows: FormListRow[];
  try {
    rows = await listForms(ctx);
  } catch (err) {
    console.error("[hub] forms load failed", err);
    return (
      <InlineAlert
        tone="error"
        action={
          <Link href={LIST_HREF} className={buttonClasses("secondary", "sm")}>
            Try again
          </Link>
        }
      >
        We couldn&apos;t load this. Check your connection and try again.
      </InlineAlert>
    );
  }

  const [forms, alert] = await Promise.all([
    withUsage(ctx, rows),
    uploadAlert(ctx, canWrite),
  ]);
  let editor: FormsPanelEditor | null = null;
  let gone = false;
  if (param !== null && param !== "new") {
    editor = await editorFor(ctx, param);
    gone = editor === null;
  }
  const panel = (
    <FormsPanel
      key={param ?? "list"}
      forms={forms}
      canWrite={canWrite}
      creating={param === "new" && canWrite}
      editor={editor}
      gone={gone}
    />
  );
  if (!alert) return panel;
  return (
    <>
      {alert}
      {panel}
    </>
  );
}

function FormsLoading() {
  return <Skeleton rows={3} />;
}

export async function FormsTab(
  searchParams: SearchParams = {},
): Promise<JSX.Element> {
  return (
    <Suspense fallback={<FormsLoading />}>
      <FormsTabBody searchParams={searchParams} />
    </Suspense>
  );
}
