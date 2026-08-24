# Motion verification: `prefers-reduced-motion` in a real browser

Task 7 of Plan 3. The Recharts spike (Plan 3 planning) claimed "reduced motion
works by default" on the strength of reading Recharts' `.d.ts` files. Every
unit test in this plan stubs `matchMedia` — that proves `useReducedMotion`'s
hooks *branch* correctly, not that a real browser agrees. This file is the
missing evidence: two Playwright passes against `npm run dev`
(`http://localhost:3000`), driving a real Chromium via
`page.emulateMedia({ reducedMotion })`, against a throwaway harness page that
rendered a `<Chart variant="line">`, a `<Chart variant="bar">`, a
`useCountUp`-driven figure, and three `useEntry(index)` sections. The harness
(`src/app/counter-harness/page.tsx`) was deleted immediately after — see the
final `git diff` in the Task 7 commit, which shows no trace of it.

Method: for each media setting, `page.emulateMedia(...)` was set, the page
was navigated (and, to rule out dev-server HMR noise, reloaded once more
after a settle period), then the DOM was sampled repeatedly over the
following ~1.5s, reading `element.style.animationName`,
`.animationDelay`, the line path's `stroke-dasharray` attribute, and the
counted figure's `textContent` — all inline properties Recharts/React set
directly, not CSS-computed values, so what's reported is exactly what each
hook wrote.

## `reduced` (`prefers-reduced-motion: reduce`)

12 samples, t = 150ms → 1506ms after navigation. Every sample was identical:

| Signal | Observed |
|---|---|
| Counted figure text | `7468` at every sample, including the first (t=150ms) — the first painted value **is** the final value |
| Line `stroke-dasharray` | `null` at every sample — no draw-in attribute is ever set |
| Bar `animation-name` (7 bars) | `""` at every sample |
| Bar `animation-delay` (7 bars) | `""` at every sample |
| Entry-section `animation-name`/`animation-delay` (3 sections) | `""` / `""` at every sample |
| Console | 0 errors |

This matches the brief's expectation exactly: nothing animates, and the
figure never shows a transient value.

## `no-preference` (`prefers-reduced-motion: no-preference`)

12 samples, t = 107ms → 1460ms after navigation.

| Signal | Observed |
|---|---|
| Bar `animation-name` (7 bars) | `"ct-bar-grow"` on all 7, from the first post-mount sample onward |
| Bar `animation-delay` (7 bars) | `0ms, 26ms, 52ms, 78ms, 104ms, 130ms, 156ms` — an exact 26ms stagger, matching `BAR_STAGGER_MS` |
| Entry-section `animation-name` (3 sections) | `"ct-entry"` on all 3 |
| Entry-section `animation-delay` (3 sections) | `0ms, 36ms, 72ms` — an exact 36ms stagger, matching `ENTRY_STAGGER_MS` |
| Line `stroke-dasharray` | absent pre-mount, then `"0px 1790.99px"` → `"293px 1790.99px"` → `"923px 1790.99px"` → `"1559px 1790.99px"` → `"1791px 1790.99px"` (fully drawn) → attribute removed. Elapsed from first non-null sample to the attribute disappearing: ~740–940ms, consistent with the documented 720ms `LINE_DRAW_MS` given ~100–300ms sampling granularity near the tail |
| Console | 1 confirmed `Hydration failed` error (see below), reproduced on every repeated navigation |

The stagger numbers land exactly on the constants (`BAR_STAGGER_MS = 26`,
`ENTRY_STAGGER_MS = 36`) — this is real per-element inline CSS, not a test
double.

## Finding: `useCountUp` hydration-mismatches on every real `no-preference` load

This is the one thing the stubbed-`matchMedia` unit tests could not have
caught, and it is a genuine defect — not a failure to honour the
preference (the terminal state under both settings is correct), but a
real, reproducible SSR/client split in `useCountUp` specifically.

**Mechanism.** `useReducedMotion`'s initial `useState` computes `reduced`
synchronously: `typeof matchMedia === "function" ? matchMedia(QUERY).matches
: true`. On the server, `matchMedia` doesn't exist, so **every SSR pass
renders as if reduced motion were on** — that's the documented, deliberate
safe default. `useCountUp` uses that value to pick its *initial displayed
number*: `reduced ? value : 0`. So the server always renders the figure's
**final** value (`7468`), regardless of what the visiting browser actually
prefers.

