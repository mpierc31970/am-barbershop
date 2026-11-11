// Read-page classes (15-18; UI-SPEC "Read pages"): card ground, 68ch column (ProseBlock), billboard
// H1, nothing else large. Shared by /hosting-rules, /privacy and /unsubscribe.

export const MK_READ_WRAP =
  "mx-auto w-full max-w-[1440px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24";

export const MK_READ_H1 =
  "font-mk-display text-[clamp(48px,6vw+16px,96px)] leading-[0.95] font-bold tracking-[-0.02em] [text-wrap:balance]";

export const MK_READ_H2 =
  "font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]";

/** Styling for renderLegalMarkdown output (h2/h3, p, lists, bold, links) inside a ProseBlock. */
export const MK_LEGAL_HTML = [
  "flex flex-col gap-4",
  "[&_h2]:mt-6 [&_h2]:font-mk-display [&_h2]:text-[24px] [&_h2]:leading-[1.2] [&_h2]:font-bold",
  "[&_h3]:mt-4 [&_h3]:font-bold",
  "[&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-6",
  "[&_ol]:flex [&_ol]:list-decimal [&_ol]:flex-col [&_ol]:gap-2 [&_ol]:pl-6",
  "[&_strong]:font-bold",
  "[&_a]:underline [&_a]:underline-offset-4",
].join(" ");
