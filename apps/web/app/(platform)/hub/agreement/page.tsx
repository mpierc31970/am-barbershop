// /hub/agreement: review and sign the CDS agreement (09-17; AGR-02, AGR-03, AGR-07; CONTEXT
// A2-Q1, A3-Q1, A6-Q2; D216, D287, D119; 09-UI-SPEC "Signing screen", "Re-accept").
// Sign mode sits in the normal hub frame; ?mode=reaccept gets the focused frame (HubShell
// contentMode). The page opts out of the re-accept gate (it IS the gate's target). Owner:
// interactive. Admin and impersonating staff: read-only with the NOT-OWNER-SIGN /
// IMPERSONATING-SIGN alert. Editor and Viewer: redirected to /hub. The cards carry the
// compiled, sanitised policy HTML only (T-09-17-05). A load failure shows ERR-LOAD.
import { can } from "@cds/core";
import {
  activeConsentVersion,
  activePolicies,
  getBusinessProfile,
  listAgreementDocuments,
} from "@cds/db";
import { InlineAlert, buttonClasses } from "@cds/ui/hub";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FrameTitle } from "../FrameTitle";
import { getAgreementStatus, safeNext } from "../../../../lib/agreement-gate";
import { requireHubSession } from "../../../../lib/session";
import { localDay } from "../../../../lib/signed-confirmation";
import {
  DRAFT_HUB_COPY,
  DRAFT_HUB_TITLE,
  SIGN_TITLE,
  buildSigningView,
  type SigningView,
} from "../../../../lib/signing-view";
import { SigningForm } from "./SigningForm";

export const metadata: Metadata = { title: SIGN_TITLE };

export const dynamic = "force-dynamic";

const COLUMN =
  "mx-auto flex w-full max-w-[720px] flex-col gap-6 font-hub sm:pt-4";
const H1 = "text-[1.75rem] leading-tight font-semibold text-hub-ink";
const SETTINGS_LEGAL = "/hub/settings?tab=legal";

type Search = { mode?: string | string[]; next?: string | string[] };

function one(v: string | string[] | undefined): string | null {
  return typeof v === "string" ? v : null;
}

export default async function AgreementPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireHubSession({ agreementGate: false });
  const { ctx } = session;
  // Editors and Viewers have no legal surface (D287, CONTEXT A2-Q1).
  if (!can(ctx, "agreements", "read")) redirect("/hub");

  const sp = await searchParams;
  const mode = one(sp.mode) === "reaccept" ? "reaccept" : "sign";
  const rawNext = one(sp.next);
  // Only a same-origin /hub path is carried (D-UI-P9-9); anything else is dropped.
  const next =
    rawNext !== null && safeNext(rawNext, "") !== "" ? rawNext : null;

  let view: SigningView;
  let latestId: string | null = null;
  try {
    const [active, consent, status, profile] = await Promise.all([
      activePolicies(),
      activeConsentVersion(),
      getAgreementStatus(ctx),
      can(ctx, "business", "read")
        ? getBusinessProfile(ctx).catch(() => null)
        : Promise.resolve(null),
    ]);
    view = buildSigningView({
      status,
      active,
      consent,
      mode,
      role: ctx.role,
      impersonating: Boolean(ctx.impersonator),
      // 09-17 choice 3: no members read exists; the last signer is the owner who signed.
      ownerName: status.lastSignerName ?? "",
      onBehalfOf: profile?.legal_name.trim() || session.org.name,
      // The org's local day, as on the confirmation (review IN-C06).
      today: localDay(new Date(), profile?.time_zone || null),
    });
    if (view.kind === "current") {
      latestId =
        (await listAgreementDocuments(ctx).catch(() => []))[0]?.id ?? null;
    }
  } catch (err) {
    console.error(
      "[agreement] load failed",
      err instanceof Error ? err.name : typeof err,
    );
    return (
      <div className={COLUMN}>
        <FrameTitle
          className={H1}
          helpId="agreement"
          name="signing"
          help={mode !== "reaccept"}
        >
          {SIGN_TITLE}
        </FrameTitle>
        <InlineAlert
          tone="error"
          action={
            <Link
              href="/hub/agreement"
              className={buttonClasses("secondary", "sm")}
            >
              Try again
            </Link>
          }
        >
          We couldn&apos;t load this. Check your connection and try again.
        </InlineAlert>
      </div>
    );
  }

  // Re-accept with nothing left to sign: straight on to where the owner was going.
  if (view.kind === "redirect") redirect(safeNext(rawNext));

  if (view.kind === "current") {
    return (
      <div className={COLUMN}>
        <FrameTitle
          className={H1}
          helpId="agreement"
          name="signing"
          help={mode !== "reaccept"}
        >
          {view.title}
        </FrameTitle>
        <p className="max-w-[56ch] text-base text-hub-ink-muted">
          {view.intro}
        </p>
        <InlineAlert
          tone="success"
          action={
            <div className="flex flex-wrap gap-2">
              {latestId ? (
                <Link
                  href={`/hub/agreement/signed/${encodeURIComponent(latestId)}`}
                  className={buttonClasses("secondary", "sm")}
                >
                  See your signed agreement
                </Link>
              ) : null}
              <Link
                href={SETTINGS_LEGAL}
                className={buttonClasses("ghost", "sm")}
              >
                Settings › Legal
              </Link>
            </div>
          }
        >
          {view.alert?.text}
        </InlineAlert>
      </div>
    );
  }

  const readOnly = view.kind === "readonly";
  return (
    <div className={COLUMN}>
      <div className="flex flex-col gap-2">
        <FrameTitle
          className={H1}
          helpId="agreement"
          name="signing"
          help={mode !== "reaccept"}
        >
          {view.title}
        </FrameTitle>
        <p className="max-w-[56ch] text-base text-hub-ink-muted">
          {view.intro}
        </p>
      </div>
      {view.alert ? (
        <InlineAlert tone={view.alert.tone}>{view.alert.text}</InlineAlert>
      ) : null}
      {view.showDraft ? (
        <InlineAlert tone="warning" title={DRAFT_HUB_TITLE}>
          {DRAFT_HUB_COPY}
        </InlineAlert>
      ) : null}
      <SigningForm
        cards={view.cards.map((c) => ({
          key: c.key,
          version: c.version,
          sha256: c.sha256,
          title: c.title,
          metaLine: c.metaLine,
          summary: [...c.summary],
          bodyHtml: c.bodyHtml,
          fullTextHref: c.fullTextHref,
          ...(c.whatChanged ? { whatChanged: c.whatChanged } : {}),
        }))}
        stillCurrent={view.stillCurrent}
        consent={view.consent}
        readOnly={readOnly}
        onBehalfOf={view.onBehalfOf}
        dateLabel={view.dateLabel}
        next={next}
        focused={mode === "reaccept"}
      />
    </div>
  );
}
