# Counter Analytics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the two Analytics pages — `/dashboard/analytics` (the group)
and `/dashboard/analytics/[storeId]` (one store) — on Counter, on both
surfaces, streaming, and gate them in the fidelity manifest.

**Architecture:** One `loadStatement` call answers the money on both pages. The
channel mix is drawn from that same statement's per-period GL platform lines,
so the headline, the bands, the marketplace share and the commission share one
denominator and one rollup. The service profile (`OtterHourlySummary`) and the
menu tables (`OtterMenuCategory` / `OtterMenuItem`) are the only additional
sources, each behind its own section promise so a slow one holds up nothing
else.

**Tech Stack:** Next.js 16.3.2 App Router, React 19.2.8, TypeScript, Prisma 7 /
Postgres, Tailwind v4, Playwright (fidelity gate), Vitest 4.

**Spec:** [`docs/superpowers/specs/2026-08-26-counter-streaming-architecture-design.md`](../specs/2026-08-26-counter-streaming-architecture-design.md)
(binding for every Counter page) and [`DESIGN.md`](../../../DESIGN.md).

**Prototype:** `docs/counter/counter-prototype.html` — `P.analytics` at line
4889, `P.analyticsstore` at line 7585.

---

## Working mode: BUILD VELOCITY

Standing instruction from the user, carried from the previous two plans:
**skip writing tests; build the product.** The TDD cycle is off. Tasks below
name no test files and no red-green loop.

**The one carve-out is money arithmetic.** Any function that decides a dollar
figure, a percentage, a share or a drift keeps its assertions — those are the
places this project has been wrong before, and a wrong number is invisible
until an owner acts on it. In this plan that means the pure modules in Task 1
and Task 2 and nothing else.

**The gates stay on, all of them:**

```
npm test && npm run tokens && npx tsc --noEmit && npm run build
```

plus `npm run fidelity`, whose baseline is **37 passed / 94 skipped**. That
number may only move by a deliberate gate flip in Task 9. If it drops for any
other reason, something regressed.

---

## Global Constraints

Copied verbatim from CLAUDE.md, DESIGN.md and the streaming spec. Every task's
requirements implicitly include this section.

1. **Never `prisma migrate dev`** — it would reset the Neon production
   database. This plan adds no migration and no schema change. If you believe
   you need one, stop and report; you do not.
2. **Colour comes only from `ct-` tokens** in `src/styles/counter.css`. No
   colour literal, no generic Tailwind palette colour, anywhere under
   `src/app/dashboard/**`, `src/app/(mobile)/m/**`,
   `src/components/counter/**`, `src/lib/counter/**`.
3. **`src/styles/counter-components.css` is GENERATED — never hand-edit it.**
   `src/styles/counter-repairs.css` is hand-written and editable. This plan
   should need neither: `.split`, `.shift`, `.strip`, `.drill`, `.ch`, `.tbl`,
   `.money` and `.mlist` all already carry rules.
4. **A page never**: imports Prisma, imports a server action directly, branches
   on a `SectionData` status, imports `framer-motion`, or renders
   `AppShell`/`PhoneShell`. `npm run tokens` fails the build on each.
5. **Every `page.tsx` under a `(counter)` route group has a `loading.tsx`
   beside it**, and calls the not-awaited `get*SectionPromises(...)`, never the
   awaited `get*Sections(...)`. Enforced by `no-route-without-loading` and
   `no-awaited-sections-in-page` in `scripts/counter-lint.ts`.
6. **`Section` is the sole renderer of `SectionData`** and owns its own
   Suspense boundary.
7. **A figure shown on two pages comes from one function in
   `src/lib/counter/`.** This is the rule Task 3 exists to honour and the rule
   ruling A-R1 below is an application of.
8. **`OtterOrder.discount` and `.commission` are stored NEGATIVE.** Add them,
   never subtract. (Not used by this plan, but the tree is full of them.)
9. **Commits carry no `Co-Authored-By: Claude` line.**
10. **Do not split or restructure any file over 400 lines** without reading
    [`docs/refactor-playbook.md`](../../refactor-playbook.md) first.

---

## The measured data

### READ THIS BEFORE COMPARING ANY DOLLAR FIGURE

**These figures drift, and they drifted during this plan.** The Otter sync
backfills into windows that are already closed. Between the morning probe that
seeded this table and the Task 3c verification eight hours later, the SAME
window 2026-08-20 … 2026-08-26 moved:

| | morning | evening |
|---|---|---|
| P&L Total Sales | 48,425.32 | **49,388.65** |
| four-channel total | 67,085.38 | **68,418.03** |
| Uber gross | 31,659.20 | **32,477.61** |
| 2026-08-26 platform sales | 8,898 | **8,475** … and every other day moved too |

**So a dollar figure in this table is a snapshot, not an expectation.** Before
comparing a screenshot to one, re-measure. The ratios are what hold: commission
was 17.3% of channel sales and 22.3% off marketplace in BOTH probes, to the
decimal, on totals nearly a thousand dollars apart.

**Verification doctrine for every remaining task:**

- **Stable — assert these.** Percentages and shares; the ordering of bands and
  days; which hour is busiest; landmark counts; structure.
- **Volatile — re-measure, never assert from this table.** Every dollar figure,
  and any points-drift derived from two dollar ratios (the thirds moved from
  +2.6 pts to +3.1 pts on the same window between probes).

This is the same lesson as the previous plan's ruling S-R4, where byte-identical
fidelity reports turned out to drift against live data as the day turned.

### Snapshot: 2026-08-27 evening, window 2026-08-20 … 2026-08-26

**That is NOT the window `?range=d7` resolves to**, and my first draft of this
sentence wrongly said it was. `d7` is a trailing window ending TODAY, so it runs
2026-08-21 … 2026-08-27 and its last day holds no data yet.

**Verify with the explicit window, not the preset.** `from`/`to` beat `range` in
`readCounterParams` because they are the more specific statement:

```
?from=2026-08-20&to=2026-08-26&cmp=weekday
```

`?range=d7` remains what the fidelity manifest sends, and Task 9 measures
landmarks — not figures — so the difference does not touch the baseline.

### Stores

| id | name | lifecycle | Otter rows |
|---|---|---|---|
| `cmexd4zia0001jr04ljkdt9na` | Chris N Eddys - Hollywood | `ready` | all of it |
| `store-chrisneddys-vannuys` | Chris N Eddys - Van Nuys | `pre_open` | none |
| `store-chrisneddys-glendale` | Chris N Eddys - Glendale | `pre_open` | **1 hourly row**, nothing else |

Hollywood's id is a cuid; the other two are hand-written slugs. Do not assume a
store id's shape.

### The window, by GL sales line (gross — the basis the P&L uses)

| GL line | platform | gross |
|---|---|---|
| house (4010 + 4011) | css-pos + bnm-web, CARD and CASH | 15,254.49 |
| 4012 Uber | ubereats | 32,477.61 |
| 4013 Doordash | doordash | 20,088.60 |
| 4014 Grubhub | grubhub | 542.02 |
| 4015C Caviar | caviar | 55.31 |
| **four-channel total** | | **68,418.03** |

Other lines inside Total Sales: service charges +113.54, tax −3,151.95,
discounts −15,990.97. **P&L Total Sales = 49,388.65** — the figure Overview and
the P&L both print as "Net sales" (`Statement.grossSales`).

### Channel share, per day (share of the four channels)

| date | house | Uber | DoorDash | Grubhub | other |
|---|---|---|---|---|---|
| 2026-08-20 | 26.0% | 48.6% | 24.9% | 0.5% | 0.00% |
| 2026-08-21 | 21.4% | 45.9% | 31.3% | 1.2% | 0.20% |
| 2026-08-22 | 26.7% | 43.5% | 29.3% | 0.4% | 0.00% |
| 2026-08-23 | 23.6% | 45.2% | 30.4% | 0.9% | 0.00% |
| 2026-08-24 | 16.5% | 53.6% | 29.5% | 0.1% | 0.21% |
| 2026-08-25 | 20.2% | 45.7% | 33.1% | 0.9% | 0.18% |
| 2026-08-26 | 20.9% | 50.9% | 26.5% | 1.7% | 0.00% |

