---
name: CDS hub site (marketing world)
description: The fan-deck world of the CDS hub site. Every value is a --mk-* token on [data-mk]; tenant sites never read it.
colors:
  card: "#FFFFFF"
  stock: "#EEF0F4"
  ink: "#15171E"
  ink-muted: "#4A4F5C"
  ink-soft: "#9AA0AE"
  rule: "#C9CDD6"
  rule-strong: "#7D8392"
  cobalt: "#2A3FD1"
  cobalt-tint: "#E4E8FB"
  cobalt-deep: "#1C2C9E"
  berry: "#A3165F"
  berry-tint: "#F8E3EE"
  berry-deep: "#7A0F47"
  leaf: "#2F7D32"
  leaf-tint: "#E3F1E3"
  tangerine: "#F26A1B"
  tangerine-tint: "#FDE7DA"
  marigold: "#F5B300"
  violet: "#6B3FC4"
  violet-tint: "#EFEAFA"
  teal: "#00796E"
  rose: "#F59AB8"
  sky: "#38A3DC"
  danger: "#B3261E"
  danger-tint: "#FCE8E6"
typography:
  display:
    fontFamily: "Anybody"
    fontSize: "clamp(48px, 6vw + 16px, 96px)"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "Anybody"
    fontSize: "clamp(28px, 1.6vw + 22px, 40px)"
    fontWeight: 700
    lineHeight: 1.1
  body:
    fontFamily: "Hanken Grotesk"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Hanken Grotesk"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  blade: "16px"
  round: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
  "16": "64px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.card}"
    rounded: "{rounded.round}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.round}"
  blade:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.blade}"
---

# Design System: CDS hub site (marketing world)

## Overview

This is the **hub site's own world**: the CDS storefront on the platform host (`/`, `/pricing`,
`/standard`, `/studio`, `/add-ons`, `/work`, `/about`, `/contact`, `/report` and the read pages).
It is written from the built code (15-26), not from the plan. It sits **beside** the root
`DESIGN.md`, which stays the tenant `--site-*` vocabulary for the drift detector. Nothing here is a
tenant theme (D-UI-P15-29).

- Source of truth for values: `packages/ui/src/marketing/tokens.css` (every `--mk-*` token, declared
  on `[data-mk]` only, never the document root).
- Utilities: `apps/web/app/globals.css` maps the tokens through `@theme inline` to `bg-mk-*`,
  `text-mk-*`, `font-mk-display`, `font-mk-body`, `rounded-mk-blade`, `rounded-mk-round`,
  `shadow-mk-rest` and `shadow-mk-lift`.
- Components: `packages/ui/src/marketing/` (barrel `@cds/ui/marketing`). Pages:
  `apps/web/app/(platform)/(marketing)/`.
- Fence: `tests/marketing-boundary.test.ts` bans `--hub-*`, `--site-*`, `--cds-*`, their utilities
  and colour literals outside `tokens.css`. `tests/tokens-contrast.test.ts` checks every pair below.

**North star: the colour fan deck.** Paths and add-ons are colour blades on one rivet. Each blade
carries its own name and its live catalog price, so choosing a website reads like choosing a colour.

**Key characteristics:**

- White card stock and cool stock grey; saturated chip fields own whole regions.
- A closed colour code: each chip means one thing, site-wide.
- Ink action buttons (white on dark chips); pill-round, 44px or 52px tall.
- 16px-radius blades with a 12px rivet ring.
- Anybody across its width axis over Hanken Grotesk; tabular price runs in condensed Anybody.
- Fine print printed loud: footnotes, sources and the gateway sentence sit on a marigold band.
- An ink footer as the deck's back cover.

## Colors

All values are `--mk-<name>` on `[data-mk]`. Contrast is measured in `tests/tokens-contrast.test.ts`.

### Grounds and ink

