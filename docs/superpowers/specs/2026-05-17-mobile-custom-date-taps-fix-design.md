# Mobile custom-date calendar: taps don't register on iOS — design

**Date:** 2026-05-17
**Scope:** Bug fix. CSS class collision + minor touch hardening.
**Files touched:** [src/styles/editorial-mobile.css](../../../src/styles/editorial-mobile.css), [src/app/(mobile)/m/count/count-flow.tsx](../../../src/app/(mobile)/m/count/count-flow.tsx)

## Symptom

On iPhone Safari, opening the Custom date sheet from the mobile toolbar (every `/m/*` route) shows the editorial two-month calendar normally, but tapping any day — past, today, or future — does nothing. Same flow works on desktop only by chance (mouse pointer events fall through differently than touch).

## Root cause

Two unrelated components declare the same root class `.m-sheet` in [src/styles/editorial-mobile.css](../../../src/styles/editorial-mobile.css):

1. **Date-range sheet shell** ([src/components/mobile/date-sheet/date-sheet-shell.tsx](../../../src/components/mobile/date-sheet/date-sheet-shell.tsx)) — declared at line 1391, anchored to the top of the viewport, `z-index: 81`, sits above its `.m-sheet__backdrop` (`z-index: 80`).
2. **Count-flow adjustment sheet** ([src/app/(mobile)/m/count/count-flow.tsx](../../../src/app/(mobile)/m/count/count-flow.tsx)) — declared at line 2278, anchored to the bottom, `z-index: 60`.

Because CSS cascade prefers the later declaration at equal specificity, the count-flow rule won, so the date sheet rendered with `z-index: 60` — *below* its own backdrop. The backdrop (`position: fixed; inset: 0`) covered the entire viewport and intercepted every tap on the calendar, so no `click` ever reached the day buttons. Playwright's iPhone-viewport run flagged this directly:

> `<div aria-hidden="true" class="m-sheet__backdrop"></div> intercepts pointer events`

The first attempt at a fix — removing the unused `overflow-x: auto` wrapper on `.ed-cal__month` and adding `touch-action: manipulation` to day buttons — addressed real but unrelated nits and did not move the date sheet above its backdrop. The bug persisted on device until the class collision was resolved.

## Fix

1. **Rename the count-flow sheet's classes** to a unique namespace `m-count-sheet` (and `m-count-sheet__head`, `m-count-sheet__close`, `m-count-sheet__body`, `m-count-sheet__lead`, `m-count-sheet__dept`, `m-count-sheet__error`, `m-count-sheet__reasons`, `m-count-sheet__reason-desc`, `m-count-sheet__label`, `m-count-sheet__input`, `m-count-sheet__actions`, `m-count-sheet--pack`). Updates the JSX in [src/app/(mobile)/m/count/count-flow.tsx](../../../src/app/(mobile)/m/count/count-flow.tsx) and the matching CSS block in [src/styles/editorial-mobile.css](../../../src/styles/editorial-mobile.css) (lines 2120–2430). The `@keyframes` is renamed to `m-count-sheet-slide-in` for clarity. The date-sheet definitions (lines 1383–1531) are untouched and now apply unambiguously.
2. **Keep the earlier `.ed-cal` touch hardening** — `touch-action: manipulation` on `.ed-cal__day` and the removal of the redundant `overflow-x: auto` on `.ed-cal__month`. These are not load-bearing for this bug but eliminate a known iOS gesture-classification edge case for the calendar grid and are worth keeping.

No component API changes. No behavior changes for the count-flow sheet (it still anchors to the bottom and slides up; only the class names moved). Date-sheet behavior is restored on iOS as designed at line 1391.

## Verification

Playwright iPhone-13 viewport (390×844):
- Open `/m/pnl` → tap CUSTOM → tap May 10 → readout becomes "Pick an end date" → tap May 15 → tap Apply → URL becomes `/m/pnl?period=custom&start=2026-05-10&end=2026-05-15`. Confirmed.
- Navigate `/m/count` after rename — no console errors, page renders normally.

Manual on a real iPhone is still warranted to confirm the iOS Safari touch dispatch matches Playwright's webkit.

## Out of scope

- Restructuring `DateSheetShell` body lock or focus trap.
- Auditing other `.m-*` selectors for similar collisions across the file (could be a follow-up).
- Day-cell `min-width` change (option B from brainstorm — not needed; grid already fits).
- Replacing `onClick` with pointer/touch events (option C — would mask the underlying issue).
