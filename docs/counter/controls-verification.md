# Controls verification: `StoreSwitcher` + `DateControl` seen in a real browser

Task 5 of Plan 5. jsdom cannot prove any of this — it has no layout, so
`getBoundingClientRect()` always returns a zero-sized box, and it has no real
`window.location`, so a reload cannot be exercised. This file is the missing
evidence: a real Chromium session, signed in with the `.env.test.local`
credentials, driving a throwaway route
(`src/app/counter-controls-harness/page.tsx`) that rendered `AppShell` with
`pathname="/dashboard"`, a `Topbar` titled "Overview", and — in the
`Topbar`'s children slot — a `StoreSwitcher` (three plausible stores:
Hollywood trading, Glendale `pre_open`, Van Nuys `warming_up`) and a
`DateControl`, both wired straight to `readCounterParams` /
`writeCounterParams` against the real URL. The harness was deleted
immediately after this session — see the `git diff` on this task's commit,
which shows no trace of it.

Method: `npm run dev` on `http://localhost:3000`, driven with the
Playwright MCP browser (real Chromium), signed in through `/login` with the
`E2E_USER_EMAIL` / `E2E_USER_PASSWORD` credentials from `.env.test.local`.
Screenshots were written to `tmp-screenshots/controls-verification/`
(gitignored, not part of this commit); paths below are relative to the repo
root for reference within this session.

## 1. Does the popover stay on screen? (note 21)

The range menu (`role="menu" aria-label="Range"`) was opened at three
viewport widths and measured with `getBoundingClientRect()` against
`window.innerWidth`:

| Viewport | `left` | `right` | `width` | `innerWidth` | On screen? |
|---|---|---|---|---|---|
| 1440×900 | 787.5 | 1225.5 | 438 | 1440 | yes — `left ≥ 0`, `right ≤ 1440` |
| 900×900  | 247.5 | 685.5  | 438 | 900  | yes — `left ≥ 0`, `right ≤ 900` |
| 390×844  | 10    | 376    | 366 | 390  | yes — `left ≥ 0`, `right ≤ 390` |

All three pass. At 1440 and 900 the menu is wide enough to hit its 438px
max and simply right-anchors under the trigger with room to spare. At 390 —
the case note 21 called out, since 438px is wider than the phone itself —
`computePlacement` clamps the width to `390 - 24 = 366` and, because a
right-anchored 366px box would put its left edge at `366 (trigger right) -
366 (width) = 0`, past the `MIN_LEFT = 10` threshold, it flips to an
explicit `left: 10` offset instead of the CSS default. The measured box
(`left: 10, right: 376`) is exactly what that arithmetic predicts, and nine
minutes of margin (390 − 376) at the right edge, ten at the left. The
comparison menu was checked too, off the same mechanism: at 390 it measured
`left: 10, right: 270, width: 260` — also fully on screen. Screenshots:
`tmp-screenshots/controls-verification/controls-{1440,900,390}-light-range.png`.

**This is a pass, not a near-miss.** The flip logic Tasks 1–3 ported from
the prototype's own `place()` does exactly what note 21 asked for — the
438px picker never overflows a 390px phone, in a real browser, measured.

The 390px screenshot also surfaces a finding that's about the *shell*, not
the popover: `AppShell`'s 212px rail column is fixed-width with no
responsive collapse, so at 390px the whole page (rail included) is
horizontally scrollable and both the store list and the comparison chip's
label are clipped off the right edge before you even open a menu. That's
expected — this codebase's phone experience lives under `/m/**` with its
own shell (`docs/counter/counter-prototype.html`'s own responsive rules
hide `.rail__store`/`.rail__cap` under 760px) — `AppShell` was never meant
to serve 390px directly. Noted here because it's what you see if you drive
this exact harness at 390 without also switching shells, not because it's
a defect in this task's scope.

## 2. Does the weekday comparison disappear on a long range?

With the range set to **Last 30 days** (`?range=d30`), the comparison menu
showed exactly three options — Prior period, Last year, None — no weekday
option anywhere. Switching to **Last 7 days** (`?range=d7`) and reopening
the same menu showed all four — Prior period, **4 same weekdays**, Last
year, None. This is `comparisonRange(range, "weekday")` returning `null`
past 7 days (`src/lib/counter/date-range.ts`) reaching the real menu through
`DateControl`'s `comparisonOptions` filter, exercised end to end rather than
trusted from the unit test. Screenshots:
`tmp-screenshots/controls-verification/controls-d30-comparison-3options.png`,
`tmp-screenshots/controls-verification/controls-d7-comparison-4options.png`.

## 3. Does the URL round-trip, and do defaults get dropped?

Starting from a clean load, a preset, a comparison and a store were picked
in sequence, reading `window.location.search` after each:

| Action | `window.location.search` |
|---|---|
| Select "Last 30 days" | `?range=d30` |
| Select "Last 7 days" | `?range=d7` |
| Select "4 same weekdays" | `?range=d7&cmp=weekday` |
| Select "Hollywood" | `?range=d7&cmp=weekday&store=hollywood` |

**Reload** (a real `page.goto` to that exact URL, forcing a fresh mount —
not a client-side navigation): the page came back with Hollywood checked
in the store radiogroup, "Last 7 days" as the range chip, "vs the same 4
weekdays" as the comparison chip, and the displayed range (Tue Aug 18 –
Mon Aug 24, 2026) matching what `d7` resolves to on this date. All three
controls survived the reload in the same state they were left in.

