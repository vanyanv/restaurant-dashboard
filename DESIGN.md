---
name: Chris Neddy's Restaurant Dashboard
description: Editorial docket — a newspaper financial section in operator's hands.
colors:
  ink: "#1a1613"
  ink-muted: "#6b625a"
  ink-faint: "#a69d92"
  paper: "#fbf6ee"
  paper-deep: "#f4ecdf"
  paper-soft: "#fff9ef"
  paper-warm: "#fcf1dd"
  hairline: "#e8dfd3"
  hairline-bold: "#c9beaf"
  accent: "#dc2626"
  accent-dark: "#7c1515"
  accent-bg: "#fcecec"
  subtract: "#8a3a3a"
  platform-doordash: "#eb1700"
  platform-ubereats: "#0b0b0b"
  platform-grubhub: "#f15c26"
  platform-chownow: "#16a085"
  platform-neutral: "#4a4541"
typography:
  display:
    fontFamily: "Fraunces, Iowan Old Style, Georgia, serif"
    fontSize: "clamp(28px, 4vw, 44px)"
    fontWeight: 500
    lineHeight: 0.95
    letterSpacing: "-0.03em"
    fontVariation: "opsz 144, SOFT 30"
  headline:
    fontFamily: "Fraunces, Iowan Old Style, Georgia, serif"
    fontSize: "26px"
    fontWeight: 450
    lineHeight: 1.1
    letterSpacing: "-0.022em"
    fontVariation: "opsz 96, SOFT 50, WONK 0"
  title:
    fontFamily: "Fraunces, serif"
    fontSize: "17px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "-0.01em"
    fontVariation: "opsz 96, SOFT 40"
  body:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.005em"
  number:
    fontFamily: "DM Sans, ui-sans-serif, sans-serif"
    fontSize: "15.5px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.014em"
    fontFeature: "tnum, lnum"
  label:
    fontFamily: "DM Sans, ui-sans-serif, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.18em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.12em"
    fontFeature: "tnum"
rounded:
  none: "0"
  hairline: "2px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "18px"
  xl: "24px"
  xxl: "40px"
components:
  panel:
    backgroundColor: "rgba(255, 253, 247, 0.72)"
    rounded: "{rounded.hairline}"
    padding: "18px 20px"
  row-default:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "18px 20px"
  row-hover:
    backgroundColor: "rgba(220, 38, 38, 0.045)"
    textColor: "{colors.ink}"
  total-default:
    typography: "{typography.number}"
    textColor: "{colors.ink}"
  total-hover:
    typography: "{typography.number}"
    textColor: "{colors.accent}"
  toolbar-btn:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "7px 12px"
  toolbar-btn-active:
    backgroundColor: "{colors.accent-bg}"
    textColor: "{colors.accent}"
    rounded: "{rounded.none}"
    padding: "7px 12px"
  nav-item-default:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "7px 16px 7px 18px"
  nav-item-active:
    backgroundColor: "{colors.accent-bg}"
    textColor: "{colors.accent-dark}"
    padding: "7px 16px 7px 18px"
  search-shell:
    backgroundColor: "rgba(255, 255, 255, 0.55)"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "6px 10px"
  stamp:
    backgroundColor: "rgba(255, 255, 255, 0.4)"
    textColor: "currentColor"
    rounded: "{rounded.hairline}"
    padding: "3px 7px 2px"
---

# Design System: Chris Neddy's Restaurant Dashboard

## 1. Overview

**Creative North Star: "The Late-Edition Ledger."**

This is a back-office newspaper, not a SaaS dashboard. The surface is warm cream paper with a fine SVG fiber grain, hairline-ruled like a financial broadsheet's tables, set in Fraunces italic display, DM Sans for figures, and JetBrains Mono for folios and stamps. A single red proofmark — `#dc2626` — sits in for the editor's pencil: it underlines totals on hover, fills the active nav rail, and marks state changes. Nothing else is colored unless it's a platform stamp.

The system explicitly rejects three failure modes named in PRODUCT.md: **Toast / Square POS** brightness (oversized blue buttons, friendly emoji), **Notion / Coda card sprawl** (rounded-xl cards with soft shadows nested inside other cards), and **Linear / Vercel dark SaaS** (slate-900 with neon accents). Density and reconciliation legibility win over visual flourish — the user is closing books at 11pm, not browsing screenshots.

