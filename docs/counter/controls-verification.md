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

**Sections 1–5 below are the original session.** It found one real defect —
`StoreSwitcher` mounted as a bare radiogroup produced a four-row stack next
to `DateControl`'s one-line trigger (§5). That was fixed by giving
`StoreSwitcher` the same single-line-trigger-plus-popover shape
`DateControl` already had, reusing the same frame-placement logic (now
extracted into `src/components/counter/shell/frame-placement.ts`, imported
by both). **§6 is the re-verification session against that fix** — the
harness was rebuilt, the store popover was measured at the same three
widths the range menu was, and the topbar was looked at again.

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

**Original finding (fixed — see §6): the range and comparison read as a
header, but the store switcher did not, and stacking them together broke
the strip.** `DateControl` rendered as a tight single-line row (‹ Last 7
days › | vs the prior period) that read exactly like a header control:
compact, right-aligned, legible at a glance. `StoreSwitcher`, though, was
the bare `role="radiogroup"` from Task 2 — a vertical `grid` of one button
per store — rendered directly in `Topbar`'s children slot with no trigger
or popover wrapping it. Placed next to a one-line date control, it turned
the whole right side of the topbar into a **four-row stack** (All stores /
Hollywood / Glendale opening soon / Van Nuys warming up) that the
single-line date/comparison controls sat oddly centered against — see
`controls-light-closed.png`. The topbar read less like a header and more
like a panel of loosely stacked controls crammed into the top-right corner.
This was a genuine finding, not a nitpick: `StoreSwitcher` was built (Task
2) as a bare primitive with no opinion about where it's mounted, and
`Topbar` (Task 4) was built with a generic children slot and no opinion
either — nothing in either task's brief called for wrapping the switcher in
its own trigger+popover, so this is what "contains a StoreSwitcher and a
DateControl" produced at the time. **Fixed in the same session this doc was
finished in:** `StoreSwitcher` now has the same trigger-collapsed-to-a-chip
shape `DateControl` already had for itself. §6 has the re-verification —
measurements, screenshots, and what the topbar reads as now.

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

## 6. Re-verification: `StoreSwitcher`'s trigger + popover

`StoreSwitcher` now renders a single-line trigger (`aria-haspopup="menu"`,
showing "All stores" or the selected store's name) with a popover behind
it, built on the same `useFramePlacement` hook `DateControl`'s two menus
already used — extracted verbatim into
`src/components/counter/shell/frame-placement.ts` rather than copied a
second time, and imported by both components. `StoreSwitcher` calls it with
narrower bounds (`maxWidth: 280, minWidth: 200`, vs. the range menu's
438/280) since a store name never needs the range picker's width; the 10px
minimum-left-margin flip is identical for both. The harness was rebuilt
(same shape as §1–5: `AppShell` + `Topbar` + both controls) and driven
again with the Playwright MCP browser.

### Does the topbar read as a header now?

Yes — screenshot: `tmp-screenshots/controls-verification/v2-1440-topbar-
closed.png`. The whole right side of the topbar is now one line: a small
green-dot "SYNCED 6:42 PM", then three bordered chips in a row — "All
stores ⌄", "‹ Yesterday ⌄ ›", "VS THE PRIOR PERIOD ⌄" — all vertically
centered against the "Overview" title on the left. Nothing stacks. The
four-row panel from §5 is gone; this is what "contains a StoreSwitcher and
a DateControl" was always meant to produce.

### Store popover frame (note 21), the same three widths as §1

| Viewport | `left` | `right` | `width` | `innerWidth` | On screen? |
|---|---|---|---|---|---|
| 1440×900 | 808 | 1088 | 280 | 1440 | yes — `left ≥ 0`, `right ≤ 1440` |
| 900×900  | 268 | 548  | 280 | 900  | yes — `left ≥ 0`, `right ≤ 900`  |
| 390×844  | 95.09 | 375.09 | 280 | 390 | yes — `left ≥ 0`, `right ≤ 390` |

All three on screen, the 390px case included. Unlike the range menu at 390
(§1), the store popover didn't need to flip to an explicit `left` offset
here — at 280px wide, right-anchoring under the trigger (which itself sits
further from the viewport's right edge than the range trigger does) already
lands its left edge at 95px, well past the 10px minimum — but it's the same
`computeFramePlacement` function deciding that, not a different code path
that happens not to be exercised. Screenshot at 390:
`tmp-screenshots/controls-verification/v2-390-store-popover.png` — "All
stores", "Hollywood", "Glendale OPENING SOON", "Van Nuys WARMING UP" all
fully legible inside the popover, which sits entirely within the frame even
though the page behind it is horizontally scrolled (the known, expected
`AppShell`-at-390 shell limitation from §1 — left untouched, as directed).

### Console errors

**0 in both themes**, re-checked after this fix: a fresh light load, a
fresh dark load (`localStorage.setItem("counter-theme", "dark")` + a real
navigation), and again after opening/closing the store popover and the
range menu several times in each. Screenshots:
`tmp-screenshots/controls-verification/v2-dark-store-popover.png` (dark,
open) alongside `v2-1440-store-popover.png` (light, open). In dark the
popover separates from the page the same way the range menu's did in §5 —
a visibly lighter charcoal surface, crisp hairline border, warm-red wash on
"All stores" (the current selection) — consistent with, not a regression
of, the earlier finding.

### Sanity check: did the refactor change `DateControl`'s own behaviour?

No. The range menu was re-measured at 1440 post-refactor as a control:
`left: 787.5, right: 1225.5, width: 438` — identical to §1's original
number. Extracting the shared helper didn't move `DateControl`'s own
popover.

## Summary

The two things this task originally set out to prove both hold, measured,
in a real browser: the popover never leaves the viewport at any of the
three widths tested, including the 390px case note 21 called out by name,
and the weekday comparison disappears from the menu exactly at the 7-day
boundary `date-range.ts` draws, not a day earlier or later. The URL
round-trips a preset, a comparison and a store through an actual reload,
and drops all three back to nothing when every control is returned to its
default. Zero console errors in both themes, confirmed after real
interaction, not just a cold load. The one real finding from actually
looking — `Topbar` containing both `StoreSwitcher` and `DateControl`
directly produced a lopsided four-row-vs-one-row header — is now fixed
(§6): `StoreSwitcher` has its own single-line trigger and frame-measured
popover, built on the same placement helper `DateControl` uses, and the
topbar reads as a single-line header at 1440, 900 and (modulo the
already-known, out-of-scope `AppShell` rail-collapse limitation) 390.