**Defaults removed, not written.** From that same state, each control was
set back to its default in turn:

| Action | `window.location.search` after |
|---|---|
| Select "All stores" (default: `storeId = null`) | `?range=d7&cmp=weekday` — `store` gone |
| Select "Prior period" (default: `comparisonId = "prev"`) | `?range=d7` — `cmp` gone |
| Select "Yesterday" (default: `presetId = "yesterday"`) | *(empty)* — `range` gone too |

The final URL is `http://localhost:3000/counter-controls-harness` with no
query string at all. `writeCounterParams`'s "drop the default" rule
(`src/lib/counter/url-state.ts`) holds for all three params, confirmed
against the real address bar, not just the unit test's `URLSearchParams`
object.

## 4. Both themes, console errors

Theme was set the way a real user takes it —
`localStorage.setItem("counter-theme", "dark"|"light")` followed by a full
navigation, not a stubbed provider. For each theme, the range menu was
opened and screenshotted:

- Light: `tmp-screenshots/controls-verification/controls-light-closed.png`,
  `controls-light-range-open.png`
- Dark: `tmp-screenshots/controls-verification/controls-dark-closed.png`,
  `controls-dark-range-open.png`

**Console errors: 0 in both themes.** Checked via the browser's own console
log after a fresh load of each theme and again after opening/closing both
menus several times while switching presets, comparisons and stores — every
check returned `0 errors`. The only console output at all, in either theme,
was a single benign Next.js dev warning repeated per navigation (`chunks/…
was preloaded using link preload but not used…`, a stylesheet-preload
timing notice unrelated to Counter code — the same class of noise
`docs/counter/shell-verification.md` already saw and dismissed for the same
reason).

## 5. Look at it and say what you see

**The range and comparison read as a header, but the store switcher does
not — and stacking them together breaks the strip.** `DateControl` renders
as a tight single-line row (‹ Last 7 days › | vs the prior period) that
reads exactly like a header control: compact, right-aligned, legible at a
glance. `StoreSwitcher`, though, is the bare `role="radiogroup"` from Task
2 — a vertical `grid` of one button per store — rendered directly in
`Topbar`'s children slot with no trigger or popover wrapping it. Placed
next to a one-line date control, it turns the whole right side of the
topbar into a **four-row stack** (All stores / Hollywood / Glendale opening
soon / Van Nuys warming up) that the single-line date/comparison controls
sit oddly centered against — see `controls-light-closed.png`. The topbar
reads less like a header and more like a panel of loosely stacked controls
crammed into the top-right corner. This is a genuine finding, not a nitpick:
`StoreSwitcher` was built (Task 2) as a bare primitive with no opinion about
where it's mounted, and `Topbar` (Task 4) was built with a generic children
slot and no opinion either — nothing in either task's brief called for
wrapping the switcher in its own trigger+popover, so this is what "contains
a StoreSwitcher and a DateControl" produces today. Before a real page ships
with both in the topbar, the store switcher needs the same
trigger-collapsed-to-a-chip treatment the date control already has for
itself, or a different home entirely (the prototype puts it in the rail,
not the topbar, behind its own `.storepop`).

**The current range is legible at a glance.** "Last 7 days" — or whichever
preset is active — sits in its own bordered chip in JetBrains-Mono-adjacent
sans, flanked by ‹ › steppers, and the comparison sits beside it in
uppercase mono. Nothing about reading "what window am I looking at" takes
more than the one glance the design intends.

**In dark, the popover clearly separates from the page.** `controls-dark-
range-open.png`: the menu's surface is a visibly lighter charcoal than the
near-black chrome/page behind it, with a crisp hairline border and a
warm-red accent wash on the selected row (`Last 7 days`). It doesn't merge
— if anything the separation reads slightly stronger in dark than in light,
where the menu's cream surface sits closer in value to the paper behind it
(still clearly bordered, just a smaller value jump).

**The stage label reads as information, not clutter — in isolation.**
"opening soon" and "warming up" in small caps mono beside a store name
answer exactly the question note 58 says they exist to answer (why is this
store empty), and they don't compete with the store name for attention —
different weight, different case, secondary ink colour. The clutter this
session found is positional (see above: four rows is a lot of vertical
space for a topbar control), not textual — the labels themselves are
doing their job.

**Titles render correctly.** Confirmed via `getComputedStyle` on the `<h1>`:
`font-family: "Bricolage Grotesque", "Bricolage Grotesque Fallback", "DM
Sans", …`, `font-weight: 700` — `font-ct-display`, and only there, per
CLAUDE.md's tripwire #3.

## Summary

The two things this task set out to prove both hold, measured, in a real
browser: the popover never leaves the viewport at any of the three widths
tested, including the 390px case note 21 called out by name, and the
weekday comparison disappears from the menu exactly at the 7-day boundary
`date-range.ts` draws, not a day earlier or later. The URL round-trips a
preset, a comparison and a store through an actual reload, and drops all
three back to nothing when every control is returned to its default. Zero
console errors in both themes, confirmed after real interaction, not just a
cold load. One real finding came out of actually looking rather than just
measuring: `Topbar` containing both `StoreSwitcher` and `DateControl`
directly, as this task's own brief describes, produces a lopsided
four-row-vs-one-row header — not because either primitive is broken, but
because neither task gave `StoreSwitcher` a collapsed/triggered form for
this context. Read this before mounting both in a real page's topbar.