**Key Characteristics:**
- Warm cream paper (`#fbf6ee → #f4ecdf` gradient with radial highlights and a 5%-opacity fractal-noise grain overlay).
- Hairline frames at `1px` (`#e8dfd3` and `#c9beaf`). No shadows. No `rounded-xl`. Radius is `2px` or `0`.
- Two-tier type: Fraunces italic for prose and display; DM Sans 500–600 with `tabular-nums lining-nums` for every number; JetBrains Mono for captions, folios, SKUs, status stamps.
- One accent (red `#dc2626`) reserved for state. A red bar that scales `Y(0→1)` on row hover; the row's total turns red simultaneously.
- A staggered `dock-in` reveal (60ms steps, 480ms duration, `cubic-bezier(0.2, 0.7, 0.2, 1)`) on first paint.

## 2. Colors: The Cream-Paper Palette

A monochrome warm-paper system with one red proofmark and a strict per-platform stamp set. There is no "secondary" or "tertiary" accent. If a hue isn't on this list, it doesn't go on `/dashboard/*`.

### Primary
- **Proofmark Red** (`#dc2626`, `oklch(57.7% 0.245 27)`): The single accent. Used only as state — row hover bar, hovered total, active nav fill, focus shadow. Never as a fill at rest. Paired with **Proofmark Red Deep** (`#7c1515`) for active-state text on tinted backgrounds, **Proofmark Wash** (`#fcecec`) as the only red surface, and **Subtract Red** (`#8a3a3a`) for negative figures in ledgers.

### Neutral (Inks)
- **Ink** (`#1a1613`): Body text, totals at rest, headings. Dark warm brown-black, never `#000`.
- **Ink Muted** (`#6b625a`): Secondary copy, store names in row meta, mono labels in nav sections.
- **Ink Faint** (`#a69d92`): Folios, decorative date strings, perforation dashes, placeholder text. **Decorative-only — must not carry meaning** (a11y rule).

### Neutral (Papers)
- **Paper** (`#fbf6ee`): The base surface beneath the editorial layout.
- **Paper Deep** (`#f4ecdf`): Bottom of the page gradient. Page bottoms read slightly cooler.
- **Paper Soft Highlight** (`#fff9ef`): Top-left radial wash, like sunlight hitting newsprint.
- **Paper Warm Highlight** (`#fcf1dd`): Top-right radial wash, slightly amber.
- **Hairline** (`#e8dfd3`): 1px row separators, panel inner rules.
- **Hairline Bold** (`#c9beaf`): Panel outer borders, toolbar buttons, search-shell strokes, sidebar dividers.

### Platform Stamps (data-only)
Used strictly on `.platform-stamp` / `.inv-stamp` to label an order's source. Each is paired with a text label and a small rotation (`rotate(-0.5deg)`) so the stamp reads as ink on paper, not as a badge.
- **DoorDash** (`#eb1700`)
- **UberEats** (`#0b0b0b`)
- **Grubhub** (`#f15c26`)
- **ChowNow** (`#16a085`)
- **Neutral / In-house** (`#4a4541`) — for `bnm-web`, `css-pos`.

### Named Rules

**The Earn-the-Red Rule.** Red is reserved for state changes. If `--accent` appears at rest on more than one element on a screen — outside an `.is-active` nav item or an inv-stamp — something is wrong. The proofmark works because it's rare.

**The No-Pure-Black Rule.** Both ink and paper are tinted toward warm hues. `#000` and `#fff` never appear on `/dashboard/*`. Even icon strokes inherit `currentColor` from `var(--ink)` or `var(--ink-muted)`.

**The Color-Plus-Label Rule.** Platform stamps are color-coded but always paired with the platform's text label. No color-only signaling — the user closing books at 11pm may be color-blind, tired, or both.

## 3. Typography: Fraunces / DM Sans / JetBrains Mono

**Display Font:** Fraunces (variable, `opsz` + `SOFT` + `WONK` axes, with Iowan Old Style and Georgia fallbacks). Italic display only.
**Body & Number Font:** DM Sans (with `system-ui` fallback). Numbers always use `font-variant-numeric: tabular-nums lining-nums`.
**Label / Mono Font:** JetBrains Mono (with Menlo fallback). Used for folios, SKUs, status stamps, kbd chips, brand-issue strings, and anything that should read as machine-set caption.

