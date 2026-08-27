# Counter Labor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the two Labor pages — `/dashboard/labor` (the group) and
`/dashboard/labor/[storeId]` (one store) — on Counter, on both surfaces,
streaming, and gate them in the fidelity manifest.

**Architecture:** Harri answers labour. `HarriPositionDaily` gives cost, hours
and role; `HarriShift` gives the published schedule, including future weeks;
`HarriTimekeepingAlert` gives the leak ledger; `ForecastHourlyOrders` gives the
demand the schedule is judged against. Sales come from the same `loadStatement`
call every other Counter money page makes, so labour-as-a-share-of-sales agrees
with the P&L by construction.

**Tech Stack:** Next.js 16.3.2 App Router, React 19.2.8, TypeScript, Prisma 7 /
Postgres, Tailwind v4, Playwright (fidelity gate), Vitest 4.

**Spec:** [`docs/superpowers/specs/2026-08-26-counter-streaming-architecture-design.md`](../specs/2026-08-26-counter-streaming-architecture-design.md)
and [`DESIGN.md`](../../../DESIGN.md).

**Prototype:** `docs/counter/counter-prototype.html` — `P.labor` at line 5524,
`P.laborstore` at line 7666.

**Precedent:** the Analytics plan
([`2026-08-27-counter-analytics-fidelity.md`](2026-08-27-counter-analytics-fidelity.md))
did this exact shape a day earlier. Its rulings A-R1 (one rollup answers the
money), A-R12 (never a shell over zero rows), A-R13 (daily statement, folded),
A-R15 (the service day, not the clock) and A-R20 (dollars drift, ratios hold)
all carry forward here unchanged.

---

## Working mode: BUILD VELOCITY

**Skip writing tests; build the product.** The TDD cycle is off.

**The carve-out is money arithmetic** — anything deciding a dollar, an hour, a
percentage or a rate keeps its assertions. Here that means Tasks 1, 2 and 3,
and nothing else.

**Gates:** `npm test && npm run tokens && npx tsc --noEmit && npm run build`,
plus `npm run fidelity`, whose baseline is **49 passed / 90 skipped**. That
number may only move by the deliberate gate flip in Task 9.

---

## Global Constraints

1. **Never `prisma migrate dev`** — it would reset the Neon production
   database. This plan adds no migration and no schema change.
2. **Colour comes only from `ct-` tokens** in `src/styles/counter.css`.
3. **`src/styles/counter-components.css` is GENERATED — never hand-edit it.**
   `counter-repairs.css` is hand-written. The `.wk` / `.wkd` week strip already
   carries rules; check before writing any CSS at all.
4. **A page never**: imports Prisma, imports a server action directly, branches
   on a `SectionData` status, imports `framer-motion`, or renders
   `AppShell`/`PhoneShell`.
5. **Every `page.tsx` under a `(counter)` route group has a `loading.tsx`
   beside it**, and calls the not-awaited `get*SectionPromises(...)`.
6. **`Section` is the sole renderer of `SectionData`** and owns its Suspense
   boundary.
7. **A figure shown on two pages comes from one function in
   `src/lib/counter/`.**
8. **Commits carry no `Co-Authored-By: Claude` line.**
9. **Do not split or restructure any file over 400 lines** without reading
   [`docs/refactor-playbook.md`](../../refactor-playbook.md).
10. **`HarriShift.startTime` / `.endTime` hold LOCAL wall-clock encoded as
    UTC** — the schema says so in its own comment. Read them with
    `getUTCHours()`. Never apply a timezone.

---

## The measured data

### The drift warning applies here too

Measured 2026-08-27 against the live database, over **2026-08-20 … 2026-08-26**.
Ruling A-R20 from the Analytics plan holds: the Otter sync backfills into closed
windows, so **dollar figures are a snapshot and ratios are the contract**.
Assert percentages, orderings and structure; re-measure any dollar before
comparing it.

`?range=d7` is a trailing window ending today and is NOT this window. Verify
with `?from=2026-08-20&to=2026-08-26&cmp=weekday`.

### Coverage

| table | rows | span | stores |
|---|---:|---|---:|
| `HarriDailyLabor` | — | … 2026-08-27 | 1 |
| `HarriPositionDaily` | 596 | 2026-02-09 … 2026-08-26 | 1 |
| `HarriTimekeepingAlert` | 2,430 | 2026-02-09 … 2026-08-26 | 1 |
| `HarriShift` | 3,800 (57 weeks, 11 virtual) | 2025-07-28 … **2026-08-30** | 1 |
| `HarriEmployee` | 20 | — | — |
| `ForecastHourlyOrders` | 32,928 | 2026-05-10 … **2026-09-09** | — |

