# Mobile date selection — expanded picker

**Date:** 2026-04-29
**Scope:** `/m/**` mobile PWA shell
**Status:** Approved design

---

## Goal

Mobile (`/m`) currently has only four date pills (Today / Yest / Wk / Last Wk) and the P&L page has no selector at all (hardcoded to "Last 8 weeks"). We want richer date selection on mobile without abandoning the editorial design language.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Add a single **Custom** pill to the shared mobile toolbar (the existing 4 short pills stay). | Keeps the toolbar compact; avoids overflow-scroll pill rows. |
| 2 | P&L gets its **own** finance-tuned pill row (not the shared toolbar). | Daily/Yesterday rarely useful for P&L; "This/Last Month" and "8 Wks" are the common cases. |
| 3 | Custom pill opens an **editorial-styled bottom sheet calendar** (not native inputs). | Matches the dashboard's editorial aesthetic; designed via the `impeccable` skill. |
| 4 | P&L Custom range gets a **granularity toggle** (Daily / Weekly / Monthly), auto-selected from range length but user-overrideable. | Matches desktop P&L's daily/weekly/monthly grouping; auto default = no extra cognitive load. |

## URL contract

| Page set | Param shape |
|----------|-------------|
| Toolbar pages (home, analytics, operations, orders, invoices) | `?period=today\|yesterday\|this-week\|last-week\|custom` <br> When `period=custom`: `&start=YYYY-MM-DD&end=YYYY-MM-DD` |
| P&L (`/m/pnl`, `/m/pnl/[storeId]`) | `?period=this-week\|last-week\|this-month\|last-month\|last-8-weeks\|custom` <br> When `period=custom`: `&start=YYYY-MM-DD&end=YYYY-MM-DD&grain=daily\|weekly\|monthly` (grain optional → auto) |

All other params (`storeId`, `status`, `platform`, …) are preserved through the existing `withParams` helper.

### Validation
- Bad ISO, `end < start`, or range > 365 days → fall back to the page's default period silently. No error UI.
- `start === end` is allowed (single-day custom).
- `grain` is honored only when `period=custom`; ignored on named periods.

## Component layout

```
src/components/mobile/
  m-toolbar.tsx                          ← MODIFY: add Custom pill (+ active-range readout)
  m-pnl-toolbar.tsx                      ← NEW: finance-tuned pill row
  date-sheet/
    editorial-calendar.tsx               ← NEW: pure range picker (client)
    m-toolbar-custom-sheet.tsx           ← NEW: bottom-sheet wrapper for toolbar
    m-pnl-custom-sheet.tsx               ← NEW: bottom-sheet wrapper + granularity toggle
    custom-pill-trigger.tsx              ← NEW: tiny client island that opens the sheet

src/lib/mobile/
  period.ts                              ← MODIFY: extend type with "custom", add parsers
  pnl-period.ts                          ← NEW: P&L preset set + autoGrain helper
```

### Module responsibilities

**`src/lib/mobile/period.ts`** (modify)
- Extend `MobilePeriod` to include `"custom"`.
- Export `parseToolbarRange(searchParams)` returning `{ kind: "named", period } | { kind: "custom", start, end }`.
- `periodToDateRange()` continues to handle named periods; new `customToDateRange(start, end)` handles custom.
- `MOBILE_PERIODS` still exports the 4 named pills (Custom is rendered separately by the toolbar).

**`src/lib/mobile/pnl-period.ts`** (new)
- `MobilePnLPeriod = "this-week" | "last-week" | "this-month" | "last-month" | "last-8-weeks" | "custom"`
- `MOBILE_PNL_PERIODS`: array of `{ value, label, short }` for the pill row.
- `pnlPeriodToRangeState(period)`: returns `PnLRangeState` for named periods (reuses logic from `src/components/pnl/pnl-date-presets.ts` — do not duplicate; import or factor shared helpers).
- `parsePnLRange(searchParams)`: returns `{ kind: "named", period } | { kind: "custom", start, end, grain? }`.
- `autoGrain(start, end): Granularity` — `≤14 days → "daily"`, `≤70 days (10 weeks) → "weekly"`, else `"monthly"`.
- Default if no `period` param: `"last-8-weeks"` (preserves current page behavior).

