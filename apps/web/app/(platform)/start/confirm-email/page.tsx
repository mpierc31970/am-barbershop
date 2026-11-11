// GET /start/confirm-email?t=<token> (ONB-09, D173; 06-UI-SPEC "Quote links"; D-UI-P6-15;
// T-06-79). The confirmation email's link. It shows whose inquiries go where and never
// confirms: the "Confirm this address" button POSTs. Used, expired, malformed and unknown
// tokens all show "This link has expired".
import { describeRouteConfirm } from "@cds/db";
import type { Metadata } from "next";
import { LinkPanel } from "../_components/LinkPanel";
import { CONFIRM_TITLE_ID } from "../_components/link-copy";
import { ConfirmEmailForm, LinkExpired } from "./ConfirmEmailForm";

export const metadata: Metadata = {
  title: "Confirm this email address",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

async function describe(t: string | undefined) {
  if (!t || t.length > 512) return null;
  try {
    return await describeRouteConfirm(t);
  } catch (err) {
    console.error(
      `[quote-links] confirm describe failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const raw = (await searchParams).t;
  const t = typeof raw === "string" ? raw : undefined;
  const d = await describe(t);

  return (
    <LinkPanel titleId={CONFIRM_TITLE_ID}>
      {!t || !d || d.state !== "valid" ? (
        <LinkExpired />
      ) : (
        <ConfirmEmailForm
          token={t}
          orgName={d.orgName}
          address={d.address}
          purposeLabel={d.purposeLabel}
        />
      )}
    </LinkPanel>
  );
}