- **`--mk-card` #FFFFFF**: page ground, header, forms, rack blades (about 60% of a page).
- **`--mk-stock` #EEF0F4**: alternate sections, calculator ground, table headers.
- **`--mk-ink` #15171E**: text, **the action colour** (primary buttons on light grounds), the closing
  CTA band and the footer.
- **`--mk-ink-muted` #4A4F5C**: secondary text on card and stock (7.18:1 on stock).
- **`--mk-ink-soft` #9AA0AE**: muted text on the ink field only.
- **`--mk-rule` #C9CDD6** hairlines; **`--mk-rule-strong` #7D8392** the 3:1 rule for controls and
  the resting rivet.

### The closed colour code

| Chip                    | Token(s)                                                        | Means, and only means                                             |
| ----------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Cobalt                  | `--mk-cobalt` `-tint` `-deep`                                   | Standard path                                                     |
| Berry                   | `--mk-berry` `-tint` `-deep`                                    | Studio path                                                       |
| Leaf                    | `--mk-leaf` `-tint`                                             | Money that stays with the owner (pitch rivet, "With CDS" column)  |
| Tangerine               | `--mk-tangerine` `-tint`                                        | What a platform keeps (comparison and calculator "Elsewhere")     |
| Marigold                | `--mk-marigold`                                                 | Fine print band (claims, sources, DRAFT bands) and add-on ring #1 |
| Violet, teal, rose, sky | `--mk-violet` (+ `-tint`), `--mk-teal`, `--mk-rose`, `--mk-sky` | Add-on ring #2-#5 (by listing order)                              |
| Danger                  | `--mk-danger` `-tint`                                           | Form errors only                                                  |

### Field scopes

`ChipField` (or any element) sets `data-mk-field="<chip>"`. The scope sets the ground and
re-points `--mk-fg`, `--mk-muted`, `--mk-focus`, `--mk-action-bg` and `--mk-action-fg`, so text,
focus rings and primary buttons read on that ground with no per-component colour logic:

- Light fields (card, stock, marigold, rose, sky, tangerine): ink text, ink focus, **ink** button with
  white label.
- Dark fields (cobalt, berry, violet, leaf, teal, ink): white text, white focus, **white** button with
  ink label.

### Named rules

- **The closed code rule.** A chip never decorates a section that has no such meaning. Red only ever
  marks a form error.
- **The descent rule.** Each page moves through the deck's colour order: card, path chip field,
  stock, marigold band, ink cover. Where you are reads from the ground colour alone.
- **Chips are identity, never action.** No button takes a chip colour.

## Typography

Four sizes, two weights (400, 700). Width (`wdth`, `font-stretch`) is the expressive axis.
Fonts are self-hosted OFL faces loaded with `next/font/local` in the marketing layout only
(`apps/web/app/(platform)/(marketing)/fonts.ts`): Anybody variable (`--font-mk-display`,
`font-stretch` 50%-150%) and Hanken Grotesk variable (`--font-mk-body`).

| Role     | Size                              | Weight    | Line height | Face                                                      | Use                                                        |
| -------- | --------------------------------- | --------- | ----------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| Display  | `clamp(48px, 6vw + 16px, 96px)`   | 700       | 0.95        | Anybody 100%, tracking -0.02em                            | One H1 per page                                            |
| Heading  | `clamp(28px, 1.6vw + 22px, 40px)` | 700       | 1.1         | Anybody 100%                                              | H2s, path names, pitch line, plan prices, rack blade names |
| Body     | 18px                              | 400 / 700 | 1.55        | Hanken (blade names: Anybody 75%, 700)                    | Reading text, form labels, nav at 1280px and up            |
| Label    | 14px                              | 400 / 700 | 1.4         | Hanken 400; Anybody 75% 700 for numbers, price runs, tags | Footnotes, sources, badges, swatch numbers                 |
| Wordmark | 24px                              | 700       | 1           | Anybody 125%                                              | "CDS" in `Wordmark` only (a logo, not a type role)         |