Only Hollywood has any of it. `HarriShift` reaches into the future; the demand
forecast reaches further.

### The window, day by day

| date | actual | scheduled | cost | net sales | SPLH |
|---|---:|---:|---:|---:|---:|
| 2026-08-20 | 56.8 h | 59.0 h | $1,181 | $6,883 | $121.10 |
| 2026-08-21 | 66.5 h | 69.5 h | $1,356 | $7,685 | $115.59 |
| 2026-08-22 | 60.7 h | 70.0 h | $1,245 | $8,307 | $136.78 |
| 2026-08-23 | 66.1 h | 67.5 h | $1,349 | $9,345 | $141.45 |
| 2026-08-24 | 59.6 h | 58.5 h | $1,195 | $7,522 | $126.27 |
| 2026-08-25 | 59.4 h | 48.5 h | $1,222 | $6,358 | $106.97 |
| 2026-08-26 | 63.0 h | 64.0 h | $1,277 | $6,451 | $102.34 |
| **total** | **432.1 h** | **437.0 h** | **$8,825** | **$52,550** | **$121.60** |

**The SPLH column above was WRONG in the first draft of this plan and is
corrected here — see L-R17.** It read $158.76 for the range because I computed
it from `OtterDailySummary` GROSS. `getSplhSeries`, which is what the Overview
already prints, divides `OtterHourlySummary.netSales` by the same Harri hours.
Three sales sources, three different answers for one week:

| source | sales | SPLH |
|---|---:|---:|
| `OtterHourlySummary.netSales` — **what the app uses** | $52,550 | **$121.60** |
| `OtterDailySummary` net | $52,570 | $121.65 |
| `OtterDailySummary` gross | $68,609 | $158.76 |
| Statement Total Sales | $49,389 | $114.30 |

**$8,825 is exactly the Labor line the Analytics store statement prints**, and
`HarriDailyLabor` sums to the same figure to the cent ($8,825.47 both ways).
The two Harri tables agree; either ties to the P&L.

Labour as a share of **Total Sales** ($49,389) is **17.9%**. Of platform sales
it is 12.9%. See L-R2 for which one the page prints.

**Labour percent and SPLH do NOT share a denominator, and that is correct.**
The percent is the P&L's line and takes the P&L's Total Sales (L-R2); SPLH is
`getSplhSeries`' figure and takes its net sales (L-R17). Two ratios, two
questions, two owners — each matching the one place in the app that already
answers it.

Overtime for the window: **$51.08** — a dollar amount. There is no
overtime-hours column anywhere in the schema.

### Positions

| position | pay type | 30-day cost | 30-day hours |
|---|---|---:|---:|
| Line Cook | HOURLY | $25,777 | 1,251 h |
| Cashier | HOURLY | $11,528 | 575 h |
| Operator | **SALARIED** | **$0** | **0 h** |

Three positions, and the salaried one carries nothing.

### The leak ledger, over the window

| alert code | alerts | hours | people | leak? |
|---|---:|---:|---:|---|
| `LATE_CLOCK_OUT` | 28 | 5.57 | 13 | **yes** |
| `EARLY_CLOCK_IN` | 9 | 7.90 | 7 | **yes** |
| `LATE_CLOCK_IN` | 8 | 4.92 | 7 | no — a saving |
| `EARLY_CLOCK_OUT` | 3 | 6.55 | 1 | no — a saving |
| `MISSED_CLOCK_OUT_OT_NOW` | 28 | — | 13 | uncostable |
| `MISSED_CLOCK_IN` | 11 | — | 8 | uncostable |
| `UNSCHEDULED_CLOCK_IN` | 2 | — | 2 | uncostable |

Leaked hours **13.47**; at the window's blended rate ($8,825 / 432.1 h =
**$20.42/h**) that is **$275**. The three uncostable codes carry a null
`timeDiffSec`.

### Twelve weeks

| week of | cost | hours | % of platform sales | SPLH |
|---|---:|---:|---:|---:|
| 2026-06-01 | $9,650 | 472 | 15.5% | $131.93 |
| 2026-06-08 | $9,730 | 471 | 16.3% | $126.90 |
| 2026-06-15 | $8,960 | 439 | 14.1% | $144.50 |
| 2026-06-22 | $8,567 | 421 | 12.2% | $167.17 |
| 2026-06-29 | $8,794 | 426 | 12.0% | $172.28 |
| 2026-07-06 | $8,667 | 423 | 12.5% | $163.52 |
| 2026-07-13 | $9,048 | 443 | 12.1% | $169.41 |
| 2026-07-20 | $8,708 | 426 | 13.8% | $148.41 |
| 2026-07-27 | $8,948 | 437 | 14.8% | $138.30 |
| 2026-08-03 | $8,409 | 410 | 12.9% | $158.72 |
| 2026-08-10 | $8,852 | 434 | 13.2% | $154.54 |
| 2026-08-17 | $8,500 | 417 | 12.4% | $164.72 |
| 2026-08-24 | **$3,695** | **182** | 13.0% | $155.60 |

