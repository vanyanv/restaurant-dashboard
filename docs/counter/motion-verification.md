# Motion verification: `prefers-reduced-motion` in a real browser

**Status: FIXED — systemically, not per-consumer.** The root cause was
`useReducedMotion`'s own initialiser reading `matchMedia` (a client-only
value) during render, which every consumer inherited. Three components
shared it: `useCountUp` (a hard hydration failure, patched locally first),
`useEntry` (a milder, previously-*masked* attribute-only version of the
same thing, uncovered only once the `useCountUp` failure stopped hiding
it), and `theme-provider.tsx` (latent, no mounted consumer yet). Fixing the
cause once, in `useReducedMotion`, closed both known instances and the
`theme-provider.tsx` one whenever it gets a consumer. See "Systemic fix
verification" at the end of this file for the final real-browser numbers —
**0 console errors under both media settings**, including the `useEntry`
warning being gone outright, not merely quieter. The two sections below
("Finding" and the earlier "Fix verification") are kept unedited as the
record of what real-browser testing caught, and how the first, narrower
fix was arrived at, before the shared cause was found.

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

## Fix verification

Plan 4 wires `Figure` to `useCountUp`, so the defect above would have
shipped. Fixed in `src/components/counter/motion/use-count-up.ts`:

1. **Hydration mismatch** — `display` now initialises to `value`
   unconditionally (server render, and the client's first render, always
   agree), and the mount effect is the only thing that ever moves it to
   `from` — after hydration has already succeeded. One settled frame at the
   target, then it drops to 0 and counts up: an accepted, deliberate cost,
   documented in the hook's own comment so it doesn't get "optimised" back
   into the mismatch.
2. **Negative `elapsed`** — clamped to a floor of 0, and the eased fraction
   is separately clamped to `[0, 1]`, so no rAF-timestamp/`performance.now()`
   ordering quirk can produce a displayed value outside `[start, target]`.

Same harness, same method, re-run against `npm run dev` after the fix
(source rebuilt, dev server restarted, fresh login, `page.emulateMedia`
exactly as before):

### `reduce`, post-fix

12 samples, t=128ms→1191ms. `7468` at every single sample, including the
very first (t=128ms). 0 console errors, 0 page errors.

### `no-preference`, post-fix

12 samples, t=178ms→1203ms:

```
178ms   0
220ms   3686
260ms   4983
302ms   5944
342ms   6422
382ms   6788
442ms   7244
502ms   7430
602ms   7468   (landed, holds through 1203ms)
```

