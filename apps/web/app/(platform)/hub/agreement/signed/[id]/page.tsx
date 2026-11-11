// /hub/agreement/signed/<id>: the signed confirmation (09-18; AGR-04, AGR-06; CONTEXT A2-Q4;
// D81; D-UI-P9-10, D-UI-P9-13; 09-UI-SPEC "Signed confirmation"). The focal point is
// the Download button. Calm, no celebration. Reachable straight after signing and
// later from Settings › Legal rows, by Owner/Admin (impersonating staff act as that role);
// Editors and Viewers, an unknown id or another org's id go to /hub (09-18 choice 3).
// Opts out of the re-accept gate: it is where the gate's own flow lands.
import { can } from "@cds/core";
import {
  getBusinessProfile,
  getOrgStage,
  listAgreementDocuments,
  type AgreementDocument,
} from "@cds/db";
import { InlineAlert, buttonClasses } from "@cds/ui/hub";
import { Download, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FrameTitle } from "../../../FrameTitle";
import { requireHubSession } from "../../../../../../lib/session";
import {
  PROOF_HELPER,
  PROOF_LABEL,
  SIGNED_TITLE,
  confirmationActions,
  copyRetain,
  formatSignedSentence,
  policyRows,
} from "../../../../../../lib/signed-confirmation";
import { inSetup } from "../../../nav";
import { ProofCode } from "./ProofCode";

export const metadata: Metadata = { title: SIGNED_TITLE };

export const dynamic = "force-dynamic";

const COLUMN =
  "mx-auto flex w-full max-w-[720px] flex-col gap-6 font-hub sm:pt-4";
const H1 = "text-[1.75rem] leading-tight font-semibold text-hub-ink";
const RECORD_ID = /^[a-z0-9]{15}$/;
const SETTINGS_LEGAL = "/hub/settings?tab=legal";

type Search = { next?: string | string[] };

export default async function SignedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const session = await requireHubSession({ agreementGate: false });
  const { ctx } = session;
  if (!can(ctx, "agreements", "read")) redirect("/hub");

  const { id } = await params;
  if (!RECORD_ID.test(id)) redirect("/hub");
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : null;

  let docs: AgreementDocument[];
  let profile: Awaited<ReturnType<typeof getBusinessProfile>> | null;
  try {
    [docs, profile] = await Promise.all([
      listAgreementDocuments(ctx),
      can(ctx, "business", "read")
        ? getBusinessProfile(ctx).catch(() => null)
        : Promise.resolve(null),
    ]);
  } catch (err) {
    // ERR-LOAD, as on the signing screen (review IN-C03): a blip right after signing must
    // not look like a failed signature.
    console.error(
      "[agreement] signed load failed",
      err instanceof Error ? err.name : typeof err,
    );
    const retry = `/hub/agreement/signed/${encodeURIComponent(id)}${
      next !== null ? `?next=${encodeURIComponent(next)}` : ""
    }`;
    return (
      <div className={COLUMN}>
        <FrameTitle
          className={H1}
          helpId="agreement"
          name="your signed agreement"
        >
          {SIGNED_TITLE}
        </FrameTitle>
        <InlineAlert
          tone="error"
          action={
            <div className="flex flex-wrap gap-2">
              <Link href={retry} className={buttonClasses("secondary", "sm")}>
                Try again
              </Link>
              <Link
                href={SETTINGS_LEGAL}
                className={buttonClasses("ghost", "sm")}
              >
                Settings › Legal
              </Link>
            </div>
          }
        >
          We couldn&apos;t load this. Check your connection and try again.
        </InlineAlert>
      </div>
    );
  }
  // Org-scoped list: another org's id is simply not in it.
  const doc = docs.find((d) => d.id === id);
  if (!doc) redirect("/hub");

  const orgName = profile?.legal_name.trim() || session.org.name;
  // A failed stage read keeps the setup default (the onboarding case it was built for).
  const stage = await getOrgStage(ctx).then(
    (o) => o.stage,
    () => null,
  );
  const action = confirmationActions(
    next,
    doc.signingKind,
    stage === null || inSetup(stage),
  );
  const rows = policyRows(doc);

  return (
    <div className={COLUMN}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck
            size={20}
            aria-hidden="true"
            className="shrink-0 text-hub-success"
          />
          <FrameTitle
            className={H1}
            helpId="agreement"
            name="your signed agreement"
          >
            {SIGNED_TITLE}
          </FrameTitle>
        </div>
        <p className="max-w-[60ch] text-base text-hub-ink tabular-nums">
          {formatSignedSentence(doc, orgName, profile?.time_zone || null)}
        </p>
      </div>

      <dl className="divide-y divide-hub-border rounded border border-hub-border bg-hub-surface">
        {rows.map((r) => (
          <div
            key={r.key}
            className="flex flex-col gap-1 px-4 py-3 sm:grid sm:grid-cols-[1fr_auto] sm:items-baseline sm:gap-4"
          >
            <dt className="text-base text-hub-ink">{r.term}</dt>
            <dd className="text-sm text-hub-ink-muted tabular-nums">
              {r.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {/* A plain anchor, not next/link: the route answers with an attachment. */}
        <a
          href={doc.downloadUrl}
          className={`${buttonClasses("primary", "md")} w-full sm:w-auto`}
        >
          <Download size={16} aria-hidden="true" />
          Download your signed copy
        </a>
        <Link
          href={action.href}
          className={`${buttonClasses("secondary", "md")} w-full sm:w-auto`}
        >
          {action.label}
        </Link>
      </div>

      <p className="text-sm text-hub-ink-muted">
        {copyRetain(doc.signerEmail)}
      </p>

      <ProofCode
        code={doc.evidenceSha256}
        label={PROOF_LABEL}
        helper={PROOF_HELPER}
      />
    </div>
  );
}
