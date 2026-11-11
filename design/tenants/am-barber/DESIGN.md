---
name: Night Shift
description: "A&M Barber Studio. A late-night barbershop window: black glass, one red neon sign, one blue, cut into hexagons."
colors:
  black-glass: "#0A0A0C"
  steel-chair: "#141418"
  chrome-white: "#F2F2F2"
  smoke: "#9A9AA3"
  neon-red: "#E0242B"
  sign-white: "#FFFFFF"
  pole-blue: "#2F6BFF"
  seam: "#26262C"
typography:
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 6vw + 1rem, 5.5rem)"
    fontWeight: 900
    lineHeight: 0.95
    letterSpacing: "-0.01em"
  heading:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 800
    lineHeight: 1.05
  subhead:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1.2
  body:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "0px"
  md: "0px"
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
    backgroundColor: "{colors.neon-red}"
    textColor: "{colors.sign-white}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "12px 28px"
    height: "52px"
  button-secondary:
    textColor: "{colors.chrome-white}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "12px 28px"
    height: "52px"
---

# Design System: Night Shift

## Overview

**Creative North Star: "The Window at 10 p.m."**

A barbershop seen from the street after dark: black glass, a red neon sign that says the
chair is open, a blue tube along the edge, chrome and steel inside. The page is heavy,
square and loud where it counts, quiet everywhere else. The hexagon from the shop's ceiling lights
is the one shape that repeats.

**Key Characteristics:**

- Near-black grounds, chrome-white type, one red for action, one blue for edges.
- Archivo at 800-900 for every heading, Public Sans for reading text.
- Square corners everywhere. Hexagon cuts on photos, team portraits and badges.
- Neon glow only on the hero heading and the primary button.

## Colors

### Primary

- **Neon Red** (#E0242B): primary buttons, links, the banner. It means "book / call / go".

### Tertiary

- **Pole Blue** (#2F6BFF): the accent. Focus rings, hover edges, the second glow tube.

### Neutral

- **Black Glass** (#0A0A0C): the page.
- **Steel Chair** (#141418): alternate bands and cards.
- **Chrome White** (#F2F2F2): headings and body text.
- **Smoke** (#9A9AA3): captions, trust lines, labels.
- **Sign White** (#FFFFFF): text on Neon Red.
- **Seam** (#26262C): hairline dividers only.

### Named Rules

**The Two Tubes Rule.** Red and blue are the only colours with light in them. Nothing else
glows.

## Typography

**Display Font:** Archivo (900, uppercase hero)
**Body Font:** Public Sans

### Hierarchy

- **Display** (900, clamp(2.75rem, 6vw + 1rem, 5.5rem), 0.95): the hero heading only.
- **Headline** (800, 44px, 1.05): section headings.
- **Title** (800, 24px, 1.2): card and column titles.
- **Body** (400, 18px, 1.6): reading text, capped at 68ch.

## Layout

Layout belongs to the platform. Every block is full width; only the columns block splits.

## Elevation & Depth

Flat. Depth comes from the two black tones and the neon light, never from soft shadows.

## Shapes

Radius 0. Media, team photos and section badges are cut as hexagons (clip-path). Dividers
are 1px Seam hairlines.

## Components

### Buttons

- **Primary:** Neon Red fill, Sign White label, 52px tall, square, a red glow that steadies
  on hover.
- **Secondary:** transparent with a 1px Chrome White border; hover fills with Steel Chair.
- **Focus:** a 2px Pole Blue ring with a 2px offset.

## Do's and Don'ts

### Do:

- **Do** keep Black Glass (#0A0A0C) as the ground for most of every page.
- **Do** keep Neon Red (#E0242B) for things a visitor can press.
- **Do** respect reduced motion: glow is static, nothing flickers.

### Don't:

- **Don't** round corners.
- **Don't** add glow to body text, cards or bands.
- **Don't** use gradients on text.