**`src/components/mobile/date-sheet/editorial-calendar.tsx`** (new, client)
- Props: `{ initialStart?: Date; initialEnd?: Date; onChange: (start: Date | null, end: Date | null) => void }`.
- Pure UI — no sheet chrome, no apply button, no URL mutation.
- Renders **two stacked month grids**: current month + prior month. (Past-only by default; user can navigate older months via header arrows. Future months disabled — financial data ranges are historical.)
- Tap-flow: first tap sets start, second tap sets end. If user taps a date earlier than current start, treat as new start (don't error).
- Visual rules (editorial system):
  - Hairline frame (`var(--hairline)`) around each month block, 2px radius.
  - Weekday headers: JetBrains Mono caps, `var(--ink-faint)`, letter-spacing 0.18em.
  - Day numbers: DM Sans 500, `font-variant-numeric: tabular-nums lining-nums`.
  - Selected start/end: red `var(--accent)` underline (4px, `scaleY(0→1)` on commit).
  - In-range fill: `rgba(220,38,38,0.045)` (matches `.inv-row` hover wash).
  - Today: subtle JetBrains Mono `TODAY` cap above the number.
  - Disabled (future) days: `var(--ink-faint)`, no hover affordance.
- Keyboard: arrow keys move focus, Enter selects (even on mobile this matters for accessibility / external keyboards).

**`src/components/mobile/date-sheet/m-toolbar-custom-sheet.tsx`** (new, client)
- Props: `{ open: boolean; onClose: () => void; pathname: string; searchParams: Record<string, string | undefined>; initialStart?: Date; initialEnd?: Date }`.
- Bottom-anchored sheet, dims background, slide-up animation (~180ms, `cubic-bezier(0.32, 0.72, 0, 1)`).
- Sheet shell:
  - Header bar: dept-cap "DATE RANGE" + red proofmark + close (×) on the right.
  - Range readout (DM Sans tabular nums): `MAR 5 — APR 20 · 47 DAYS` (or "Pick a start date" placeholder).
  - `<EditorialCalendar />`.
  - Footer: Cancel (ghost) + Apply (red filled, JetBrains Mono caps).
- On Apply: `router.push(buildHref(pathname, searchParams, { period: "custom", start, end }))`, then `onClose()`.
- Apply disabled until both start and end are set.

**`src/components/mobile/date-sheet/m-pnl-custom-sheet.tsx`** (new, client)
- Same shell as toolbar sheet, with one addition: a granularity toggle row above the footer.
  - Three pills: "Daily / Weekly / Monthly", JetBrains Mono caps.
  - Auto-selected via `autoGrain(start, end)`; updates as range changes.
  - User tap overrides auto and sticks until they change the range; tapping the granularity pill that matches the current auto-pick reverts to auto-mode (URL omits `&grain=`).
- On Apply: pushes `?period=custom&start=…&end=…&grain=…` (or omits `grain` if auto).

**`src/components/mobile/date-sheet/custom-pill-trigger.tsx`** (new, client)
- Props: `{ pathname; searchParams; variant: "toolbar" | "pnl"; activeRangeLabel?: string }`.
- Renders the "Custom" pill as a `<button>` (not a `<Link>`).
- When `activeRangeLabel` is set (period=custom), renders `<RangeLabel>MAR 5 → APR 20</RangeLabel>` inside the pill instead of the word "Custom".
- On click: lazy-imports the appropriate sheet (`variant === "pnl" ? MPnLCustomSheet : MToolbarCustomSheet`) and opens it. (Lazy load keeps the calendar JS off the initial page bundle.)

**`src/components/mobile/m-toolbar.tsx`** (modify)
- Append the `<CustomPillTrigger variant="toolbar" />` after the four named pills.
- When `period === "custom"`, none of the four named pills is `is-active`; instead, the Custom pill is `is-active` and shows the range readout.
- `withParams` already preserves other params, but extend it to clear `start`/`end` when navigating to a named period.

**`src/components/mobile/m-pnl-toolbar.tsx`** (new)
- Same shape as `m-toolbar.tsx` but uses `MOBILE_PNL_PERIODS` and `<CustomPillTrigger variant="pnl" />`.
- Used by `/m/pnl` and `/m/pnl/[storeId]` only.

### Page wiring

- `src/app/(mobile)/m/pnl/page.tsx` and `src/app/(mobile)/m/pnl/[storeId]/page.tsx`:
  - Read `searchParams` (`period`, `start`, `end`, `grain`).
  - Resolve via `parsePnLRange()` → `PnLRangeState` (use `pnlPeriodToRangeState()` for named, `customToPnLState()` for custom).
  - Render `<MPnLToolbar />` between PageHead and MastheadFigures.
  - Default range when no params: `pnlPeriodToRangeState("last-8-weeks")` (preserves today's behavior).

- All other pages currently using `MToolbar` (home, analytics, operations, orders, invoices) get the Custom pill for free.

## Design tokens / styling

All new components use the existing editorial tokens — `--ink`, `--ink-muted`, `--ink-faint`, `--paper`, `--hairline`, `--hairline-bold`, `--accent`. No generic Tailwind colors. No shadcn `<Card>` shadows.

The bottom sheet itself uses `.inv-panel` styling (warm paper background, hairline-bold border, 2px radius, no shadow) but with the rounded top corners only (radius applies to top edges).

## Out of scope

- Saved custom ranges / "favorites".
- Comparison ranges (vs. prior period).
- Date arithmetic shortcuts ("last 30 days", "year to date") — can be added later as named presets if they earn it.
- Desktop changes — desktop P&L date picker unchanged.
- Toolbar pill-row scroll / overflow handling — sticking with the existing fixed-grid layout.

## Build sequence

1. `src/lib/mobile/period.ts` — extend types, add `parseToolbarRange` and `customToDateRange`.
2. `src/lib/mobile/pnl-period.ts` — new file, including `autoGrain` and `parsePnLRange`.
3. `src/components/mobile/date-sheet/editorial-calendar.tsx` — pure calendar, designed via `impeccable`.
4. `src/components/mobile/date-sheet/m-toolbar-custom-sheet.tsx` and `m-pnl-custom-sheet.tsx`.
5. `src/components/mobile/date-sheet/custom-pill-trigger.tsx`.
6. `m-toolbar.tsx` — wire Custom pill.
7. `m-pnl-toolbar.tsx` — new finance toolbar.
8. P&L pages — read URL, pass to action, render toolbar.
9. Manual test on mobile viewport: every pill, custom flow on toolbar pages and P&L, granularity override, browser back/forward, deep-link with explicit params.
