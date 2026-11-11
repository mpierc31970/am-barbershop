// Owner: 15-11 (P15-P1). DemoPanel: "See a real site in action" on a berry field (UI-SPEC Home §5,
// Work §2; D209, A1-Q6). The page passes demoSiteUrl(); null (the demo org can't be resolved) renders
// nothing, so the section hides. The link opens in a new tab with rel="noopener" (T-15-11-02).
import { MK_COPY } from "@cds/core/marketing";
import { ChipField } from "./ChipField";
import { MkLinkButton } from "./MkButton";

export type DemoPanelProps = {
  url: string | null;
  className?: string;
};

export function DemoPanel({ url, className }: DemoPanelProps) {
  if (!url) return null;
  return (
    <ChipField field="berry" aria-labelledby="mk-demo-h" className={className}>
      <div className="mx-auto flex max-w-[1440px] flex-col items-start gap-6 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <h2
          id="mk-demo-h"
          className="font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]"
        >
          {MK_COPY.HOME.DEMO_H2}
        </h2>
        <p className="max-w-[60ch] text-[18px] leading-[1.55] [text-wrap:pretty]">
          {MK_COPY.HOME.DEMO_BODY}
        </p>
        <MkLinkButton href={url} external variant="primary" size="md">
          {MK_COPY.HOME.OPEN_DEMO}
        </MkLinkButton>
      </div>
    </ChipField>
  );
}
