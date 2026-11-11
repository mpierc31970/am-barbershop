// "Can my site be hosted here?" (ONB-12, D215; UI-SPEC FAQ box). A native <details>, closed
// by default, under Section 2 and opened by the footer link. Both lists render from
// AUP_CATEGORIES, the one source the FitChecker also screens with, so they never drift
// from ACCEPTABLE-USE.md (aup.test.ts guards that copy).
import { AUP_CATEGORIES } from "@cds/core/onboarding";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { aupLines } from "./start-logic";

export const HOSTING_FAQ_ID = "hosting-faq";

export function HostingFaq() {
  const { never, review } = aupLines(AUP_CATEGORIES);
  return (
    <details
      id={HOSTING_FAQ_ID}
      className="group scroll-mt-8 rounded-lg bg-hub-surface-2 px-6 py-4"
    >
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
        Can my site be hosted here?
        <ChevronDown
          aria-hidden
          size={20}
          strokeWidth={2}
          className="shrink-0 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="mt-4 flex flex-col gap-4 text-base">
        <p>Most businesses are welcome. We don&apos;t host sites for:</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {never.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p>We welcome these, but review them before we build:</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {review.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p>
          We check every quote when you submit it. If something&apos;s unclear,
          a person looks at it, usually within 2 business days.
        </p>
        <p>
          <Link
            href="/legal/acceptable-use"
            className="text-hub-accent underline underline-offset-4"
          >
            Read the Acceptable Use Policy
          </Link>
        </p>
      </div>
    </details>
  );
}