For a `reduce` visitor, the client also computes `reduced = true` on first
render, so client and server agree (`7468` both times) — no mismatch, which
is exactly what the "reduce" table above shows.

For a `no-preference` visitor — the common case, since most people don't
have OS-level reduced motion turned on — the client's first render computes
`reduced = false` and wants to start the count at `0`. Server said `7468`,
client wants `0`: a genuine text-content hydration mismatch. Reproduced on
every one of six repeated fresh navigations in this session (see the raw
Playwright console capture; each `Encountered a script tag...` /
`Hydration failed because the server rendered text didn't match the client`
pair fired together, every time, only under `no-preference`, never under
`reduce`). React's response is its documented recovery path: discard the
mismatched subtree and regenerate it client-side — which is also why the
harness's root-layout inline theme-script warning ("Encountered a script
tag...") rides along each time: that recovery re-render walks back up
through the app tree, past the layout's no-flash `<script>`, re-triggering
a warning that would otherwise only fire once.

**Downstream, visible consequence.** Because the whole subtree is discarded
and remounted, the counted figure doesn't just "start over cleanly" — its
freshly-mounted `useCountUp` instance's very first `requestAnimationFrame`
tick reported `elapsed = now - start = -9.8ms` (measured directly: `start`
was captured via a synchronous `performance.now()` inside the effect at
`125.5ms`; the first rAF callback fired with `now = 115.7ms`, i.e. *before*
`start`). `requestAnimationFrame`'s timestamp argument is the time the
browser's current frame began, which can predate a `performance.now()` call
made after that frame started — a real, if obscure, timing quirk. A
negative `elapsed` produces a negative `t`, and the cubic ease-out
(`1 - (1-t)**3`) is not clamped, so a negative `t` produces a negative
`eased` — observed directly as the counted figure briefly rendering
**`-542`** (one run) / **`-664`** (another) for a single frame before
recovering and counting up normally (`4786 → 6070 → 6861 → 7202 → 7455 →
7468`, landing exactly on target at t≈659ms). This reproduced identically
across three separate measurement passes (including one after a hard
`page.reload()` with no concurrent file edits), so it is not Fast-Refresh
noise — it is a real, if narrow, defect in the animation math.

**Scope check — is this shipping today?** No. `Figure`
(`src/components/counter/surface/figure.tsx`) takes a pre-formatted
`value: string` prop; it does not call `useCountUp` anywhere, and no other
component in the tree does either. `useCountUp` is exported from the barrel
(this task's Step 1) but has zero production callers yet, so no shipped page
carries this hydration mismatch today. It will the moment a page wires a
`Figure` (or anything else) up to `useCountUp`.

**Recommended fix (not implemented here — out of scope for this task, which
is proof-and-documentation, not a fix)**: make the SSR and first-client-render
text agree, e.g. initialise `display` to `value` unconditionally (matching
what the server always renders) and only start the animation from `0` inside
the mount effect itself, after the DOM is already interactive — never as the
value React hydrates against. Separately, clamp `t` to `[0, 1]`
(`Math.max(0, Math.min(1, elapsed / duration))`) so a stray negative-`elapsed`
first frame can't produce an out-of-range `eased` value regardless of cause.

`useEntry` and `useChartDraw` (the `Chart` bar/line animation props) have the
same SSR-always-reduced default, but they only change **inline `style`**
props (`animation-name`/`animation-delay` present vs. absent) between server
and client, not text content — React patches an attribute-level mismatch in
place rather than discarding the subtree, so no hydration error was observed
for either of them in this session's captures.

## Summary

| | `reduce` | `no-preference` |
|---|---|---|
| Bars animate | No | Yes — 26ms stagger, exact |
| Line draws in | No | Yes — ~720ms, matches `LINE_DRAW_MS` |
| Entry sections stagger | No | Yes — 36ms stagger, exact |
| Figure's first paint = final value | Yes | No — SSR paints the final value, then a forced hydration remount **restarts** the count from a transient negative value before landing correctly |
| Console errors | 0 | 1 (`Hydration failed`, `useCountUp`-specific, reproduced every time) |

`prefers-reduced-motion` itself **is honoured** — nothing animates when it's
requested, and every animated value lands on the correct final number
either way. The defect found here is adjacent to that: the *safe* SSR
default (assume reduced) guarantees a hydration mismatch, a full-subtree
remount, and a one-frame negative-value glitch for the common case
(`no-preference`) the moment `useCountUp` gets a real caller. Filed above
rather than papered over, per this task's brief.
