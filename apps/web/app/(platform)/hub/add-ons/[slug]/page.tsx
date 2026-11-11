// Add-on detail (ADDON-05, ADDON-07, ADDON-09, ADDON-11; 05-UI-SPEC "Detail", "Add and
// remove"; T-05-54). Back link, Display name + On your site badge, one primary action top
// right (Add to site, or Manage <plural> + View on site), the summary, then What it adds,
// How it works (training title + first 3 steps + Read all steps), Works with (omitted when
// empty) and Remove from site (only when added). Refusals render as an InlineAlert above
// the header action. An unknown or private slug is a 404, identical either way.
// P10 (10-31; BILL-03, BILL-18, D27): the catalog price sits under the name; a billing-lapsed
// add-on shows the Paused badge, the PAUSED-ADDON alert above the header action, the Owner's
// "Update card and pay", and keeps its Remove section.
// 13-32 (STAFF-07): the merged catalog view supplies the description and screenshots; a
// hidden listing is the same 404 as an unknown slug unless the add-on is on the site (so its
// owner can still manage or remove it); a coming-soon one shows the badge and a disabled
// Add to site. Behaviour and training still come from the manifest.
import { ADDON_REGISTRY, howToSteps } from "@cds/addon-registry";
import { can } from "@cds/core";
import type { AddonManifest } from "@cds/core/addons";
import {
  activeAddons,
  listOrgAddons,
  listPages,
  orgPlanPath,
  readBillingAccount,
  retainedRecordCounts,
  type OrgAddonRow,
  type OrgContext,
} from "@cds/db";
import { Badge, InlineAlert } from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import {
  ArrowLeft,
  FileText,
  LayoutTemplate,
  PanelsTopLeft,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addAddonAction,
  addBothAction,
  removeAddonAction,
  addAddonPreviewAction,
  updateCardAction,
} from "../../../../actions/addons";
import { addonDeps } from "../../../../../lib/addons";
import { getCatalog } from "../../../../../lib/catalog";
import {
  catalogEntryFor,
  getCatalogView,
  type CatalogEntry,
} from "../../../../../lib/catalog-view";
import { requireHubSession } from "../../../../../lib/session";
import { GuardedLink } from "../../GuardedLink";
import {
  AddFlowProvider,
  DetailHeaderActions,
  HowItWorks,
  RemoveSection,
} from "../AddonActions";
import {
  addonMonthlyCents,
  addonPriceLabel,
  availability,
  COMING_SOON,
  namesOf,
  pausedSlugs,
  refusalCopy,
  removeBillLine,
  whatItAdds,
  worksWith,
  type AddonRef,
  type WhatItAddsIcon,
} from "../catalog-logic";
import { LoadError } from "../LoadError";
import { buildView, detailHref } from "../views";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/** Public catalog only, own-property lookup: private and unknown are the same 404. */
function publicManifest(slug: unknown): AddonManifest | null {
  if (typeof slug !== "string") return null;
  const map: Record<string, AddonManifest> = Object.create(null);
  for (const m of ADDON_REGISTRY.publicList()) map[m.slug] = m;
  return Object.hasOwn(map, slug) ? map[slug]! : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const m = publicManifest((await params).slug);
  return { title: m ? m.name : "Get add-ons" };
}

const ICONS: Record<WhatItAddsIcon, LucideIcon> = {
  FileText,
  LayoutTemplate,
  PanelsTopLeft,
};

function SectionHeading({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="mb-4 text-xl leading-tight font-semibold">
      {children}
    </h2>
  );
}

function RefLinks({ refs }: { refs: readonly AddonRef[] }) {
  return refs.map((r, i) => (
    <span key={r.slug}>
      {i > 0 ? ", " : null}
      <Link
        href={detailHref(r.slug)}
        className="text-hub-accent underline underline-offset-2"
      >
        {r.name}
      </Link>
    </span>
  ));
}

/** The seeded page's live URL; the site home if the owner deleted it; null without a host. */
async function seededPageUrl(
  host: string | null,
  row: OrgAddonRow | undefined,
  load: () => ReturnType<typeof listPages>,
): Promise<string | null> {
  if (!host) return null;
  const home = `https://${host}/`;
  const page = row?.seeded.page;
  if (!page) return home;
  const pages = await load();
  const found = pages.find((p) => p.id === page.id);
  return found ? `${home}${encodeURIComponent(found.slug)}` : home;
}

