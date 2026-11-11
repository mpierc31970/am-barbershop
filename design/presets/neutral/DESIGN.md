---
name: Neutral
description: The plain, legible default for any site without its own theme. Not a brand.
colors:
  paper: "#FBFAF8"
  paper-raised: "#F1EFEA"
  ink: "#1D1C1A"
  ink-muted: "#5E5A54"
  white: "#FFFFFF"
  rust: "#8A4B2A"
  rule: "#D8D4CC"
typography:
  display:
    fontFamily: "System Sans"
    fontSize: "clamp(2.5rem, 4vw + 1rem, 3.5rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "System Sans"
    fontSize: "36px"
    fontWeight: 600
    lineHeight: 1.2
  subhead:
    fontFamily: "System Sans"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "System Sans"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "4px"
  md: "4px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
  3xl: "64px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "12px 24px"
    height: "48px"
  button-secondary:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "12px 24px"
    height: "48px"
---

# Design System: Neutral

## Overview

**Creative North Star: "The Plain Page"**

The preset every site falls back to when it has no theme of its own, or when its theme
cannot be read. It is deliberately nobody's brand, including CDS's: an off-white page, near
black ink, the device's own sans-serif, and a single rust accent. Its job is to be legible
and to get out of the way.

It downloads no fonts, uses no decoration, and keeps every text pair well above AA, so a
site on the preset is never broken, only plain.

**Key Characteristics:**

- Off-white page, near-black ink; the ink doubles as the button colour.
- The system sans-serif in both roles; zero font downloads.
- Gentle 4px corners on buttons and images.
- One rust accent for hero accent words and countdown numerals.

## Colors

Near-monochrome: ink on paper, with one quiet rust note.

### Primary

- **Ink** (#1D1C1A): the primary button fill, the banner ground and rich-text links, as
  well as all text. On this preset action is signalled by shape and underline, not hue.

### Tertiary

- **Rust** (#8A4B2A): the accent. Hero accent words and countdown numerals only.

### Neutral

- **Paper** (#FBFAF8): the page, main bands and the pop-up panel.
- **Paper Raised** (#F1EFEA): alternate bands.
- **Ink Muted** (#5E5A54): trust lines, captions and unit labels.
- **White** (#FFFFFF): text on Ink (button labels, banner text).
- **Rule** (#D8D4CC): hairline dividers only; decorative.

### Named Rules

**The No Brand Rule.** The preset carries no identity. Never add a logo colour, a signature
font or a flourish to it; a site that wants character gets its own theme.

## Typography

**Display Font:** System Sans (the device's UI sans-serif)
**Body Font:** System Sans

**Character:** Familiar and fast. The same face the visitor's device already uses, so
nothing loads and nothing surprises.

### Hierarchy

- **Display** (600, clamp(2.5rem, 4vw + 1rem, 3.5rem), 1.1, -0.02em tracking): the hero
  heading only.
- **Headline** (600, 36px, 1.2): section headings (h2).
- **Title** (600, 24px, 1.3): card, step and column titles (h3).
- **Body** (400, 18px, 1.6): all reading text, capped at 68ch.

## Layout

Layout belongs to the platform, not the theme. Every block is full width; only the columns
block chooses a split. Bands stack on the platform spacing scale with a 68ch reading
measure.

## Elevation & Depth

Flat. Depth comes from the two paper tones. The pop-up panel is the only lifted surface.

### Shadow Vocabulary

- **Overlay** (`box-shadow: 0 16px 48px rgb(0 0 0 / 0.18)`): the pop-up panel, over an ink
  backdrop at 55%.

## Shapes

Gentle 4px corners on buttons and images; 1px Rule hairlines for dividers.

## Components

### Buttons

- **Shape:** gently rounded (4px), 48px tall.
- **Primary:** Ink fill with White text, semibold, 12px 24px padding.
- **Hover / Focus:** the fill mixes 12% toward the text colour on hover; a 2px ink focus
  ring with a 2px offset.
- **Secondary:** transparent with a 1px Ink border; hover fills with Paper Raised.

### Pop-up panel

- Paper ground, 4px corners, the Overlay shadow.

## Do's and Don'ts

### Do:

- **Do** keep the preset exactly in step with the platform's built-in fallback values.
- **Do** keep every text pair at or above 4.5:1 and the accent at or above 3:1.

### Don't:

- **Don't** add a web font to the preset; it must download nothing.
- **Don't** give the preset a brand colour, logo tone or named identity.