**Character:** A serious newspaper's financial section, set in Fraunces with optical-size 96–144 for headlines (so the italic stays bold, not literary). Numbers run in DM Sans semi-bold with tabular figures so columns reconcile to the pixel; mono pulls SKUs and folios into the margin. The pairing is editorial, not decorative — Fraunces never appears on a number, DM Sans never appears on a quote.

### Hierarchy

- **Display** (Fraunces, `500`, `clamp(28px, 4vw, 44px)`, `line-height: 0.95`, `letter-spacing: -0.03em`, `opsz 144, SOFT 30`): Page titles, masthead-style section headers. One per view.
- **Headline** (Fraunces italic, `450`, `26px`, `line-height: 1.1`, `letter-spacing: -0.022em`, `opsz 96, SOFT 50, WONK 0`): Panel heads, brand name in sidebar, prose intros. The brand-name supports an inline `<em>` that flips to `var(--accent)`.
- **Title** (Fraunces, italic-capable, `500`, `17px`): Vendor names in `.inv-row__vendor-name`, secondary headings inside panels.
- **Body** (DM Sans, `400`, `13px`, `line-height: 1.5`): Default running text, nav items, table cells where the value is not a number. Cap line length at 65–75ch when used as prose.
- **Number** (DM Sans, `600`, `15.5px`, `letter-spacing: -0.014em`, `tabular-nums lining-nums`): Every total, KPI value, currency figure on hover or at rest. Inherits `var(--ink)` at rest, `var(--accent)` on parent row hover.
- **Label** (DM Sans, uppercase, `600`, `10px`, `letter-spacing: 0.18em`, `var(--ink-muted)`): Section captions, panel-head departments. Used for the small editorial chrome.
- **Mono** (JetBrains Mono, `400`, `10px`, `letter-spacing: 0.12em`, `tabular-nums`): Folios, SKUs, brand issue strings, kbd chips. Always uppercase when used as caption.

### Named Rules

**The Two-Tier Rule.** Fraunces is for prose and display. DM Sans is for numbers. JetBrains Mono is for captions and folios. **Crossing the lines is a regression** — a Fraunces-italic dollar amount or a DM Sans display heading both fail the system.

**The Tabular Rule.** Every figure is set with `font-variant-numeric: tabular-nums lining-nums` and `font-feature-settings: "tnum", "lnum"`. Columns must reconcile to the pixel; proportional figures break the ledger metaphor.

**The Optical-Size Rule.** Fraunces is variable — set `font-variation-settings: "opsz" 96` for headlines, `"opsz" 144` for display, `"SOFT" 30–50` to match the era. Default Fraunces (no axis settings) reads literary, not editorial.

## 4. Elevation: Hairlines, Not Shadows

This system has **no shadow vocabulary.** Depth comes from tonal layering — the cream paper sits beneath a 5%-opacity fractal-noise grain (`mix-blend-mode: multiply`) and panels float as warmer rectangles (`rgba(255, 253, 247, 0.72)`) framed in `1px solid #c9beaf`. The grain layer is `position: fixed` and promoted to its own GPU layer via `transform: translateZ(0)` so it does not re-composite during layout.

Interactive surfaces signal state through:
1. **A red 4px proofmark bar** (`scaleY(0→1)` from origin center) on `.inv-row`, `.order-row`, and `.editorial-nav-item`. Transitions at `220ms cubic-bezier(0.2, 0.7, 0.2, 1)`.
2. **A warm-red wash** (`rgba(220, 38, 38, 0.028)` for orders, `0.045` for invoices) under the row.
3. **A `box-shadow: inset 3px 0 0 var(--accent)`** on `:focus-visible` only — this is the one place a shadow appears, and it's not for elevation, it's for a focus ring on a non-rectangular target.

### Named Rules

**The No-Shadow Rule.** `box-shadow` for elevation is forbidden on `/dashboard/*`. If a surface needs to feel "lifted", increase its background opacity against the cream — don't add a shadow.

