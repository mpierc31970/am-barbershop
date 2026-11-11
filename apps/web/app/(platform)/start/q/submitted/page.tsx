// /start/q/submitted (06-UI-SPEC "Quote links", Submitted row). A reopen link for a quote
// that already became a site: the owner signs in to keep setting it up.
import { buttonClasses } from "@cds/ui/hub";
import type { Metadata } from "next";
import Link from "next/link";
import { LinkBody, LinkPanel, LinkTitle } from "../../_components/LinkPanel";
import {
  QUOTE_SUBMITTED_TITLE,
  QUOTE_SUBMITTED_BODY,
} from "../../_components/link-copy";

export const metadata: Metadata = {
  title: "Quote already submitted",
  robots: { index: false, follow: false },
};

export default function QuoteSubmittedPage() {
  return (
    <LinkPanel titleId="quote-submitted-title">
      <LinkTitle id="quote-submitted-title">{QUOTE_SUBMITTED_TITLE}</LinkTitle>
      <LinkBody>{QUOTE_SUBMITTED_BODY}</LinkBody>
      <Link href="/sign-in" className={`${buttonClasses("primary")} w-full`}>
        Sign in
      </Link>
    </LinkPanel>
  );
}
