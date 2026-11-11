// /start/q/s/<signed> (ONB-08; 06-09 reminder emails; T-06-78, T-06-81; B-WR-01). A
// reminder cannot carry the raw quote token (only its hash is stored), so it carries an
// HMAC-signed quote id. This GET page only DESCRIBES the link: mail link scanners (Safe
// Links, Proofpoint) and prefetch follow GETs, so nothing changes here. The Open my quote
// button POSTs openSignedQuoteAction, which rotates the quote token, sets the cookie and
// lands on /start. Bad, tampered, expired and unknown links all go to the one expired page.
// Dynamic (no-store) and no-referrer: the link is in the URL.
import { describeSignedReopen } from "@cds/db";
import { buttonClasses } from "@cds/ui/hub";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { openSignedQuoteAction } from "../../../../../actions/quote-links";
import {
  REOPEN_EXPIRED_PATH,
  REOPEN_SUBMITTED_PATH,
  SIGNED_REOPEN_RE,
} from "../../../../../../lib/quote-links";
import { LinkBody, LinkPanel, LinkTitle } from "../../../_components/LinkPanel";
import {
  REOPEN_BODY,
  REOPEN_BUTTON,
  REOPEN_TITLE,
  REOPEN_TITLE_ID,
} from "../../../_components/link-copy";

export const metadata: Metadata = {
  title: "Open your quote",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

async function describe(signed: string): Promise<string | null> {
  if (!SIGNED_REOPEN_RE.test(signed)) return null;
  try {
    return await describeSignedReopen(signed);
  } catch (err) {
    console.error(
      `[quote-links] signed reopen describe failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export default async function SignedReopenPage({
  params,
}: {
  params: Promise<{ signed: string }>;
}) {
  const { signed } = await params;
  const state = typeof signed === "string" ? await describe(signed) : null;
  if (state === "submitted") redirect(REOPEN_SUBMITTED_PATH);
  if (state !== "valid") redirect(REOPEN_EXPIRED_PATH);

  return (
    <LinkPanel titleId={REOPEN_TITLE_ID}>
      <LinkTitle id={REOPEN_TITLE_ID}>{REOPEN_TITLE}</LinkTitle>
      <LinkBody>{REOPEN_BODY}</LinkBody>
      <form action={openSignedQuoteAction}>
        <input type="hidden" name="s" value={signed} />
        <button type="submit" className={`${buttonClasses("primary")} w-full`}>
          {REOPEN_BUTTON}
        </button>
      </form>
    </LinkPanel>
  );
}