The last row is a **partial week** — 182 hours against a ~430-hour norm.

### The schedule runs out before the forecast does

| date | scheduled | forecast orders |
|---|---|---:|
| 2026-08-27 | 59.0 h · 8 shifts | 345 |
| 2026-08-28 | 69.5 h · 10 shifts | 365 |
| 2026-08-29 | 70.0 h · 10 shifts | 415 |
| 2026-08-30 | 67.5 h · 10 shifts | 432 |
| 2026-08-31 | **none** | 380 |
| 2026-09-01 | **none** | 331 |
| 2026-09-02 | **none** | 343 |
| 2026-09-03 | **none** | 341 |

### The staffing curve, 2026-08-28

| hour | scheduled people | forecast orders |
|---:|---:|---:|
| 9h | 3 | — |
| 10h–14h | 4 | 5.8 → 16.1 |
| 15h–17h | 3 | 16.9 → 18.9 |
| 18h | 3 | 26.8 |
| 19h | 3 | 33.2 |
| **20h** | **3** | **38.4** |
| **21h** | **6** | **36.1** |
| 22h | 6 | 35.6 |
| 23h | 6 | 39.4 |

**Staffing steps up an hour after demand peaks.** That is the page's finding
and it is measured, not borrowed.

### The forecast-generation trap, again

`ForecastHourlyOrders` is unique on `(storeId, forecastDate, hourBucket,
generatedAt)`. Over the window:

- raw: **2,208 rows, 35,020 orders**
- newest generation only: **168 rows, 2,658 orders**
- **inflation 13.17×**

The deduped total is credible — 2,658 forecast against 2,643 actual orders for
the same week.

---

## Rulings

**L-R1 — There is no SPLH floor, and this project already ruled that.**
`src/lib/counter/adapters/overview.ts:343` says it in full: no column publishes
one, the prototype's `SPLH_FLOOR = 68.00` is its own invention, and
`SplhPoint.targetSplh` is the median of the store's own history — the figure
judging itself. So: **no floor line, no hit/miss on the week strip, no "under
the floor" verdict tag, and no "comfortably over the floor" sentence.**

Measured, the prototype's floor would be meaningless anyway: our SPLH is
**$121.60** for the window, against its fixture's $66–$76.

*Cost if wrong:* the week strip shows each day's SPLH without saying whether it
was good. That is the honest state until a store file carries a floor.

**L-R17 — SPLH comes from `getSplhSeries`' source, and my own measurement of
it was wrong.** I wrote $158.76 into the first draft of this plan, computed
from `OtterDailySummary` GROSS. The app already answers this question:
`src/app/actions/splh-actions.ts` divides `OtterHourlySummary.netSales` by
`HarriPositionDaily.actualSeconds`, and its own comment says netSales
reconciles with `OtterDailySummary` to ~0.1% — which it does, **against the NET
column**, not the gross one. The correct figure is **$121.60**.

The Overview prints SPLH from that function today. A Labor page printing
$158.76 beside an Overview printing $121.60 would be the two-numbers-one-name
defect this project has spent three plans removing.

*Cost of my error:* Task 1 shipped a test asserting $158.76 whose fixture
back-derived its sales as `splh × hours` — so the assertion could not fail. It
is corrected in Task 1b.

