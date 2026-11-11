---
name: Harbor Ivory
description: A DCR-shaped test fixture for the theme importer. Not a theme.
colors:
  teal: "#17656A"
  brand: "{colors.teal}"
  teal-ink: "#0F4A4E"
  bronze: "#A86F42"
  bronze-ink: "#8A5424"
  rose: "#B9827D"
  paper: "#FAF4EA"
  paper-raised: "#F1E7D8"
  ink: "#12312F"
  ink-soft: "#3D5551"
  line: "#D9C7AE"
  white: "#FFFFFF"
typography:
  display:
    fontFamily: "Source Serif 4, Georgia, 'Times New Roman', serif"
    fontSize: "clamp(2.6rem, 1.9rem + 3.2vw, 4.6rem)"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.012em"
  heading:
    fontFamily: "Source Serif 4, Georgia, 'Times New Roman', serif"
    fontSize: "clamp(2rem, 1.6rem + 1.8vw, 2.75rem)"
    fontWeight: 400
    lineHeight: 1.15
  subhead:
    fontFamily: "Source Serif 4, Georgia, 'Times New Roman', serif"
    fontSize: "1.28rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "'Public Sans', system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.6
  inscription:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: "1rem"
    letterSpacing: "0.22em"
rounded:
  none: "0"
  sm: "2px"
  md: "6px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "32px"
  xl: "64px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "14px 32px"
---

## Overview

A warm ivory page with deep teal water and aged copper. This file is a test fixture shaped
like the DCR-Website donor theme: rem sizes, font stacks, heading/subhead keys and
`{colors.x}` references.

## Colors

- **Paper** (#FAF4EA): the page ground.
- **Rich Teal** (#17656A): links and the primary button.
- **Bronze Ink** (#8A5424): the one accent.

## Typography

Source Serif 4 for headings, Public Sans for reading at an 18px base.
