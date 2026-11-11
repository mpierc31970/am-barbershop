// Owner: 15-09 (P15-P1). Wordmark: typographic lockup (UI-SPEC components, Typography logo exemption).
// Rivet ring + "CDS" (Anybody 700, wdth 125, 24px) + the full name (Label, hidden < 640px).
// Links home; the accessible name is "Connections Design Studios home".
import { MK_COPY } from "@cds/core/marketing";
import Link from "next/link";
import { RivetMark } from "./RivetMark";

export type WordmarkProps = {
  /** "ink" on card/stock grounds (header), "white" on the ink back cover (footer). */
  tone: "ink" | "white";
  className?: string;
};

const ORG = MK_COPY.SEO.ORG_NAME;

export function Wordmark({ tone, className }: WordmarkProps) {
  return (
    <Link
      href="/"
      aria-label={`${ORG} home`}
      className={[
        "inline-flex min-h-11 items-center gap-2 no-underline",
        tone === "white" ? "text-mk-card" : "text-mk-ink",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <RivetMark />
      <span className="font-mk-display text-[24px] leading-none font-bold [font-stretch:125%]">
        CDS
      </span>
      <span className="hidden text-[14px] leading-[1.4] sm:inline">{ORG}</span>
    </Link>
  );
}
