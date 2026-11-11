// Marketing fonts (15-02; D-UI-P15-6, D-UI-P15-7, CONTEXT A1-Q3; RESEARCH Pattern 6).
// Self-hosted through next/font/local from the exact-pinned fontsource packages (OFL-1.1),
// imported only by the (marketing) layout, so tenant pages, /start and the owner hub never
// preload them (T-15-02-01). No Google Fonts fetch: offline Docker builds stay green.
// `src` is relative to this file; the packages hoist to the root node_modules.
// apps/web/test/marketing-fonts.test.ts proves both files exist, so a version bump that
// renames them fails in `npm test`, not only in `next build`.
import localFont from "next/font/local";

/** Anybody (variable wght + wdth): display, headings, wordmark, blade labels, figures (P15-P10). */
export const anybody = localFont({
  src: "../../../../../node_modules/@fontsource-variable/anybody/files/anybody-latin-standard-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-mk-display",
  // Without a declared range the @font-face says font-stretch: normal and CSS
  // font-stretch: 75% cannot reach the wdth axis (RESEARCH Pitfall 6).
  declarations: [{ prop: "font-stretch", value: "50% 150%" }],
  adjustFontFallback: "Arial",
});

/** Hanken Grotesk (variable wght): body, labels, forms. No tnum (RESEARCH Pitfall 5). */
export const hanken = localFont({
  src: "../../../../../node_modules/@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-mk-body",
  adjustFontFallback: "Arial",
});
