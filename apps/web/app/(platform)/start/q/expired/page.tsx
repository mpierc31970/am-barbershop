// /start/q/expired (06-UI-SPEC "Quote links", Expired and Invalid / unknown rows; T-06-78).
// Every reopen link that is not valid or submitted lands here, so expired, invalid and
// unknown tokens look the same and cannot be probed.
import { buttonClasses } from "@cds/ui/hub";
import type { Metadata } from "next";
import Link from "next/link";
import { LinkBody, LinkPanel, LinkTitle } from "../../_components/LinkPanel";
import {
  QUOTE_EXPIRED_TITLE,
  QUOTE_EXPIRED_BODY,
} from "../../_components/link-copy";

export const metadata: Metadata = {
  title: "This quote has expired",
  robots: { index: false, follow: false },
};

export default function QuoteExpiredPage() {
  return (
    <LinkPanel titleId="quote-expired-title">
      <LinkTitle id="quote-expired-title">{QUOTE_EXPIRED_TITLE}</LinkTitle>
      <LinkBody>{QUOTE_EXPIRED_BODY}</LinkBody>
      <Link href="/start" className={`${buttonClasses("primary")} w-full`}>
        Start a new quote
      </Link>
    </LinkPanel>
  );
}