**L-R2 — Labour percent is taken on Total Sales, the P&L's own denominator.**
Measured: $8,825 is **12.9%** of platform sales and **17.9%** of Total Sales.
`getAllStoresPnL` computes `laborPct` on `grossSales`, which IS Total Sales, and
the Overview's comparison table prints that number. One denominator across the
site (Analytics A-R1's rule, applied to labour).

**L-R3 — "With salaried" is dropped; the strip is five cells, not six.**
`Store.fixedMonthlyLabor` is **0** for Hollywood, and `HarriPositionDaily`'s
SALARIED rows carry **$0 and 0 seconds**. The cell would print the identical
percentage to the one beside it. A figure repeated is not a second figure.

*Cost:* one strip cell and its landmarks, plus a `data-n` of 5 against the
prototype's 6 — declared through `styleAllowances`, the mechanism the Analytics
plan added to the gate for exactly this.

**L-R4 — Overtime is dollars.** `HarriPositionDaily.overtimeAmount` is USD and
no overtime-seconds column exists. Measured **$51.08** for the window. The
prototype's "3.5 h · one person" cannot be answered; the cell prints dollars and
its caption says what it is.

**L-R5 — Two alert codes are leaks, two are savings, three are uncostable.**
See the measured table. A leak is time PAID that the schedule did not ask for:
`LATE_CLOCK_OUT` and `EARLY_CLOCK_IN`. `LATE_CLOCK_IN` and `EARLY_CLOCK_OUT` are
the opposite — the store paid less than it planned — and putting them in a
"leaked hours" total would report a saving as a cost. The three `MISSED_*` /
`UNSCHEDULED_*` codes carry a null `timeDiffSec`: **count them, name them, never
give them a dollar figure.**

*Cost if wrong:* the leak total is 13.47 h rather than the 24.94 h a
sign-blind sum would produce — nearly double, in the wrong direction.

**L-R6 — Dedupe `ForecastHourlyOrders` on the newest `generatedAt`.** Measured
**13.17×** inflation over the window (35,020 against 2,658). This is the same
trap `ForecastDailyRevenue` carries at 12.7×, and
`src/lib/counter/forecast-generation.ts` already exists for the daily case —
extend it or write its hourly sibling beside it, keyed on
`(storeId, forecastDate, hourBucket)`. **Do not write a third dedupe.**

**L-R7 — A shift that ends after midnight covers the hours on both sides of
it.** Measured: shifts run `9→17`, `12→17`, `17→1`, `18→1`, `20→1`. A `17→1`
shift staffs hours 17…23 AND hour 0. An expansion that stops at 23 loses the
busiest hours of the night — the same shape as the Analytics plan's A-R15, and
the staffing curve uses that page's service-day ordering so both charts read the
day the same way.

**L-R8 — The decision card is derived, and it is NOT the prototype's.** The
prototype hardcodes "Saturday 2–6pm is short". Measured, the real open decision
is that **the published schedule ends 2026-08-30 while the demand forecast runs
to 2026-09-09** — four forecast days with no schedule at all, the nearest
carrying 380 orders. Derive it; if a range ever has full coverage, the queue is
`not_computed` rather than a card about nothing.

**L-R9 — The staffing-curve sentence is computed.** Measured for 2026-08-28: 3
people against 38.4 forecast orders at 20h, then 6 people against 36.1 at 21h.
The shape is right and the prototype's wording ("the shape, not the total, is
what costs you") survives; every number in it must be ours.

**L-R10 — No labour band and no rule on the twelve-week chart.** The prototype
draws 23.9–26.2% and a `26.2` rule. The Overview's own note records
`targets.labor` as `null` — nothing in this schema publishes a labour target.

**L-R11 — A partial week is labelled, never averaged in silently.** Measured:
the newest week holds 182 hours against a ~430-hour norm. `buildPeriods` already
publishes `isPartial`; use it.

**L-R12 — One store trades.** Van Nuys and Glendale are `pre_open` with no
Harri rows at all. Same as Analytics A-R7: every section resolves a reasoned
refusal, never a shell over zero rows (A-R12).

**L-R13 — A bar needs a scale; a scale is not a verdict.** The week strip's bar
is scaled to the range's own extent so it can be drawn at all. That is not the
same as judging a day against a floor, which L-R1 forbids.

---

## File structure

**Create — pure modules (these carry assertions):**

- `src/lib/counter/labor-week.ts` — per-day hours, cost, SPLH and labour
  percent; the blended rate; the week's totals; the twelve-week series.
- `src/lib/counter/labor-leaks.ts` — alert codes classified into leak, saving
  and uncostable, with hours and cost.
- `src/lib/counter/staffing-curve.ts` — shift-to-hour expansion across
  midnight, forecast demand deduped by generation, and the gap between them.

**Create — the adapter:**

- `src/lib/counter/adapters/labor.ts`

**Create — four routes**, mirroring the Analytics layout exactly:

- `src/app/dashboard/(counter)/labor/{page,loading,counter-labor-client}.tsx`
- `src/app/dashboard/(counter)/labor/[storeId]/{page,loading,counter-store-labor-client}.tsx`
- `src/app/(mobile)/m/(counter)/labor/{page,loading,counter-phone-labor-client}.tsx`
- `src/app/(mobile)/m/(counter)/labor/[storeId]/{page,loading,counter-phone-store-labor-client}.tsx`

**Delete:** `src/app/dashboard/(editorial)/labor/**` and
`src/app/(mobile)/m/labor/**`.

**Modify:** `src/middleware.ts` (the store sub-path allowlist already carries
`/dashboard/labor` → `/m/labor`; check before adding), `e2e/fidelity/manifest.ts`.

---

## Task 1: The labour week

**Files:** create `src/lib/counter/labor-week.ts` and
`tests/lib/counter/labor-week.test.ts`.

**Interfaces:**
- Consumes: `prisma`, `DateRange`/`toQueryBounds` from `date-range`,
  `Statement` from `statement`.
- Produces: the exports below. Tasks 4–8 consume these and nothing under them.

```ts
export interface LaborDay {
  /** `YYYY-MM-DD`. */
  key: string
  /** "Wed Aug 26". */
  label: string
  /** Hours actually worked, from `HarriPositionDaily.actualSeconds`. */
  actualHours: number
  /** Hours published, from `HarriShift.minutes`. `null` when no schedule was published. */
  scheduledHours: number | null
  cost: number
  /** Sales over hours worked. `null` with no hours — never `0`. */
  splh: number | null
  /** This day's labour over this day's Total Sales, 0..100. `null` with no sales. */
  laborPct: number | null
}

export interface LaborWeek {
  days: LaborDay[]
  actualHours: number
  scheduledHours: number | null
  cost: number
  /** `cost / actualHours`. The rate the leak ledger costs its hours at. */
  blendedRate: number | null
  splh: number | null
  /** Over TOTAL SALES, not platform sales (L-R2). */
  laborPct: number | null
  overtimeCost: number
}

export interface LaborRole {
  position: string
  payType: "HOURLY" | "SALARIED"
  hours: number
  cost: number
  /** Share of the range's labour cost, 0..100. */
  share: number
}

export interface LaborTrendWeek {
  /** Monday of the week, `YYYY-MM-DD`. */
  key: string
  label: string
  cost: number
  hours: number
  laborPct: number | null
  splh: number | null
  /** Fewer days than a full week fell inside the data (L-R11). */
  isPartial: boolean
}

export function laborWeek(days: LaborDay[], overtimeCost: number): LaborWeek
export function laborDay(input: {...}): LaborDay
export async function loadLaborWeek(input: {
  range: DateRange
  storeId: string | null
  accountId: string
  /** Per-day Total Sales, keyed `YYYY-MM-DD`, off the statement the page already loaded. */
  salesByDay: Map<string, number>
}): Promise<{ days: LaborDay[]; roles: LaborRole[]; overtimeCost: number }>
export async function loadLaborTrend(input: {
  storeId: string | null
  accountId: string
  /** How many weeks back from the range's end. Twelve on both pages. */
  weeks: number
  endingOn: Date
}): Promise<LaborTrendWeek[]>
```

**Sales come from the caller, not from a second query.** The page already loads
a daily statement (Analytics A-R13); labour percent must be taken on the same
Total Sales the P&L prints (L-R2). A loader that fetched its own sales would be
a second answer to a question already answered.

`loadLaborWeek` resolves stores through `accountId` first, exactly as
`loadChannelMix` and `loadServiceProfile` do — without it, `storeId: null` means
every store in the database.

- [ ] **Step 1: Write the module.**
- [ ] **Step 2: Write the assertions**, against the measured table:
  1. The seven days' `actualHours` sum to **432.1**, `scheduledHours` to
     **437.0**, `cost` to **$8,825** (within a cent of `8825.47`).
  2. `blendedRate` is **$20.42/h** to the cent.
  3. `splh` for the range is **$158.76** to the cent; 2026-08-23 is **$183.62**
     and 2026-08-26 is **$134.98**.
  4. `laborPct` on Total Sales of 49,389 is **17.9%** to one decimal —
     **not** the 12.9% a platform-sales denominator gives. Assert both the
     right answer and that the wrong denominator is not what is returned.
  5. A day with hours and no sales yields `splh: null`, never `0`.
  6. A day with no published schedule yields `scheduledHours: null`, never `0`
     — no schedule is not a schedule of nothing.
  7. `laborRole` shares sum to 100 within 0.01, and a SALARIED position with
     $0 and 0 hours still appears with `share: 0` rather than being dropped.
  8. `loadLaborTrend` marks the newest week `isPartial: true` at 182 hours and
     the one before it `false`.
- [ ] **Step 3: Run them.** `npx vitest run tests/lib/counter/labor-week.test.ts`
- [ ] **Step 4: Mutation-check assertion 4.** Swap the denominator to platform
  sales, confirm it fails with 12.9 against 17.9, restore. Report the output.
- [ ] **Step 5: Commit.**
  `git commit -m "feat(counter): the labour week, on the denominator the P&L uses"`

---

## Task 2: The leak ledger

**Files:** create `src/lib/counter/labor-leaks.ts` and
`tests/lib/counter/labor-leaks.test.ts`.

```ts
export type LeakKind = "leak" | "saving" | "uncostable"

export interface LeakRow {
  code: string
  /** "Clocked out late" — the words a manager reads, not the enum. */
  label: string
  kind: LeakKind
  alerts: number
  /** `null` for an uncostable code — NEVER `0` (L-R5). */
  hours: number | null
  /** `hours * blendedRate`, or `null`. */
  cost: number | null
  people: number
}

export interface LeakLedger {
  rows: LeakRow[]
  /** Leak rows only. */
  leakedHours: number
  leakedCost: number
  /** Alerts on codes with no `timeDiffSec`, so the reader knows what is uncounted. */
  uncostableAlerts: number
}

export function classifyAlertCode(code: string): LeakKind
export function leakLedger(
  rows: Array<{ alertCode: string; timeDiffSec: number | null; userId: number }>,
  blendedRate: number,
): LeakLedger
export async function loadLeakLedger(input: {
  range: DateRange
  storeId: string | null
  accountId: string
  blendedRate: number
}): Promise<LeakLedger>
```

**`classifyAlertCode` is the whole point of this module.** A code it has never
seen is `"uncostable"`, not `"leak"` — Harri can add an alert type any day, and
a new code silently counted as money leaving is a number nobody can defend.

- [ ] **Step 1: Write the module.**
- [ ] **Step 2: Write the assertions:**
  1. `LATE_CLOCK_OUT` and `EARLY_CLOCK_IN` classify `"leak"`.
  2. `LATE_CLOCK_IN` and `EARLY_CLOCK_OUT` classify `"saving"`. **Assert this
     explicitly** — it is the difference between a $275 leak and a $509 one.
  3. Every `MISSED_*` and `UNSCHEDULED_*` code classifies `"uncostable"`.
  4. An unknown code — `"SOMETHING_HARRI_ADDED_LATER"` — classifies
     `"uncostable"`.
  5. Over the measured window at a blended rate of 20.42: `leakedHours` is
     **13.47** to two decimals and `leakedCost` is **$275** to the dollar.
  6. An uncostable row has `hours: null` and `cost: null`, not `0`.
  7. `uncostableAlerts` is **41** (28 + 11 + 2).
- [ ] **Step 3: Run them.**
- [ ] **Step 4: Mutation-check.** Make `classifyAlertCode` return `"leak"` for
  an unknown code and confirm assertion 4 fails; make savings count as leaks and
  confirm assertion 5 fails with 24.94 against 13.47. Restore. Report both.
- [ ] **Step 5: Commit.**
  `git commit -m "fix(counter): two of the seven clock alerts are savings, not leaks"`

---

## Task 3: The staffing curve

**Files:** create `src/lib/counter/staffing-curve.ts` and
`tests/lib/counter/staffing-curve.test.ts`.

```ts
export interface StaffedHour {
  hour: number
  /** People on the clock in this hour, from the published schedule. */
  scheduled: number
  /** Forecast orders in this hour, newest generation only (L-R6). `null` where none. */
  demand: number | null
}

export interface StaffingCurve {
  /** In SERVICE-DAY order, not clock order — see `service-profile.ts` (A-R15). */
  hours: StaffedHour[]
  /** The hour where demand most outruns the schedule, or `null`. */
  tightest: number | null
  /** One sentence, computed (L-R9). */
  sentence: string
}

/** Which hours a shift staffs. A shift ending after midnight covers both sides (L-R7). */
export function shiftHours(startHour: number, endHour: number): number[]

export function staffingCurve(
  shifts: Array<{ startHour: number; endHour: number }>,
  demand: Map<number, number>,
): StaffingCurve

export async function loadStaffingCurve(input: {
  date: Date
  storeId: string | null
  accountId: string
}): Promise<StaffingCurve | null>

/** Days the forecast covers and the schedule does not (L-R8). */
export async function loadScheduleGap(input: {
  storeId: string | null
  accountId: string
  from: Date
}): Promise<Array<{ date: string; forecastOrders: number }>>
```

**`shiftHours` is the trap.** `17 → 1` must return `[17,18,19,20,21,22,23,0]`.
An implementation that stops at 23, or that returns an empty array when
`end < start`, silently unstaffs the busiest hours of the night.

**Read `HarriShift.startTime`/`.endTime` with `getUTCHours()`.** They hold local
wall-clock encoded as UTC and the schema says so in its own comment.

**Dedupe the forecast on the newest `generatedAt`** — 13.17× otherwise (L-R6).
`src/lib/counter/forecast-generation.ts` already holds the daily equivalent;
put the hourly one beside it rather than writing a third.

- [ ] **Step 1: Write the module.**
- [ ] **Step 2: Write the assertions:**
  1. `shiftHours(9, 17)` is `[9,10,11,12,13,14,15,16]`.
  2. `shiftHours(17, 1)` is `[17,18,19,20,21,22,23,0]` — **the midnight case**.
  3. `shiftHours(20, 1)` is `[20,21,22,23,0]`.
  4. Over the measured 2026-08-28 schedule, `scheduled` is **3** at 20h and
     **6** at 21h, and the curve's hours come back in service-day order.
  5. `tightest` is **20h** — the hour where 38.4 forecast orders meet 3 people.
  6. The forecast dedupe: a fixture with three generations for one hour returns
     the newest only, and the raw sum would have been 3× larger.
  7. `loadScheduleGap` from 2026-08-27 returns days **from 2026-08-31**, and
     not 2026-08-30, which has a schedule.
- [ ] **Step 3: Run them.**
- [ ] **Step 4: Mutation-check the midnight case.** Make `shiftHours` return
  `[]` when `end < start`, confirm assertions 2, 3 and 4 fail. Restore. Report.
- [ ] **Step 5: Commit.**
  `git commit -m "feat(counter): a shift that ends at 1am staffs both sides of midnight"`

---

## Task 4: The labour adapter

**Files:** create `src/lib/counter/adapters/labor.ts`.

**Read `src/lib/counter/adapters/analytics.ts` first.** It is the same shape,
one page-pair newer, and it already solves: one daily statement folded to the
display grain, per-section promises, `not_computed` over empty shells, and
captions living inside their own section's payload.

**Sections — the group page:**

| key | holds |
|---|---|
| `headline` | the head block: hourly labour %, the reading sentence, and the strip's five cells (L-R3) |
| `week` | the day-by-day strip: hours, SPLH, and a bar scaled to the range (L-R13) |
| `schedule` | scheduled against actual hours, per bucket |
| `curve` | the staffing curve and its computed sentence |
| `roles` | by role: hours, cost, share |
| `leaks` | the leak ledger |
| `decision` | the schedule gap, as a queue (L-R8) |
| `trend` | twelve weeks of labour percent, no rule (L-R10) |

**Sections — the store page:** `headline` (four cells), `schedule`, `roles`,
`leaks`, `week` (a table with a verdict column — **and the verdict is not a
floor comparison**, see L-R1; say what the day cost, not whether it passed),
`trend`.

**Rules:**

1. ONE `loadStatement` at daily granularity, folded here. Its per-day Total
   Sales feed `loadLaborWeek` (L-R2).
2. `not_computed`, never an empty shell (A-R12). A `pre_open` store has no
   Harri rows at all and every section must say so in its own words.
3. Every caption that depends on data lives inside its section's payload.
4. The reading sentence in `headline` is derived. Do not port the prototype's
   "On plan, with one short shift" — say what this week actually did.

- [ ] **Step 1: Write the adapter.**
- [ ] **Step 2: Gate.** `npx tsc --noEmit && npm run tokens`
- [ ] **Step 3: Commit.**
  `git commit -m "feat(counter): one adapter answers both labour pages"`

---

## Task 5: The group page, on the desk

**Files:** create `src/app/dashboard/(counter)/labor/{page,loading,counter-labor-client}.tsx`;
delete the editorial group route; check the middleware.

Composition, in the prototype's order (`P.labor.desk()`, line 5528):

```
headBlock (headline figure + say + action)
  → strip (5 cells)
  → sec "The week, day by day"        : the .wk strip + a computed sentence
  → sec "Scheduled against actual hours" : chart, 2 series, legend
  → sec "The staffing curve"          : chart, 2 series + a computed sentence
  → div.split [ sec "By role" : table ] [ sec "Where the hours leaked" : table ]
  → sec "Needs a decision"            : queue
  → sec "Twelve weeks"                : chart, no rule (L-R10)
```

**The five strip cells:** Hourly labor % · Hours · Sales / labor hour ·
Overtime (dollars, L-R4) · Leaked hours. "With salaried" is dropped (L-R3).

**No floor anywhere** — not on the SPLH cell, not on the week strip, not in a
sentence (L-R1).

- [ ] **Step 1: Write the page, island and `loading.tsx`.**
- [ ] **Step 2: Delete the editorial group route.** Then
  `grep -rn "(editorial)/labor" src/ e2e/ tests/ || echo "no references"`
- [ ] **Step 3: Gate.** `npm run tokens && npx tsc --noEmit && npm run build`
- [ ] **Step 4: Look at it.**
  `npm run shot -- "/dashboard/labor?from=2026-08-20&to=2026-08-26&cmp=weekday" /tmp/labor-desk.png 1440 light 2600`
  Report: the strip's five cells and their values; that the week strip shows
  seven days with no hit/miss colouring; that the staffing curve's two series
  cross where the measured table says they do; and the leak table's totals.
- [ ] **Step 5: Commit.**

---

## Task 6: The group page, on a phone

**Files:** create the four `(mobile)` files; delete `src/app/(mobile)/m/labor/**`.

```
h2.mtitle "Labor" + p.msub
  → mstrip (2 cells: Hourly labor · SPLH)
  → sec "Scheduled vs actual" : chart, ticks off, legend on
  → sec "By role"             : mlist
  → a primary button
```

**The phone calls the same adapter as the desk.**

**Watch the caption trap.** `MCell` opens its band inside `reference ? … : ''`,
so a `caption` with no `reference` renders NOTHING — and on the desk the same
prop renders an EXTRA landmark. The Analytics plan hit both faces of this
(A-R22). Put qualifiers in the delta slot, and give a delta a neutral tone
unless it is genuinely a movement: an untoned `.strip .d` is `var(--good)`.

- [ ] Steps as Task 5, screenshotting
  `"/m/labor?from=2026-08-20&to=2026-08-26" /tmp/labor-phone.png 390 light 1600`.

---

## Task 7: The store page, on the desk

**Files:** create the `[storeId]` desk route; delete the editorial store route.

Composition (`P.laborstore.desk()`, line 7671): store note → strip of four →
"Scheduled against actual" → split of "By role" and "Where the hours leaked"
(a queue here, not a table) → "The week, day by day" (a table) → "Twelve weeks".

**The week table's verdict column does not compare against a floor** (L-R1).

- [ ] Steps as Task 5, screenshotting the Hollywood id AND a `pre_open` store.
  Report what every section renders for `store-chrisneddys-glendale` — it must
  be a reasoned refusal in each, never a heading over a blank panel.

---

## Task 8: The store page, on a phone

**Files:** create the `(mobile)/[storeId]` route; add the store sub-path to the
middleware allowlist if `labor` is not already there.

```
h2.mtitle "<store> labor" + p.msub
  → mstrip (2 cells: Labor % · Leak)
  → sec "Scheduled vs actual" : chart
  → sec "By role"             : mlist
```

- [ ] Steps as Task 6, both stores.

---

## Task 9: Measure the fidelity, then gate it

Same discipline as the Analytics plan, which is not negotiable: **report first,
gate second.**

- [ ] **Step 1:** set both manifest entries to `report: true`, `status:
  "editorial"`, `query: "?range=d7&cmp=weekday"`, with `mobileRoute`s. Run
  `npm run fidelity` and `npm run fidelity:report`.
- [ ] **Step 2:** read all four reports and write down prototype count, ours,
  missing, extra, rendering differences, `.empty`.
- [ ] **Step 3:** account for every difference against a ruling. Expected:
  the "With salaried" cell's landmarks and a `data-n` of 5 against 6 (L-R3);
  whatever the floor's absence removes (L-R1).
  **An EXTRA landmark is never forgiven.** `.empty` must be 0 on all four.
- [ ] **Step 4:** flip to `status: "counter"` with measured baselines,
  `absentLandmarks` for the missing, and `styleAllowances` for the `data-n`
  difference — the mechanism the Analytics plan added for exactly this case.
- [ ] **Step 5:** re-run. `npm run fidelity` must be **61 passed / 78 skipped**
  (49 + 12 gated tests, 90 − 12). Report the numbers.
- [ ] **Step 6:** the roster test in `tests/e2e/landmarks.test.ts` asserts the
  gated set in manifest order and **will fail** until `labor` and `laborstore`
  are added. That failure is expected; add them.
- [ ] **Step 7: Commit.**

---

## Task 10: The whole-branch check

- [ ] Re-run every gate from a clean tree, plus
  `npx playwright test e2e/ --project=desktop --project=mobile`.
- [ ] `ls src/app/dashboard/\(editorial\)/ | grep labor` must find nothing.
- [ ] Confirm one `loadStatement` per (page, range) in the adapter and no
  second sales query anywhere under labour.
- [ ] `graphify update .`
- [ ] Report the final numbers and the four landmark tables.

---

## Carried forward, not fixed here

- **`hasOwnerAccess` always returns true** — `Role` holds only `OWNER` and
  `DEVELOPER` and the guard accepts both. Every owner gate in the app is
  unreachable. A product decision, not a code fix.
- **Nothing links into `/dashboard/analytics/<id>`.**
- **`scripts/fidelity-report.ts` knows about neither allowance**, so a
  committed report prints declared-and-forgiven differences as if they were
  findings.
- **`scopeEmptyReason` duplicates `pnl.ts`'s private `emptyReasonFor`.**
- **Top-item margins vs the food-cost line** were never reconciled.
- **The Otter sync's `adjusted_commission` coverage collapse.**
- **`npm run eval:llm` cannot start on this branch** — `server-only` throws
  under tsx.
