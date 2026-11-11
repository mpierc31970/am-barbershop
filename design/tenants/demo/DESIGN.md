---
name: Almanac
description: Warm serif editorial. A well-made printed almanac on warm paper, oxide-red ink for action.
colors:
  almanac-paper: "#F7F1E8"
  folded-linen: "#EDE3D3"
  printers-umber: "#2A211B"
  faded-umber: "#6A5A4C"
  oxide-red: "#9A3B22"
  cream-label: "#FFF8F0"
  field-olive: "#56642A"
  deckle: "#D8CAB4"
typography:
  display:
    fontFamily: "Fraunces, ui-serif, Georgia, 'Times New Roman', serif"
    fontSize: "clamp(2.75rem, 5vw + 1rem, 4.5rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "Fraunces, ui-serif, Georgia, 'Times New Roman', serif"
    fontSize: "40px"
    fontWeight: 600
    lineHeight: 1.2
  subhead:
    fontFamily: "Fraunces, ui-serif, Georgia, 'Times New Roman', serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Source Serif 4, ui-serif, Georgia, 'Times New Roman', serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "2px"
  md: "2px"
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
    backgroundColor: "{colors.oxide-red}"
    textColor: "{colors.cream-label}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "12px 24px"
    height: "48px"
  button-secondary:
    textColor: "{colors.printers-umber}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "12px 24px"
    height: "48px"
---

# Design System: Almanac

## Overview

**Creative North Star: "The Almanac Page"**

A well-made printed almanac: warm paper, dark umber ink, oxide red kept for the things a
visitor can act on, and field olive for the occasional flourish. The page persuades by
reading well. Type carries the voice; colour stays restrained and never decorates for its
own sake.

The density is that of a good book page rather than a brochure. Bands alternate between the
paper and a slightly deeper linen, the way a folded sheet shows two tones of the same stock.
Corners are press-cut, almost square. Nothing glows, nothing floats except the one pop-up
panel.

**Key Characteristics:**

- Warm paper grounds, umber ink, one red for action.
- Fraunces headings over Source Serif 4 reading text.
- Press-cut 2px corners on buttons and images.
- Olive appears on two things only: hero accent words and countdown numerals.

## Colors

A restrained warm palette: paper and ink do the work, red and olive are rare.

### Primary

- **Oxide Red** (#9A3B22): the primary button fill, the announcement banner ground and every
  rich-text link. It is the colour of doing something.

### Tertiary

- **Field Olive** (#56642A): the accent. Hero accent words and countdown numerals, nowhere
  else.

### Neutral

- **Almanac Paper** (#F7F1E8): the page, main bands and the pop-up panel (about 60% of any
  screen).
- **Folded Linen** (#EDE3D3): alternate bands (about 30%).
- **Printer's Umber** (#2A211B): headings and body text, focus rings.
- **Faded Umber** (#6A5A4C): trust lines, captions and unit labels.
- **Cream Label** (#FFF8F0): text on Oxide Red (button labels, banner text).
- **Deckle** (#D8CAB4): hairline dividers only; decorative, never a text colour.

### Named Rules

**The One Flourish Rule.** Olive appears only on the hero accent words and the countdown.

**The Red Means Act Rule.** Oxide Red marks what a visitor can press or follow: buttons,
links, the banner. Never a heading colour, never a background band.

## Typography

**Display Font:** Fraunces (with ui-serif, Georgia)
**Body Font:** Source Serif 4 (with ui-serif, Georgia)

**Character:** A soft, slightly old-style display serif over a sturdy reading serif: literary
and warm, like a chapter opening in a well-set book.

### Hierarchy

- **Display** (600, clamp(2.75rem, 5vw + 1rem, 4.5rem), 1.1, -0.02em tracking): the hero
  heading only.
- **Headline** (600, 40px, 1.2): section headings (h2).
- **Title** (600, 24px, 1.3): card, step and column titles (h3).
- **Body** (400, 18px, 1.6): all reading text, capped at 68ch.

### Named Rules

**The Two Weights Rule.** Regular for reading, semibold for headings and button labels.
Nothing lighter, nothing heavier.

## Layout

Layout belongs to the platform, not the theme. Every block is full width; only the columns
block chooses a split. Bands stack vertically on the platform spacing scale (48px band
padding below 768px, 64px from 768px up), with a 68ch reading measure for body copy.

## Elevation & Depth

Flat by default. Depth comes from the two paper tones, not from shadows. The only lifted
surface is the pop-up panel.

### Shadow Vocabulary

- **Overlay** (`box-shadow: 0 18px 48px rgb(42 33 27 / 0.20)`): the pop-up panel, over a
  backdrop of umber at 55%.

### Named Rules

**The Flat Page Rule.** Bands and images sit flat on the paper. Only the pop-up panel lifts.

## Shapes

Press-cut corners: 2px on buttons and 2px on images. Dividers are 1px Deckle hairlines. No
pills, no circles, no soft cards.

## Components

### Buttons

- **Shape:** press-cut corners (2px), 48px tall.
- **Primary:** Oxide Red fill with Cream Label text, semibold, 12px 24px padding.
- **Hover / Focus:** the fill mixes 12% toward Printer's Umber on hover; a 2px umber focus
  ring with a 2px offset.
- **Secondary:** transparent with a 1px Printer's Umber border and umber text; hover fills
  with Folded Linen.

### Announcement banner

- Oxide Red ground, Cream Label text, the link semibold and underlined; the focus ring turns
  Cream Label inside the banner.

### Pop-up panel

- Almanac Paper ground, 2px corners, the Overlay shadow, over an umber backdrop at 55%.

### Countdown

- Numerals in Field Olive at display size; unit labels in Faded Umber.

## Do's and Don'ts

### Do:

- **Do** keep Almanac Paper (#F7F1E8) as the ground for most of every page, with Folded
  Linen (#EDE3D3) for alternate bands.
- **Do** use Oxide Red (#9A3B22) for buttons, links and the banner, and nothing else.
- **Do** set every heading in Fraunces at weight 600 and every paragraph in Source Serif 4.

### Don't:

- **Don't** use Field Olive anywhere but the hero accent words and countdown numerals.
- **Don't** round corners past 2px or add shadows to bands, images or buttons.
- **Don't** set body text in Fraunces; it is a display face.