Monotonically increasing, start-to-target, every sample — **no negative
value anywhere**, in contrast to the pre-fix `7468 → -542/-664 → 4786 → …`
sequence measured above. `Hydration failed` (the error tied to
`useCountUp`'s text mismatch): **0 occurrences**, down from reproducing on
every one of 6 fresh navigations pre-fix.

**Residual, separate, and out of scope**: 2 raw console `error`-level
events still fire under `no-preference`, both the same distinct message —
*"A tree hydrated but some attributes of the server rendered HTML didn't
match the client properties. This won't be patched up."* — pointing not at
`CountedFigure` (clean now) but at the `EntrySection` elements'
`animation-*` inline styles. This is exactly the attribute-only mismatch
predicted earlier in this document for `useEntry`/`useChartDraw` (SSR
always omits animation styles; a `no-preference` client adds them) — it was
never actually *absent* before, it was masked: the harder `Hydration
failed` error aborted hydration of the whole subtree before React got far
enough to separately evaluate the entry sections' attributes. Fixing the
harder bug let the softer, pre-existing one surface. It is lower severity
(no subtree discard, no remount) and does not affect the rendered result —
the stagger numbers above (26ms bars, 36ms sections, measured earlier in
this document) are already proof the animations end up correct regardless.
Not fixed here — the coordinator's ask was scoped to the `useCountUp`
hydration/negative-value defect specifically — but recorded here rather
than left to be rediscovered as a surprise. See
`docs/counter/deferred-upgrades.md`.

### Unit tests added

`tests/components/counter/motion/use-count-up.test.tsx` gained two tests,
both reproducing the exact conditions measured above rather than
approximating them:

- **Hydration safety**: renders the hook inside a small harness component
  that records the displayed value during the render body (before any
  effect runs) — the same thing SSR would produce — for both `reduced`
  settings, and asserts it's always the target.
- **Backwards rAF timestamp**: stubs `requestAnimationFrame` to capture
  the callback without scheduling it, then invokes that callback with a
  timestamp guaranteed earlier than the real `start` — the exact `now <
  start` condition measured in the browser (115.7ms vs. 125.5ms) — and
  asserts the displayed value stays within `[0, target]`.

7 of 7 pass (`npx vitest run tests/components/counter/motion/use-count-up.test.tsx`),
5 pre-existing plus these 2.

## Systemic fix verification

The per-consumer `useCountUp` fix above treated the symptom. The actual
cause was `useReducedMotion`'s own initialiser:

```ts
const [reduced, setReduced] = useState<boolean>(() =>
  typeof matchMedia === "function" ? matchMedia(QUERY).matches : true,
)
```

This reads the *client's* preference during render. The server has no
client to ask (`matchMedia` doesn't exist there, so it always got `true`),
and a real `no-preference` client's first render got `false` — disagreeing
by construction, on every single consumer, not just `useCountUp`. Fixed in
`src/components/counter/motion/use-reduced-motion.ts`: the initial state is
now unconditionally `true`, full stop, no `matchMedia` call in the
initialiser at all. The existing effect — unchanged — reads the real
preference on mount and subscribes to changes, so motion switches on one
tick after hydration succeeds rather than never disagreeing with the server
in the first place.

`useCountUp`'s local `useState(value)` guard was kept rather than removed:
with the systemic fix, `reduced` is now *always* `true` at `useCountUp`'s
first render too, so the local guard and the systemic fix now produce an
identical result — but the local one is retained as defense-in-depth (it
doesn't rely on trusting `useReducedMotion`'s internal contract forever,
and costs nothing). See that hook's module comment for the full reasoning.

Same harness, same method, rebuilt and re-run against `npm run dev` after
the systemic fix (fresh dev server, fresh login, `page.emulateMedia` exactly
as before):

### `reduce`, post-systemic-fix

12 samples, t=204ms→1226ms. `7468` at every sample. No bar/section
`animation-name` or `animation-delay` at any sample. Line `stroke-dasharray`
`null` throughout. **0 console errors, 0 page errors.**

### `no-preference`, post-systemic-fix

12 samples, t=86ms→1173ms:

```
 86ms   7468   (SSR/pre-hydration paint — server and client now AGREE, no mismatch)
191ms      0   (mount effect: the one accepted settled-then-reset frame, now silent)
231ms   3933
272ms   4795
312ms   5506
352ms   6318
412ms   6866
472ms   7280
572ms   7463
672ms   7468   (landed — 481ms after the 191ms mount-effect start, ~COUNT_UP_MS)
873ms   7468
1173ms  7468
```

Strictly monotonic 0 → 7468, no negative value anywhere.

**Staggers, confirmed still running correctly** (a fix that silenced
hydration by never animating would be worse than the bug it replaced):

- Bars: `animation-name` = `"ct-bar-grow"` on all 7 from t=191ms onward;
  `animation-delay` = `0ms, 26ms, 52ms, 78ms, 104ms, 130ms, 156ms` — exact
  26ms stagger.
- Entry sections: `animation-name` = `"ct-entry"` on all 3;
  `animation-delay` = `0ms, 36ms, 72ms` — exact 36ms stagger.
- Line: `stroke-dasharray` grows `0px` → `967.97px` → `1387.45px` →
  `1511.58px` (of `1516.17px` total) then the attribute disappears between
  t=873ms and t=1173ms — completion ~682–982ms after the t=191ms mount,
  consistent with `LINE_DRAW_MS = 720`.

**Console errors: 0 under `reduce`, 0 under `no-preference`.** The
`useEntry` "won't be patched up" attribute-mismatch warning documented in
"Fix verification" above is **gone outright**, not merely quieter — direct
confirmation that it shared `useCountUp`'s root cause, and that fixing the
cause in `useReducedMotion` closed both.

### Why this is the better fix

Patching each consumer (`useCountUp` today, `useEntry` next, whatever the
next one turns out to be) treats an infinite list of symptoms one at a time.
`useReducedMotion` is the one place every motion hook in Counter goes
through — fixing its initialiser once means no future consumer can
reintroduce this class of bug by construction, rather than by discipline.
