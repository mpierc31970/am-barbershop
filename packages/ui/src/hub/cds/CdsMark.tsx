// CdsMark (12-06 choice 1; 12-UI-SPEC "CdsMark" lines 213-221; COMM-05, D83). The only CDS
// graphic in the hub: a square tile (1/6 corner radius on a 24 grid) filled with --cds-mark,
// a white open "C" arc (stroke 2.5, 270° sweep, opening right) and a 2×2 square "studio dot"
// in the opening. No letters, no wordmark. Renders only inside [data-cds-identity]
// (apps/web/test/neutral-chrome.test.tsx asserts it via data-cds-mark).
// `label` makes it an image named "CDS" (when it stands alone); otherwise it is decorative
// because the adjacent text already says CDS.

export type CdsMarkSize = 16 | 20 | 32;

export interface CdsMarkProps {
  size: CdsMarkSize;
  /** true → role="img" aria-label="CDS"; default aria-hidden (adjacent text says CDS). */
  label?: boolean;
  className?: string;
}

// Arc: centre (12, 12), radius 6, from 45° above the right horizontal round through the
// left to 45° below it (counter-clockwise on screen = sweep-flag 0, large arc).
const ARC = "M16.24 7.76 A6 6 0 1 0 16.24 16.24";

export function CdsMark({ size, label = false, className }: CdsMarkProps) {
  const a11y = label
    ? ({ role: "img", "aria-label": "Support" } as const)
    : ({ "aria-hidden": "true" } as const);
  return (
    <svg
      data-cds-mark=""
      width={size}
      height={size}
      viewBox="0 0 24 24"
      focusable="false"
      className={`shrink-0${className ? ` ${className}` : ""}`}
      {...a11y}
    >
      <rect width="24" height="24" rx="4" fill="var(--cds-mark)" />
      <path
        d={ARC}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.5"
        strokeLinecap="butt"
      />
      <rect x="16" y="11" width="2" height="2" fill="#FFFFFF" />
    </svg>
  );
}