/**
 * The Remove dialog's bill line: only for the Owner (the one who can remove), once checkout
 * is paid. A billing read failure just drops the line; it never blocks the page.
 */
async function removeBillFor(
  ctx: OrgContext,
  slug: string,
  monthlyCents: number | null,
  removable: boolean,
): Promise<string | null> {
  if (!removable || ctx.role !== "owner" || ctx.impersonator) return null;
  try {
    const account = await readBillingAccount(ctx);
    if (!account) return null;
    // WR-D04: the price this add-on is billed at (a price lock keeps the old amount), per
    // its own interval; the catalog on the account's cadence until the mirror has it.
    const billed = (account.itemPrices ?? []).find(
      (p) => p.kind === "addon" && p.key === slug && p.interval !== "once",
    );
    if (billed) {
      return removeBillLine(
        billed.unitCents * Math.max(1, billed.quantity),
        Boolean(account.paidAt),
        billed.interval === "year" ? "year" : "month",
      );
    }
    if (monthlyCents === null || monthlyCents <= 0) return null;
    return account.cadence === "yearly"
      ? removeBillLine(monthlyCents * 10, Boolean(account.paidAt), "year")
      : removeBillLine(monthlyCents, Boolean(account.paidAt));
  } catch (err) {
    console.error("[hub] add-on billing read failed", err);
    return null;
  }
}

