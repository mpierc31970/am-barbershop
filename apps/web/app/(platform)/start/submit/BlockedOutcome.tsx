// Submit Step C, blocked (ONB-12, D215; 06-UI-SPEC "Submit › Outcomes" Blocked row,
// Copywriting "Blocked"; D-UI-P6-14). A plain page: the one red is the 20px CircleAlert
// beside the heading. It names the category the answers matched, opens the "what we host"
// lists in place (the same AUP_CATEGORIES lines as the /start FAQ box, so they never
// drift from ACCEPTABLE-USE.md) and gives a human path: Contact CDS by email. No org was
// created, and the pending account Submit made for the address is deleted (B-WR-04), so
// there is nothing to undo. A later Submit from the same address is held for staff.
import { AUP_CATEGORIES } from "@cds/core/onboarding";
import { ChevronDown, CircleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { aupLines } from "../_components/start-logic";

export const BLOCKED_TITLE = "We can't host this site";

export function blockedBody(category: string): string {
  return `Your answers match a type of site we don't host: ${category}.`;
}

export interface BlockedOutcomeProps {
  category: string;
  supportEmail: string;
}

export function BlockedOutcome({
  category,
  supportEmail,
}: BlockedOutcomeProps) {
  const { never, review } = aupLines(AUP_CATEGORIES);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section
      aria-labelledby="submit-blocked-title"
      className="flex flex-col gap-6"
    >
      <div className="flex items-start gap-3">
        <CircleAlert
          aria-hidden
          size={20}
          strokeWidth={2}
          className="mt-2 shrink-0 text-hub-danger md:mt-3"
        />
        <h1
          id="submit-blocked-title"
          ref={headingRef}
          tabIndex={-1}
          className="text-[1.75rem] leading-tight font-semibold outline-none md:text-[2rem]"
        >
          {BLOCKED_TITLE}
        </h1>
      </div>
      <p className="text-base">
        Your answers match a type of site we don&apos;t host:{" "}
        <strong className="font-semibold">{category}</strong>.
      </p>
      <details open className="group rounded-lg bg-hub-surface-2 px-6 py-4">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
          See what we host and why
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
        </div>
      </details>
      <p className="text-base">
        Think we&apos;ve got this wrong?{" "}
        <a
          href={`mailto:${supportEmail}`}
          className="font-semibold text-hub-accent underline underline-offset-4"
        >
          Contact CDS
        </a>{" "}
        and a person will look at it.
      </p>
    </section>
  );
}
