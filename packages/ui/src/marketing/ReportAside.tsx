// Owner: 15-11 (P15-P1). ReportAside: "What happens next" beside the /report form (UI-SPEC Report,
// A3-Q3). The six D249 steps come verbatim from MK_COPY.REPORT.NEXT_STEPS, then a What we host link
// to /hosting-rules. Sticky top 32px at >= 1024px; stacked after the form below.
import { MK_COPY } from "@cds/core/marketing";
import Link from "next/link";

export type ReportAsideProps = { className?: string };

export function ReportAside({ className }: ReportAsideProps) {
  return (
    <aside
      aria-labelledby="mk-report-next-h"
      className={[
        "flex flex-col gap-6 border-t border-mk-rule pt-8 lg:sticky lg:top-8 lg:border-t-0 lg:pt-0",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <h2
        id="mk-report-next-h"
        className="font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]"
      >
        {MK_COPY.REPORT.NEXT_H2}
      </h2>
      <ol className="m-0 flex list-decimal flex-col gap-3 pl-6 marker:font-mk-display marker:font-bold">
        {MK_COPY.REPORT.NEXT_STEPS.map((step) => (
          <li
            key={step}
            className="pl-1 text-[18px] leading-[1.55] [text-wrap:pretty]"
          >
            {step}
          </li>
        ))}
      </ol>
      <p className="m-0 text-[18px] leading-[1.55]">
        <Link
          href="/hosting-rules"
          className="py-1 text-mk-fg underline decoration-1 underline-offset-[0.2em] hover:decoration-2"
        >
          {MK_COPY.REPORT.HOSTING_LINK}
        </Link>
      </p>
    </aside>
  );
}
