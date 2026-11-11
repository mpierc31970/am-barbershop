---
name: CDS Platform site vocabulary
description: The --site-* roles and tokens every tenant site renders from. No brand values live here.
colors:
  surface: "var(--site-surface)"
  surface-raised: "var(--site-surface-raised)"
  text: "var(--site-text)"
  text-muted: "var(--site-text-muted)"
  primary: "var(--site-primary)"
  primary-contrast: "var(--site-primary-contrast)"
  accent: "var(--site-accent)"
  border: "var(--site-border)"
  backdrop: "var(--site-backdrop)"
  focus: "var(--site-focus)"
typography:
  display:
    fontFamily: "var(--site-font-heading)"
    fontSize: "var(--site-text-display)"
    fontWeight: 600
    lineHeight: 1.1
  heading:
    fontFamily: "var(--site-font-heading)"
    fontSize: "var(--site-text-h2)"
    fontWeight: 600
    lineHeight: 1.2
  subhead:
    fontFamily: "var(--site-font-heading)"
    fontSize: "var(--site-text-h3)"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "var(--site-font-body)"
    fontSize: "var(--site-text-body)"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "var(--site-radius-button)"
  md: "var(--site-radius-media)"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-contrast}"
    rounded: "{rounded.sm}"
---

# Design System: CDS Platform site vocabulary

## Overview

This file is the **platform vocabulary** for the impeccable drift detector
(`npm run design:detect`, THEME-04, D48). It lists roles and tokens only. It carries
**no brand colours and no font families**: every value is a `var(--site-*)` reference.

Each tenant's real theme is authored under `design/<presets|tenants>/<slug>/`
(`DESIGN.md` + `.impeccable/design.json`), imported into `organization.design`, and
emitted at render as `--site-*` custom properties on the `[data-site]` wrapper (D44–D46,
THEME-02, THEME-03). Site renderers in `packages/ui/src/site`, `packages/templates`,
`packages/addons` and `apps/web/app/tenant` must use these names and nothing else.

**Key Characteristics:**

- Eight authored colour roles plus two derived ones (`backdrop`, `focus`).
- Two font roles (heading, body) and four size tokens.
- Two radius tokens (buttons, media).
- Weights are fixed at 400 and 600; themes choose families, never weights.

## Colors

Roles, not colours. Each tenant theme supplies the values.

### Primary

- **Primary** (`var(--site-primary)`): buttons, links and the active state. Text on it
  uses `var(--site-primary-contrast)`.

### Tertiary

- **Accent** (`var(--site-accent)`): only the Hero accent words and the Countdown
  numerals (D-UI-P4-2).

### Neutral

- **Surface** (`var(--site-surface)`): the page ground.
- **Surface raised** (`var(--site-surface-raised)`): alternating rows and cards.
- **Text** (`var(--site-text)`) and **text muted** (`var(--site-text-muted)`): body copy
  and secondary copy.
- **Border** (`var(--site-border)`): rules and field outlines.
- **Backdrop** (`var(--site-backdrop)`): derived, text at 55% alpha, behind pop-ups.
- **Focus** (`var(--site-focus)`): derived, the one focus-ring source; equals text, and
  primary-contrast inside the banner.

### Named Rules

**The Role-Only Rule.** A site renderer never writes a literal colour. The colour gate is
`tests/theme-drift.test.ts`; the engine's `design-system-color` check is advisory in
0.1.5.

## Typography

- **Heading** `var(--site-font-heading)` at `var(--site-text-display)`,
  `var(--site-text-h2)` and `var(--site-text-h3)`.
- **Body** `var(--site-font-body)` at `var(--site-text-body)`.
- Line heights are fixed in CSS: body 1.6, h3 1.3, h2 1.2, display 1.1.

## Shapes

- Buttons round at `var(--site-radius-button)`; media at `var(--site-radius-media)`.

## Components

### Buttons

Primary buttons fill with the primary role and set text in primary-contrast. Hover mixes
primary toward text (D-UI-P4-8).

## Do's and Don'ts

### Do:

- Use only the `--site-*` names above in site renderers.
- Add a detector exception only through `impeccable ignores add-value … --reason`.

### Don't:

- Write hex, `rgb()`, Tailwind palette colours or font-family literals in site code.
- Hand-edit `.impeccable/config.json`.

### Detector exceptions

Test files (`*.test.ts`, `*.test.tsx`) are exempt from the `broken-image` rule: they are
fixtures that assert markup and are never shipped.
