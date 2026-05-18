# Mobile custom-date calendar: taps don't register on iOS — design

**Date:** 2026-05-17
**Scope:** Bug fix. CSS-only.
**Files touched:** [src/styles/editorial-mobile.css](../../../src/styles/editorial-mobile.css)

## Symptom

On iPhone Safari, opening the Custom date sheet from the mobile toolbar (every `/m/*` route) shows the editorial two-month calendar normally, but tapping any day — past, today, or future — does nothing. No highlight, no underline animation, no selection. The same flow works on desktop.

## Root cause

Each month container has horizontal-scroll wiring even though the grid always fits the sheet width:

[src/styles/editorial-mobile.css:1230-1238](../../../src/styles/editorial-mobile.css#L1230-L1238)

```css
.ed-cal__month {
  …
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
```

The `.ed-cal__grid` and `.ed-cal__weekdays` have `min-width: 308px`, which fits every iPhone viewport with margin to spare — the horizontal scroll is never triggered. But the `overflow-x: auto` rule still turns `.ed-cal__month` into a scroll container, and iOS Safari resolves taps inside scroll containers ambiguously: a `touchstart` on a child can be classified as the start of a pan and the subsequent `click` never fires.

`.ed-cal__day` ([src/styles/editorial-mobile.css:1304](../../../src/styles/editorial-mobile.css#L1304)) also has no `touch-action` hint, which lets iOS add a small classification delay on top.

## Fix

Two CSS edits in [src/styles/editorial-mobile.css](../../../src/styles/editorial-mobile.css):

1. **`.ed-cal__month` — drop horizontal-scroll wiring.** Remove `overflow-x: auto` and `-webkit-overflow-scrolling: touch`. The `::-webkit-scrollbar { display: none }` rule becomes redundant; remove it too.
2. **`.ed-cal__day` — add `touch-action: manipulation`.** Tells iOS to skip pan/zoom classification on day buttons and deliver `click` immediately.

No component changes. No behavior change on desktop. No change to disabled-future-date logic.

## Verification

- Open `/m/pnl` on iPhone Safari, tap the Custom pill, tap a past date → red underline animation appears, readout updates. Tap a second date → range fills. Apply navigates with `?period=custom&start=…&end=…`.
- Repeat on one other route (e.g., `/m/analytics`) to confirm the fix is universal.
- Desktop Chrome regression check: same flow still works; no horizontal scroll bar appears anywhere.

## Out of scope

- Changing the disabled-future-date rule or its visual.
- Restructuring `DateSheetShell` body lock or focus trap.
- Reducing day-cell `min-width` below 44px (option B from brainstorm — not needed since the grid already fits).
- Swapping `onClick` for pointer/touch events (option C from brainstorm — would mask the root cause).