**Marketplace share 77.7%** of the four channels. **Commission 17.3% of channel
sales and 22.3% off marketplace** — both held to the decimal across two probes
a thousand dollars apart, which is why they are the figures to check.

Uber is the largest channel every single day. In-house never exceeds 27%.
Caviar never reaches a quarter of one percent — that is A-R2's whole basis.

### Day of week (trailing 90 days, net)

| | Sun | Mon | Tue | Wed | Thu | Fri | Sat |
|---|---|---|---|---|---|---|---|
| days | 13 | 13 | 13 | 13 | 12 | 13 | 13 |
| average | **$9,018** | $7,063 | $6,397 | $6,680 | $6,706 | $7,325 | $8,444 |

**Sunday is the best day and Tuesday the worst** — that ORDERING is the stable
fact. Over a 7-day range every weekday is a single reading, and the
prototype's own caveat sentence applies.

### Service profile (`OtterHourlySummary`)

```
 0h:255   1h:98   2h:1   10h:43  11h:86  12h:121 13h:132 14h:115 15h:126
16h:128  17h:143 18h:185 19h:192 20h:240 21h:245 22h:242 23h:284
```

- 2,636 orders over 7 days = **377 a day**
- **busiest hour 23h**
- trading hours run **10h through 2h** — seventeen hours, crossing midnight
- 5p–10p (the prototype's block) is **38.1%**
- the best contiguous five hours are **20h–0h at 48.0%**
- **25.8% of orders fall outside the prototype's 11a–10p axis**, including the
  busiest hour
- coverage begins **2026-02-25**
- the daily summaries report 2,598 orders for the same window — 1.5% fewer.
  Two syncs, two answers (A-R5).

### Menu

Categories by net: On The Side · NFL Promo · Combos · Slider and Fries Combos ·
Drinks · Secret Menu · A La Carte · Uncategorized.

Top items by net: Signature Double Patty & Cheese Slider · Signature Slider
Fries & Drink Combo · 2 Slider Combo · 2 Sliders and Fries · 1 Slider Combo.

**That ordering is the stable fact; the dollars are not.** Both tables span
2025-02-21 … 2026-08-26. `OtterMenuItem` names its column **`itemName`**.

### Customer identity

| platform | orders | with a name |
|---|---|---|
| css-pos | 29,173 | **0** |
| ubereats | 27,871 | 27,867 |
| doordash | 21,953 | 21,948 |
| d2c-eater-website | 1,159 | 1,154 |
| grubhub | 776 | 776 |

The most common values are `Brady B`, `Michael P`, `Liam Fitzgerald`, `Chris C`,
`Chris D` — truncated first-name-plus-initial, which collide by construction.
There is no customer id anywhere in the schema. This is A-R3's whole basis.

## Rulings

Decided before execution, from the measurements above. Each says what it costs
if it is wrong.

**A-R1 — One net, and it is the statement's.** The strip's "Net sales", the mix
bands, the marketplace share, the commission and the drill's cost sentence all
come from ONE `loadStatement` call. The bands are the statement's per-period GL
platform lines — house = `4010` + `4011`, Uber = `4012`, DoorDash = `4013`,
Grubhub = `4014` — read off `Statement.rows` and `Statement.periods`, the same
arrays `buildSalesChart` in the Overview adapter already reads. **This page does
not call `loadChannelMix`.**

*Why not:* `loadChannelMix` answers in Otter's **net**, and
`Statement.grossSales` is a **gross**-based GL construct. Measured, the same
window is $51,542 one way and $48,425 the other. A page whose headline came
from one and whose bands came from the other would put two different "net
sales" on one screen — which is the shape of note 60, and of the N-R17 defect
the previous plan had to fix.

*Cost if wrong:* the mix is drawn on gross, so the marketplace bands are wider
than a net-based mix would draw them — 77.6% against 70.6%. Gross is the basis
the P&L actually charges commission on (`commission = rate × gross`), so the
drill's "what the mix cost" sentence is arithmetically exact on this basis and
would not be on the other. That is the argument for choosing it, and it is the
thing to revisit if an owner says the marketplace share reads too high.

**A-R2 — Caviar and chownow are not a fifth band.** Measured 0.08% of the
window ($55.31 of $67,140.69) and 0.14% all-time. `src/lib/counter/channels.ts`
publishes exactly four CVD-safe bands; a fifth needs a fifth colour the design
system does not define, and folding a marketplace into `house` would report
commissioned volume as commission-free. They are excluded from the mix and from
its denominator, and the section's subtitle names the denominator.

*Cost if wrong:* the four bands sum to 100% of something 0.08% smaller than all
platform sales.

**A-R3 — "Repeat guests" is dropped. The desk strip is three cells, not four.**
The entire in-house channel — 29,173 orders — carries no name at all, and the
marketplace names that exist are truncated to a first name and an initial. A
repeat rate computed on that describes marketplace orders only, on an identity
that merges strangers. Nothing else in the schema carries a customer identity.

*Cost:* one `sp` landmark absent on the desk surface, and `Strip` renders
`data-n="3"`. Declared in the manifest in Task 9.

**A-R4 — `PREPAID` house sales sit outside Total Sales, and this page inherits
that.** `salesRowValues` counts first-party gross only where `paymentMethod` is
`CARD` or `CASH`; css-pos `PREPAID` holds $3,696.32 across 151 orders all-time
and lands in neither line. The mix's house band is built from the same two
lines, so the mix and the P&L agree exactly.

This is a P&L finding, not this plan's to fix — record it, do not change
`src/lib/pnl.ts`. *Cost:* the house band understates by about 0.1%.

**A-R5 — The service profile reads `OtterHourlySummary`.** It is the
purpose-built table — LA local hour, `orderCount`, `netSales`, one row per
store-date-hour — against 80,932 order rows and the local-time-encoded-as-UTC
trap that `OtterOrder.referenceTimeLocal` carries. Coverage begins
**2026-02-25**; a range that starts before that has no hourly shape, and the
section resolves `not_computed`, never an empty chart.

The hourly table and the daily summaries disagree by 1.5% on order count for
the same window (2,636 against 2,598) — two syncs, two answers. The hourly
section's caption therefore counts orders **from the hourly table** and never
against a figure the strip printed.

*Cost if wrong:* the hourly panel's order counts do not tie to any other
order count on the site. That is stated in the caption rather than hidden.

**A-R6 — The staffing sentence is computed, not copied.** The prototype names
5p–10p. Measured here that block is 38.1% of orders and the busiest hour is
**23h**; the best contiguous five hours are **20h–0h at 48.0%**. The sentence
names the measured peak block. Copying the prototype's hours would print a
recommendation this restaurant's own data contradicts.

**A-R7 — One store trades; the group page says so the way Overview does.** Van
Nuys and Glendale are `pre_open` with no Otter rows, so the group Analytics
page is Hollywood's numbers under a group heading — exactly what Overview and
the P&L already do, using the same `Statement.allStores`. Glendale carries
**one** stray `OtterHourlySummary` row: a per-store service profile must not
draw a chart from a single hour. Below three covered days the section resolves
`not_computed`.

**A-R8 — The streaming shape is binding.** `(counter)` route group; chrome in
the layout; a `loading.tsx` beside every `page.tsx`; the page calls the
not-awaited `getAnalyticsSectionPromises(...)`; `Section` owns each Suspense
boundary. Three lint rules already fail the build on violations.

**A-R9 — Both routes get a middleware rewrite**, matching the `decisions` and
`alerts` entries added by the previous plan: `/dashboard/analytics` →
`/m/analytics`, and the store route → `/m/analytics/[storeId]`.

**A-R10 — Below three buckets there are no thirds.** `floor(n/3)` with `n < 3`
is 0, and a drift read off zero buckets is a fabricated number. The drill then
prints the prototype's own line: *"A range this short has no first and last
third to compare. Widen it to read the drift."*

**A-R11 — The day book's food, labour and prime come from the statement's own
per-period rows** (`COGS_CODE` `6100`, `LABOR_CODE` `6200`, and
`prime-cost.ts`), never a second COGS query. One page, one prime cost.

**A-R13 — The statement is loaded DAILY and folded, not loaded twice.** The
day-of-week panel needs one reading per calendar day. `granularityFor` buckets
anything past a fortnight into weeks or months, so at the display grain those
days do not exist — and a second `loadStatement` at daily granularity would be
a second rollup answering the same question, which is the shape A-R1 exists to
forbid.

So the adapter calls `loadStatement({ ..., granularity: "daily" })` **once**
and folds the days into the range's display grain itself for the mix chart's
labels and bands. The underlying query is unchanged — `getAllStoresPnL` buckets
the same `OtterDailySummary` rows either way — so this costs more periods over
the wire and nothing else.

*Verify this before building on it.* In Task 3, time a daily-granularity
statement over the widest preset the date control offers. If it is materially
slower than the same range at its natural grain, say so in the report and fall
back to two calls with the weekday panel explicitly labelled as the daily one.
*Cost if wrong:* a wide range pulls 365 periods where it needed 12.

**A-R14 — Commission comes off the statement's rows, not off `Store`.**
`computeStorePnL` writes `COM_UBER` and `COM_DD` per period and
`consolidateRows` merges them by code across stores, so the rate this account
actually charges is already inside the rollup that printed the headline.
Reading `Store.uberCommissionRate` again would be a second source for a number
the statement holds, and the two would disagree the moment a rate changed
mid-range. **The stored values are NEGATIVE** — flip the sign exactly once, and
assert it (Task 1, assertion 12).

**A-R15 — The hour axis is this restaurant's service day, not the prototype's
`11a`–`10p`.** The prototype's `HOURS` list holds twelve labels, `11a` through
`10p` (line 3662). Measured here, **25.8% of orders fall outside that window** —
including hour 23, which is the single busiest hour of the day. A chart that
cuts off its own peak is not a shorter chart, it is a wrong one.

So the axis runs from the first trading hour to the last, in **service-day
order**: `10a, 11a, … 11p, 12a, 1a`. The day crosses midnight, and the hours
after midnight belong to the evening that produced them, not to the morning
that follows.

That ordering is also what the peak-block search runs over — a block may
therefore span `11p → 12a`, and the measured winner does. It may not wrap past
the service day's own end.

*Cost if wrong:* seventeen ticks where the prototype draws twelve. The fidelity
gate compares landmark classes and computed styles, not tick counts, so this
does not move the baseline — it is a design decision, made on the data, and
recorded here so it is not mistaken for drift later.

**A-R12 — Where a section has a shell but no rows, change what the section
shows — do not render an empty shell.** This is N-R4/N-R5's correction,
promoted to a standing rule: the previous plan ruled "render the shell over
zero rows, never `Empty`" to protect the landmark count, and shipped a heading
over a blank white panel that only the rendering pass caught. A section with
nothing to list gets a different subject or `not_computed`, not an empty list.

---

## File structure

**Create — pure modules (these carry assertions):**

- `src/lib/counter/channel-series.ts` — per-bucket channel shares off a
  `Statement`, the thirds drift, and the commission arithmetic.
- `src/lib/counter/service-profile.ts` — the hourly shape and the day-of-week
  shape, plus the peak-block search.

**Create — the adapter:**

- `src/lib/counter/adapters/analytics.ts` — `getAnalyticsSectionPromises`,
  `getAnalyticsSections`, `getStoreAnalyticsSectionPromises`,
  `getStoreAnalyticsSections`, and the section types both pages import.

**Create — the desk routes:**

- `src/app/dashboard/(counter)/analytics/page.tsx`
- `src/app/dashboard/(counter)/analytics/loading.tsx`
- `src/app/dashboard/(counter)/analytics/counter-analytics-client.tsx`
- `src/app/dashboard/(counter)/analytics/[storeId]/page.tsx`
- `src/app/dashboard/(counter)/analytics/[storeId]/loading.tsx`
- `src/app/dashboard/(counter)/analytics/[storeId]/counter-store-analytics-client.tsx`

**Create — the phone routes:**

- `src/app/(mobile)/m/(counter)/analytics/{page,loading,counter-phone-analytics-client}.tsx`
- `src/app/(mobile)/m/(counter)/analytics/[storeId]/{page,loading,counter-phone-store-analytics-client}.tsx`

**Delete — the editorial routes they replace:**

- `src/app/dashboard/(editorial)/analytics/**` (the whole subtree)

**Modify:**

- `src/middleware.ts` — two rewrites (A-R9)
- `e2e/fidelity/manifest.ts` — `analytics` and `analyticsstore` to
  `status: "counter"` with measured baselines (Task 9)

---

## Task 1: The channel series

**Files:**
- Create: `src/lib/counter/channel-series.ts`
- Create: `tests/lib/counter/channel-series.test.ts`

**Interfaces:**
- Consumes: `Statement`, `PnLRow`, `Period` from `@/lib/counter/statement`;
  `CHANNELS`, `ChannelId` from `@/lib/counter/channels`; the GL row codes from
  `@/lib/pnl`.
- Produces: everything in the export list below. Tasks 3, 4, 5 and 6 consume it
  and nothing else for the mix.

This is money arithmetic, so it keeps its assertions (see Working mode).

**What it exports:**

```ts
/** One channel's line through the range, bucket by bucket. */
export interface ChannelBand {
  channel: ChannelId
  /** The channel's own name — "In-house", "DoorDash", "Uber Eats", "Grubhub". */
  name: string
  /** Sales per bucket, in the statement's own gross basis. Same length as periods. */
  values: number[]
  /** Share of the four-channel total per bucket, 0..100. Same length. */
  shares: number[]
  /** Sales across the whole range. */
  total: number
  /**
   * What this channel's marketplace kept over the range, or `null` where the
   * schema publishes no rate. `0` for the house channel — there is genuinely
   * no marketplace. NEVER `0` for Grubhub: see `channel-mix.ts`'s own note.
   */
  commission: number | null
}

export interface ChannelSeries {
  /** Bucket labels, straight off `Statement.periods`. */
  labels: string[]
  bands: ChannelBand[]
  /** The four-channel total across the range. The denominator every share uses. */
  total: number
  /** The house channel's total. */
  house: number
  /** `(total - house) / total * 100`. */
  marketplaceShare: number
  /** Commission across the rateable channels, in dollars. */
  commission: number
  /** Commission as a share of `total`, 0..100. */
  commissionPct: number
  /** Commission as a share of `total - house`, 0..100. `null` with no marketplace sales. */
  blendedPct: number | null
}

/** How a share moved between the first third of the range and the last. */
export interface Drift {
  /** `false` when the range holds fewer than three buckets (A-R10). */
  enough: boolean
  /** The first third's reading, 0..100. */
  was: number
  /** The last third's reading, 0..100. */
  now: number
  /** `now - was`, in points. */
  points: number
}

export interface MixMove {
  enough: boolean
  rows: MixMoveRow[]
  /** How the blended rate off the top moved, in points. */
  ratePoints: number
  /** `ratePoints / 100 * total` — dollars, signed. Positive is more commission. */
  cost: number
}

export interface MixMoveRow {
  channel: ChannelId
  name: string
  was: number
  now: number
  points: number
  /** The channel's own commission rate as a percent, or `null` where none is published. */
  rate: number | null
  /** True when this channel's move went the expensive way. */
  costly: boolean
}

export function channelSeries(statement: Statement): ChannelSeries
export function marketplaceDrift(series: ChannelSeries): Drift
export function commissionDrift(series: ChannelSeries): Drift
export function mixMove(series: ChannelSeries): MixMove
```

**Every one of these takes the statement and nothing else.** There is no rates
parameter: `getAllStoresPnL` already computes the commission rows and
`consolidateRows` merges them by code across stores, so the rate this account
actually charges is derivable from the rollup that printed the headline. A
second read of `Store.uberCommissionRate` here would be a second source for a
number the statement already holds.

**How the bands are built.** Read the statement's rows by GL code, using the
constants from `@/lib/pnl` — never a string literal:

| band | source |
|---|---|
| `house` | `rowValues(rows, "4010")` + `rowValues(rows, "4011")`, element-wise |
| `doordash` | `rowValues(rows, "4013")` |
| `ubereats` | `rowValues(rows, "4012")` |
| `grubhub` | `rowValues(rows, "4014")` |

`rowValues` is currently a private helper in
`src/lib/counter/adapters/overview.ts:418`. **Move it to
`src/lib/counter/statement.ts` and export it**, then import it in both places.
It reads a `PnLRow[]` for a code and returns its `values` or `null`. Two copies
of it is the beginning of two answers.

Bands are emitted in `CHANNELS` order, not size order — the band is fixed to
the channel (notes 36/41), so a range where DoorDash outsells in-house must not
reorder or repaint anything.

A bucket whose four-channel total is 0 gets `shares` of 0 for every band, not
`NaN`.

**Commission comes off the statement's own rows, and IT IS NEGATIVE.**

| band | commission source |
|---|---|
| `ubereats` | `-sum(rowValues(rows, UBER_COMMISSION_CODE))` |
| `doordash` | `-sum(rowValues(rows, DOORDASH_COMMISSION_CODE))` |
| `grubhub` | `null` — the schema publishes no rate (A-R1's own note) |
| `house` | `0` — there is genuinely no marketplace |

`computeStorePnL` writes these as `uberGross.map(g => -(g * rate))`, so the
stored values are negative and the sign must be flipped exactly once. This
codebase has been wrong about a stored sign twice — `OtterOrder.discount` and
`promo-roi-actions.ts:148` — so **assert the sign**: a `commission` that comes
back negative is a bug, not a display concern.

The per-channel RATE, which `mixMove` needs to compute the blended-rate drift,
is derived from the same two rows: `rate = commission / bandTotal`. Never read
`Store.uberCommissionRate` here — that would be a second source for a number
the rollup already holds, and the two could disagree the moment a rate changes
mid-range.

**How thirds work** (A-R10). `k = Math.floor(labels.length / 3)`. When `k < 1`,
return `{ enough: false, was: 0, now: 0, points: 0 }`. Otherwise `was` is the
reading over the first `k` buckets **summed and then divided** — not the mean
of per-bucket shares, which weights a slow Tuesday the same as a busy Saturday
— and `now` the same over the last `k`.

**`mixMove.cost`** is `ratePoints / 100 * series.total`. Positive means the mix
moved toward the more expensive channels and the range cost that much more in
commission with nobody changing what they charge.

- [ ] **Step 1: Write the module.**

- [ ] **Step 2: Write the assertions.**

Cover, at minimum, using the measured window as the fixture — build a
`Statement`-shaped object from the per-day table in "The measured data" above:

1. `channelSeries` totals: house `15055.23`, ubereats `31659.20`, doordash
   `19828.93`, grubhub `542.02`, `total` `67085.38` (within a cent).
2. `marketplaceShare` is `77.6` to one decimal.
3. `commission` is `11605.66` within a cent; `commissionPct` `17.3`;
   `blendedPct` `22.3`, each to one decimal.
4. Each bucket's four `shares` sum to `100` within 0.01.
5. `bands` come back in `CHANNELS` order even when the input rows are shuffled.
6. `grubhub.commission` is `null`, not `0`. **Assert this explicitly** — it is
   the difference between "we do not know" and "it is free".
7. `house.commission` is `0`.
8. `marketplaceDrift` over the seven buckets: `was` `76.4`, `now` `79.0`,
   `points` `+2.6`, each to one decimal, `enough: true`.
9. `mixMove.ratePoints` is `+0.52` to two decimals and `cost` is `348` to the
   nearest dollar.
10. A two-bucket range returns `enough: false` from all three of
    `marketplaceDrift`, `commissionDrift` and `mixMove`.
11. A bucket with zero sales across all four channels yields `shares` of `0`,
    and no `NaN` appears anywhere in the result.

- [ ] **Step 3: Run them.**

```bash
npx vitest run tests/lib/counter/channel-series.test.ts
```

- [ ] **Step 4: Mutation-check two of them.** Change `Math.floor(n/3)` to
`Math.ceil(n/3)` and confirm the thirds assertions fail; change
`grubhub.commission` from `null` to `0` and confirm assertion 6 fails. Restore
both. **Report the exact failure output for each** — an assertion that cannot
be made to fail is not a test.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/counter/channel-series.ts tests/lib/counter/channel-series.test.ts src/lib/counter/statement.ts src/lib/counter/adapters/overview.ts
git commit -m "feat(counter): the channel mix, off the statement that prints the headline"
```

---

## Task 2: The service profile

**Files:**
- Create: `src/lib/counter/service-profile.ts`
- Create: `tests/lib/counter/service-profile.test.ts`

**Interfaces:**
- Consumes: `DateRange`, `toQueryBounds`, `dayCount` from
  `@/lib/counter/date-range`; `prisma` from `@/lib/prisma`.
- Produces: the exports below, consumed by Task 3.

Money and share arithmetic, so it keeps assertions — but only the pure half.
The loader is not unit-tested.

**What it exports:**

```ts
export interface HourReading {
  /** 0–23, LA local hour. */
  hour: number
  /** Average orders in this hour on a day of the range. */
  orders: number
}

export interface ServiceProfile {
  hours: HourReading[]
  /** Distinct dates the hourly table covered in the range. */
  coveredDays: number
  /** Average orders on a covered day. */
  perDay: number
  /** The hour with the most orders. */
  busiest: number
  /** The best contiguous five hours, and their share of the day (A-R6). */
  peak: PeakBlock
}

export interface PeakBlock {
  startHour: number
  endHour: number
  /** Share of the range's orders landing in the block, 0..100. */
  share: number
  /** "7p to midnight" — written the way the prototype writes an hour. */
  label: string
}

export interface DayOfWeekReading {
  /** 0 = Monday, matching the chart's Mon-first labels. */
  day: number
  name: string
  /** Average net on this weekday across the range. `null` with no day in range. */
  average: number | null
  /** How many of this weekday the range held. */
  days: number
}

export interface DayOfWeekProfile {
  readings: DayOfWeekReading[]
  /** The mean across the days that are IN the range. */
  mean: number
  /** Index into `readings` of the best day, or `null` when the range holds none. */
  best: number | null
}

/** Pure. Given rows the loader fetched, the shape. */
export function serviceProfile(
  rows: Array<{ hour: number; date: Date; orderCount: number }>,
): ServiceProfile | null

/** Pure. Given per-bucket net keyed by calendar date, the weekday shape. */
export function dayOfWeekProfile(
  days: Array<{ date: Date; net: number }>,
): DayOfWeekProfile

/**
 * The loader. Returns `null` when the range starts before the hourly table
 * begins, or when fewer than three days are covered (A-R5, A-R7) — the caller
 * turns that into `not_computed`, never an empty chart.
 */
export async function loadServiceProfile(input: {
  range: DateRange
  storeId: string | null
  accountId: string
}): Promise<ServiceProfile | null>
```

**The hour axis** (A-R15) is the service day: the hours are ordered from the
first hour that traded to the last, so a restaurant open past midnight gets
`10a, 11a, … 11p, 12a, 1a` and NOT a clock-ordered `0..23` that puts the late
rush at the far left. Emit `hours` in that order; the chart draws them as given.

**The peak block** (A-R6): scan every contiguous five-hour window **in
service-day order**, and return the one with the largest share. A block may
span `11p → 12a` — the measured winner does — but may not wrap past the service
day's own end. The measured answer for the d7 window is **20h–0h at 48.0%**.

`label` writes an hour the way the prototype's `HOURS` list does — `8p`, `11p`,
`midnight`, `noon` — so the measured block reads **"8p to 1a"**.

**`loadServiceProfile` scoping.** It takes an `accountId` for the same reason
`loadChannelMix` does: without it, `storeId: null` would mean "every store in
the database". Resolve the store ids through `prisma.store.findMany({ where: {
accountId, isActive: true, ...(storeId ? { id: storeId } : {}) } })` first, then
query `OtterHourlySummary` for those ids. A `storeId` not on the account
resolves to no stores and returns `null`, never to the whole account.

**The three-day floor** is what stops Glendale's single stray hourly row from
being drawn as a service profile (A-R7).

- [ ] **Step 1: Write the module.**

- [ ] **Step 2: Write the assertions** for the two pure functions:

1. `serviceProfile` over the measured d7 rows: `coveredDays` 7, `perDay` 377 to
   the nearest order, `busiest` 23.
2. `peak` is `{ startHour: 20, endHour: 0 }` with `share` 48.0 to one decimal
   and `label` `"8p to 1a"`.
3. `hours` comes back in service-day order — first element hour 10, last element
   hour 2 — and NOT clock-ordered starting at 0.
4. The peak block may span midnight (assertion 2 proves it does) but does not
   wrap past the service day's end: a fixture trading only 10h–14h returns a
   block inside that span, never one running 13h → 11h.
5. `serviceProfile` returns `null` for fewer than three covered days — assert
   at 2 and at 3.
6. `dayOfWeekProfile` over the 90-day figures: Sunday's average `9018`,
   Tuesday's `6397`, `best` pointing at Sunday, and `mean` equal to the mean of
   the seven averages weighted by their day counts.
7. A weekday the range never held has `average: null`, not `0`.

- [ ] **Step 3: Run them.**

```bash
npx vitest run tests/lib/counter/service-profile.test.ts
```

- [ ] **Step 4: Mutation-check the ordering.** Order the hours by clock
(`0..23`) instead of by service day and confirm assertions 2 and 3 both fail.
Restore. Report the exact failure output.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/counter/service-profile.ts tests/lib/counter/service-profile.test.ts
git commit -m "feat(counter): when the orders actually come, and the block worth staffing"
```

---

## Task 3: The analytics adapter

**Files:**
- Create: `src/lib/counter/adapters/analytics.ts`

**Interfaces:**
- Consumes: `channelSeries`, `marketplaceDrift`, `commissionDrift`, `mixMove`
  from Task 1; `loadServiceProfile`, `dayOfWeekProfile` from Task 2;
  `loadStatement` from `@/lib/counter/statement`; `classify` / `SectionData` /
  `SectionSources` the way `adapters/pnl.ts` uses them.
- Produces: `AnalyticsSections`, `StoreAnalyticsSections` and the four
  functions below. Tasks 4–7 consume these and nothing under them.

**Read `src/lib/counter/adapters/pnl.ts` first.** It is the closest analogue —
statement-backed, streaming, one rollup — and this adapter follows its shape:
`get*SectionPromises` starts every loader without awaiting, hands each section
its own promise, and `get*Sections` is `awaitSections` over the same object.

**ONE `loadStatement` call feeds every money section on the page** (A-R1), and
it is loaded at `granularity: "daily"` and folded to the display grain here
(A-R13). Start it once, share the promise, and derive from it. Do not call it
per section and do not call it twice at two grains.

**`AnalyticsSections` — the group page:**

| key | holds |
|---|---|
| `headline` | the strip's three cells (A-R3) |
| `mix` | the stacked chart, its labels, and the mix-move drill's rows and sentence |
| `weekday` | the day-of-week chart, its notes, and the best-day sentence |
| `service` | the hourly chart and the peak-block sentence |

**`StoreAnalyticsSections` — the store page:**

| key | holds |
|---|---|
| `headline` | net sales, orders, average ticket, food cost — for this store |
| `sales` | this store's net-sales chart |
| `service` | this store's hourly chart |
| `mix` | this store's channel mix |
| `items` | top items by contribution |
| `dayBook` | every day in range: net, orders, ticket, food, labour, prime |
| `statement` | this store's money lines |
| `categories` | net, share and food cost by category |

**Rules this adapter carries:**

1. **`Section.meta` takes a string or a data callback.** A section's caption
   that depends on the section's own data goes INSIDE the section's payload —
   never as a bare sibling string on the sections object. That was ruling N-R9,
   found the hard way.
2. **`not_computed`, not empty.** `service` resolves `not_computed` when
   `loadServiceProfile` returns `null` (A-R5, A-R7). `mix`'s drill resolves its
   "widen the range" line rather than an empty table when `enough` is false
   (A-R10). No section renders a shell over zero rows (A-R12).
3. **The hourly caption counts orders from the hourly table** and never against
   a figure another section printed (A-R5).
4. **The day book, the statement and the categories are the store page's
   only** — the group page does not draw them. That is the prototype's own
   argument for the route existing.
5. **Top items need a margin**, and margin comes from the menu-profit path, not
   from a second recipe query written here. Use
   `src/lib/menu-category-analytics-aggregation.ts` and whatever server-action
   loader already feeds it. If no session-free loader exists for it, the
   `items` section resolves `not_computed` and Task 9 records the absence —
   **do not** write a second COGS derivation to fill the column.
6. **The day book's food, labour and prime** come off the statement's own
   per-period rows and `prime-cost.ts` (A-R11). With A-R13 the statement is
   already daily, so the day book needs no extra load at all.
6b. **Time the daily statement** over the widest preset and report the number
   (A-R13). This is the one measurement in this task.
7. **`storeNotFound`.** A `storeId` the rollup has no row for zeroes the lines
   and empties `perStore`; the store page must surface that rather than
   silently falling back to the account. `Statement` already publishes the flag.

- [ ] **Step 1: Write the adapter.**

- [ ] **Step 2: Gate it.**

```bash
npx tsc --noEmit && npm run tokens
```

- [ ] **Step 3: Commit.**

```bash
git add src/lib/counter/adapters/analytics.ts
git commit -m "feat(counter): one rollup answers both analytics pages"
```

---

## Task 3b: Periods are built in UTC (A-R18)

**Files:**
- Modify: `src/lib/date-utils.ts` — UTC-safe date helpers
- Modify: `src/lib/pnl.ts` — `buildPeriods` uses them
- Create: `tests/lib/pnl-periods.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change. `buildPeriods(startDate, endDate, granularity)`
  keeps its shape; only its answers stop depending on the process timezone.

Money arithmetic, so it keeps assertions.

### The defect

`buildPeriods` floors its bounds with `startOfDayUTC` and then does **every**
subsequent operation with local-time date-fns: `addDays`, `format`,
`startOfWeek`, `endOfWeek`, `startOfMonth`, `endOfMonth`,
`differenceInCalendarDays`. Two things follow, both reproduced:

```
--- TZ=UTC ---                        --- TZ=America/Los_Angeles ---
Thu Mar 5  2026-03-05T00:00:00.000Z   Wed Mar 4  2026-03-05T00:00:00.000Z
Sun Mar 8  2026-03-08T00:00:00.000Z   Sat Mar 7  2026-03-08T00:00:00.000Z
Mon Mar 9  2026-03-09T00:00:00.000Z   Sun Mar 8  2026-03-08T23:00:00.000Z
rows placed 8 of 8                    rows placed 4 of 8
```

1. **Rows vanish after a DST transition.** Periods land at `23:00Z`; a daily
   period has `startDate === endDate` and `bucketSummariesByPeriod` matches on
   exact equality, so no row matches and it is silently skipped. Measured YTD:
   **$1,589,817.29 under UTC against $443,895.15 under PDT.**
2. **Every daily label is one day early** in a negative-offset zone — no DST
   transition required. Live in the August fidelity window, on the mix chart's
   x-axis and the day book's dates.

`src/lib/pnl.ts` already carries a comment stating the invariant it breaks:
*"Period boundaries must land on the same instant or `bucketSummariesByPeriod`
drops every row when the server runs in non-UTC TZ (e.g. local dev in PDT)."*
Someone changed `startOfDay` to `startOfDayUTC` and stopped. Finish it.

### The fix

Every instant `buildPeriods` handles is a UTC midnight, and UTC has no DST, so
the arithmetic is exact on epoch milliseconds. Add to `src/lib/date-utils.ts`,
beside the existing `startOfDayUTC` / `startOfDayLocal` / `ymdUTC`:

```ts
export function addDaysUTC(d: Date, n: number): Date
export function startOfWeekUTC(d: Date, weekStartsOn: number): Date
export function endOfWeekUTC(d: Date, weekStartsOn: number): Date
export function startOfMonthUTC(d: Date): Date
export function endOfMonthUTC(d: Date): Date
export function differenceInCalendarDaysUTC(later: Date, earlier: Date): number
export function formatUTC(d: Date, pattern: "EEE MMM d" | "MMM d" | "MMM yyyy"): string
```

`formatUTC` needs only the three patterns `buildPeriods` uses. Build it on
`Intl.DateTimeFormat("en-US", { timeZone: "UTC", … })` rather than on string
surgery — the weekday and month names must match what date-fns produced, since
they are what a reader sees on the axis today under UTC.

**Do not add a dependency.** `@date-fns/tz` is not installed and this does not
need it.

Then replace every local-time call inside `buildPeriods` with its UTC
counterpart. `isAfter` and `isBefore` compare instants and are already safe —
leave them.

**Scope discipline: `buildPeriods` and its helpers only.** Do not convert other
date handling in `src/lib/pnl.ts` or anywhere else in this task. Other callers
of local date-fns may be correct for their own purpose.

- [ ] **Step 1: Write the helpers and switch `buildPeriods` over.**

- [ ] **Step 2: Write the assertions**, in `tests/lib/pnl-periods.test.ts`. The
suite must prove the answers no longer depend on the process timezone. Set
`process.env.TZ` per-case if the runner allows it; otherwise assert the UTC
instants and labels directly, which is what actually changed.

1. A daily range 2026-03-05 … 2026-03-12 yields eight periods whose
   `startDate`s are exactly `2026-03-05T00:00:00.000Z` through
   `2026-03-12T00:00:00.000Z` — no `23:00:00.000Z` anywhere.
2. Those eight periods' labels are `Thu Mar 5` … `Thu Mar 12`.
3. `bucketSummariesByPeriod` places **8 of 8** rows dated at UTC midnight
   across that range. **Assert the placed count, not just the bucket shape** —
   the old code returned the right number of empty buckets.
4. The same three assertions for a range NOT crossing a DST transition
   (2026-08-20 … 2026-08-26): labels `Thu Aug 20` … `Wed Aug 26`, 7 of 7
   placed. This is the fidelity window and the label defect is live in it.
5. Weekly and monthly granularity over a DST-crossing range keep every row:
   assert the placed count equals the row count.
6. A one-day range yields exactly one period.

- [ ] **Step 3: Run them, then run every suite that touches the P&L.**

```bash
npx vitest run tests/lib/pnl-periods.test.ts
npx vitest run tests/lib/ tests/app/
```

**A pre-existing test that asserted a label under the local timezone will now
fail, and that failure is the bug being fixed — not a regression.** If one
does, report it with its old and new expected values rather than editing the
assertion to whatever the code now prints.

- [ ] **Step 4: Prove the timezone independence end to end.**

```bash
TZ=UTC npx vitest run tests/lib/pnl-periods.test.ts
TZ=America/Los_Angeles npx vitest run tests/lib/pnl-periods.test.ts
TZ=Asia/Kolkata npx vitest run tests/lib/pnl-periods.test.ts
```

All three must pass. Kolkata is `UTC+5:30` — a positive, non-integer offset,
which catches a fix that only handles negative whole-hour zones. **Report all
three outputs.**

- [ ] **Step 5: Full gate and commit.**

```bash
npm test && npx tsc --noEmit && npm run tokens && npm run build
```

```bash
git add -A
git commit -m "fix(pnl): periods walked in local time dropped every day after a DST switch"
```

---

## Task 4: The group page, on the desk

**Files:**
- Create: `src/app/dashboard/(counter)/analytics/{page,loading,counter-analytics-client}.tsx`
- Modify: `src/middleware.ts`
- Delete: `src/app/dashboard/(editorial)/analytics/page.tsx`,
  `error.tsx`, `loading.tsx` and `components/` (keep `[storeId]/` until Task 6)

**Interfaces:**
- Consumes: `getAnalyticsSectionPromises` and `AnalyticsSections` from Task 3.
- Produces: nothing other tasks consume.

**Copy the shape of `src/app/dashboard/(counter)/pnl/page.tsx` exactly** — the
session read, the redirect, the `searchParams` flattening, the single `today`,
`readCounterParams`, the not-awaited section promises, `getOverviewStores` for
the switcher, and plain serialisable props to the client island.

**Composition, in the prototype's own order** (`P.analytics.desk()`, line 4894):

```
strip (3 cells)
  → sec "Channel mix · share of net" : chart + drill "How the mix moved, and what it cost"
  → div.split
      sec "By day of week"        : chart + the best-day sentence
      sec "When the orders come"  : chart + the peak-block sentence
```

**The three strip cells** (A-R3 drops the fourth):

1. **Net sales** — `money(statement.grossSales)`, the comparison tag when a
   comparison is on, and the caption `"<n> days · <grain> buckets"`.
2. **Through marketplaces** — `marketplaceShare` to one decimal, the drift in
   points "across the range", `is-down` when the drift is positive (a rising
   marketplace share is the bad direction), the caption `"started at <was>%"`,
   and a quiet `Bullet` reading now against was.
3. **Commission** — `commissionPct` to one decimal, the commission drift "on
   mix alone", `is-down` when positive, and the caption
   `"of channel sales · <blendedPct>% off marketplace sales"`.

Note cell 3's caption says **"of channel sales"**, not the prototype's "of
net" — because A-R1 makes the denominator the four-channel total, and the
strip's own first cell prints a different figure under the word "net". One
page, one name for one number.

**The mix section's subtitle names its denominator** (A-R2):
`"<range label> · share of the four channels, not dollars"`.

**The drill** is `<Drill wide label="How the mix moved, and what it cost">`
holding a `Table` of Channel / First third / Last third / Change / Commission,
and beneath it a `<p className="shift">` carrying the sentence. The change cell
gets the `hot` class when `costly`. When `enough` is false, the drill's body is
the single "widen it to read the drift" paragraph and no table.

**The two split sections' sentences** are `<p className="mono">`, and both come
from the adapter — the page composes, it does not compute.

**`loading.tsx`** composes `Section` with `data={loading()}` for each of the
four keys, in the same order, so the skeleton has the page's shape. Copy
`src/app/dashboard/(counter)/pnl/loading.tsx`.

**Middleware** (A-R9): add `/dashboard/analytics` → `/m/analytics` beside the
`decisions` and `alerts` entries.

- [ ] **Step 1: Write the page, the client island and `loading.tsx`.**

- [ ] **Step 2: Add the middleware rewrite.**

- [ ] **Step 3: Delete the editorial group route** (leave `[storeId]/` for
Task 6). Then grep for imports of anything you deleted:

```bash
grep -rn "(editorial)/analytics" src/ e2e/ tests/ || echo "no references"
```

- [ ] **Step 4: Gate.**

```bash
npm run tokens && npx tsc --noEmit && npm run build
```

- [ ] **Step 5: Look at it in a browser.** Start the dev server, sign in, and
screenshot the page:

```bash
npm run shot -- "/dashboard/analytics?from=2026-08-20&to=2026-08-26&cmp=weekday" /tmp/analytics-desk.png
```

Confirm from the image, and say so in your report: the strip reads three cells;
"Net sales" is **$48,425**; "Through marketplaces" is **77.6%** with **+2.6
pts**; "Commission" is **17.3%** with **22.3% off marketplace sales**; the mix
chart's four bands fill the plot; the day-of-week chart shows Sunday tallest;
the hourly chart peaks at 11p. **A number that disagrees with the measured
table is a finding — report it, do not adjust the table to match.**

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "feat(counter): where the sales came from, on the desk"
```

---

## Task 3c: The range's bounds are UTC-anchored (A-R19)

**Files:**
- Modify: `src/lib/counter/date-range.ts` — `toQueryBounds` only
- Create: `tests/lib/counter/date-range-bounds.test.ts`

**Interfaces:** no signature change. `toQueryBounds(r)` keeps returning
`{ startDate, endDate }`; only the instants stop depending on the process
timezone.

Money arithmetic — it decides which rows a range contains — so it keeps
assertions.

### The defect

Task 3b fixed how `buildPeriods` WALKS. It did not fix what it is HANDED.
Counter's `DateRange` is local midnights by explicit contract, and
`toQueryBounds` adds `23:59:59` in local time; `buildPeriods` then floors with
`startOfDayUTC`. Two frames, one handoff. Reproduced on `?range=d7` with
`today = 2026-08-27T12:00:00Z`:

```
TZ UTC                 d7 = Aug 21 00:00Z -> Aug 27 00:00Z   dayCount 7
  bounds Aug 21 00:00:00Z -> Aug 27 23:59:59Z
  daily periods: 7   Fri Aug 21 … Thu Aug 27          <- correct

TZ America/Los_Angeles d7 = Aug 21 07:00Z -> Aug 27 07:00Z   dayCount 7
  bounds Aug 21 07:00:00Z -> Aug 28 06:59:59Z
  daily periods: 8   Fri Aug 21 … Fri Aug 28          <- a day that has not happened

TZ Asia/Kolkata        d7 = Aug 20 18:30Z -> Aug 26 18:30Z   dayCount 7
  bounds Aug 20 18:30:00Z -> Aug 27 18:29:59Z
  daily periods: 8   Thu Aug 20 … Thu Aug 27          <- range shifted a day earlier
```

`dayCount` says 7 and the page draws 8. The extra bucket also widens the
QUERY: `date <= Aug 28 06:59:59Z` matches the `@db.Date` row stored at
`Aug 28 00:00:00Z`. **The shipped P&L page prints $50,192 for a window that
holds $48,425.** Production is UTC and unaffected; local dev is not.

### The fix

`toQueryBounds` is already documented as *"the one place that conversion
happens"*. Make it convert frames as well as times: take the CALENDAR day out
of the local-midnight instant and rebuild it in UTC, which is the frame
`@db.Date` stores.

```ts
export function toQueryBounds(r: DateRange): { startDate: Date; endDate: Date } {
  const startDate = new Date(
    Date.UTC(r.start.getFullYear(), r.start.getMonth(), r.start.getDate()),
  )
  const endDate = new Date(
    Date.UTC(r.end.getFullYear(), r.end.getMonth(), r.end.getDate(), 23, 59, 59),
  )
  return { startDate, endDate }
}
```

Under UTC this is a no-op — the same Y/M/D goes in and the same instant comes
out — so production behaviour does not change. **Say so in the docblock**, and
explain WHY the conversion is here rather than in `resolvePreset`: the module's
contract is "all dates are local midnights", every caller and label depends on
that, and this function is the boundary where a local calendar day becomes a
database query.

**Scope: `toQueryBounds` only.** Do not change `resolvePreset`, the presets,
`dayCount`, or `src/app/actions/_shared/date-range.ts`. Six loaders call
`toQueryBounds` — `channel-mix`, `service-profile`, `statement`, and three in
the two adapters — and all six query `@db.Date` columns or the
local-time-encoded-as-UTC `referenceTimeLocal`. UTC bounds are right for every
one.

- [ ] **Step 1: Make the change and write the docblock.**

- [ ] **Step 2: Write the assertions.** Each must pass under all three zones:

1. `toQueryBounds` on a `d7` range resolved at `2026-08-27T12:00:00Z` yields
   `startDate` exactly `2026-08-21T00:00:00.000Z` and `endDate` exactly
   `2026-08-27T23:59:59.000Z`.
2. `buildPeriods` over those bounds at daily granularity yields **7** periods,
   labelled `Fri Aug 21` … `Thu Aug 27`. Assert the COUNT and the LABELS —
   the count alone passed in Kolkata for the wrong seven days.
3. `dayCount(range)` equals the period count, for `d7`, `d30` and `today`.
   **This is the invariant the bug broke**, so assert it as one.
4. A single-day range (`today`) yields one period, not two.
5. `startDate` is midnight UTC and `endDate` is `23:59:59` UTC — assert the
   UTC hours directly, so a future local-time regression cannot pass.

- [ ] **Step 3: Run under three zones and report all three.**

```bash
TZ=UTC npx vitest run tests/lib/counter/date-range-bounds.test.ts
TZ=America/Los_Angeles npx vitest run tests/lib/counter/date-range-bounds.test.ts
TZ=Asia/Kolkata npx vitest run tests/lib/counter/date-range-bounds.test.ts
```

- [ ] **Step 4: Re-measure the shipped P&L.** With the server running in the
local zone, load `/dashboard/pnl?from=2026-08-20&to=2026-08-26` and report the
Total Sales it now prints. **It must be $48,425.32.** If it is not, that is a
finding — report the number, do not adjust anything.

- [ ] **Step 5: Full gate and commit.**

```bash
npm test && npx tsc --noEmit && npm run tokens && npm run build
```

```bash
git add -A
git commit -m "fix(counter): a seven-day range asked the database for eight"
```

---

## Task 5: The group page, on a phone

**Files:**
- Create: `src/app/(mobile)/m/(counter)/analytics/{page,loading,counter-phone-analytics-client}.tsx`

**Interfaces:**
- Consumes: the same `getAnalyticsSectionPromises` and `AnalyticsSections`.
  **The phone calls the same adapter as the desk** — that is the rule that keeps
  the two surfaces from printing different numbers.

**Composition** (`P.analytics.phone()`, line 4975):

```
h2.mtitle "Analytics" + p.msub <range label>
  → mstrip (4 cells)
  → sec "Channel mix"   : chart (h 130, ticks off, legend on) + the mix sentence
  → sec "By day of week": chart (h 116, M T W T F S S labels)
```

**The four `mstrip` cells:** Net sales · Marketplaces · Commission (in
**dollars** here, not percent — `$11,606`, captioned `17.3% of channel sales`)
· Best day (`Sun`, captioned `$9,018 average`).

The phone strip keeps four cells because its fourth is Best day, not Repeat
guests — A-R3 removes nothing here.

**The legend is on** for the mix chart on the phone and `direct` is off: at
340px a label written on a 20px band is a label nobody can read. That is the
prototype's own note and it is right.

- [ ] **Step 1: Write the page, the island and `loading.tsx`.**

Copy `src/app/(mobile)/m/(counter)/pnl/` for the route shape.

- [ ] **Step 2: Gate.**

```bash
npm run tokens && npx tsc --noEmit && npm run build
```

- [ ] **Step 3: Look at it.**

```bash
npm run shot -- "/m/analytics?from=2026-08-20&to=2026-08-26&cmp=weekday" /tmp/analytics-phone.png
```

Confirm and report: four `mstrip` cells, no horizontal overflow, the legend
naming all four bands, and the day-of-week chart's seven single-letter labels.

- [ ] **Step 4: Commit.**

```bash
git add -A
git commit -m "feat(counter): where the sales came from, on a phone"
```

---

## Task 6: The store page, on the desk

**Files:**
- Create: `src/app/dashboard/(counter)/analytics/[storeId]/{page,loading,counter-store-analytics-client}.tsx`
- Delete: `src/app/dashboard/(editorial)/analytics/` (the rest of it)

**Interfaces:**
- Consumes: `getStoreAnalyticsSectionPromises` and `StoreAnalyticsSections`
  from Task 3.

**Composition** (`P.analyticsstore.desk()`, line 7589):

```
the store note
  → strip (4 cells: Net sales · Orders · Avg ticket · Food cost)
  → div.split  [ sec "Net sales" : chart ] [ sec "When the orders come" : chart ]
  → div.split  [ sec "By channel" : chart ] [ sec "Top items" : table ]
  → sec "The day book" : table
  → div.split  [ sec "The statement" : money lines ] [ sec "By category" : table ]
```

**The store note** is the prototype's `storeNote()` — the line that says this
page is the group page filtered to one store, except for the day book, the
statement and the category table.

**The day book** lists every day in range, newest first: Date · Net · Orders ·
Ticket · Food · Labor · Prime. Food, labour and prime come off the statement's
own per-period rows (A-R11). A day the rollup has no COGS for shows a dash, not
a zero.

**The statement** is `MoneyLines` — Net sales, Food, Labor, Marketplace fees,
Fixed prorated, EBITDA — every figure from `Statement`'s own lines. Do not
invent the prototype's `0.248` labour rate or its `425.42` daily fixed cost;
those are its fixtures.

**Top items** — if Task 3 resolved `items` to `not_computed` because no
session-free margin loader exists, render it as that and move on. Do not
backfill a margin here.

**`storeNotFound`** renders the section's own refusal, not a zeroed page.

- [ ] **Step 1: Write the page, the island and `loading.tsx`.**
- [ ] **Step 2: Delete the rest of `(editorial)/analytics/`.** Grep for
references as in Task 4 Step 3.
- [ ] **Step 3: Gate.** `npm run tokens && npx tsc --noEmit && npm run build`
- [ ] **Step 4: Look at it.**

```bash
npm run shot -- "/dashboard/analytics/cmexd4zia0001jr04ljkdt9na?from=2026-08-20&to=2026-08-26&cmp=weekday" /tmp/analytics-store-desk.png
```

Report what the day book's first row reads and whether its prime equals food
plus labour on that row.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(counter): one store's analytics, with the day book the group page cannot draw"
```

---

## Task 7: The store page, on a phone

**Files:**
- Create: `src/app/(mobile)/m/(counter)/analytics/[storeId]/{page,loading,counter-phone-store-analytics-client}.tsx`
- Modify: `src/middleware.ts` — the store rewrite (A-R9)

**Composition** (`P.analyticsstore.phone()`, line 7648):

```
h2.mtitle <store name> + p.msub <range label>
  → mstrip (2 cells: Net sales · Food cost)
  → sec "Net sales"    : chart (h 116, ticks off)
  → sec "The day book" : mlist, newest first, four days
```

The `mlist` rows are `[label, "<n> orders", money(net)]`.

- [ ] **Step 1: Write the page, the island and `loading.tsx`.**
- [ ] **Step 2: Add the store middleware rewrite.**
- [ ] **Step 3: Gate.** `npm run tokens && npx tsc --noEmit && npm run build`
- [ ] **Step 4: Look at it.** `npm run shot -- "/m/analytics/cmexd4zia0001jr04ljkdt9na?from=2026-08-20&to=2026-08-26" /tmp/analytics-store-phone.png`

Per A-R12: confirm the day book list has rows. A heading over a blank panel is
the defect the previous plan shipped and had to fix.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(counter): one store's analytics, on a phone"
```

---

## Task 8: Lint, nav and the whole-project gate

**Files:**
- Modify: `src/lib/counter/nav.ts` if the rail's analytics entry needs the
  store route; `e2e/fidelity/manifest.ts` only if a route string changed.

- [ ] **Step 1: Confirm the four lint rules fire on these routes.** Each of the
following mutations must fail `npm run tokens`. Make it, run, record the exact
message, restore:

1. Render `<AppShell>` inside `counter-analytics-client.tsx` →
   `no-shell-in-page`.
2. Delete `src/app/dashboard/(counter)/analytics/loading.tsx` →
   `no-route-without-loading`.
3. Change the group page to `await getAnalyticsSections(...)` →
   `no-awaited-sections-in-page`.
4. Put a hex colour in the client island → the colour-literal rule.

**A rule that does not fire on a new route is a hole in the rule, and it is a
finding.** Report all four messages.

- [ ] **Step 2: Run the whole gate.**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
```

- [ ] **Step 3: Run the e2e suite.**

```bash
npx playwright test e2e/
```

Warm the dev server with one signed-in page load **before** running it — the
cold-server `auth.setup.ts` race has now hit three consecutive plans. Sign-in
succeeds server-side while the browser is shown "Sign-in failed". Never retry
blindly; warm first.

- [ ] **Step 4: Commit** anything the gate required.

---

## Task 9: Measure the fidelity, then gate it

**Files:**
- Modify: `e2e/fidelity/manifest.ts`

This task measures first and gates second. **A baseline invented before it is
measured is a number nobody can defend** — that is how Overview and the P&L
went in, and it is not negotiable.

- [ ] **Step 1: Report, do not gate.** Leave both entries `status: "editorial"`,
add `report: true`, give both a `query` of `?range=d7&cmp=weekday` and the
group entry a `mobileRoute` of `/m/analytics`, then run:

```bash
npm run fidelity
```

Warm the server first (Task 8 Step 3's note applies).

- [ ] **Step 2: Read the four reports** — group desk, group phone, store desk,
store phone. For each, write down: the prototype's landmark count, ours,
missing, extra, rendering differences, dark defects, and the `.empty` count.

- [ ] **Step 3: Account for every difference.** For each missing landmark, say
which ruling or which schema hole explains it. The ones already expected:

- one `sp` on the group desk — A-R3, no customer identity
- the `blt` bullets wherever `referenceFor` returns undefined, as on Overview
- `items` if it resolved `not_computed` — Task 3 rule 5

**An EXTRA landmark is never forgiven** and an allowance that forgives fewer
than budgeted fails as stale. If our page has something the prototype does not,
remove it; do not budget for it.

**Zero `.empty` on all four surfaces.** A `.empty` here means a section
rendered a shell over no rows, which A-R12 forbids.

- [ ] **Step 4: Gate.** Flip both entries to `status: "counter"` with the
measured `baseline: { desktop, mobile }` and an `absentLandmarks` entry per
absence, each carrying its reason in prose — the reason is the part that is
worth anything in six months.

- [ ] **Step 5: Re-run and confirm.**

```bash
npm run fidelity
```

The pass count must rise from **37** by exactly the surfaces gated, and the
skip count must fall by the same. Report both numbers.

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "test(fidelity): the analytics pages are gated"
```

---

## Task 10: The whole-branch check

- [ ] **Step 1: Re-run every gate**, from a clean tree:

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build && npm run fidelity
npx playwright test e2e/
```

- [ ] **Step 2: Confirm the editorial subtree is gone.**

```bash
ls src/app/dashboard/\(editorial\)/ | grep analytics && echo "STILL THERE — finding" || echo "removed"
```

- [ ] **Step 3: Confirm no page reads a second net.** There must be exactly one
`loadStatement` call per request on each analytics route, and no
`loadChannelMix` import anywhere under `analytics`:

```bash
grep -rn "loadChannelMix" src/lib/counter/adapters/analytics.ts src/app/dashboard/\(counter\)/analytics src/app/\(mobile\)/m/\(counter\)/analytics && echo "FINDING — A-R1 violated" || echo "clean"
```

- [ ] **Step 4: Update the graph.**

```bash
graphify update .
```

- [ ] **Step 5: Report** the final numbers: fidelity pass/skip, test count, and
the four surfaces' landmark tables.

---

## Carried forward, not fixed here

These are real and belong to Phase F, not to this plan:

- **The Otter sync's `adjusted_commission` coverage collapse** — 97% through
  April, 0% in May, June and August. Still the top item.
- **`npm run eval:llm` cannot start on this branch** — `server-only` throws
  under tsx. Will block the next person who edits a chat prompt.
- **`PREPAID` house sales are outside Total Sales** (A-R4) — $3,696.32 across
  151 orders that the P&L does not count.
- **One stray `OtterHourlySummary` row on Glendale**, a `pre_open` store with
  no other Otter data. Harmless, and a sign the hourly sync once ran against a
  store that has never traded.
- **`buildActionCards` ranking compares two incompatible scales** (N-R7) —
  shipped characterised, not fixed.
- **The decisions headline's DELTA** is the forward window's rate beside a
  calendar-week total.
- **The cold-server `auth.setup.ts` race.**
