// /hub/settings/quotes/<id>: the owner's quote from CDS (10-30; BILL-20; CONTEXT A4; D297,
// D299; D-UI-P10-15, D-UI-P10-16; 10-UI-SPEC "Quote page"). Inside Settings with the Billing
// tab active, a "← Billing" back link, then QuoteDetail: scope, price by kind, Pay now, the
// acceptance tick and Accept and pay (or the status block once answered). 11-47: the tab bar
// comes from HUB_SECTIONS (DASH-25) and the "?" opens the Billing how-to (`settings.billing`).
//
// Owner only (`billing:read`): Admin, Editor and Viewer go to /hub. Impersonating staff see it
// read-only (QuoteDetail shows IMPERSONATING-PAY; the actions refuse them too, T-10-30-02).
// The id is checked with a strict regex before any db call; the chokepoint read is scoped by
// the session's org, and NotFound / Forbidden both render notFound() so another org's id
// looks exactly like an unknown one (10-30 choice 1, T-10-30-01). A failed read shows
// ERR-LOAD with Try again.
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { CdsError, can } from "@cds/core";
import { billingTabCounts, readWorkOrder } from "@cds/db";
import { InlineAlert, TabLinks, buttonClasses } from "@cds/ui/hub";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  requireHubSession,
  type HubSession,
} from "../../../../../../lib/session";
import { GuardedLink } from "../../../GuardedLink";
import { HUB_SECTIONS } from "../../../sections";
import { BILLING_TAB } from "../../billing-copy";
import { SettingsFrame } from "../../SettingsPanels";
import {
  settingsTabHref,
  settingsTabLabel,
  type SettingsTabId,
} from "../../tabs";
import { QuotePanel } from "./QuotePanel";

export const metadata: Metadata = { title: "Quote from Support" };

export const dynamic = "force-dynamic";

const QUOTE_ID = /^[a-z0-9]{15}$/;

type Ctx = HubSession["ctx"];
type Loaded =
  | { kind: "ok"; view: Awaited<ReturnType<typeof readWorkOrder>> }
  | { kind: "missing" }
  | { kind: "error" };

async function load(ctx: Ctx, id: string): Promise<Loaded> {
  try {
    return { kind: "ok", view: await readWorkOrder(ctx, id) };
  } catch (err) {
    if (
      err instanceof CdsError &&
      (err.code === "not_found" || err.code === "forbidden")
    ) {
      return { kind: "missing" };
    }
    console.error(
      "[hub] quote read failed",
      err instanceof Error ? err.name : typeof err,
    );
    return { kind: "error" };
  }
}

/** "Payments · 1" / "Billing · n" as on the Settings page; a failed read counts 0. */
async function counts(
  ctx: Ctx,
): Promise<{ payments: number; billing: number }> {
  try {
    const c = await billingTabCounts(ctx);
    return { payments: c.payments, billing: c.billing };
  } catch (err) {
    console.error(
      "[hub] quote: billing count failed",
      err instanceof Error ? err.name : typeof err,
    );
    return { payments: 0, billing: 0 };
  }
}

export default async function QuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { ctx } = await requireHubSession();
  if (!can(ctx, "billing", "read")) redirect("/hub");

  const { id } = await params;
  if (!QUOTE_ID.test(id)) notFound();

  const [loaded, c] = await Promise.all([load(ctx, id), counts(ctx)]);
  if (loaded.kind === "missing") notFound();

  return (
    <SettingsFrame
      readOnly={false}
      helpId="settings.billing"
      helpName="Billing"
      tabBar={
        <TabLinks
          label="Settings sections"
          activeId="billing"
          tabs={HUB_SECTIONS.settings
            .tabs({
              role: ctx.role,
              grants: ctx.grants,
              active: [],
              registry: ADDON_REGISTRY,
            })
            .map((t) => ({
              id: t.id,
              label: settingsTabLabel(t.id as SettingsTabId, {
                payments: c.payments,
                billing: c.billing,
              }),
              href: settingsTabHref(t.id as SettingsTabId),
            }))}
          LinkComponent={GuardedLink}
        />
      }
    >
      <div className="flex flex-col gap-6">
        <Link
          href={BILLING_TAB}
          className="self-start text-sm font-semibold text-hub-accent underline-offset-2 hover:underline"
        >
          <span aria-hidden="true">← </span>Billing
        </Link>
        {loaded.kind === "ok" ? (
          <QuotePanel id={id} view={loaded.view} />
        ) : (
          <InlineAlert
            tone="error"
            action={
              <Link
                href={`/hub/settings/quotes/${encodeURIComponent(id)}`}
                className={buttonClasses("secondary", "sm")}
              >
                Try again
              </Link>
            }
          >
            We couldn&apos;t load this. Check your connection and try again.
          </InlineAlert>
        )}
      </div>
    </SettingsFrame>
  );
}
