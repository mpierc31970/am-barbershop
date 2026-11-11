// GET /start/unsubscribe?t=<signed> (06-UI-SPEC "Quote links"; D-UI-P6-15, D138; T-06-79).
// The reminder footer's link. It only describes: which quote and until when. The page
// never unsubscribes (link scanners follow GETs); the Unsubscribe button POSTs. A link
// already used shows Done; a bad or expired one shows Link expired. The mail provider's
// RFC 8058 one-click goes to POST /api/email/unsubscribe instead.
//
// B-WR-02: the unsubscribe token authorises only "stop reminders". It travels in the
// List-Unsubscribe header and gets logged by mail gateways, so this page never turns it
// into a quote credential: Open my quote goes to plain /start, which reopens the quote
// only when the visitor's own cookie is there.
import { describeUnsubscribe } from "@cds/db";
import type { Metadata } from "next";
import { LinkPanel } from "../_components/LinkPanel";
import { UNSUB_TITLE_ID, unsubscribeUntil } from "../_components/link-copy";
import {
  UnsubscribeDone,
  UnsubscribeExpired,
  UnsubscribeForm,
} from "./UnsubscribeForm";

export const metadata: Metadata = {
  title: "Stop quote reminders",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

type Described = NonNullable<Awaited<ReturnType<typeof describeUnsubscribe>>>;

async function describe(t: string | undefined): Promise<Described | null> {
  if (!t || t.length > 512) return null;
  try {
    return await describeUnsubscribe(t);
  } catch (err) {
    console.error(
      `[quote-links] unsubscribe describe failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const raw = (await searchParams).t;
  const t = typeof raw === "string" ? raw : undefined;
  const d = await describe(t);

  return (
    <LinkPanel titleId={UNSUB_TITLE_ID}>
      {!d || !t ? (
        <UnsubscribeExpired />
      ) : d.done ? (
        <UnsubscribeDone />
      ) : (
        <UnsubscribeForm
          token={t}
          until={unsubscribeUntil(d.expiresAt, new Date())}
        />
      )}
    </LinkPanel>
  );
}
