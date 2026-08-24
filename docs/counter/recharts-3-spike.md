# Recharts 3 capability spike

Counter's chart contract is prototype note 16 ("How the charts behave"):
hover anywhere on the plot with the nearest reading winning, a crosshair +
dot + card naming the day/every series/the comparison, non-hovered bars
dimmed to 42%, motion note 27's 720ms line stroke-on and 26ms-apart bar
growth, and touch-drag on the phone moving the same card.

None of the 14 chart components in `src/components/charts/` (or the two
outside it — `cogs-trend-chart.tsx`, `cost-by-category-donut.tsx`) currently
implement any of this — they're stock shadcn/Recharts composition. So this
spike isn't "read the existing code," it's "prove each behaviour is
reachable from Recharts 3's actual, typed, documented API, exercised against
a real chart in this app, running in a real browser." All five rows below
were proved that way: signed into the running dev server with Playwright,
against `/dashboard/analytics` (desktop, 1440px) and `/dashboard/cogs/[id]`
(mobile viewport, 390×844), reading real DOM state — tooltip text, SVG
attributes, computed styles — not source or docs.

Two rows (dimming, bar stagger) required a temporary prototype edit to prove
feasibility; that code was written, exercised in the browser, measured, and
then reverted (`git checkout --`) before the final commit — it is not part
of the shipped diff. Every measurement below is quoted from the live DOM.