**The Hairline Rule.** Every visible boundary is `1px solid` of either `--hairline` (`#e8dfd3`) for inner rules and row separators or `--hairline-bold` (`#c9beaf`) for panel outer borders, toolbar strokes, and search-shell frames. Two weights — that's the entire vocabulary.

**The Grain Rule.** The fractal-noise overlay sits at `opacity: 0.05` with `mix-blend-mode: multiply`. Lifting the opacity above 0.07 makes the surface look dirty; dropping it below 0.03 makes the paper look flat. Don't tune it.

## 5. Components

### Panels (`.inv-panel`)
- **Character:** A boxed broadsheet department — masthead at the top, hairline rule, contents below.
- **Shape:** `border-radius: 2px`. Never `rounded-md` or higher.
- **Background:** `rgba(255, 253, 247, 0.72)` over the cream paper, so the grain still reads underneath.
- **Border:** `1px solid var(--hairline-bold)`. No shadow.
- **Padding:** `18px 20px` (use `.inv-panel--flush` for `padding: 0` when the panel hosts a full-bleed table).
- **Head:** `.inv-panel__head` is a flex baseline-aligned row with a department tag (`.inv-panel__dept`, JetBrains Mono `10px / 0.24em` uppercase, ink-faint), divided from the body by `1px var(--hairline)` with `14px` padding-bottom and `14px` bottom margin.
- **Doctrine:** Replaces every shadcn `<Card>` on `/dashboard/*`. Nested panels are forbidden — use a hairline rule and indent instead.

### Rows (`.inv-row`, `.order-row`)
- **Character:** Pressable ledger lines. Tap target wraps the entire row.
- **Shape:** `display: grid` with named columns; `padding: 18px 20px` (invoices) or `18px 24px 18px 16px` (orders).
- **Border:** `1px solid var(--hairline)` on top of every row except `:first-child`.
- **At rest:** `background: transparent`, `color: var(--ink)`, total in `var(--ink)`.
- **Hover / focus-visible:**
  - Background washes to `rgba(220, 38, 38, 0.045)` (invoices) or `0.028` (orders).
  - Pseudo-element `::before` is a `4px` (or `3px` for orders) bar of `var(--accent)`, transitioning `transform: scaleY(0) → scaleY(1)` at `220ms cubic-bezier(0.2, 0.7, 0.2, 1)` from center origin.
  - The total amount transitions `color` to `var(--accent)` at `180ms ease`.
  - The chevron fades in (`opacity 0 → 1`) and slides `translateX(-4 → 0)`.
- **Focus ring:** `box-shadow: inset 3px 0 0 var(--accent)` on `:focus-visible`. No outline.
- **Doctrine:** Plain `hover:bg-muted/50` is forbidden. If a row is interactive, it uses this exact pattern.

### Toolbar Buttons (`.toolbar-btn`)
- **Shape:** `border-radius: 0` (sharp). `padding: 7px 12px`. `font-size: 12px`.
- **Default:** `background: transparent`, `border: 1px solid var(--hairline-bold)`, `color: var(--ink)`.
- **Hover:** `border-color: var(--ink)`, `background: rgba(0, 0, 0, 0.02)`.
- **Active:** `border-color: var(--accent)`, `color: var(--accent)`, `background: var(--accent-bg)` (`#fcecec`).
- **Doctrine:** Use these instead of shadcn `<Button>` on dashboard toolbars and segmented controls.

### Search Shell (`.search-shell`)
- **Shape:** `1px solid var(--hairline-bold)` on a `rgba(255, 255, 255, 0.55)` ground. Radius `0`. `padding: 6px 10px`.
- **Focus:** `border-color` shifts to `var(--ink)` via `transition: border-color 120ms ease`.
- **Adornments:** Leading icon in `var(--ink-muted)`; trailing `.kbd-chip` (JetBrains Mono `10px`, `1px solid var(--hairline-bold)`, `padding: 1px 5px`).