function Screenshots({ entry }: { entry: CatalogEntry | null }) {
  const shots = entry?.screenshots ?? [];
  if (shots.length === 0) return null;
  return (
    <ul aria-label="Screenshots" className="mt-6 flex flex-wrap gap-4">
      {shots.map((s) => (
        <li key={s.id}>
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded"
          >
            {/* Host-relative /_catalog URL served by the app (13-20, 13-37). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.url}
              alt={s.alt}
              width={s.w || 160}
              height={s.h || 100}
              loading="lazy"
              className="h-[100px] w-40 rounded border border-hub-border object-cover"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}

export default async function AddonDetailPage({ params }: Props) {
  const { ctx, org } = await requireHubSession();
  if (!can(ctx, "addons", "read")) notFound();
  const m = publicManifest((await params).slug);
  if (!m) notFound();
  const entry = catalogEntryFor(await getCatalogView(), m.slug);

  let active: string[];
  let retained = 0;
  let pageUrl: string | null = null;
  let priceLabel: string | null = null;
  let paused = false;
  let removeBill: string | null = null;
  let hidden = false;
  try {
    let rows: OrgAddonRow[];
    let catalog: Awaited<ReturnType<typeof getCatalog>>;
    let path: string;
    [active, rows, catalog, path] = await Promise.all([
      activeAddons(ctx),
      listOrgAddons(ctx),
      getCatalog(),
      orgPlanPath(ctx),
    ]);
    priceLabel = addonPriceLabel(catalog, m.slug, path);
    paused = pausedSlugs(rows).has(m.slug);
    removeBill = await removeBillFor(
      ctx,
      m.slug,
      addonMonthlyCents(catalog, m.slug, path),
      active.includes(m.slug) || paused,
    );
    const row = rows.find((r) => r.addon === m.slug);
    const isOn = active.includes(m.slug);
    // A hidden listing is absent for owners who don't have it (same 404 as unknown);
    // notFound() runs after the try so the catch never turns it into a load error.
    hidden = !entry && !isOn && !paused;
    if (isOn) {
      pageUrl = await seededPageUrl(org.primaryHost, row, () => listPages(ctx));
    } else if (row && ctx.role === "owner") {
      retained = await retainedRecordCounts(ctx, addonDeps(), m.slug);
    }
  } catch (err) {
    console.error("[hub] add-on detail failed", err);
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <ScreenHeader
          title={m.name}
          helpId="add-ons"
          helpName="Get add-ons"
          LinkComponent={GuardedLink}
        />
        <LoadError href={detailHref(m.slug)} />
      </div>
    );
  }

  if (hidden) notFound();
  const view = buildView({
    manifest: m,
    ctx,
    active,
    retained,
    pageUrl,
    registry: ADDON_REGISTRY,
    priceLabel,
    paused,
    removeBill,
    comingSoon: entry !== null && !entry.pickable,
  });
  const refusal = refusalCopy(
    m,
    availability({
      manifest: m,
      active,
      role: ctx.role,
      impersonating: Boolean(ctx.impersonator),
      registry: ADDON_REGISTRY,
    }),
    ADDON_REGISTRY,
  );
  const lines = whatItAdds(m);
  const works = worksWith(m, ADDON_REGISTRY);
  const training = m.training[0];
  const steps = training ? howToSteps(training.howTo) : [];
  const on = new Set(active);
  const dependents = namesOf(
    ADDON_REGISTRY.dependentsOf(m.slug).filter((d) => on.has(d)),
    ADDON_REGISTRY,
  );
  const actions = {
    add: addAddonAction,
    addBoth: addBothAction,
    remove: removeAddonAction,
    updateCard: updateCardAction,
    preview: addAddonPreviewAction,
  };
  const ownerRefusal =
    view.state === "not-owner" || view.state === "impersonating"
      ? (refusal?.text ?? null)
      : null;

  return (
    <AddFlowProvider actions={actions}>
      <div className="flex flex-col">
        <BackLink />
        <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            {/* 11-47: an added add-on's "?" opens its own how-to; otherwise Get add-ons. */}
            <ScreenHeader
              title={m.name}
              helpId={view.active ? `add-ons.${m.slug}` : "add-ons"}
              helpName={view.active ? m.name : "Get add-ons"}
              LinkComponent={GuardedLink}
            >
              {view.active ? <Badge tone="on-site">On your site</Badge> : null}
              {view.paused ? <Badge tone="paused">Paused</Badge> : null}
              {view.comingSoon && !view.paused ? (
                <Badge tone="coming-soon">{COMING_SOON}</Badge>
              ) : null}
            </ScreenHeader>
            {view.priceLabel === null ? (
              <p data-addon-price="" className="text-sm text-hub-ink-muted">
                Price coming soon
              </p>
            ) : (
              <p
                data-addon-price=""
                className="text-base font-semibold tabular-nums"
              >
                {view.priceLabel}
              </p>
            )}
          </div>
          <div className="flex max-w-md flex-col items-end gap-3">
            {view.paused ? (
              <InlineAlert tone="warning">{view.pausedCopy}</InlineAlert>
            ) : null}
            {refusal && !view.active && !view.paused && !view.comingSoon ? (
              <InlineAlert tone={refusal.tone}>{refusal.text}</InlineAlert>
            ) : null}
            <DetailHeaderActions view={view} />
          </div>
        </div>
        <p className="mt-4 max-w-[68ch] text-base whitespace-pre-line">
          {entry?.description ?? m.summary}
        </p>
        <Screenshots entry={entry} />

        <section aria-labelledby="adds-heading" className="mt-12">
          <SectionHeading id="adds-heading">What it adds</SectionHeading>
          <ul className="flex flex-col gap-2">
            {lines.map((l) => {
              const Icon = ICONS[l.icon];
              return (
                <li key={l.text} className="flex items-center gap-2 text-base">
                  <Icon aria-hidden size={16} strokeWidth={2} />
                  {l.text}
                </li>
              );
            })}
          </ul>
        </section>

        {training && steps.length > 0 ? (
          <section aria-labelledby="how-heading" className="mt-12">
            <SectionHeading id="how-heading">How it works</SectionHeading>
            <HowItWorks
              title={training.title}
              steps={steps.map((s) => ({ ...s }))}
            />
          </section>
        ) : null}

        {works.needs.length > 0 || works.cantUseWith.length > 0 ? (
          <section aria-labelledby="works-heading" className="mt-12">
            <SectionHeading id="works-heading">Works with</SectionHeading>
            <ul className="flex flex-col gap-2 text-base">
              {works.needs.length > 0 ? (
                <li>
                  Needs: <RefLinks refs={works.needs} />
                </li>
              ) : null}
              {works.cantUseWith.length > 0 ? (
                <li>
                  Can&apos;t be used with: <RefLinks refs={works.cantUseWith} />
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}

        {view.active || view.paused ? (
          <RemoveSection
            view={view}
            actions={actions}
            dependents={dependents}
            refusal={ownerRefusal}
          />
        ) : null}
      </div>
    </AddFlowProvider>
  );
}

function BackLink() {
  return (
    <Link
      href="/hub/add-ons"
      className="inline-flex items-center gap-1 self-start rounded text-sm text-hub-ink-muted hover:text-hub-ink hover:underline"
    >
      <ArrowLeft aria-hidden size={16} strokeWidth={2} />
      Get add-ons
    </Link>
  );
}
