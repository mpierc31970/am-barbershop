---
name: Tidewater
description: Cool bold sans. Clean daylight surfaces, one confident cobalt for action, signal coral for the accent moments.
colors:
  sea-mist: "#F3F6F8"
  tide-pool: "#E1EAEF"
  deep-channel: "#0F1D26"
  slate-current: "#465A66"
  harbour-cobalt: "#1F3FCC"
  white: "#FFFFFF"
  signal-coral: "#F06A4D"
  breakwater: "#C3D1D9"
typography:
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 6vw + 0.5rem, 5rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 600
    lineHeight: 1.2
  subhead:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "999px"
  md: "12px"
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
    backgroundColor: "{colors.harbour-cobalt}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "12px 28px"
    height: "48px"
  button-secondary:
    textColor: "{colors.deep-channel}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "12px 28px"
    height: "48px"
---

# Design System: Tidewater

## Overview

**Creative North Star: "The Harbour Signal"**

A harbour on a clear morning: cool, washed daylight surfaces, deep channel-blue ink, one
confident cobalt for anything a visitor can act on, and a flash of signal coral where the
page wants to be noticed. Bold and civic rather than soft; clarity is the personality.

The display type is bigger and the buttons are pills, so the page reads like well-made
wayfinding. Bands alternate between sea mist and a slightly deeper tide pool. Images carry
softer 12px corners. The only lifted surface is the pop-up panel.

**Key Characteristics:**

- Cool daylight grounds, deep channel ink, one cobalt for action.
- Archivo headings over Public Sans reading text, with a large display size.
- Pill buttons, 12px image corners.
- Coral appears on two things only: hero accent words and countdown numerals.

## Colors

Cool neutrals carry the page; cobalt and coral are the only saturated notes.

### Primary

- **Harbour Cobalt** (#1F3FCC): the primary button fill, the announcement banner ground and
  every rich-text link.

### Tertiary

- **Signal Coral** (#F06A4D as authored): the accent, at display size only. Authored bright
  on purpose; the importer darkens it within the same hue until it holds 3:1 on both
  surfaces, and stores the solved value.

### Neutral

- **Sea Mist** (#F3F6F8): the page, main bands and the pop-up panel (about 60%).
- **Tide Pool** (#E1EAEF): alternate bands (about 30%).
- **Deep Channel** (#0F1D26): headings and body text, focus rings.
- **Slate Current** (#465A66): trust lines, captions and unit labels.
- **White** (#FFFFFF): text on Harbour Cobalt (button labels, banner text).
- **Breakwater** (#C3D1D9): hairline dividers only; decorative, never a text colour.

### Named Rules

**The Harbour Signal Rule.** Cobalt is the only colour that means "go". Buttons, links and
the banner use it; nothing else does.

**The Flare Rule.** Coral appears only on the hero accent words and the countdown numerals,
always at display size.

## Typography

**Display Font:** Archivo (with system-ui)
**Body Font:** Public Sans (with system-ui)

**Character:** A sturdy grotesque for headings over a plain, highly legible civic sans:
bold, clear, and confident without shouting.

### Hierarchy

- **Display** (600, clamp(2.5rem, 6vw + 0.5rem, 5rem), 1.1, -0.02em tracking): the hero
  heading only.
- **Headline** (600, 36px, 1.2): section headings (h2).
- **Title** (600, 22px, 1.3): card, step and column titles (h3).
- **Body** (400, 18px, 1.6): all reading text, capped at 68ch.

### Named Rules

**The Two Weights Rule.** Regular for reading, semibold for headings and button labels.

## Layout

Layout belongs to the platform, not the theme. Every block is full width; only the columns
block chooses a split. Bands stack on the platform spacing scale (48px band padding below
768px, 64px from 768px up), with a 68ch reading measure.

## Elevation & Depth

Flat by default; depth comes from the two cool surface tones. The pop-up panel is the one
lifted surface.

### Shadow Vocabulary

- **Overlay** (`box-shadow: 0 20px 56px rgb(15 29 38 / 0.22)`): the pop-up panel, over a
  deep-channel backdrop at 55%.

### Named Rules

**The Calm Water Rule.** Bands, images and buttons sit flat. Only the pop-up panel lifts.

## Shapes

Pill buttons (999px) and softened 12px image corners. Dividers are 1px Breakwater hairlines.

## Components

### Buttons

- **Shape:** full pill (999px), 48px tall.
- **Primary:** Harbour Cobalt fill with White text, semibold, 12px 28px padding.
- **Hover / Focus:** the fill mixes 12% toward Deep Channel on hover; a 2px deep-channel
  focus ring with a 2px offset.
- **Secondary:** transparent with a 1px Deep Channel border and deep-channel text; hover
  fills with Tide Pool.

### Announcement banner

- Harbour Cobalt ground, White text, the link semibold and underlined; the focus ring turns
  White inside the banner.

### Pop-up panel

- Sea Mist ground, 12px corners, the Overlay shadow, over a deep-channel backdrop at 55%.

### Countdown

- Numerals in the solved Signal Coral at display size; unit labels in Slate Current.

## Do's and Don'ts

### Do:

- **Do** keep Sea Mist (#F3F6F8) as the ground for most of every page, with Tide Pool
  (#E1EAEF) for alternate bands.
- **Do** use Harbour Cobalt (#1F3FCC) for buttons, links and the banner.
- **Do** set headings in Archivo at weight 600 and reading text in Public Sans.

### Don't:

- **Don't** use Signal Coral for body text, links, buttons or backgrounds.
- **Don't** square off the buttons; the pill is part of the signal.
- **Don't** add shadows to bands, images or buttons.