- **`.mk-figures`**: tabular figures are set in Anybody 75% with `tabular-nums`, never Hanken (it has
  no `tnum`). Every price, total, date and percentage uses it.
- H1 and H2 use `text-wrap: balance`; reading text caps at 68ch.
- No uppercase text except the status word "DRAFT". No eyebrows or kickers, no section numbers.

## Spacing and layout

- Spacing tokens `--mk-space-1/2/4/6/8/12/16` = 4, 8, 16, 24, 32, 48, 64px. Nothing above 64px is a
  token; more air is composition (section 64px plus a 32px heading margin).
- Page wrapper `max-w-[1440px]` with 16 / 24 / 32px gutters (the UI-SPEC's 1280px content width
  landed as 1440px in the build); prose 68ch; forms 640px; comparison 1040px.
- Header 72px (64px under 1024px), static. Buttons `md` 44px, `lg` 52px (hero and closing CTA only).
  Every link, row, radio and checkbox row is at least 44px tall.
- **Home first viewport (as built, 15-26):** 12-column grid; text 6 columns from 1024px and 7 from
  1280px, the fan in the rest. At 1440 x 900 the H1 sets in four lines and **Start your site** sits
  inside the first viewport. On phones the full-width CTA ends inside the first 600px.

## Shapes and depth

- `--mk-radius-blade` 16px (blades, panels, the screenshot frame); `--mk-radius-round` pill
  (buttons, tags, chip dots).
- `--mk-shadow-rest`: a blade at rest on the deck (1-2px offset, soft blur).
- `--mk-shadow-lift`: a blade lifted off the deck (4px/16px offset, 32px blur).
- No other shadows. No glass, no gradients, no side stripes.

## Motion

- Tokens: `--mk-dur-fast` 160ms, `--mk-dur-lift` 320ms, `--mk-dur-spread` 480ms,
  `--mk-ease-out` `cubic-bezier(0.16, 1, 0.3, 1)`.
- **The lift (signature).** On the desktop fan (`min-width: 1024px` and `pointer: fine`), hovering or
  focusing a blade straightens it to 0deg and raises it 24px with the lift shadow; its neighbours
  spread 3deg further. CSS only (`:hover`, `:focus-within`, `:has()`). Standard stands lifted while
  nothing is hovered or focused.
- Closed-deck rows lift 4px for 160ms when pressed. The mobile menu slides in from the right edge
  (the only thing that enters from off-screen).
- No scroll-triggered entrances, count-ups, parallax or autoplay. `prefers-reduced-motion` zeroes the
  `--mk-dur-*` tokens, so every change is instant.

## Components

