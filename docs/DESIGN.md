# DESIGN — Trace

Hard requirements. A build that satisfies every functional criterion but ignores this file has failed.

## Concept

Trace is a **forensic instrument**. It should read like a lab readout or a documentary plate, not a SaaS
marketing page. Precision, restraint, visible truthfulness. It measures and reports; it does not sell.

Consequence: generous empty space, hairline rules, tabular data, small honest type, and a deliberate
refusal to colour-code reassurance.

## The single most important visual rule

**There is no green "all clear" state.** An absent watermark is not a pass, so it must not look like one.

| state | token | rationale |
|---|---|---|
| `ai_confirmed` | `--v-confirmed` oxblood `#8C2F39` | a definite finding |
| `ai_probable` | `--v-probable` burnt ochre `#A85E22` | likely |
| `ai_possible` | `--v-possible` olive `#7E742E` | weak |
| `no_provenance_signal` | `--v-none` neutral slate `#4C5560` | deliberately neutral, NOT green |
| `unknown` | `--v-unknown` taupe `#6B5B4A` | no verdict |
| `not_configured` | `--v-unconfigured` cool grey `#59606B` | did not run |
| `error` | `--v-error` oxblood `#7A2E2E` | failure |

`no_provenance_signal`, `unknown` and `not_configured` must be visually distinct from one another.

## Palette

Light (default): `--canvas #F2EFE8` (warm paper, never pure white) · `--surface #FAF8F3` ·
`--surface-2 #E8E3D8` · `--ink #16181C` (never `#000`) · `--ink-soft #4A4F57` · `--hairline #D6CFC0` ·
`--accent #A85E22` warm ochre · `--accent-2 #3A5A78` slate blue.

Dark: `--canvas #14161A` · `--surface #1B1E23` · `--surface-2 #23272E` · `--ink #EDEAE3` ·
`--ink-soft #A8AEB8` · `--hairline #2E3239`, accents lightened for contrast.

Both `--accent` and `--accent-2` must appear somewhere real (primary action, and links or informational
marks). A monochrome ramp does not read as a theme.

**Contrast floors:** body text 4.5:1, large text and meaningful graphics 3:1. Measure against the resolved
background by walking ancestors, not a hardcoded colour, and report the measured numbers.

## Type

Self-host in `css/fonts/` as `.woff2` with `@font-face` and `font-display: swap`. **No third-party font
CDN**: the page must make no external request.

- Display and headings: **Fraunces**. Body and UI: **Archivo**. Technical data only: **JetBrains Mono**,
  for short values such as enum names, byte sizes and dimensions. Never for sentences, headings, section
  labels, button text or feature titles. Mono applied broadly makes the product read like a code editor.

Body 16px at 1.6 line-height minimum. Nothing below 12px, no dense panel micro-text below 13px.

## Form

- **Corners: 2px.** Sharp, a deliberate precision-instrument choice that intentionally overrides the older
  12-16px radius convention. Soft radii are on the banned list.
- Borders are 1px hairlines. Depth comes from rules and surface tone, never from shadow.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64.
- Data in tables and definition lists with aligned numeric columns, not decorative cards.
- One focal element per viewport. The verdict banner is the focal element; do not put a stat band and a
  diagram beside it at equal weight. A status chip must never be louder than the heading above it.

## Motion

Minimal and functional only: state transitions plus one continuous ambient element, such as a hairline
rule that advances during analysis. No entrance animation that delays reading. Honour
`prefers-reduced-motion: reduce`. No animated arrows, no hover animation beyond colour or opacity.

## Required states

Skeleton loaders mirroring the real result layout while analysing (a bare spinner is not acceptable); an
empty state that teaches the three input methods; an error state naming what failed and what to do next;
and a visible keyboard focus style on every interactive element.

## Iconography

**Hand-authored inline SVG**, one consistent 1.5px stroke style, drawn for this product. Banned outright:
Lucide, Feather, Heroicons, Font Awesome, Bootstrap Icons, any off-the-shelf set, and emojis anywhere.

## Banned (each is a failure, not a nitpick)

No pure white background. No harsh gradients. No rainbow or multi-hue decoration. No drop shadows. No
glassmorphism or liquid glass. No bento grids. No row of three feature cards. No three pricing tiers. No
radial orbs. No dot-grid backgrounds. No sparkle icons. No animated arrows. No terminal-window mockups. No
fake testimonials or invented stats. No purple-and-black. No neon. No basic pastels. No checkmark bullets.
No "it is not X, it is Y" construction. No em dashes. No emojis. No Inter, Geist or Space Grotesk. No
generic three-column footer of link lists.

## Copy voice

Plain, specific, declarative. Short sentences. State limits openly, including the limits of this tool.
Never phrase an absent signal as reassurance. Never invent a number.
