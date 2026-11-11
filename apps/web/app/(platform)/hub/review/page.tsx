// /hub/review: the owner's launch review (14-34 choice 3; DOM-10, D172, D26, D312; 14-UI-SPEC
// "Launch review" lines 591-650; T-14-34-01, T-14-34-02). Mode: Operate, 720px column.
//   - Access: Owners act; Admins (and CDS staff viewing, who arrive as Admin or as an
//     impersonated Owner) read the list with no buttons; everyone else gets notFound() even
//     though the permission matrix lets Editors read launch_review (UI-SPEC: "others never
//     see it"). `launchReviewView(ctx).canAct` (Owner, not impersonated) decides the mode.
//   - `?step=facts` (KeyFactsConfirm), `?step=phone` (PhoneCheckPanel), else the checklist +
//     the submit panel.
//   - Review links: `<scheme>://<preview host>/_site/review/start?t=<signReviewToken(org, user,
//     mode)>&next=<path>` (review mode for the checklist, phone mode for the QR), minted per
//     request and only for the acting Owner, so no Admin or staff page ever holds one
//     (T-14-34-01). The preview host is the org's primary host while it is still on the
//     preview suffix (it stays primary until cutover, 14-23); otherwise no link is shown.
//   - The QR is `qrSvg(phoneUrl, { px: 160 | 200, label })` from @cds/core/qr: numbers plus an
//     escaped label only (T-14-34-02).
//   - ScreenHeader "?" only once the help map knows `review` (14-46 adds the alias; P13-P12).
// Load failures are logged by class name only and shown as one InlineAlert.
import { can } from "@cds/core";
import { P14_COPY } from "@cds/core/dns";
import { qrSvg } from "@cds/core/qr";
import {
  getBusinessProfile,
  launchReviewView,
  listEmailRoutes,
  previewHostSuffix,
  signReviewToken,
  type LaunchReviewView,
  type OrgContext,
} from "@cds/db";
import { InlineAlert } from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import {
  REVIEW_UI_COPY,
  ReviewChecklist,
  compactWeeklyHours,
  type KeyFactKey,
  type KeyFactsView,
  type ReviewSubmitReason,
} from "@cds/ui/hub/review";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { HELP_ALIASES } from "../../../../lib/help-index";
import { requireHubSession } from "../../../../lib/session";
import { GuardedLink } from "../GuardedLink";
import { FactsIsland, PhoneIsland, SubmitIsland } from "./ReviewIslands";

export const metadata: Metadata = { title: "Review your site" };

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
type Step = "facts" | "phone" | "list";

const COLUMN = "mx-auto flex w-full max-w-[720px] flex-col gap-8 font-hub";
const HELP_ID = "review";
const QR_LABEL = REVIEW_UI_COPY.qrLabel;
const FACTS_NEXT = encodeURIComponent("/hub/review?step=facts");
const DOMAIN_HREF = "/hub/settings?tab=domain";

const REVIEW_HREFS = Object.freeze({
  requests: "/hub/support?tab=tickets",
  facts: "/hub/review?step=facts",
  phone: "/hub/review?step=phone",
  inbox: "/hub/inbox",
});

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function parseStep(raw: unknown): Step {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "facts" || v === "phone" ? v : "list";
}

/** Who may open the screen at all: Owner and Admin (choice 3). */
function mayOpen(ctx: OrgContext): boolean {
  return (
    (ctx.role === "owner" || ctx.role === "admin") &&
    can(ctx, "launch_review", "read")
  );
}

/** Scheme and port for links to tenant hosts from this hub request (14-20 pattern). */
async function originParts(): Promise<{ scheme: string; port: string }> {
  if (process.env.CDS_ENV === "production")
    return { scheme: "https", port: "" };
  const host = (await headers()).get("host") ?? "";
  const m = /:(\d{1,5})$/.exec(host);
  return { scheme: "http", port: m ? `:${m[1]}` : "" };
}

