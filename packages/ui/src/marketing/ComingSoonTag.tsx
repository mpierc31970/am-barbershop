// Owner: 15-09 (P15-P1). ComingSoonTag: outline tag "Coming soon" (1px field-fg border, Label 700;
// UI-SPEC components). Unshipped lines and coming-soon listings only (Voice: never claim a capability).
import { MK_COPY } from "@cds/core/marketing";

export function ComingSoonTag({ className }: { className?: string }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-mk-round border border-mk-fg px-2 text-[14px] leading-[1.4] font-bold text-mk-fg",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {MK_COPY.COMMON.COMING_SOON}
    </span>
  );
}