| Component                                                                                                            | What it is                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BladeDeck`                                                                                                          | `<ul>` of up to 9 blades. Fan at 1024px+ with a fine pointer (112 x 352px blades; 128 x 400px in a 560 x 480 deck from 1440px). Elsewhere, closed-deck rows (64px, 72px chip edge), first 5 plus "See all add-ons". Under 5 blades: rows at every width, capped at 560px wide on desktop. |
| `Blade`                                                                                                              | One swatch: chip, number, name, tagline, price run, in that order everywhere (the label grid). Orientations `fan`, `row`, `upright` (the `/add-ons` rack: 160px chip field, 400px min height). Coming soon = 2px outline chip, no link, no Add button.                                    |
| `BladeRack`                                                                                                          | The rack grid: 4 / 3 / 2 columns at 1280 / 1024 / 640px; row blades below 640px.                                                                                                                                                                                                          |
| `PriceRun`                                                                                                           | "<Path> · <price>" lines from the catalog label helpers, in `.mk-figures`.                                                                                                                                                                                                                |
| `PathField`                                                                                                          | A full-bleed cobalt or berry field: name, who-for, price line, included lines, Start on <Path>.                                                                                                                                                                                           |
| `FormulaCard`                                                                                                        | A worked example: chip dots joined by "+", then "= total".                                                                                                                                                                                                                                |
| `ChipField`                                                                                                          | Any region that takes a chip ground (`data-mk-field`).                                                                                                                                                                                                                                    |
| `MkButton` / `MkLinkButton`                                                                                          | `primary` (field action pair), `secondary` (1px field-fg border), `text` (underlined). Sizes `md` 44px, `lg` 52px. New-tab links carry an sr-only suffix.                                                                                                                                 |
| `MkHeader` / `MkMobileMenu` / `MkFooter`                                                                             | Card header with rule; menu dialog with focus trap and `inert`, path links marked by a 12px chip dot; ink footer with the pitch line.                                                                                                                                                     |
| `Wordmark` / `RivetMark`                                                                                             | The typographic logo (rivet ring + CDS + full name) and the 12px rivet ring (leaf-filled on the pitch line).                                                                                                                                                                              |
| `ComparisonTable`, `ClaimFootnotes`, `SourcesTable`                                                                  | Tangerine "how they make it" against leaf "how we make ours"; footnotes and sources on the marigold band.                                                                                                                                                                                 |
| `CostCalculator` / `CalculatorStatic`                                                                                | The client calculator island and its no-JS table.                                                                                                                                                                                                                                         |
| `MkForm`                                                                                                             | `MkTextField`, `MkTextArea` (counter), `MkRadioGroup`, `MkCheckbox`, `MkErrorSummary`, `MkFormStatus`.                                                                                                                                                                                    |
| `ProofList`, `TestimonialList`, `DemoPanel`, `ReportAside`, `ProseBlock`, `StepsList`, `ComingSoonTag`, `DraftBadge` | Proof, demo, report and reading blocks. `DraftBadge` is marigold with an ink border.                                                                                                                                                                                                      |

## Browser surfaces

All in `tokens.css`. The element defaults sit in `@layer base`, so Tailwind utilities always win
over them (15-26 fix: unlayered, `a { color: inherit }` had turned the ink buttons' labels
ink-on-ink).

- Selection: marigold ground, ink text. Caret and `accent-color`: ink.
- Scrollbar: rule-strong thumb on a transparent track.
- Links: underlined, 0.2em offset, 1px going to 2px on hover.
- Focus: 3px outline in the field's `--mk-focus`, 3px offset. Never removed (programmatically
  focused headings after a form result are the one `outline-none` case).
- Forced colours: blades keep a 1px `CanvasText` border; chip meaning is always in words too.

## Rasters and provenance

The hub ships **no generated or stock rasters**. Its only images are:

- The 11 Open Graph images (1200 x 630): **code-rendered** at build by `next/og` from
  `apps/web/lib/og-image.tsx` (chip ground, wordmark, page H1 in Anybody 700). They are regenerated on
  every build, so no prompt is embedded; `impeccable embed-prompt --scan` reports them as missing a
  prompt by design.
- Add-on screenshots on `/add-ons/<slug>`: supplied by each add-on's listing (plain lazy `<img>`).

## Do's and Don'ts

### Do

- Read every value from a `--mk-*` token or its `mk-*` utility.
- Put a region on a chip only when the chip's one meaning applies.
- Use `.mk-figures` for every figure, and the catalog label helpers for every price.
- Put breakpoint visibility on a wrapper when the element sets its own `display`
  (`MkLinkButton` is `inline-flex`, which outranks `hidden`).

### Don't

- Don't use `--site-*`, `--hub-*` or `--cds-*` tokens, `@cds/ui/hub` or `@cds/ui/site` here.
- Don't add a coloured side stripe to a row or card; mark identity with a chip dot or field.
- Don't add eyebrows, kickers, section numbers, gradients, glass or hard offset shadows.
- Don't sprinkle chips as small accents on neutral ground.
- Don't animate on scroll or on load; motion follows input only.