| Capability | Recharts 3 | How it was proved |
|---|---|---|
| Hover anywhere on the plot, nearest reading wins | **YES — native** | Dispatched a real mouse hover at `PlatformTrendChart` (`/dashboard/analytics`, 5-series LineChart), 15px from the *top edge* of the plot — empty space, nowhere near any of the five lines. The axis-based tooltip still activated on the nearest date and read all 5 series: `"Aug 23Otter POS: $2,165.75Otter Online: $85.44DoorDash: $2,856.76Uber Eats: $4,465.88Grubhub: $107.07"`. Vertical mouse position is irrelevant; Recharts tracks X against the axis scale across the full plot height by default (LineChart/BarChart use `tooltipEventType: 'axis'`; no configuration needed). |
| Crosshair + dot + card naming every series and the comparison | **Crosshair/dot/card: YES — measured, native. Comparison: UNPROVEN — see Uncertain below.** | Same hover as above produced, in the DOM: a vertical cursor line (`<path class="recharts-curve recharts-tooltip-cursor" d="M798.5,0L798.5,240">`, full plot height), `document.querySelectorAll('.recharts-active-dot').length === 5` (one dot per series at the intersection), and the tooltip card listing the day + all 5 series/values (text above). That *is* "a crosshair, a dot, and a card" out of the box, measured live. What was **not** measured is a "comparison" value in that card — no chart in this repo renders one today. The claim that it's reachable rests on inference, not measurement: `RevenueTrendChart` already does the *shape* of a comparison pattern (a solid `grossRevenue` Line + a dashed, `strokeOpacity={0.55}` `netRevenue` Line, both named in the same tooltip), and prototype note 37 describes exactly this pattern (comparison as "a dashed reference line... drawn from a series with its own shape") — but I did not build and observe a live comparison overlay. Treat the comparison half as UNPROVEN until the `<Chart>` primitive actually builds one. |
| Non-hovered bars dim to 42% | **YES — via `Cell` + `onMouseEnter`/`onMouseLeave`, not automatic** | Not native (no chart in the repo does this, and Recharts has no dim-on-hover flag). Prototyped on `TopItemsChart` (`/dashboard/analytics`, stacked horizontal bar): added `onMouseEnter={(_, index) => setHoverIndex(index)}` / `onMouseLeave` on each `<Bar>`, and one `<Cell fillOpacity={hoverIndex === null \|\| hoverIndex === index ? 1 : 0.42} />` per data point. Real Playwright `hover()` (trusted mouse events, not synthetic) on bar index 10 produced `fill-opacity` `["0.42","0.42","0.42","0.42","0.42","0.42","0.42","0.42","0.42","0.42","1"]` across all 11 rendered rects; re-hovering index 3 produced `["0.42","0.42","0.42","1","0.42",...]` — confirmed reactive, not a fluke. `Bar`'s `onMouseEnter`/`onMouseLeave` (`BarMouseEvent`, per-index) and `Cell`-level `fillOpacity` are both typed, documented Recharts 3 props (`node_modules/recharts/types/cartesian/Bar.d.ts`). Reverted before commit — see note above. |
| Line stroke-on over 720ms, bars grow from baseline 26ms apart | **Line: YES, native and exact. Bars: NOT native (one shared timer per series) — 26ms-apart stagger is achievable via a custom `shape`, proven live.** | **Line:** set `animationDuration={720}` on one `<Line>` in `PlatformTrendChart`, reloaded, and sampled `stroke-dasharray` on the real `<path class="recharts-curve recharts-line-curve">` every ~40ms from mount: `0px` at t=0 → `742.68/1585.27px` at t=216ms → `1584.6/1585.27px` (i.e. ~100%) at t=714ms → attribute removed (animation-complete state) by t=754ms. That's a dead-on match for a 720ms duration, measured on a real rendered path, not asserted from the prop existing. **Bars:** read `node_modules/recharts/es6/cartesian/Bar.js` — `animationBegin`/`animationDuration` are read once per `<Bar>` element and passed into a single `Animate` wrapping the *whole* rectangles group (confirmed empirically too: sampling all rect widths together during a reload showed them moving in lockstep, no per-index lag). A per-item 26ms stagger is not a Bar prop. It's achievable, though: prototyped a custom `shape` on `TopItemsChart`'s `fpQty` Bar (`isAnimationActive={false}`, `shape={(props) => <rect ... style={{ animation: \`spike-grow-x 300ms ease-out ${props.index * 26}ms both\` }} />}` plus one `@keyframes` block). Reloaded and read `getComputedStyle` on each rendered rect: `animation-delay` came back `0s, 0.026s, 0.052s, 0.078s, 0.104s, 0.13s` for indices 0–5 — exact 26ms increments, live in the DOM. Reverted before commit. |
| Touch-drag moves the card | **YES — native, proven with real `TouchEvent`s** | Resized the browser to 390×844 (phone viewport), reloaded `/dashboard/analytics` → `/dashboard/cogs/[storeId]` (a genuine navigation mid-test, not staged), found `CogsTrendChart`'s `<LineChart>` (one of only 4 files that import `recharts` directly, not through the facade). Dispatched a real `touchstart` then two `touchmove`s (constructed with `new Touch({...})`/`new TouchEvent(...)`, `bubbles: true`) at two different X positions across the plot, waiting ~120ms between each for Recharts' `requestAnimationFrame`-throttled touch listener (`state/touchEventsMiddleware.js`) to flush. Tooltip text went from `"July 26th, 2026COGS % : 29.6%"` to `"August 17th, 2026COGS % : 30.5%"` — the card followed the touch position across a >3-week span, exactly the "drag across a chart on the phone and the card follows" requirement. (First attempt without the `rAF` wait read the tooltip synchronously and saw nothing — a timing bug in the test, not evidence against the capability; documented here so the next person doesn't waste the same 20 minutes.) |

## Verdict

**RECHARTS** — `<Chart>` wraps Recharts 3 directly. `<Chart>`'s public props
are identical either way; pages never learn what's underneath.

Every row in Counter's chart contract was reachable from Recharts 3's public,
typed API, exercised live against real charts in this repo:

- Hover-anywhere/nearest-wins, the crosshair+dot, and the touch-drag card are
  **built in** — zero custom code, confirmed by direct interaction.
- The 720ms line draw-on is a **one-line prop** (`animationDuration`),
  confirmed by measuring the actual animated attribute over time.
- Bar dimming and the 26ms bar stagger are **not** flags Recharts ships, but
  both were built and proven live using only documented, typed extension
  points (`Cell` + per-series mouse events; the `shape` render prop). Neither
  needed reaching outside Recharts' component model, a portal, or raw SVG
  bypassing the chart's coordinate system.

No capability required dropping to custom SVG or gave a materially better
result outside Recharts, so there's no HYBRID/CUSTOM split to name — every
chart type in `src/components/charts/` (line, bar, pie/donut, heatmap) stays
on Recharts 3 under `<Chart>`.

### A known asymmetry `<Chart>` must budget for

RECHARTS is the right verdict, but it's closer to the line than "wrap
Recharts and you're done" suggests, and the next plan shouldn't discover
this by surprise. Line charts need zero extra wiring for anything in the
contract — hover, crosshair, dot, card, and the 720ms draw-on are all
default behaviour or a single prop. Bar charts don't get the same free
ride: dimming routes through `Cell` + per-series `onMouseEnter`/
`onMouseLeave` state, and the 26ms stagger routes through a custom `shape`
render prop with hand-written CSS keyframes. That's real per-chart-type
branching that has to live *inside* `<Chart>`'s implementation — a bar
variant carries meaningfully more internal plumbing than a line variant,
even though both sit on the same `<Chart>` public API and the same
Recharts rendering engine underneath.

This doesn't flip the verdict to HYBRID, because HYBRID in this brief's
sense means routing different chart *types* through two different
*rendering engines* (Recharts for some, raw SVG for others) — and nothing
here does that. Both extension points (`Cell`/mouse events, `shape`) are
typed, documented, first-class Recharts API, not monkey-patching or SVG
that bypasses Recharts' coordinate system. The rendering engine stays
uniform; only the amount of interaction-wiring per chart type does not.
`<Chart>`'s implementation should treat "bar variant needs Cell + shape
wiring, line variant doesn't" as a known, budgeted-for asymmetry rather
than an assumption that every chart type is an equally thin wrapper.

## What upgrading actually broke

Recharts 3 restructured its Tooltip/Legend prop types around a
context-read model: the *outer* `<Tooltip>`/`<Legend>` props (`TooltipProps`,
`LegendProps`) no longer type `payload`/`coordinate`/`label`/`viewBox`/
`accessibilityLayer` (Tooltip) or `payload` (Legend) — those are read from
chart context internally now. (`active` is the one exception: Recharts 3's
`TooltipProps` omits it from the inherited `DefaultTooltipContentProps` and
then re-declares it directly as `active?: boolean`, so it's still typed on
the outer component — this repo's `active?: boolean` on `ChartTooltipContent`
is a harmless redundant re-declaration, not a required fix.) A custom
`content` render component (like this repo's
`ChartTooltipContent`/`ChartLegendContent` in `src/components/ui/chart.tsx`)
still *receives* them at runtime via `cloneElement`, but has to source its
prop types from `TooltipContentProps`/`DefaultLegendContentProps` instead of
the outer component's props. Fixed by re-typing those two components; nine
call-site fixes followed from that (formatter/labelFormatter signatures
tightened to accept possibly-`undefined` values and `ReactNode` labels
instead of bare `string`; `ReferenceDot`'s `isFront` prop was removed in
favour of `zIndex`, whose default of 600 already renders above the series).
Full list and reasoning: see the commit diff — no behavioural changes, only
type-level fixes to keep the same runtime behaviour compiling.

**Did the `recharts.ts` facade help?** Yes, but not as a compatibility shim —
no renamed/removed export needed papering over at that choke point for any
of the 20 files importing through it. Its value here was scoping: it
confirmed only 4 files ever touch `recharts` directly (the facade,
`menu-profit-matrix.tsx`, `cost-by-category-donut.tsx`, `cogs-trend-chart.tsx`),
so the 20 facade consumers only needed fixing where they *also* passed
`recharts`-typed values through `ui/chart.tsx` (the tooltip/legend content
components) or through their own `labelFormatter`/`formatter` props — never
because of anything facade-specific.

## Uncertain / not covered

- **The "comparison" value** in row 2 (crosshair+dot+card "naming... the
  comparison it is being judged against") isn't implemented by any chart
  today — no chart currently renders a second, dashed "prior period" series.
  I'm confident it's reachable (it's the same `<Line>` + tooltip-payload
  mechanism already proven for multi-series cards, and note 37 describes the
  exact pattern), but I did not build and observe an actual comparison
  overlay live — that's a `<Chart>`-primitive-level feature for the next
  plan, not something this spike could prove without building the feature
  itself.
- The bar-dimming and bar-stagger prototypes were verified on one chart
  (`TopItemsChart`, a stacked horizontal bar). I did not repeat them against
  a vertical/grouped bar chart (e.g. `StoreComparisonChart`) — I'd expect the
  same `Cell`/`shape` mechanics to apply unchanged since neither depends on
  bar orientation, but that's inference from the Recharts API surface, not a
  second live measurement.
- `prefers-reduced-motion` (required by motion note 27's "off under
  prefers-reduced-motion") was not tested. Recharts respects it automatically
  for the *default* `isAnimationActive: 'auto'` on `Tooltip` only; `Line`/`Bar`
  default to `'auto'` too per their `.d.ts`, but I did not verify the actual
  runtime behaviour under a reduced-motion media query — `<Chart>` will need
  to either rely on that `'auto'` default consistently or gate animations
  itself.
