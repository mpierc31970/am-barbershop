// InitialsTile (08-05; D-UI-P8-13; 08-UI-SPEC "Our team" photo states, colour table).
//
// Two variants, both aria-hidden (the member's name is the <h3> beside it):
// - "tile": the 1:1 photo frame for a member without a photo in a team where others have
//   one; initials text-muted 600 at the h2 size.
// - "circle": the 64px circle used when nobody in the team has a photo; initials text 600
//   at the body size.
// Ground follows the P7 table-stripe rule: surface-raised on a main band, surface on an
// alternate band. --site-* roles only. Server component.
import type { BackgroundVariant } from "@cds/core/content";
import { BODY_CLASS } from "../types";

export function InitialsTile({
  initials,
  background,
  variant,
  className = "",
}: {
  initials: string;
  background: BackgroundVariant;
  variant: "tile" | "circle";
  className?: string;
}) {
  const ground =
    background === "alternate" ? "bg-site-surface" : "bg-site-surface-raised";
  if (variant === "circle") {
    return (
      <div
        aria-hidden="true"
        className={`flex size-16 shrink-0 items-center justify-center rounded-full ${ground} ${BODY_CLASS} font-semibold text-site-text ${className}`}
      >
        {initials}
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      className={`flex aspect-square w-full items-center justify-center rounded-site-media ${ground} text-[length:var(--site-text-h2)] font-semibold text-site-text-muted ${className}`}
    >
      {initials}
    </div>
  );
}