/** The org's preview host: its primary host while that is still on the preview suffix. */
function previewHostOf(primaryHost: string | null): string | null {
  if (!primaryHost) return null;
  try {
    const suffix = previewHostSuffix();
    return primaryHost.endsWith(`.${suffix}`) ? primaryHost : null;
  } catch (err) {
    console.error(`[hub] review preview suffix failed ${errName(err)}`);
    return null;
  }
}

type ReviewLinks = {
  /** Build a review-mode URL that lands on `path`. */
  review: (path: string) => string;
  phone: string;
};

/** Mints the owner's review + phone links (60 minutes); null when no link is possible. */
async function mintLinks(
  ctx: OrgContext,
  previewHost: string | null,
  now: number,
): Promise<ReviewLinks | null> {
  if (!previewHost) return null;
  try {
    const { scheme, port } = await originParts();
    const base = `${scheme}://${previewHost}${port}/_site/review/start?t=`;
    const reviewToken = signReviewToken(ctx.orgId, ctx.actor, "review", now);
    const phoneToken = signReviewToken(ctx.orgId, ctx.actor, "phone", now);
    return {
      review: (path) =>
        `${base}${encodeURIComponent(reviewToken)}&next=${encodeURIComponent(path)}`,
      phone: `${base}${encodeURIComponent(phoneToken)}`,
    };
  } catch (err) {
    console.error(`[hub] review link failed ${errName(err)}`);
    return null;
  }
}

function addressLine(a: {
  street: string;
  city: string;
  state: string;
  zip: string;
}): string {
  const tail = [a.state, a.zip].filter(Boolean).join(" ");
  return [a.street, a.city, tail].filter(Boolean).join(", ");
}

async function factsStep(
  ctx: OrgContext,
  view: LaunchReviewView,
  readOnly: boolean,
): Promise<ReactNode> {
  const [profile, routes] = await Promise.all([
    getBusinessProfile(ctx),
    listEmailRoutes(ctx),
  ]);
  const main = routes.find((r) => r.purpose === "default") ?? routes[0];
  const facts: KeyFactsView = {
    name: profile.orgName,
    phone: profile.phone,
    email: main?.address ?? "",
    emailConfirmed: main ? main.status === "confirmed" : null,
    address: addressLine(profile.address),
    hours: compactWeeklyHours(profile.hours),
  };
  const business = `/hub/settings?tab=business&next=${FACTS_NEXT}`;
  const editHrefs: Record<KeyFactKey, string> = {
    name: business,
    phone: business,
    email: `/hub/settings?tab=email&next=${FACTS_NEXT}`,
    address: business,
    hours: `/hub/settings?tab=team-hours&next=${FACTS_NEXT}`,
  };
  const waiting = view.unconfirmedEmail
    ? routes.find(
        (r) => r.address === view.unconfirmedEmail && r.status !== "confirmed",
      )
    : undefined;
  return (
    <FactsIsland
      facts={facts}
      editHrefs={editHrefs}
      unconfirmedEmail={view.unconfirmedEmail}
      resendRouteId={waiting?.id ?? null}
      readOnly={readOnly}
    />
  );
}

function phoneStep(
  view: LaunchReviewView,
  links: ReviewLinks | null,
  readOnly: boolean,
): ReactNode {
  const url = readOnly ? null : (links?.phone ?? null);
  let svg: string | null = null;
  let svgLarge: string | null = null;
  if (url) {
    try {
      svg = qrSvg(url, { px: 160, label: QR_LABEL });
      svgLarge = qrSvg(url, { px: 200, label: QR_LABEL });
    } catch (err) {
      console.error(`[hub] review qr failed ${errName(err)}`);
    }
  }
  const done = view.items.some((i) => i.id === "phone_check" && i.done);
  return (
    <PhoneIsland
      svg={svg}
      svgLarge={svgLarge}
      shortLink={svg ? url : null}
      done={done}
      readOnly={readOnly}
    />
  );
}