### Sidebar Nav (`.editorial-nav-item`)
- **Default:** `font-family: DM Sans`, `font-size: 13px`, `color: var(--ink)`, `padding: 7px 16px 7px 18px`. A 2px red `::before` bar sits at `scaleY(0)` from `top: 20%` to `bottom: 20%`.
- **Hover:** `background: rgba(0, 0, 0, 0.025)`, the `::before` bar scales to `0.55` (a half-mark, like a tick).
- **Active (`.is-active`):** `color: var(--accent-dark)` (`#7c1515`), `background: var(--accent-bg)` (`#fcecec`), `font-weight: 600`, `::before` at `scaleY(1)`. Icon recolors to `var(--accent)`.
- **Section labels:** DM Sans `9.5px / 0.2em` uppercase in `var(--ink-faint)`, with a `1px dotted var(--hairline-bold)` rule trailing on the right.

### Platform Stamps (`.platform-stamp`, `.inv-stamp`)
- **Character:** Rotated rubber stamps. A border drawn in `currentColor` at `1.5px solid`, `2px` corner radius, `transform: rotate(-0.5deg)`, sitting on a `rgba(255, 255, 255, 0.4)` ground.
- **Type:** DM Sans `700`, `9.5px` (or `11px` for `.stamp-md`), uppercase, `letter-spacing: 0.14em` (or `0.16em` for `.stamp-md`).
- **Color:** Each platform sets `color` only — DoorDash red, UberEats black, Grubhub orange, ChowNow green, neutral grey for in-house.

### Live Indicator (`.live-dot`)
- A 6px circular `var(--accent)` dot pulsing `opacity: 1 → 0.35 → 1` on a `1.8s ease-in-out infinite` cycle. Always paired with a "LIVE" label in JetBrains Mono.

### Perforation (`.perforation`)
- A horizontal `1px dashed var(--hairline-bold)` rule with optional `var(--ink-faint)` inline label at `font-size: 10px`. Used to break ledger groups by date or store, like the perforated tear-line on a printed report.

## 6. Do's and Don'ts

### Do
- **Do** use the editorial tokens — `--ink`, `--ink-muted`, `--ink-faint`, `--paper`, `--paper-deep`, `--hairline`, `--hairline-bold`, `--accent` — for every color decision on `/dashboard/*`.
- **Do** set every figure (KPI, total, count, currency) in DM Sans 500–600 with `font-variant-numeric: tabular-nums lining-nums`.
- **Do** wrap interactive list rows with `.inv-row` or `.order-row` and let the existing `::before` red-bar pattern carry the hover state.
- **Do** compose page sections with `.inv-panel` (warm-cream background, `1px solid var(--hairline-bold)`, `2px` radius, no shadow).
- **Do** set Fraunces with explicit `font-variation-settings` (`opsz` 96 for headlines, `opsz` 144 for display, `SOFT` 30–50) — default Fraunces reads too literary.
- **Do** stagger first-paint reveals with `.dock-in-1` through `.dock-in-12` (60ms steps, 480ms duration, `cubic-bezier(0.2, 0.7, 0.2, 1)`).
- **Do** pair every platform stamp with a text label.
- **Do** respect `prefers-reduced-motion: reduce` — disable the dock-in stagger and the row-hover `scaleY` transition.

### Don't
- **Don't** use generic Tailwind colors on `/dashboard/*` — no `bg-sky-*`, `text-emerald-*`, `border-violet-*`, no `slate-900` backgrounds. The four CLAUDE.md tripwires are non-negotiable.
- **Don't** ship Toast / Square POS aesthetics — bright primary blues, oversized buttons, friendly-emoji empty states are explicit anti-references from PRODUCT.md.
- **Don't** ship Notion / Coda card sprawl — `<Card className="rounded-xl shadow-sm">` is wrong everywhere on the dashboard. Use `.inv-panel`.
- **Don't** ship Linear / Vercel dark SaaS — slate-900 with neon-gradient accents is exactly what this is rejecting.
- **Don't** apply a `box-shadow` for elevation. The system has no shadow vocabulary; tonal layering and hairlines do that work.
- **Don't** set Fraunces italic on a number, or DM Sans on a display title. Crossing the type lanes breaks the system.
- **Don't** use `hover:bg-muted/50` on a list row. Use `.inv-row` or `.order-row`.
- **Don't** use `#000` or `#fff` anywhere on `/dashboard/*`. Tint every neutral toward the warm-paper hue.
- **Don't** scale the proofmark red beyond state. If `--accent` appears at rest on more than one element per screen (outside an active nav item or a stamp), the design has lost its line.
- **Don't** color-code without labeling. Platform stamps are color + text, never color alone.