function submitReasons(view: LaunchReviewView): ReviewSubmitReason[] {
  const reasons: ReviewSubmitReason[] = [];
  const left = view.total - view.done;
  if (left > 0) reasons.push({ text: REVIEW_UI_COPY.finishMore(left) });
  if (view.domain && !view.domainReady) {
    reasons.push({
      text: P14_COPY.DOMAIN_NOT_READY,
      href: DOMAIN_HREF,
      linkLabel: REVIEW_UI_COPY.domainSettings,
    });
  }
  return reasons;
}

function listStep(
  view: LaunchReviewView,
  links: ReviewLinks | null,
  readOnly: boolean,
  timeZone: string,
): ReactNode {
  const firstOpen =
    view.pages.find((p) => p.status !== "looks_good") ?? view.pages[0];
  const contact = view.pages.find((p) => /contact/i.test(p.path));
  const pageHrefs: Record<string, string> = {};
  if (links && !readOnly) {
    for (const p of view.pages) pageHrefs[p.id] = links.review(p.path);
  }
  return (
    <>
      <ReviewChecklist
        view={view}
        readOnly={readOnly}
        timeZone={timeZone}
        LinkComponent={GuardedLink}
        actions={{
          reviewHref:
            links && !readOnly ? links.review(firstOpen?.path ?? "/") : null,
          pageHrefs,
          requestsHref: REVIEW_HREFS.requests,
          factsHref: REVIEW_HREFS.facts,
          phoneHref: REVIEW_HREFS.phone,
          testFormHref:
            links && !readOnly ? links.review(contact?.path ?? "/") : null,
          inboxHref: REVIEW_HREFS.inbox,
        }}
      />
      <SubmitIsland
        locked={!view.available}
        reasons={submitReasons(view)}
        domain={view.domain}
        sent={view.submittedAt !== null}
        resubmit={view.resubmitNeeded}
        domainHref={DOMAIN_HREF}
        readOnly={readOnly}
      />
    </>
  );
}

async function timeZoneOf(ctx: OrgContext): Promise<string> {
  try {
    const profile = await getBusinessProfile(ctx);
    return profile.time_zone || "UTC";
  } catch {
    return "UTC";
  }
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { ctx, org } = await requireHubSession();
  if (!mayOpen(ctx)) notFound();
  const params: SearchParams = (await searchParams) ?? {};
  const step = parseStep(params.step);

  const header = Object.prototype.hasOwnProperty.call(HELP_ALIASES, HELP_ID) ? (
    <ScreenHeader
      title={REVIEW_UI_COPY.title}
      helpId={HELP_ID}
      helpName={REVIEW_UI_COPY.helpName}
      LinkComponent={GuardedLink}
    />
  ) : (
    <h1 className="text-[28px] leading-[1.2] font-semibold text-hub-ink">
      {REVIEW_UI_COPY.title}
    </h1>
  );

  let view: LaunchReviewView;
  try {
    view = await launchReviewView(ctx);
  } catch (err) {
    console.error(`[hub] launch review failed ${errName(err)}`);
    return (
      <div className={COLUMN}>
        {header}
        <InlineAlert tone="error">
          {"We couldn't load your review. Reload the page to try again."}
        </InlineAlert>
      </div>
    );
  }

  const readOnly = !view.canAct;
  if (!view.available && view.submittedAt === null) {
    return (
      <div className={COLUMN}>
        {header}
        <InlineAlert tone="info">{REVIEW_UI_COPY.notAvailable}</InlineAlert>
      </div>
    );
  }

  const links = readOnly
    ? null
    : await mintLinks(ctx, previewHostOf(org.primaryHost), Date.now());

  let body: ReactNode;
  try {
    if (step === "facts") body = await factsStep(ctx, view, readOnly);
    else if (step === "phone") body = phoneStep(view, links, readOnly);
    else body = listStep(view, links, readOnly, await timeZoneOf(ctx));
  } catch (err) {
    console.error(`[hub] launch review step failed ${errName(err)}`);
    body = (
      <InlineAlert tone="error">
        {"We couldn't load this part. Reload the page to try again."}
      </InlineAlert>
    );
  }

  return (
    <div className={COLUMN} data-review-step={step}>
      {header}
      {body}
    </div>
  );
}
